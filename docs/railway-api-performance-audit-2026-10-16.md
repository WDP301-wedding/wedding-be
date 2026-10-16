# Đo hiệu năng API Railway — 16/10/2026

## Kết luận

Đã đo thực tế 18 đường dẫn GET, gồm 19 trường hợp route/quyền, mỗi trường hợp
20 response thành công: **380 mẫu HTTP 200**. Đối chiếu được **380/380 request ID**
với thời gian xử lý trong log ứng dụng của đúng deployment. Có thêm một response
401 do token hết hạn trong lượt chạy dài; giữ riêng lỗi này và bổ sung mẫu bằng
phiên mới, không tính lỗi xác thực thành API nghiệp vụ chạy nhanh.

Các ưu tiên có bằng chứng là analytics refresh, danh sách mẫu thiệp, booking overview,
notification scope và các danh sách đọc nhiều lượt DB. Không có bằng chứng rằng
giảm số bảng nghiệp vụ sẽ giải quyết độ trễ đang thấy.

Backend phục vụ request tại **`railway/us-west2`**, trong khi ingress là **`sin1`**.
Pooler đã lưu cho cùng project Supabase chỉ `ap-southeast-2` (Sydney); DB region này
được suy từ cấu hình pooler khớp project/credential/database, chưa kiểm tra bằng
Supabase Management API/dashboard. Cần xác nhận vùng DB và đo RTT ngay trong
Railway trước khi quy toàn bộ độ trễ cho khoảng cách địa lý. Header phân biệt
edge với nơi chạy ứng dụng theo [tài liệu Railway](https://docs.railway.com/guides/multi-region-api-failover);
định danh vùng theo [Railway](https://docs.railway.com/deployments/regions) và
[Supabase](https://supabase.com/docs/guides/platform/regions).

## Môi trường và phương pháp

- Origin: `https://wedding-be-production-e1dc.up.railway.app`.
- Railway project `1c56721d-021a-442c-9e01-bb91abe73adb`, environment
  `08a2899c-b0d6-4200-a505-604965a4b3fc`, service
  `0f70d648-8c59-48bd-84f3-29a86d2e2d38`.
- Deployment `b1b875c0-25d8-4bcf-a6fe-2484bbb25c74`, commit
  `5b2536212e9a6feafbb48d9a71bba1f90ded08ae`; snapshot trước/sau không đổi.
  Bản tối ưu đọc PR #45 đã có trên target trước khi đo.
- Thực hiện trong chiều 16/10/2026, Asia/Saigon. Timestamp máy đọc được lưu UTC
  trong JSON để đối chiếu Railway. Public probe bắt đầu khoảng 15:38; hoàn tất
  các lượt bổ sung và kiểm tra deployment trước 15:55.
- API public: HTTPS HTTP/1.1 keep-alive, round-robin tuần tự, `Accept-Encoding:
identity`. API có quyền: Node fetch, cùng máy, tuần tự giữa các request; không
  trộn kết quả thành phép so sánh transport HTTP/1.1 và fetch.
- Một initial probe mỗi trường hợp được lưu riêng, không gọi đó là cold start vì
  không restart ứng dụng hay xóa cache. Sau đó lấy 20 mẫu thành công/trường hợp.
- p50/p95 dùng nearest-rank. Với n=20, p95 là mẫu thứ 19 sau sắp xếp; mẫu nhỏ này
  là baseline tải nhẹ, chưa phải SLO, capacity test hay production acceptance.
- `Client` đo đến khi nhận hết response body. `Backend` lấy `durationMs` của
  log ứng dụng, ghép đúng `x-request-id`, không lấy toàn bộ response time làm CPU.
- Không gửi payload nghiệp vụ, token, cookie, mật khẩu, email/contact của response
  vào evidence. Chỉ lưu role, route, status, request ID, thời gian, kích thước và
  số item. Tài khoản do chủ dự án cung cấp; session đo đã thu hồi qua API.
- Có traffic client khác trong cùng thời gian. Consultation list thay đổi 17→18
  item. Đây không phải môi trường đo độc quyền; không gán các thao tác client khác
  trong log cho chương trình audit.

## Kết quả chính

Đơn vị giây. Mỗi dòng có 20 mẫu thành công và 20 log backend tương ứng.
Đường dẫn bên dưới bỏ tiền tố `/api/v1`, trừ health. Danh sách dùng `limit=20`.

| Quyền   | GET                                 |                     Số item trả về | Client p50 | Client p95 | Backend p50 | Backend p95 |
| ------- | ----------------------------------- | ---------------------------------: | ---------: | ---------: | ----------: | ----------: |
| Manager | `/management/analytics/overview`    |            aggregate tháng 10/2026 |      3.112 |     12.543 |       2.862 |      12.299 |
| Manager | `/management/invitation-templates`  |                                  4 |      4.436 |      4.683 |       4.190 |       4.437 |
| Couple  | `/notifications/inbox`              |                                  0 |      3.460 |      3.540 |       3.210 |       3.292 |
| Couple  | `/couple/bookings`                  |                                  0 |      3.432 |      3.523 |       3.197 |       3.295 |
| Manager | `/management/print-orders`          |                                  3 |      2.678 |      2.796 |       2.240 |       2.341 |
| Manager | `/management/catalog/dishes`        |                                  5 |      2.211 |      2.293 |       1.962 |       2.038 |
| Couple  | `/notifications/unread-count`       |                              count |      2.218 |      2.263 |       1.981 |       2.028 |
| Couple  | `/auth/me`                          |                            account |      1.955 |      2.098 |       1.674 |       1.724 |
| Staff   | `/auth/me`                          |                            account |      0.865 |      1.887 |       0.614 |       1.642 |
| Manager | `/management/catalog/menu-packages` |                                  2 |      1.454 |      1.477 |       1.221 |       1.246 |
| Public  | `/catalog/dishes`                   | chưa lưu count trong public runner |      1.110 |      1.432 |       0.866 |       1.189 |
| Manager | `/management/consultation-requests` |                              17–18 |      1.148 |      1.194 |       0.918 |       0.941 |
| Public  | `/catalog/menu-packages`            | chưa lưu count trong public runner |      1.173 |      1.190 |       0.930 |       0.933 |
| Couple  | `/auth/profile`                     |                            profile |      1.005 |      1.033 |       0.763 |       0.780 |
| Public  | `/catalog/restaurant`               |                            profile |      0.708 |      0.757 |       0.465 |       0.466 |
| Public  | `/catalog/halls`                    | chưa lưu count trong public runner |      0.707 |      0.721 |       0.465 |       0.466 |
| Public  | `/openapi.json`                     |                    1,742,554 bytes |      0.392 |      0.535 |       0.017 |       0.029 |
| Public  | `/health/ready`                     |               migrations readiness |      0.401 |      0.523 |       0.156 |       0.157 |
| Public  | `/health/live`                      |                           liveness |      0.245 |      0.260 |      0.0008 |      0.0010 |

Analytics tối đa **13.034 giây ở client / 12.784 giây ở backend**. p95 chứa cả
đường đọc generation hiện có và trường hợp tự refresh; không coi đây là p95 riêng
của warm read hay riêng refresh. Việc phân nhóm hai đường cần instrumentation tiếp.

Health live cho thấy riêng đường truyền/edge/response đã khoảng 245 ms trung vị,
trong khi code liveness dưới 1 ms. Readiness thực hiện đọc lịch sử migrations qua
một pool riêng, mất khoảng 156 ms trong backend khi đã kết nối. Đây là bằng chứng
về chi phí đường đọc DB rất nhỏ, chưa thay thế phép đo RTT Railway→DB trực tiếp.
Các response nghiệp vụ chậm chỉ vài chục đến vài nghìn byte, nên không thể giải
thích tất cả bằng tải response lớn. OpenAPI 1.66 MiB có chi phí truyền riêng và
không đại diện cho endpoint dữ liệu nghiệp vụ.

## Database: thực tế có bao nhiêu bảng?

Đọc metadata trên **đúng `DATABASE_URL` của service Railway**, trong transaction
`READ ONLY`, giới hạn mỗi statement 2 giây. Chỉ ánh xạ file CA `/app/certs/…`
sang file CA tương ứng trong repo để chạy từ desktop; giữ `sslmode=verify-full`.
Không hạ xác thực TLS. URL local khác URL deploy; không sử dụng nhầm phép đo
pooler local làm bằng chứng của kết nối trực tiếp từ Railway.

| Nhóm                                         | Số bảng | Nhận định                                                                   |
| -------------------------------------------- | ------: | --------------------------------------------------------------------------- |
| `public`                                     |     145 | 144 model Prisma + `_prisma_migrations`                                     |
| Ba schema `ntf12_rehearsal_*` / `ntf_rv16_*` |     363 | Có thể rà soát dọn môi trường sau khi xác minh ownership/evidence; chưa xóa |
| `auth`                                       |      27 | Provider-owned                                                              |
| `storage` / `realtime` / `vault`             |      12 | Provider-owned                                                              |

Toàn bộ 144 model đều có bảng tương ứng; public không có bảng lạ ngoài migrations.
Snapshot đầu khoảng 10.48 MiB, snapshot sau khoảng **10.56 MiB**, tính cả index/TOAST;
thống kê ước lượng khoảng 4.7 nghìn rows. Chênh lệch hai snapshot trong lúc có
audit/client/worker traffic không phải bằng chứng bloat. `n_live_tup` không phải
COUNT chính xác; bảng ước lượng rỗng không được mặc định là bảng thừa.

Ví dụ EXPLAIN ANALYZE có giới hạn trên dữ liệu live hiện tại:

| SELECT nhỏ dùng để kiểm tra     | DB execution | Access path                                  |
| ------------------------------- | -----------: | -------------------------------------------- |
| Trang head mẫu thiệp active     |     0.043 ms | `InvitationTemplate_pkey`                    |
| Trang ID sảnh active            |     1.328 ms | bitmap index + sort nhỏ                      |
| Lookup token hash không tồn tại |     0.043 ms | `AccessCredential_tokenHash_key`, index-only |

Đây là query đại diện nhỏ, không phải toàn bộ SQL của endpoint. Lookup hash không
tồn tại không chứng minh chi phí đường có account/session/roles thực. Trong
`pg_stat_statements` tích lũy, các SELECT public có tổng execution lớn nhất được
trích xuất có mean khoảng 0.02–0.88 ms; không dùng mean đó thay cho tail latency
hay tổng round trip của một request. SQL text/parameters không lưu vào evidence.
[PostgreSQL EXPLAIN](https://www.postgresql.org/docs/17/using-explain.html) cũng
phân biệt chi phí plan với thời gian truyền kết quả tới client.

**Chưa đề xuất bỏ bảng nghiệp vụ nào.** Thiết kế hiện tại dùng bảng riêng cho
immutable revisions, audit, idempotency, ledger, outbox và các owner projections.
Gộp/xóa các bảng này có thể làm hỏng lịch sử, concurrency hoặc settlement ngay cả
khi chúng đang ít dữ liệu. Inventory 145 bảng có size, estimate, index/FK và file
runtime tham chiếu; phép quét tham chiếu chỉ là hỗ trợ, không phải proof an toàn để xóa.

## Chỗ cần cải thiện và mức chắc chắn

1. **Vùng triển khai — đo được topology, chưa đo được lợi ích di chuyển.**
   Actual upstream ở US West; cùng project DB có pooler Sydney. Ưu tiên xác nhận
   vùng DB, đo từ container rồi thử application APAC với build/DB không đổi.
   Không chuyển database hay deployment trong audit.
2. **Mẫu thiệp — đo được API chậm và thấy pattern theo item trong source.**
   `DesignService.listTemplates` đọc head, query current version theo từng template,
   và thực hiện authority checks đầu/cuối. Batch versions và hợp nhất owner reads
   có kiểm chứng; không bỏ recheck hoặc cache quyền để đổi tốc độ.
3. **Print orders — source có các query tuần tự theo từng order.**
   `listManagementPrintOrders` đọc lines, commercial revision và pending proposal
   trong vòng lặp await. Batch theo trang, giữ đúng các immutable revision.
4. **Identity/notifications/overview — nhiều lượt đọc authority/scope.**
   Identity resolver tải credential/session/account/roles; Notifications còn resolve
   ở middleware rồi trong service, kiểm tra role transaction và lấy booking scope.
   Couple list và inbox rỗng vẫn mất khoảng 3.2 giây trong backend. Cần trace query
   cụ thể và gộp reads trong cùng phạm vi hợp lệ, không kết luận chỉ một query chậm.
   `/auth/me` giữa hai account cũng khác phân bố; cần kiểm tra thay vì suy từ số bảng.
5. **Analytics — GET có nhánh tạo/làm mới dữ liệu tổng hợp.**
   Service có freshness 60 giây/invalidation; projector đọc các owner và publish
   generation mới, thay thế generation dẫn xuất cũ. Đây là side effect hiện có
   của GET đã đo; không mô tả audit HTTP là toàn bộ SQL read-only. Tách warm/stale/
   concurrent-first-read, coalesce refresh và xem xét lịch chạy phù hợp contract.
6. **Catalog — có repeated media/resource queries và pagination trong memory.**
   `listSigned` kiểm tra lại resource rồi lấy asset cho mỗi item; halls tải toàn bộ
   active list trước khi slice. Có hướng batch/push pagination xuống SQL. Signed URL
   có expiry/authority, nên không thêm cache toàn cục tùy tiện.
7. **Pool — rủi ro cấu hình, chưa có proof đang cạn.**
   Tám runtime tạo Prisma client/pool riêng, mặc định tối đa 10 mỗi pool, thêm pool
   readiness. DB báo max_connections 60. Snapshot sau không có lock waiter hay
   transaction đang giữ; không kết luận exhaustion chỉ từ tổng lý thuyết 81.
   Đo active/waiting và budget theo replica/worker trước khi đổi pool.

Hướng batch/N+1 và quản lý pool được đối chiếu với
[Prisma](https://www.prisma.io/docs/orm/v7/prisma-client/queries/advanced/query-optimization-performance)
và [node-postgres](https://node-postgres.com/features/pooling). Những thay đổi trên
là kế hoạch thử nghiệm; chưa có số before/after Railway chứng minh bản sửa mới.

## Giới hạn và thao tác đã thực hiện

- Tài khoản Couple được cung cấp có **0 booking**, inbox **0 item**. Chưa đo đường
  nghiệp vụ có booking: Guest/groups/planning, current Seating/options, invitation
  designs, billing/contracts hoặc check-in Staff theo event được phân công.
  Không tạo booking, chuyển quyền, seed settlement hay khởi tạo Guest để lấp chỗ trống.
- Chỉ đo Staff `/auth/me`; không coi đó là bằng chứng tốc độ search/check-in event.
- Không benchmark POST/PATCH/DELETE nghiệp vụ, AI, checkout/payment callback,
  email delivery, upload hoặc render/PDF provider. Không stress/load test shared DB.
- HTTP login/logout/revoke tác động các phiên test; một lỗi 401 do token hết hạn
  được giữ riêng. Phiên audit ban đầu được xác định bằng đúng login audit request ID,
  thu hồi qua owner-session API; không revoke toàn bộ phiên của tài khoản.
- Analytics GET có thể thay thế projection dẫn xuất theo luồng runtime có sẵn.
  Không chạy SQL sửa dữ liệu, migration, reset, seed hoặc cleanup schema thủ công.
  Không gọi paid generation, giao dịch tiền hay provider write chủ động.
- SSH container không có key đã liên kết hợp lệ; không tạo key, liên kết tài khoản,
  thay đổi cấu hình hay deploy để vượt trở ngại. Desktop SELECT 1 trung vị khoảng
  273 ms chỉ là desktop→DB, không phải Railway→DB.
- Các lần probe thất bại vì SSH identity/CA path được xử lý riêng. Dùng đúng
  `certs/supabase-root-ca.crt` sau khi ánh xạ đường dẫn; giữ nguyên TLS verification.

## Kế hoạch và bằng chứng

Kế hoạch chi tiết, dependencies, acceptance và checkpoint:
[tasks/plan.md](../tasks/plan.md). Trạng thái PERF-01–13 nằm trong
[backlog backend](../tasks/backend-revision-todo.md#railway-performance-extension--2026-10-16).
Ưu tiên: attribution + topology, sau đó Identity/templates/notifications/print,
catalog và analytics; việc review xóa bảng là luồng riêng.

Artifacts tại `output/railway-api-performance-20261016/`:

- `summary.json`: 19 trường hợp đo, client/backend p50/p95, correlation, topology,
  schema statistics và limits. `public.json`, `authenticated.json`: mẫu gốc đã lọc.
- `application-logs.json`: request logs đã lọc, không gồm raw request/payload/token.
  Không dùng histogram của traffic hỗn hợp thay cho 380 mẫu ghép request ID.
- `database-desktop.json`, `table-inventory.json`, `table-inventory.csv`: metadata,
  EXPLAIN summary, query IDs/thống kê tích lũy và inventory từng bảng.
- `deployment.json`, `topology.json`, `region-probes.json`: target và actual upstream.
- `audit.mjs`, `database-remote.cjs`, `authenticated.mjs`, `finish-authenticated.mjs`,
  `summarize.mjs`: chương trình đo. Credential file riêng đã xóa sau cleanup;
  muốn đo lại cần cung cấp lại file private, không ghi credential vào script/evidence.

Không thay application source, dependencies, OpenAPI, migrations hay sibling frontend.
Đây là kết quả audit và kế hoạch; chưa triển khai tối ưu, đổi vùng hay xóa bảng.

Kiểm tra kết quả: đủ 19 trường hợp × 20 mẫu thành công, 380/380 log correlation,
7/7 thao tác cleanup session trả 204; không còn credential file của chương trình
đo. Quét artifact không thấy opaque access/refresh/invitation token. Local document
links, Prettier của báo cáo và `git diff --check` đều đạt; task files giữ quy ước
Markdown thủ công của repo. Không chạy lại application test suite vì không sửa
source/schema; không chuyển các kiểm tra tài liệu này thành proof tính năng/provider.
