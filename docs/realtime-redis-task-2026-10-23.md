# Owner task: Manager/Couple realtime + Redis rate limit — 2026-10-23

## Yêu cầu và scope

Chủ dự án yêu cầu kiểm tra kỹ và giao Antigravity triển khai WebSocket để Manager/Couple thấy thay đổi mà không phải F5, thêm Redis cho rate limiting. Triển khai thực tế, có bằng chứng trên UI; không chỉ dựng socket server.

Scope của yêu cầu hiện tại: `wedding-be`, Couple ở `wedding-web`, Manager ở `wedding-manage-web`. Đây là ngoại lệ owner mới cho giới hạn frontend ownership trước đây, chỉ cho realtime/session/cache invalidation cần thiết. Không redesign UI, không sửa wedding-app/native hoặc domain không liên quan. Đọc AGENTS.md mỗi repo, backend-scope mới nhất và Next docs đi kèm phiên bản cài trong node_modules trước khi sửa frontend. Ghi scope amendment này vào tài liệu handoff, không xóa quy tắc cũ hoặc mở quyền vô hạn.

Không tự commit/push/merge/deploy, provision dịch vụ trả phí hoặc thay repository security/branch protection. Giữ thay đổi đang có. Lưu ý ngày 2026-10-23 scope pre-deposit đã thay đổi: role COUPLE không chứng minh đã thanh toán; dùng access level/booking eligibility thật.

## Những điểm Codex đã thấy trong source

- Baseline tại lúc đọc: `dea2f59`, working tree BE sạch.
- BE chưa có WebSocket/Socket.IO/Redis dependency hoặc runtime wiring.
- `src/core/http/rate-limit.ts`: express-rate-limit dùng MemoryStore; `identity.runtime.ts:57` tạo in-memory attempt throttle cho login/refresh/invitation consumption.
- `src/config/env.ts` còn ép BACKEND_REPLICA_COUNT=1; thêm Redis không tự làm mọi worker/pool an toàn đa replica.
- Notifications đã đọc IdentityOutbox/BookingOutboxEvent/BillingOutboxEvent/InvitationStudioOutbox/GuestOutbox bằng consumer receipts riêng. Notification event filter không bao phủ mọi thay đổi UI; không dùng nó làm toàn bộ realtime change feed hoặc dùng chung receipt khiến notification mất event.
- `wedding-web/src/features/booking-lifecycle/overview-page.tsx`: tải overview theo mount/retry; không có cross-user subscription.
- `wedding-manage-web/src/features/print-orders/use-print-orders-data.ts`: local state, manual fetch/reload và epoch guards, không có cross-user subscription.
- `wedding-manage-web/src/features/venue-catalog/catalog-cache.ts`: TTL/shared cache + dependency invalidation nội bộ; socket refetch không đủ nếu cache cũ vẫn được phục vụ.
- Một số mutation đã tự reload local. Không kết luận mọi thao tác đều hỏng; xác minh từng màn và phân biệt local update thiếu với cross-client synchronization thiếu.

## Bước 1 — Ma trận thay đổi → người xem → UI

Trước khi code, rà tất cả route/features Manager/Couple thực tế và lập bảng: mutation (HTTP hoặc worker/provider callback), transaction/outbox owner, entity/revision, audience/authorization, screen/list/detail/totals phụ thuộc, cache/state bị ảnh hưởng, event và cách re-fetch.

Ít nhất bao phủ: consultation/intake/booking list & overview; proposal & accepted/proposed revisions; commercial contract/appendix; deposit/payment attempt/billing/refund/final invoice; timeline; guest groups/named guests/headcount; seating/layout; media/AI job/design/publication; print order/quote/cancel/replacement; catalog/dish/menu/hall/shift; notification unread; profile/access/session revocation. Chỉ phần màn hiện hữu tương ứng, không thêm flow sản phẩm mới. Staff/guest không được nhận event ngoài quyền; public catalog nếu cần refresh chỉ dùng public invalidation.

Đừng gom mọi thứ thành `everything.changed` rồi tải lại toàn bộ app. Đừng chỉ sửa một trang demo. Hạng mục không áp dụng phải có lý do và coverage rõ trong báo cáo.

## Bước 2 — Realtime backend đáng tin cậy

