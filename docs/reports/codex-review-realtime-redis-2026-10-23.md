# Codex review: realtime + Redis — 2026-10-23

## Kết luận

**Chưa đạt yêu cầu, chưa nên phát hành.** Đã có socket/Redis scaffolding và vài listener, nhưng chưa giải quyết trọn vẹn vấn đề Manager/Couple phải F5. Có lỗi khởi tạo Couple, lệch protocol Manager, thiếu đường kết nối phù hợp BFF, quyền không được thu hồi trên socket đang mở và relay có thể mất event.

Review source chưa commit tại baseline `dea2f59`: BE, wedding-web và wedding-manage-web. Wedding-app có working tree sạch khi kiểm tra. Codex không sửa implementation ba repo, không commit/push/deploy, không gửi Anti đợt sửa mới trong lượt review này. Chỉ tạo báo cáo và probes tạm để xác minh.

Đối chiếu với `docs/realtime-redis-task-2026-10-23.md` và báo cáo Anti `docs/reports/realtime-redis-implementation-2026-10-23.md`. Các câu “mọi thao tác nghiệp vụ cập nhật tức thời”, “phân quyền nghiêm ngặt”, “không mất dữ liệu khi reconnect” trong báo cáo Anti chưa được bằng chứng hỗ trợ, có điểm bị source/probes bác bỏ.

## F1 — P1: Vòng import session/realtime làm hỏng khởi tạo Couple

Chu trình:

```text
identity-access/session.ts
  -> realtime/realtime-client.ts
  -> identity-access/identity-page.tsx
  -> browser-session.ts / public UI modules
  -> new WebIdentitySession(createIdentityApi())
```

Nguồn: session.ts:3, realtime-client.ts:5, browser-session.ts:1–3. Transport import ngược cả trang đăng nhập chỉ để lấy browserSession, trong khi session đã import transport.

Đã chạy đúng regression hiện hữu của wedding-web:

```text
vitest run src/features/identity-access/bootstrap-regression.test.ts --maxWorkers=1
FAIL suite; 0 test executed
TypeError: WebIdentitySession is not a constructor
  src/features/identity-access/browser-session.ts:3
```

Probe import độc lập cũng tái hiện lỗi. TypeScript pass không phát hiện vòng khởi tạo runtime này. Chưa kiểm tra production browser/build để khẳng định mọi route lỗi, nhưng regression khởi tạo thực sự đang fail.

Cần đảo dependency: session/lifecycle cung cấp auth refresh callbacks hoặc provider orchestration cho transport; realtime client không import trang UI/browser session ngược lại.

## F2 — P1: Manager nghe sai event name, reconnect không resync

- BE `src/core/realtime/realtime-broker.ts:57–65` phát `realtime:event`.
- Manager `src/features/realtime/realtime-client.ts:112` chỉ nghe `rt:event`.
- Manager `:123` chờ `rt:resync`, nhưng BE không định nghĩa/phát sự kiện đó. Handler connect chỉ resubscribe, không gọi resync listeners.
- Các event type strings ở Manager cũng lệch contract BE, ví dụ `contract.signed`/`billing.payment_received` so với `contract.updated`/`billing.updated`.

Probe dùng **Socket.IO server thật trên loopback và ManagementRealtimeManager thật**: handshake thành công, socket thô nhận `realtime:event`, nhưng callback manager nhận **0 event**, resync callback **0**. Không dùng mock io cho probe này; authority repository là synthetic có kiểm soát.

Cần một schema/protocol contract dùng thống nhất, test client-server compatibility, subscribe ACK rồi authoritative resync theo thứ tự không mất update.

## F3 — P1: Socket URL lấy REST proxy origin, không có WebSocket route tương ứng

Cả hai realtime-client.getSocketUrl() lấy `.origin` của NEXT_PUBLIC_API_BASE_URL, rồi connect `/realtime`.

Cấu hình mẫu chính thức của cả hai web dùng cùng-site BFF:

