# Rà soát độ trễ BE → FE, ngày 2026-10-22

## Phạm vi và kết luận

- Source được đọc tại HEAD `6554a69c35cc2342cc28046a21d9559c2bf7adc7`; working tree sạch khi bắt đầu.
- Chỉ audit wedding-be. Không sửa implementation, migration, cấu hình hay frontend; không commit/push/deploy.
- Có thêm cơ hội tối ưu đáng kể sau đợt sửa trước. Ưu tiên lớn nhất là **giảm thời gian giữ khóa/connection khi chờ Storage**, giảm ký URL lặp, giảm refresh analytics và số round trip xác thực trong transaction.
- Chưa có production traces, deployed SHA, cấu hình pool thực tế, `pg_stat_statements` hoặc EXPLAIN trên dữ liệu đại diện. Không quy mọi request chậm cho SQL và không cam kết mọi API dưới 800 ms từ audit này.
- Không ghép các API hiện hữu. Giữ authorization/revocation, thứ tự khóa, quota, revision, idempotency, immutable history và settlement evidence.

## Bằng chứng thực hiện

### 1. Kiểm chứng tranh chấp khóa media trên PostgreSQL thật, Storage có kiểm soát

Tạo database UUID riêng bằng `CatalogTestDatabase`, áp dụng migration, tạo fixture booking/media, gọi production `MediaService.preview`. Chặn duy nhất boundary `Storage.createSignedReadUrl` bằng Promise gate; không gọi Supabase thật, không dùng sleep để giả lập kết quả.

Trong lúc ký URL còn pending, một transaction khác thử:

```sql
SELECT pg_try_advisory_xact_lock_shared(hashtext(:bookingId::text));
```

Kết quả được assertion xác nhận:

| Thời điểm                    | Lấy được shared booking lock |
| ---------------------------- | ---------------------------- |
| Storage signing đang pending | `false`                      |
| Preview đã hoàn tất          | `true`                       |

Vitest: **1 file / 1 test passed**, exit 0, tổng runner 5,87 giây. Đây là bằng chứng giữ khóa xuyên external IO, không phải benchmark response production. Lần chạy đầu không kết nối được cổng local; đã sửa lệnh khởi động cluster sang đúng cổng 55439 rồi chạy đạt. Có cảnh báo pg hiện hữu về query đồng thời trên một client; không tắt cảnh báo.

Test audit tạm đã được xóa khỏi source, bản tái lập được lưu tại `C:/Users/Admin/AppData/Local/Temp/codex-media-lock-audit-2026-10-22.test.ts` (đặt lại trong thư mục integration/invitation-studio nếu chạy lại). SHA256 `9F38446CB960FB3FA1D7AC2AEA8A7189BA5B94CE32C318C0F4EFE52CC0F96E9A`. PostgreSQL riêng đã dừng; không dùng DB trong `.env`.

### 2. Mẫu GET công khai từ máy người dùng tới BE deploy

Endpoint: `https://wedding-be-production-e1dc.up.railway.app`. Đo ngày 2026-10-22 khoảng 14:19 ICT, tuần tự, 3 request/route, không login/ghi dữ liệu/load test. Thời gian gồm mạng, server và đọc hết body.

| Route                        | HTTP | Lượt 1   | Lượt 2 | Lượt 3 | Body      |
| ---------------------------- | ---- | -------- | ------ | ------ | --------- |
| `/health/live`               | 200  | 585 ms   | 413 ms | 246 ms | 77 bytes  |
| `/health/ready`              | 200  | 1.536 ms | 402 ms | 361 ms | 78 bytes  |
| `/api/v1/catalog/restaurant` | 200  | 1.925 ms | 675 ms | 705 ms | 401 bytes |

Các response không có `Content-Encoding`; body rất nhỏ nên đây không phải bằng chứng cần compression. Health/live không truy vấn DB trong handler, nên độ trễ quan sát được còn có phần ngoài SQL. Không trừ hai mẫu độc lập để suy ra chính xác DB time. Mẫu quá nhỏ để tính p95/p99, chứng minh cold start hay xác định nguyên nhân request 4 giây. Chưa xác minh deployed SHA trùng source đang audit.