- Chọn một transport/protocol duy nhất có bảo trì tốt, ví dụ Socket.IO dùng WebSocket, với ADR ngắn và dependency/version/lockfile hợp lệ. Client/server phải cùng protocol; native WebSocket không tự tương thích Socket.IO. Không thêm cả hai framework song song.
- Gắn vào HTTP server/lifecycle thực tế; reusable modules cho transport, auth/subscriptions, event schema, dispatcher và observability; không socket singleton import vòng khắp domain.
- Redis connections quản lý chung với timeout/retry/backoff, TLS/auth từ env, shutdown sạch. Pub/sub cần connection riêng phù hợp SDK, không tạo connection theo request/socket. Không thay Redis thành nguồn sự thật của booking/tiền/quyền.
- Chỉ phát invalidation sau DB commit. Tận dụng outbox hiện hữu có envelope/version; bổ sung durable change fact trong cùng transaction khi owner chưa có event phù hợp. Redis publish không nằm trong domain DB lock và lỗi Redis không đảo kết quả domain command đã commit.
- Relay có retry, independent receipt/lease/claim, bounded batch/concurrency và index phù hợp; không đánh dấu delivered trước publish thành công. Crash có thể duplicate, xử lý idempotent. Không dùng high-water sequence ngây thơ bỏ qua lower sequence commit muộn. Không quét full history mỗi vài trăm ms hoặc thêm N+1 recipient queries.
- Event tối thiểu: eventId, schemaVersion/type, authorized scope/entity reference, revision/sequence có semantics rõ, occurredAt, các resource invalidations. Không gửi token, PII, private snapshot, monetary payload không cần, hoặc room names do client tự quyết quyền.
- Redis fan-out adapter cho phép nhiều process, nhưng không tự bật replica count >1 trước khi kiểm tra worker leases, pool budget và deployment topology. Classic Redis pub/sub không tự cung cấp replay. Nếu dùng adapter không hỗ trợ connection recovery, phải có resync rõ thay vì bật flag và claim đã giải quyết.
- Không hứa exactly-once WebSocket delivery. EventId/revision dedup, replay có scope nếu hỗ trợ, hoặc bắt buộc authoritative snapshot/resync sau reconnect/gap/restart. Giới hạn replay buffer/TTL và payload size; slow client/backpressure phải bounded.

## Bước 3 — Quyền truy cập và vòng đời kết nối

- Handshake dùng cơ chế session/access token thực tế, check account/session/expiry và origin allowlist. Browser CORS middleware không bảo vệ WebSocket upgrade: kiểm tra Origin ở upgrade/allowRequest, không wildcard credentials.
- Không token trong query string/log/localStorage mới; dùng auth payload hoặc short-lived single-use ticket nếu phù hợp BFF hiện tại. Không hardcode account/booking/provider URL. Không cho client tự gửi accountId/role/room rồi tin tưởng.
- Subscribe booking/entity phải kiểm tra current authorization bên server: couple sở hữu + access RESTRICTED/FULL, manager theo đúng policy hiện hữu, staff theo assignment nếu nằm trong existing flow. Tránh broadcast global chứa private IDs/payload.
- Connection đã mở không được giữ quyền vô hạn: logout/password/session revoke/account disable/access reduction phải ngắt hoặc hủy subscription đúng lúc. Kiểm tra lại quyền trước delivery/replay theo cơ chế có bằng chứng tránh TOCTOU, không chỉ tại handshake. Không global token/permission cache không invalidation. Khi revoke xảy ra lúc dispatch/reconnect phải deny.
- Token refresh đồng bộ với session singleton hiện có, không mỗi socket/tab gây refresh credential rotation race. Logout/account switch hủy listener, buffer và cache đúng scope. Không khôi phục room cũ mà skip middleware và quyền mới.
- Chỉ push invalidations/read hints; các business write vẫn qua HTTP command hiện hữu, giữ validation/idempotency/audit/lock order.

## Bước 4 — Frontend cập nhật không F5

- Một shared realtime manager/provider theo authenticated browser session mỗi app/tab, không tạo socket theo page/component. Cleanup đúng React StrictMode, route changes và auth changes; không reconnect vô hạn vì token cũ.
- Nối event vào **data owner và cache layer thực tế**. Reuse existing reload/invalidation gateways, không cài React Query chỉ để né state architecture nếu không cần. Invalidate in-flight generation và TTL caches trước fetch; ngăn response cũ ghi đè revision mới.
- Mỗi mutation thành công tự cập nhật response authoritative hoặc invalidate local đúng chỗ ngay; không chờ socket echo mới hiển thị. Event echo không gây fetch trùng; burst nhiều event coalesce/debounce có giới hạn, single-flight và dirty-while-loading follow-up, tránh nuốt event đến trong lúc request đang chạy.
- Chỉ refresh dữ liệu đang dùng đúng scope/filter, giữ selection, pagination semantics, scroll, modal/form dirty data và focus. Không window.location.reload, router.refresh toàn app hoặc interval polling dày. Khi dữ liệu nền đổi trong form đang sửa, báo stale/conflict theo UI hiện có; không âm thầm ghi đè input.
- Reconnect/network online/tab foreground: resubscribe đúng quyền + authoritative resync để bù mất event. Bảo đảm subscribe/initial fetch không có khoảng trống mất update. Sequence/revision chỉ so sánh trong cùng stream/entity có bảo đảm, không so global timestamp tùy tiện.
- Có trạng thái mất kết nối/đang đồng bộ nhẹ, theo design system hiện tại; không toast cho mỗi background event gây spam. Realtime không tự sửa tốc độ SQL: tránh refetch storm làm BE chậm hơn.

