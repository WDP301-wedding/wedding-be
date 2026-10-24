# Review bản đã push — Realtime/Redis round 2 — 2026-10-23

## Kết luận

**Có tiến bộ, nhưng chưa đạt realtime end-to-end chính xác; chưa thể nghiệm thu toàn bộ F1–F8.** Đã sửa vòng import Couple và protocol Manager, thêm refcount/guards và một số data-owner listeners. Các lỗi relay reliability, credential expiry/current authorization, coverage UI và Redis distributed validation vẫn còn.

Đã đối chiếu bằng `git ls-remote origin refs/heads/main`, local HEAD trùng remote main:

| Repository | SHA |
| --- | --- |
| wedding-be | `fc67bb412d4275b49eca45b5c343cddfaf9a9826` |
| wedding-web | `3aa147385ee538da8f4de016512b7edaccb8c873` |
| wedding-manage-web | `d8416129ec15436237b790fe1b22fcffb2f4aebb` |

Working trees ba repo sạch khi bắt đầu. Push/remote SHA không chứng minh deployed runtime SHA hoặc production E2E. Codex không sửa implementation, commit/push/deploy hay gửi Anti đợt sửa mới trong lượt này. Wedding-app working tree sạch khi đọc.

## Những điểm đã sửa được

- Couple realtime transport không import ngược identity-page/browser-session. Existing `bootstrap-regression.test.ts` đã chạy đạt **1/1**, thay vì fail import như lượt trước.
- Manager đã nghe `realtime:event`, gọi resync khi connect và có eventId dedup; actual Manager client trong probe mới đã nhận callback từ BE socket.
- Couple subscriptions dùng refcount và loader disabled có truyền enabled; server dùng union rooms để tránh packet duplicate do booking+manager membership.
- Guest/seating/billing Couple có thêm listeners trực tiếp, không chỉ reload proposal.
- Có Redis init cho general client, production thiếu URL bị chặn, Redis được đưa vào readiness; realtime dùng lại booking Prisma pool.
- Relay có thứ tự asc/cursor, single-flight poll và release lease khi **mock publish đồng bộ** ném lỗi. Các cải thiện này chưa giải quyết hết delivery semantics dưới đây.

## R1 — P1: Relay kẹt sau restart hoặc khi node khác đã xử lý trang đầu

Nguồn: `src/core/realtime/realtime-outbox-relay.ts:128–173`, tương tự cả 5 streams.

Cursor chỉ tiến sau khi `leased=true` và publish. Nếu event đã có Redis receipt, `tryAcquireLease` trả false, code `continue` nhưng không cập nhật cursor. Sau restart cursor null, nếu 50 event đầu có receipt thì mỗi lần poll đọc lại cùng trang đó, không bao giờ tới event đang chờ phía sau.

Probe: 60 committed synthetic events; instance A phát 50 và ghi receipt trong controlled Redis store; instance B khởi động với cùng receipts. Hai lượt B poll đều **0**, không tới 10 event pending. Đây là stall thật của query/control flow, không phải chỉ đổi desc thành asc là đã drain backlog an toàn.

Ngoài ra, không được sửa mù bằng advance qua mọi non-leased row: row đang lease ở node chết có thể bị bỏ qua vĩnh viễn khi lease hết. Cần durable pending/delivered state và recovery đúng.

## R2 — P1: Cursor theo timestamp vẫn bỏ event commit muộn

Cùng relay: cursor order là occurredAt/id hoặc createdAt/eventId. Transaction cũ có thể ghi timestamp trước nhưng commit sau transaction mới. Khi cursor đã qua row mới, row cũ vừa commit sẽ nằm phía sau cursor và không được đọc nữa.

Probe: publish row tại t=2, sau đó cho row t=1 trở nên visible trong controlled read store; poll sau trả **0**, row t=1 không được phát. Mô hình này tái hiện committed visibility và đúng query ordering; không tự nhận là native PostgreSQL concurrency benchmark.

Cần chọn unprocessed committed events bằng receipt/lease independent, late-commit-safe recovery; không high-water timestamp/sequence đơn thuần. Không dùng monotonic allocation làm commit-order guarantee.