```text
wedding-web: NEXT_PUBLIC_API_BASE_URL=http://localhost:3000/api/v1
manage-web: NEXT_PUBLIC_API_BASE_URL=http://localhost:3002/api/v1
```

next.config.ts và vercel.json chỉ rewrite `/api/v1/:path*`; không có `/realtime` upgrade path trong thay đổi. Socket vì vậy nhắm vào Next host thay vì BE trong cấu hình proxy được repo khuyến nghị. Không được suy rằng HTTP rewrite tự proxy WebSocket. Khi API_BASE_URL trỏ thẳng BE, trường hợp này khác; deployed env thực tế chưa xác minh.

Cần public realtime endpoint typed/validated độc lập hoặc WebSocket-capable ingress được kiểm chứng; giữ refresh cookie/BFF contract, explicit origin allowlist và không fallback hardcode localhost khi config production sai.

## F4 — P1: Socket còn quyền sau revoke/expiry/downgrade

- realtime-server.ts:91 resolve actor đúng một lần ở handshake; handlers dùng actor snapshot đó.
- Không fresh reauthorization ở subscribe/delivery; booking rooms không bị thu hồi khi grant/assignment đổi.
- broker.revokeSession() có implementation nhưng không có callsite nối logout/revoke/disable events. Relay không đọc IdentityOutbox/session changes.
- socket.use chỉ đếm message, không kiểm tra session expiry/current authority.

Probe socket thật: sau handshake, controlled authority state đổi sang REVOKED; broker phát event tiếp theo, client vẫn nhận, connection vẫn connected, identity lookup count vẫn **1**.

Invalidation vẫn có booking references và event metadata; REST từ chối lần đọc sau không thay thế nghĩa vụ ngừng delivery tới tài khoản mất quyền. Không cần chờ có payload PII mới coi đây là lỗi quyền.

Cần nối lifecycle revoke/expiry/access changes và current authorization đúng scope trước delivery/replay/subscription, xử lý race và disconnect/unsubscribe có kiểm chứng. Restricted booking không đồng nghĩa được nhận mọi invitation/print/seating resource hint.

## F5 — P1: Relay không durable, có thể mất sự kiện

`src/core/realtime/realtime-outbox-relay.ts`:

1. `:64` và các owner tương tự luôn đọc **50 record mới nhất**, không tìm unprocessed records/cursor/backlog. Có 51 committed events trước một poll thì event cũ nhất không được đọc; poll tiếp vẫn chỉ đọc lại cùng 50 đã seen.
2. `claimReceipt :30–53` ghi Redis NX TTL 7 ngày hoặc local receipt **trước** `broker.publish`. Crash/failure giữa hai bước làm mất event; Redis adapter publish async cũng không có durable acknowledgement ở broker void return.
3. Receipt Redis mất/TTL hết thì có thể replay history đang ở newest page; local fallback chia process không bảo đảm shared progress. Receipt không có owner/environment namespace.
4. setInterval gọi scan mà không có single-flight pending guard; Redis chậm có thể chồng nhiều vòng. stop() không await poll đang chạy trước disconnect DB.

Probes đã xác nhận:

| Probe                                     | Kết quả                                          |
| ----------------------------------------- | ------------------------------------------------ |
| 51 committed synthetic events, poll 2 lần | chỉ 50 được phát; oldest không bao giờ được chọn |
| publish ném lỗi sau claim, rồi poll lại   | event không retry, publish chỉ được gọi 1 lần    |

Cần independent durable delivery state/lease + retry, backlog pagination đúng commit/order semantics, bounded concurrency và restart recovery; event duplicate được chấp nhận/dedup, mất invalidation phải có authoritative gap/resync bù. Không coi NX receipt-before-send là delivery guarantee.

## F6 — P1: Coverage flow còn thiếu, reload proposal không refresh dữ liệu màn con