## Phát hiện và hướng tối ưu

### P1 — Media upload/preview giữ exclusive booking lock khi chờ Storage

Nguồn:

- `src/modules/invitation-studio/application/media.service.ts:53`: upload thực hiện inspect ảnh, journal và `Storage.put` bên trong `runCommand/runLocked`.
- Cùng file `:248`: GET preview gọi `runLocked`, ký URL tại `:266` rồi kiểm tra quyền lại trước khi trả.
- `src/modules/invitation-studio/infrastructure/prisma-media.repository.ts:47`: nạp policy, toàn bộ active assets/currentFile (tối đa 101 để phát hiện vượt quota), reservations; clone state dù preview chỉ cần một asset.
- Cùng file `:204` trở đi: runtime dùng `boundary.run`, không phải shared read boundary. `src/core/database/booking-boundary.ts` dùng exclusive theo mặc định.
- `prisma-media.repository.ts:243`: upload journal dùng connection độc lập trong khi acceptance transaction còn giữ connection. Comment của repository xác nhận cần connection thứ hai.

Tác động: Storage chậm làm request khác cùng booking chờ khóa; concurrent upload trên nhiều booking còn có nguy cơ chiếm hết pool trong lúc mỗi transaction cần thêm connection cho journal. Rủi ro pool này được suy ra từ code, chưa load-test tái hiện. `Promise.all` nhiều Prisma query trong cùng transaction không tạo thêm connection hay SQL song song thực sự; hiện còn phát cảnh báo queued-query của pg.

Hướng sửa:

1. Preview dùng read projection chỉ lấy đúng asset/file trong transaction ngắn; ký URL sau khi trả connection; transaction ngắn tiếp theo kiểm tra lại quyền, detach, revision/policy trước khi trả URL.
2. Upload: durable intent + quota reservation/lease, decode và Storage ngoài transaction; accept trong transaction ngắn với revalidation và recovery cho unknown outcome. Tận dụng mô hình external work đã có ở derived assets/generation.
3. Không chỉ bỏ lock hoặc bỏ final authorization: sẽ tạo race, vượt quota hoặc lộ media đã bị thu hồi.

### P1 — Catalog còn một network call ký URL cho mỗi ảnh

Nguồn: `src/modules/venue-catalog/application/catalog-media.service.ts:123`, `:294`, `:303`, `:428`; `src/integrations/storage/supabase-storage-provider.ts:174`.

SQL được batch nhưng `listSignedBatch` vẫn `Promise.all(assets.map(signAsset))`; mỗi asset gọi provider thật. Hall page còn có fan-out hai tầng. Không thấy cache/in-flight dedup trong wiring runtime đã đọc. Đây là external-call fan-out, không phải SQL N+1.

Hướng sửa: provider batch signing nếu contract/SDK hỗ trợ, giới hạn concurrency, dedup theo object bất biến và TTL; cân nhắc cache URL cho catalog với invalidation đúng lifecycle. Không biến private bucket thành public hoặc dùng cache quyền riêng tư chung giữa booking/account. Giới hạn concurrency kiểm soát tải; bản thân nó không bảo đảm một request đơn lẻ nhanh hơn.

### P1 — Analytics refresh vẫn đọc/ghi lại cả generation

Nguồn:

- `analytics-dashboard/application/analytics.service.ts:94–142`: HTTP stale/missing có thể chờ refresh rồi load lại.
- `application/projection.ts:81`: load toàn bộ previous projection; sau xử lý delta vẫn gọi publish tại `:174`.
- `infrastructure/projection.repository.ts:55`: tạo generation, insert toàn bộ rows từng chunk 500, cập nhật head, xóa generation cũ trong transaction.
- `analytics.runtime.ts:26`: scheduler gọi projector trực tiếp. HTTP có map gom refresh tại service `:60`, nhưng scheduler đi ngoài map đó.

Tác động tăng theo lịch sử/số manager, có thể refresh trùng scheduler/HTTP dù CAS vẫn bảo vệ tính đúng khi publish.