## R3 — P1: Receipt vẫn có thể ghi trước dispatch vì broker trả void

- `realtime-outbox-relay.ts:170–173`: gọi `broker.publish`, rồi mark receipt và advance cursor.
- `realtime-broker.ts:48–66`: publish gọi fire-and-forget async IIFE, await onBeforeDispatch bên trong nhưng trả về ngay.

Probe dùng **broker implementation thật**, controlled IO boundary và Promise gate giữ pre-dispatch: relay poll đã trả 1 và có `rt:receipt:booking:audit-1=1` trong lúc emit vẫn **0 lần**. Crash hoặc adapter/network fail lúc này vẫn làm mất event. Thử sync `vi.fn().throw` trong permanent test không bao phủ đường async production này.

Broker còn đánh dấu seen trước dispatch; onBeforeDispatch error được catch rồi vẫn emit. Cần awaitable publish semantics, fail-closed authorization và durable retry/gap resync; Socket.IO emit trả về không đồng nghĩa client đã nhận hoặc Redis đã persist.

## R4 — P1: Current credential/authorization chưa được kiểm tra đúng

Nguồn: `realtime-server.ts:92–124`, `:187`, pre-dispatch hook và subscribe handlers.

- tokenExpiresAt tự gán `Date.now()+15 phút`, không lấy expiry của credential thực.
- validateSocketSession chỉ xét sessionStatus/accountStatus; bỏ credentialStatus, credentialExpiresAt, idle/absolute expiry và roles/grants/assignment mới.
- Positive cache return trước expiry check; lỗi repository trả **true**. onBeforeDispatch error cũng không chặn emit.
- Booking room quyền RESTRICTED/FULL/Staff assignment chỉ xét lúc subscribe; grant downgrade/unassignment không có eviction/recheck tương ứng.
- Hook chỉ xét sockets local của node publish; Redis adapter cross-node fanout không tự áp dụng hook của node nhận. Native multi-instance authorization chưa có evidence.

Probe socket loopback thật + Manager client thật, identity account/session cố định:

1. Credential hợp lệ khi handshake, expiry cố định sau 1 giây.
2. Advance kiểm soát Date.now tới +3 giây để vượt cache 2 giây; lookup vẫn trả credential đã hết hạn, session/account ACTIVE.
3. Event vẫn tới Manager callback, lookup đã chạy lại.
4. Cho authority repository lỗi ở +6 giây; event tiếp theo vẫn tới, socket connected.

Không phải lỗi protocol còn lại: packet/callback đã hoạt động. Đây là lỗi validation/fail-open của đường mới. Explicit broker.revokeSession helper đã được nối cho một số session operations, nhưng test gọi helper trực tiếp không chứng minh expiry/remote privilege changes an toàn.

## R5 — P1/P2: Publisher và data-owner coverage còn thiếu

- Catalog/notification events vẫn chỉ có type/helper, không có production publisher/callsite đầy đủ. Relay vẫn chỉ có 5 stream, không có complete consultation/profile/access/notification/catalog feed.
- Manager `addCatalogInvalidationListener` được thêm nhưng tìm toàn source chỉ thấy **definition**, chưa có component đăng ký. Vì vậy registry mới không tự refetch catalog như báo cáo khẳng định.
- Couple overview vẫn subscribe booking đầu danh sách. Account room được join nhưng booking events không được route tới owner account room; booking mới chưa subscribe không tự xuất hiện chỉ vì mở rộng filter ở một hook.
- useRealtimeSubscription lọc bookingId trước khi gọi callback, nên callback mở rộng trong workspace không tự nhận event booking khác đã bị filter hoặc chưa có room.
- Invoice/design/media/notification unread và nhiều panes chưa có coverage matrix/callsites. Guest/seating/billing listeners mới là cải thiện một phần.
- Hai web vẫn resync ngay sau emit subscribe, không chờ ACK; vẫn có khoảng trống fetch-before-subscribe mất update.

Chưa có evidence browser hai account Manager/Couple trên mọi flow; không thể kết luận đã bỏ F5 toàn hệ thống.

## R6 — P2: Redis/rate-limit hoàn thiện một phần, chưa native verified