## Bước 5 — Redis rate limiting

- Shared Redis store cho general HTTP limiter và các in-memory identity attempt throttles liên quan (login/refresh/invitation), scan cả OTP/account/settings/guest-link/feature limiters. Giữ DB-backed business quotas, OTP security state và chống double-use/idempotency; không chuyển chúng thành volatile Redis đơn giản.
- Ưu tiên adapter/library maintained phù hợp express-rate-limit hiện tại hoặc atomic Redis script có coverage. Atomic consume + expiry/TTL bằng Lua/transaction hợp lệ; không GET-then-SET, không INCR rồi EXPIRE rời có crash window.
- Giữ policy hiện tại trừ khi có đo đạc và giải thích điều chỉnh cần thiết. Buckets phân namespace/env/purpose/IP/account/hashed subject đúng endpoint, canonical IPv6 và trust-proxy hiện có; không tin X-Forwarded-For bừa hoặc gom cả manager/couple cùng NAT vào một quota thấp.
- Thêm giới hạn riêng socket handshake, concurrent connections/account/IP, subscribe operations và inbound messages, max payload. Không tính mọi server-push/outbound packet như HTTP request; không để socket flood bypass HTTP limiter.
- 429 vẫn đúng error envelope/RateLimit headers/Retry-After từ TTL; FE backoff/resync không retry tight loop. Redis timeout/unavailable phải có chính sách rõ theo endpoint: không silently fail-open security-sensitive routes; không fallback MemoryStore rồi claim shared correctness. Phân biệt dependency unavailable với quota exceeded. Không làm mất IPN/provider callback hoặc settlement evidence vì policy mới; giữ retry/idempotency đúng.
- Config typed/validated, REDIS_URL/rediss secrets chỉ server-side, examples placeholders, key TTL bounded, không KEYS/full SCAN hot path, memory/queue/connection limits và health/readiness/degraded policy. Dev/test mode rõ; production yêu cầu Redis khi feature enabled, không báo ready giả.
- Redis chung không có nghĩa mọi process scaling-safe; giữ guard topology cho các thành phần còn lại đến khi có evidence. Không provision Railway/Redis trả phí hay thay production env trong task.

## Bước 6 — Kiểm chứng và bàn giao

- Tự chạy lint/type/build/API compatibility phù hợp cả ba repo và tests tập trung. Tôn trọng CI hiện tại: không thêm lại format gate, không biến test optional thành bắt buộc cho mọi push. Test local regression vẫn cần; không dùng DB/provider production từ .env.
- Integration với PostgreSQL/Redis local isolated thật và ít nhất hai backend instances dùng chung Redis: shared quota không nhân đôi, reconnect/broadcast đúng account/scope, shutdown/restart/retry không mất eventual resync, offline/gap/out-of-order/duplicates, queue bounds, origin unauthorized, session expiry/revoke, restricted access không lộ dữ liệu, rollback không event.
- Direct browser E2E local trên **hai tài khoản synthetic Manager/Couple** trong hai context: manager đổi dữ liệu thì couple thấy; couple đổi thì manager thấy; worker/payment callback simulated có controlled evidence cập nhật UI; không F5. Kiểm tra list/detail/totals/sidebar/badges và giữ dirty form. Không dùng tài khoản thật/tiền thật/paid AI hoặc phá dữ liệu shared.
- Đo commit→event→visible UI latency, SQL count, HTTP refetch count, sockets/listener counts, Redis latency và rate-limit contention cùng workload. Số liệu thực, không claim SLA production chỉ từ mock. Matrix phải ghi PASS/FAIL/BLOCKED/NOT_TESTED, không dùng “đã nối socket” làm bằng chứng tất cả flow.
- Handoff gồm event contract/schema, auth/subscription/reconnect/resync rules, resource dependency matrix, Redis config/provision/deploy instructions, feature flags/rollback và giới hạn. WebSocket không được mô tả bằng OpenAPI HTTP giả; tài liệu protocol riêng có version.
- Kết quả lưu `wedding-be/docs/reports/realtime-redis-implementation-2026-10-23.md`, kèm file list mỗi repo, commands+exitcode, bằng chứng E2E/measurements và blockers/deferred. Không tự commit/push/deploy; báo hoàn tất để Codex review.

## Tài liệu kỹ thuật chính thức cần đối chiếu

- [Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/): mặc định không replay mọi packet server→client bị mất.
- [Socket.IO Redis adapter](https://socket.io/docs/v4/redis-adapter/): kiểm tra compatibility, recovery support và sticky-session requirements theo transport đã chọn.
- [Socket.IO Origin/CORS handling](https://socket.io/docs/v4/handling-cors/): WebSocket không chịu CORS như HTTP polling; cần allowRequest/origin validation phù hợp.
- [Redis INCR/rate limiter atomicity](https://redis.io/docs/latest/commands/incr/): counter + expiry phải bảo đảm atomic semantics.