Hướng sửa theo thứ tự: một coordinator refresh dùng chung theo scope; no-op khi source fences không đổi nhưng vẫn cập nhật freshness/checkpoint đúng contract; sau đó mới thiết kế incremental projection. Giữ scope isolation, generation/cursor consistency và source-not-ready semantics. Không tự tăng TTL, trả stale như fresh hoặc bỏ CAS.

### P1/P2 — Xác thực trong transaction có nhiều round trip lặp

Nguồn: `identity-access/authorization/scoped-identity.reader.ts:21–50`.

Khi có active scope, mỗi lần resolve hợp lệ đi qua: reference read, Account lock, roles lock, Session lock, credential lock, joined credential read — **6 SQL tuần tự theo source**. Một số service guard trước/sau thao tác nên chi phí lặp lại. Ngoài transaction, preflight đã dùng joined reader một query; không phải mọi auth request đều chạy sáu query.

Hướng sửa: authority read context tái sử dụng **chỉ trong đúng transaction đã khóa**, vẫn kiểm tra expiry/time ở mỗi use, invalidate khi authority đổi. Sau external IO/new transaction luôn phải đọc mới. Có thể đưa `clientKind` vào projection hiện hữu để tránh lookup phụ. Không dùng global token cache, không bỏ revocation guard hoặc đổi lock order tùy tiện. Cần đo query budget từng route trước/sau thay đổi.

### P2 — GET payment attempt có thể chờ VNPay ngay trong HTTP request

Nguồn: `payments-billing/http/payments-billing.http-services.ts:329–350`; `application/vnpay.service.ts:241`; `infrastructure/vnpay.gateway.ts:7`.

Pending/unknown VNPay attempt có thể gọi query provider với timeout mặc định **5.000 ms** trước khi trả response. Terminal attempt không query provider theo nhánh này. Provider query đã ở ngoài booking transaction — không phải lỗi giữ khóa như media.

Hướng sửa: dedup reconcile theo attempt, cooldown theo evidence/timestamp, worker/IPN làm phần lớn reconcile, HTTP đọc trạng thái đã biết theo chính sách freshness rõ ràng. Nếu đổi GET từ synchronous reconcile sang read-only cần xác nhận contract/FE expectations. Tuyệt đối không biến timeout thành FAILED, không cache SUCCEEDED trước settlement hoặc bỏ idempotency/evidence.

### P2 — Admin catalog phân trang đầu mục nhưng không giới hạn lịch sử lồng bên trong

Nguồn: `venue-catalog/application/catalog-query.service.ts:90`, `:104`, `:213`, `:224`, `:235`, `:252`, `:281`, `:318`.

List dishes/menu/timeline/layout lấy versions không có `take`; menu history còn kéo items/dish versions, layout kéo geometry/table identities. Một page nhỏ vẫn có thể trả nhiều lịch sử và tốn query, mapping, JSON serialization.

Hướng sửa: list projection gọn và history được phân trang/đọc theo nhu cầu **nếu response contract cho phép**. Không âm thầm cắt history đang được FE sử dụng. Trước mắt đo row count/bytes của list có nhiều revisions, bỏ field nội bộ không thuộc DTO nếu có; tránh nạp graph lớn chỉ để lọc bỏ sau đó.

### P2 — Guest import còn write amplification; report có vòng tìm kiếm O(G²)

Nguồn: `guest-management/application/guest.service.ts:521–574`; `infrastructure/guest.repository.ts:70–115`; `guest.service.ts:611–628`.

Reference reads đã batch, nhưng mỗi row thay đổi vẫn await guest create/update, history create và audit create. Đây là **3 Prisma write calls/row thay đổi**, không phải số SQL round trip đã đo; các query khác của command chưa tính. `report` lấy toàn bộ groups và group counts rồi `membership.find` cho từng group.

Hướng sửa ít rủi ro: Map group counts để O(G), batch inserts/history/audit nhưng giữ đủ record/revision và nguyên thứ tự lỗi/atomicity. Update nhiều row khác dữ liệu cần thiết kế riêng. Không xóa audit/history để chạy nhanh. Import lớn là SLO riêng với ordinary GET.

### P2 — Billing append vẫn đọc full ledger; tổng hợp GET vẫn tăng theo ledger size