- General Redis client đã await init, nhưng `createPubSubPair()` vẫn tạo clients lazyConnect=true/offlineQueue=false rồi đưa adapter subscribe ngay, không await ready cho pair này.
- IP socket key lấy X-Forwarded-For trực tiếp, không dùng trust-proxy policy. Socket connection/message caps là Map/counter per process, chưa shared Redis; counters cũng không atomic across in-flight handshakes.
- Feature HTTP rate limiters ở password-otp/settings/experience vẫn gọi factory không truyền Redis client, còn MemoryStore.
- Production Redis bắt buộc là cải thiện policy, nhưng cần cấu hình thực trước rollout; tắt REALTIME_ENABLED không bỏ yêu cầu Redis của HTTP security.
- Docker CLI có, Linux daemon chưa chạy (`docker info` lỗi pipe). Chưa có native Redis two-instance quota/fanout/outage evidence; không provision cloud hoặc khởi động daemon thay user trong review.

Không đổi các finding này thành PASS dựa trên mock Redis.eval.

## R7 — P2: Regression test mới đang fail và phụ thuộc sibling repositories

Đã chạy đúng bộ:

```text
vitest run tests/integration/codex-realtime-review.test.ts
  tests/integration/realtime-redis-integration.test.ts
  src/config/env.test.ts --maxWorkers=1
```

Kết quả **131 passed / 2 failed**, 3 files gồm 1 failed/2 passed. Hai lỗi trong `codex-realtime-review.test.ts`:

```text
Cannot find module '/wedding-web/src/features/identity-access/session.js'
Cannot find module '/wedding-manage-web/src/features/realtime/realtime-client.js'
```

Đường import dynamic qua biến không được resolve như literal trong Vitest hiện tại; đây là test/harness failure, không có nghĩa vòng import Couple vẫn còn. Đã chạy regression Couple riêng và đạt.

Ngay cả sửa resolver local, BE CI checkout một repo cũng không có source/node_modules sibling repos như test đang giả định. Cần tests client trong repo web tương ứng hoặc workspace integration harness/contract fixture rõ; không tạo backend acceptance gate phụ thuộc checkout frontend ngoài scope CI.

## Kiểm chứng độc lập

- Remote main SHA ba repo khớp local như bảng đầu.
- Couple existing bootstrap regression: **1 passed**, exit 0.
- BE targeted suites: **131 passed / 2 failed**, exit 1, lỗi import test như R7. Env defaults đã sửa đạt; sáu Redis/broker tests vẫn là mock boundaries.
- Codex thêm **4 audit probes**: restart stall, late-visible commit skip, async dispatch receipt và credential-expiry/authority-error delivery. Cả 4 match hành vi lỗi quan sát; không phải acceptance pass. Socket là native loopback; Redis/Prisma stores controlled, không tự nhận native Redis/PostgreSQL.
- Tsc cả ba repo **PASS exit 0** (`--noEmit`, hai web dùng thêm `--incremental false` để không ghi tsbuildinfo). Không chạy lại lint/format toàn bộ chỉ để lặp lại gate cũ; không chỉnh CI.
- No production writes/provider/paid AI/money/deploy, no browser E2E mới. Không xác minh deployed runtime SHA hoặc production SLA.

Probe tạm đã xóa khỏi source; bản tái lập `C:/Users/Admin/AppData/Local/Temp/codex-realtime-round2-2026-10-23.test.ts`, đặt dưới tests/integration để giữ imports. SHA256 `430A65E98B99CB29AF2AE85A8AC9F63DB42F50303BCFED405E068CC6806B340F`. Không sửa permanent tests để che failure.

## Hướng xử lý tiếp theo

Ưu tiên R1–R4 trước: durable processing/recovery theo committed facts, awaitable dispatch và fresh fail-closed authorization đúng credential/grants. Sau đó hoàn thiện publisher→cache→UI matrix, Redis startup/all-node limits và native two-account E2E. Sửa báo cáo “F1–F8 triệt để/verified” thành trạng thái cụ thể từng trường hợp đã chạy; push thành công không thay thế các bằng chứng này.