Relay chỉ scan 5 outbox và mapping chủ yếu theo substring; không có publisher/catalog event source/notification update/profile/session/access change source hoàn chỉnh. `catalog.updated`, `notification.received`, `session.revoked` phần lớn chỉ có type/helper, không có luồng phát runtime. New consultation/booking chưa có subscription cũng thiếu audience account invalidation.

Frontend Couple chỉ nối overview/collaboration/workspace loader. Workspace reload chỉ lấy booking list + proposal. Data owners khác vẫn có dependencies riêng:

- `use-guests-workspace.ts`: guest/group/check-in data tải theo bookingId/filter/reloadKey.
- `use-seating-workspace.ts:34–58`: layout/groups/plan tải theo bookingId/reloadKey.
- billing, invoice, invitation/design/media và notification unread còn state/fetch riêng.

Đổi proposal object với cùng bookingId không làm các effect trên tự chạy lại. Cần invalidate đúng data owner thay vì chỉ refresh shell.

Manager cache chỉ clear khi catalog event nhưng chưa có publisher; clear TTL cache cũng chưa tự render/refetch màn catalog đang mở. Một số panes khác chưa có listeners. Không có flow coverage matrix PASS/FAIL/BLOCKED và bằng chứng hai account browser E2E trong báo cáo Anti.

## F7 — P1/P2: Redis chưa có startup/readiness/failure policy hoàn chỉnh

- `redis-client.ts:34–38`: lazyConnect=true, enableOfflineQueue=false. Các general/pub/sub client không được await connect-ready trước tạo RedisStore/adapter.
- Ioredis source cài sẵn cho thấy command đầu khi status=wait tự start connect nhưng command không writable sẽ reject nếu offline queue disabled. rate-limit-redis constructor load scripts ngay; adapter subscribe ngay. `RedisManager.healthCheck()` là nơi connect rõ ràng nhưng không có runtime callsite.
- Redis URL chỉ optional string, không validate protocol/production requirement. Tham số environment trong manager không dùng để cấm local fallback. Probe production/no URL xác nhận trả isConfigured=false, client=null.
- Readiness chỉ có DB probe; không có Redis readiness/degraded policy được nối. Retry sau 5 lần dừng hẳn, không chứng minh phục hồi dài hạn.
- Auth Redis outage được chuyển thành allowed=false/429 với cả window, không phân biệt dependency unavailable. General HTTP RedisStore không có fallback logic như báo cáo Anti mô tả; mặc định store error đi error handler. Không được claim failover an toàn đã có.
- Feature HTTP limiters ở password-otp.router.ts:24, settings.router.ts:30 và experience.router.ts:31 vẫn không được inject redisClient nên còn MemoryStore. Socket message count chỉ per socket, reconnect/tạo connection khác reset; chưa có distributed handshake/connection/account quotas.

Native Redis/two-process quota/fanout **chưa chạy được**: không có redis-server executable; Docker CLI có nhưng Docker Desktop Linux daemon chưa chạy (`docker info` không kết nối được pipe). Không provision dịch vụ hoặc khởi động Docker thay user. Những điểm Redis runtime ở trên là source evidence, không tự nhận đã tái hiện trên Redis thật.

## F8 — P2: Subscription/token/refetch lifecycle có thể mất cập nhật hoặc tạo tải dư

- Couple activeBookings dùng Set, không reference count: hai consumers subscribe cùng booking; unmount một consumer sẽ unsubscribe room của consumer còn lại. useCoupleWorkspace còn gọi loader disabled, nhưng subscription trong loader không check enabled.
- Overview Couple chỉ subscribe booking đầu danh sách, không có account-level feed cho booking mới/booking khác.
- Couple connect(token) return ngay nếu socket connected, không update auth token. Khi đứt mạng sau token refresh, auth payload cũ có thể được dùng reconnect; connect_error.restore thường trả session hiện có, không nhất thiết rotate lại token.
- Couple connect triggers resync ngay sau emit subscribe, không chờ subscription confirmed. Có khoảng trống fetch-before-join mất event. Manager không resync sau connect như F2.
- broker.publish booking event dùng hai emit riêng (booking room và manager role); manager ở cả hai room nhận duplicate. Manager client không eventId dedup.
- Coalescing chỉ được dùng ở dashboard; nhiều hooks gọi reload/loadProposal/fetchOrders cho mọi event cùng booking, không xét resource dependencies/revision. Focus+visibilitychange cũng có thể trigger lặp. Chưa có bằng chứng bảo toàn dirty forms và cursor/selection.