Nguồn: `payments-billing/infrastructure/billing.persistence.ts:161`, `:400`, `:500`.

GET history đã keyset và tính tổng SQL; không còn nên báo là GET luôn nạp full ledger. Tuy nhiên append validation còn `readLedger`; aggregate SUM vẫn phải xét các entry liên quan khi lịch sử tăng.

Hướng sửa dài hạn: transactional balance projection cập nhật cùng append, kiểm chứng/reconcile với immutable ledger; projection theo payment/refund khi phù hợp. Chỉ làm sau EXPLAIN và benchmark booking có lịch sử lớn. Không dùng cache rời làm nguồn tính tiền, không thay integer VND hoặc rewrite invoice/contract.

### P2 — Pool/worker/deployment có thể là phần đáng kể của latency

Nguồn: `core/database/pool-budget.ts`; `core/database/prisma.ts`; các runtime analytics/studio/notifications.

Default owner pool max 3; 6 common pools + catalog + analytics + readiness = **25 connection capacity/process**, không phải 25 connection luôn mở. Acquire timeout 2 giây, idle timeout 10 giây. Worker và HTTP dùng chung owner pool. Actual deployed settings/topology chưa được xem.

Hướng xử lý: đo acquire time, waiting count, lock time và query time riêng; ưu tiên worker admission và loại bỏ transaction dài trước khi tăng pool. Kiểm tra BE/DB/Storage region, public/private DB URL, CPU/RAM và DB IO bằng cấu hình/log thật. Không tăng tất cả pool/replicas vượt DB capacity. Mẫu readiness đầu chậm chưa đủ chứng minh reconnect là nguyên nhân.

## Các điểm phụ và giới hạn

- `guest-readers.ts:193`: search dùng `strpos`/rank trên guest active trong booking; catalog substring search dùng insensitive contains. Index B-tree không trực tiếp tăng tốc mọi substring predicate. Chỉ thêm trigram/expression index sau EXPLAIN (ANALYZE, BUFFERS) trên dữ liệu đại diện và giữ chính xác normalization/ranking/pagination.
- `prisma-media.repository.ts:277`: recoveryPage lookup receipt từng attempt là N+1 thực sự có thể batch; đây là reconciliation nội bộ, ưu tiên sau FE hot paths.
- PDF/image work có CPU và external reads; artifact cache chỉ phù hợp snapshot bất biến với quyền truy cập được kiểm tra mới. AI image jobs đã async; không nên mô tả toàn bộ AI là HTTP blocking.
- Những điểm đã cải thiện ở HEAD: import reference batching; billing keyset/SQL totals; commercial catalog batching; public invitation joined read + revocation check; bounded PDF asset reads. Không coi chúng là chưa làm để tối ưu lại mù quáng.

## Thứ tự triển khai và tiêu chí chấp nhận đề xuất

1. Bật/tận dụng diagnostics hiện hữu theo route: response duration, pool acquire, SQL count/round-trip, advisory/row-lock time, provider time, response bytes. `core/database/diagnostics.ts` đã có instrumentation opt-in; lockRoundTripMs bao gồm toàn round trip của lock statement, không phải thời gian chờ lock thuần. Không log token/PII/SQL parameters.
2. Sửa media critical section và exact-asset read; kiểm chứng concurrent preview/upload/revoke/replacement/quota/recovery.
3. Catalog signing dedup/batch/bounded concurrency; analytics shared refresh/no-op.
4. Giảm authority reads trong locked scope; tối ưu list graphs, guest bulk writes và billing projections theo số đo.
5. Đo p50/p95/p99 trên dataset đại diện, warm/cold, concurrent requests giống lúc FE mở trang, theo từng route. So sánh với cùng workload trước thay đổi. Ordinary GET đặt mục tiêu p95 <800 ms tại vùng đo đã thống nhất; upload/provider reconciliation/export cần budget riêng.

Không thể bảo đảm “mọi API siêu nhanh” bằng giảm số query đơn thuần: thời gian chờ lock/pool/provider và mạng có thể lớn hơn thời gian thực thi SQL. Audit này xác định các điểm cần sửa; chưa triển khai các hướng sửa trên và chưa chứng minh SLO production.