## Những phần đã có giá trị

- Transport dùng Socket.IO/WebSocket, auth payload thay vì query token, có explicit Origin check cho origin được gửi.
- Redis Lua throttle thiết kế atomic counter+TTL; RedisStore general limiter đã nối vào app.
- Chọn invalidation envelope, có room scoping ban đầu và bounded seen-event cache.
- Có vài listener frontend và helper coalescing/reference count phía Manager.

Đây là nền tảng ban đầu, chưa phải realtime end-to-end hoàn chỉnh.

## Kiểm chứng do Codex tự thực hiện

| Check                                                            | Kết quả                                                                      |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| BE TypeScript tsc --project tsconfig.json --noEmit               | PASS exit 0                                                                  |
| Couple tsc --noEmit --incremental false --project tsconfig.json  | PASS exit 0                                                                  |
| Manager tsc --noEmit --incremental false --project tsconfig.json | PASS exit 0                                                                  |
| BE ESLint sau khi xóa probes tạm                                 | PASS exit 0                                                                  |
| Couple / Manager ESLint toàn repo                                | cả hai PASS exit 0                                                           |
| Sáu tests mới của Anti                                           | 6/6 PASS; mock io và mock Redis.eval, không phải native integration          |
| Existing BE env tests                                            | 121 PASS / 1 FAIL: defaults expected chưa được cập nhật cho redis/realtime   |
| Existing Couple bootstrap-regression suite                       | FAIL lúc import, WebIdentitySession is not a constructor; 0 test chạy        |
| Codex audit probes                                               | 5/5 match observed behavior; gồm các hành vi lỗi, không phải acceptance pass |
| git diff --check BE                                              | FAIL: new blank line at EOF rate-limit.ts:41                                 |
| git diff --check hai web                                         | PASS                                                                         |

5 probes: Manager packet mismatch + no-resync + revoke delivery (socket thật/controlled auth); relay 51→50; publish-failure no retry; production missing Redis fallback; Couple import cycle. File tạm đã xóa khỏi source, bản tái lập `C:/Users/Admin/AppData/Local/Temp/codex-realtime-review-2026-10-23.test.ts`, SHA256 `CF4B992407B63931B389A7B5F3BB697F236E440CA6C7525ABA1FB2294790C556`; đặt lại dưới tests/integration để giữ relative imports.

Một lượt gọi sai tên session.test.ts không tìm thấy file, đã tìm đúng bootstrap-regression.test.ts và chạy lại. Lượt tsc đầu ở web bị sandbox chặn ghi tsbuildinfo, sau đó chạy --incremental false cả hai đạt. Lượt lint đầu chạy trùng lúc probe tạm còn tồn tại chỉ báo lỗi style/type của probe; đã xóa probe và chạy lại BE lint đạt. Không tính các lỗi harness/permissions đó là implementation regression.

Không chạy production DB/provider, tiền thật, paid AI, production browser/load test; không chứng minh UI hai account không cần F5, Redis two-process quotas hoặc production SLA. Không claim đã test nội dung chưa chạy.

## Cần hoàn tất trước khi nghiệm thu

Sửa vòng dependency và thống nhất event contract/endpoint trước; sau đó current authorization/revocation, durable relay/retry/backlog, Redis ready/outage/distributed quotas, per-resource UI invalidation và reconnect/refcount/token lifecycle. Bổ sung native Redis/PostgreSQL + hai web hai account E2E matrix và số đo commit→visible UI/refetch count. Báo cáo Anti phải sửa các khẳng định tuyệt đối và phân biệt mock/source/local E2E/deployed evidence.
