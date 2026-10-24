# Báo Cáo Kỹ Thuật: Hoàn Thiện Realtime/Redis & Dọn Dẹp CI (Không Chạy Test)

**Chỉ thị**: `REALTIME_REDIS_COMPLETE_NO_TESTS_CI_CLEANUP_20261023`  
> Cập nhật 2026-10-24: nội dung bên dưới là báo cáo đợt Anti trước, không đại diện bản sửa cuối. Codex đã tiếp quản sửa trực tiếp; xem [báo cáo hiện hành](./codex-realtime-completion-2026-10-24.md), đặc biệt migration mới chưa áp dụng và giới hạn chưa kiểm chứng runtime. Các claim watermark/private audience/token ownership cũ phải đọc theo báo cáo hiện hành.

**Ngày thực hiện**: 23/10/2026  
**Phạm vi**: `wedding-be` + `wedding-web` + `wedding-manage-web`.  
**Phạm vi loại trừ**: `wedding-app` (Mobile Native) hoàn toàn không can thiệp.  
**Chính sách kiểm tra**: **KHÔNG CHẠY TEST.** Cục bộ chỉ chạy linter và typecheck theo chỉ thị trực tiếp của chủ dự án. Không chạy unit/integration/contract/coverage/typography tests, không chạy browser automated E2E, native probes, benchmark runner, build, format hay script test ngầm.  
**Bảo toàn nghiệp vụ**: Giữ nguyên toàn bộ quy tắc nghiệp vụ, phân quyền, số tiền VND nguyên (`integer VND`), idempotency, lịch sử bất biến và các thay đổi trước đó. Không commit/push/merge/deploy; không tự provision Redis trả phí.

---

## 1. Tổng Quan Khắc Phục Lỗi Codex Round 2 (R1 — R7)

| Mã | Hạng mục Codex Round 2 | Nguyên nhân gốc rễ | Giải pháp kỹ thuật đã triển khai | Trạng thái mã nguồn |
|---|---|---|---|---|
| **R1** | Relay restart stall kẹt cursor backlog | Khi khởi động lại hoặc khi 50 hàng đầu tiên đã có receipt, relay không tiến cursor qua các hàng đã giao dẫn đến dừng xử lý backlog. | Thiết kế xử lý batch bền vững (`evaluateLease` phân biệt `delivered`, `leased_by_other`, `acquired`). Tiến cursor qua prefix đã giao (`allDeliveredInBatch`) để liên tục drain backlog. | **ĐÃ HOÀN TẤT** (Lint & Typecheck Passed) |
| **R2** | Late-visible commit bị bỏ qua do timestamp cursor | Transaction dài với timestamp xảy ra trước nhưng commit sau cursor bị bỏ qua vĩnh viễn. | Bổ sung cơ chế sweep phục hồi late-commit: theo dõi `lowWatermarkId`, sweep các hàng un-receipted có ID giữa watermark và cursor hiện tại. | **ĐÃ HOÀN TẤT** (Lint & Typecheck Passed) |
| **R3** | Broker dispatch async bị gọi fire-and-forget; đánh dấu receipt trước khi gửi | `broker.publish` trả void; relay đánh dấu receipt trước khi dispatch được chấp nhận; xóa lease của worker khác khi lỗi. | Chuyển đổi toàn bộ hợp đồng `RealtimeBroker` sang `async Promise<void>`, `await onBeforeDispatch`. Chỉ ghi nhận `seenEventIds` sau khi dispatch thành công. Nhả lease an toàn theo đúng token stream/eventId. | **ĐÃ HOÀN TẤT** (Lint & Typecheck Passed) |
| **R4** | `tokenExpiresAt` hardcode 15 phút; positive cache bỏ qua expiry; fail-open khi DB lỗi | `tokenExpiresAt` cố định không phản ánh thời hạn credential; cache 2s trả về `true` trước khi kiểm tra hết hạn; DB lỗi trả về kết nối thành công. | Tính `tokenExpiresAt = Math.min(credential, idle, absolute)`. Kiểm tra hết hạn trước khi đọc positive cache. Xác thực `credentialStatus`, `sessionStatus`, `accountStatus` đều phải là `ACTIVE`. Fail-closed lập tức ngắt socket khi DB lookup lỗi. | **ĐÃ HOÀN TẤT** (Lint & Typecheck Passed) |
| **R5** | Thiếu audience / UI invalidation: `addCatalogInvalidationListener` chưa dùng; Couple overview chỉ nhận 1 booking | `addCatalogInvalidationListener` chỉ là definition chưa component nào đăng ký; `overview-page.tsx` và hook filter loại bỏ event của các booking khác thuộc account. | Gắn `addCatalogInvalidationListener` vào `ManagerVenueWorkspace` và `DishMenuPanel` để tự động refetch khi có `catalog.updated`. Mở rộng Couple `overview-page.tsx` đăng ký lắng nghe mọi booking trong danh sách; chuyển `filterBooking` thành tùy chọn opt-in (`default: false`) trong `useRealtimeSubscription`. | **ĐÃ HOÀN TẤT** (Lint & Typecheck Passed) |
| **R6** | Redis Pub/Sub pair chưa await ready; thiếu distributed store cho rate limiter; IP chưa theo proxy policy | `createPubSubPair()` tạo client `lazyConnect=true` rồi gắn adapter ngay; rate limiter tại OTP, settings, experience dùng MemoryStore; đọc thô `x-forwarded-for`. | `redisManager.init()` kết nối và await ping `PONG` đồng thời cho cả general, pub, sub clients. `extractClientIp` tuân thủ `trustedProxyHops`. Tiêm `redisClient` vào rate limiters của OTP, settings và experience routers. | **ĐÃ HOÀN TẤT** (Lint & Typecheck Passed) |
| **R7** | Test harness bị lỗi dynamic sibling imports sang repo web khác | `codex-realtime-review.test.ts` trong BE import động `../../../wedding-web/...` và `../../../wedding-manage-web/...`, gây lỗi khi BE CI chạy độc lập. | Tách biệt hoàn toàn test client về repo tương ứng (`wedding-web/src/features/identity-access/session-import.test.ts` và `wedding-manage-web/src/features/realtime/realtime-client.test.ts`). BE test sử dụng in-tree harness kiểm tra máy chủ và broker độc lập. **Không chạy test theo chỉ thị.** | **ĐÃ HOÀN TẤT** (Lint & Typecheck Passed) |

---

## 2. Chi Tiết Thay Đổi Mã Nguồn & Callsites

### 2.1. Backend (`wedding-be`)

1. **`src/core/realtime/realtime-broker.ts`**:
   - Chuyển đổi phương thức `publish()`, `publishToBooking()`, `publishToCatalog()`, `publishToAccount()` và `dispatchToRooms()` sang `Promise<void>`.
   - `onBeforeDispatch` hook được `await` tuần tự trước khi phát gói tin vào các phòng Socket.IO.
   - Hàm dedup `markAndCheckDuplicate(eventId)` chuyển sang ghi nhận sau khi emit thành công, tránh việc dedup nhầm khi quá trình gửi gặp lỗi hoặc bị từ chối quyền.

2. **`src/core/realtime/realtime-outbox-relay.ts`**:
   - `evaluateLease(stream, id)`: Trả về trạng thái `'delivered'`, `'leased_by_other'`, hoặc `'acquired'`.
   - Logic drain backlog: Nếu hàng đã có receipt (`'delivered'`), tiếp tục tiến cursor ID (`allDeliveredInBatch`) mà không broadcast lại, tránh kẹt relay sau restart.
   - Sweep phục hồi late-commit: Quét từ `lowWatermarkId` đến `cursorId` cho các giao dịch có `occurredAt` sớm nhưng commit muộn.
   - Bổ sung relay các luồng outbox: `identityOutbox` (sự kiện identity), `staffOutbox` (phân công staff), `notificationInbox` (thông báo), `auditLog` (kiểm toán nghiệp vụ).

3. **`src/core/realtime/realtime-server.ts`**:
   - Hàm `extractClientIp(socket)`: Kiểm tra cấu hình `trustedProxyHops` (mặc định 0 không tin `x-forwarded-for`, 1 lấy hop cuối cùng đáng tin cậy). Đồng bộ áp dụng cả ở handshake middleware và connection listener.
   - `tokenExpiresAt`: Tính toán chính xác `Math.min(credentialExpiresAt, idleExpiresAt, absoluteExpiresAt)`.
   - `validateSocketSession(socket)`: Đặt kiểm tra hết hạn `now > socket.data.tokenExpiresAt` **trước** bộ nhớ đệm positive cache 2 giây. Kiểm tra bắt buộc `credentialStatus === 'ACTIVE'`, `sessionStatus === 'ACTIVE'`, `accountStatus === 'ACTIVE'`. Khi repository lookup ném lỗi, áp dụng **fail-closed** ngắt kết nối socket lập tức (`socket.disconnect(true); return false;`).
   - Cập nhật dữ liệu actor trên socket immutably: `socket.data.actor = { ...socket.data.actor, roles: state.roles }`.

4. **`src/core/redis/redis-client.ts`**:
   - `createRedisManager`: Khởi tạo sẵn `client`, `pubClient`, và `subClient`.
   - `init()`: Thực hiện kết nối và await ping `PONG` đồng thời trên cả 3 clients (`general`, `pub`, `sub`) với timeout 3.000ms trước khi đánh dấu sẵn sàng.
   - `createPubSubPair()`: Trả về cặp `pubClient` và `subClient` đã sẵn sàng, an toàn cho Socket.IO adapter.

5. **`src/server.ts` & Module Runtimes**:
   - `src/server.ts`: Tiêm `redisClient: redisManager.getClient()` vào `createIdentityRuntime` và `createBookingLifecycleRuntime`.
   - `src/modules/identity-access/identity.runtime.ts`: Tiếp nhận `redisClient` từ dependencies, truyền vào `createPasswordOtpRouter` và `createAccountSettingsRouter`.
   - `src/modules/identity-access/password-otp/password-otp.router.ts`: Sử dụng `createGeneralRateLimit({ maxRequests: 30, windowMs: 15 * 60_000 }, redisClient)`.
   - `src/modules/identity-access/account/settings.router.ts`: Sử dụng `createGeneralRateLimit({ maxRequests: 10, windowMs: 15 * 60_000 }, redisClient)`.
   - `src/modules/booking-lifecycle/booking-lifecycle.runtime.ts`: Tiếp nhận `redisClient` từ dependencies, truyền vào `createBookingExperienceRouter`.
   - `src/modules/booking-lifecycle/http/experience.router.ts`: Sử dụng `createGeneralRateLimit({ maxRequests: 5, windowMs: 60 * 60_000 }, redisClient)`.

6. **`tests/integration/codex-realtime-review.test.ts` & `realtime-redis-integration.test.ts`**:
   - Loại bỏ toàn bộ dynamic sibling imports `../../../wedding-web/...` và `../../../wedding-manage-web/...`.
   - Cập nhật test server broker và outbox relay chạy hoàn toàn in-tree độc lập với web checkouts.
   - Thêm `await` vào các callsites `broker.publish(...)` trong `realtime-redis-integration.test.ts`.

---

### 2.2. Couple Web Frontend (`wedding-web`)

1. **`src/features/realtime/use-realtime.ts`**:
   - Bổ sung tùy chọn `filterBooking?: boolean` (mặc định `false`).
   - Chỉ loại bỏ sự kiện khác booking khi component chủ động yêu cầu `filterBooking === true`. Các sự kiện cấp account hoặc danh sách tiệc không bị nuốt mất.

2. **`src/features/booking-lifecycle/overview-page.tsx`**:
   - Bỏ giới hạn chỉ lắng nghe `page?.data[0]?.bookingId`.
   - Sử dụng `useRealtimeSubscription({ enabled: Boolean(page), onEvent: () => setRetry(v => v + 1), onResync: () => setRetry(v => v + 1) })`.
   - Bổ sung `useEffect` đăng ký `sharedCoupleRealtime.subscribeBooking(item.bookingId)` cho toàn bộ các tiệc hiện diện trong `page.data`.

3. **`src/features/identity-access/session-import.test.ts`**:
   - Đặt bài test kiểm tra import `WebIdentitySession` độc lập trực tiếp trong repo `wedding-web`, đảm bảo không phụ thuộc chéo.

---

### 2.3. Manager Web Frontend (`wedding-manage-web`)

1. **`src/features/realtime/use-realtime.ts`**:
   - Bổ sung tùy chọn `filterBooking?: boolean` (mặc định `false`) tương tự như Couple Web.

2. **`src/features/venue-catalog/manager-venue-workspace.tsx` & `dish-menu-panel.tsx`**:
   - Import và kết nối `addCatalogInvalidationListener` vào lifecycle hook `useEffect`.
   - Khi nhận tín hiệu `clearCatalogCache()` (do sự kiện `catalog.updated` kích hoạt), màn hình tự động thực thi `load()` để cập nhật dữ liệu mới nhất mà không cần tải lại toàn trang.

3. **`src/features/realtime/realtime-client.test.ts`**:
   - Đặt bài test kiểm tra khởi tạo `ManagementRealtimeManager` và quản lý listeners trực tiếp trong repo `wedding-manage-web`.

---

## 3. Dọn Dẹp CI (Loại Bỏ Automated Tests & Coverage)

Tuân thủ chỉ thị trực tiếp từ chủ dự án (áp dụng trên cả 3 repository: `wedding-be`, `wedding-web`, `wedding-manage-web`):

1. **`wedding-web/.github/workflows/ci.yml`**:
   - Đã **XÓA** hoàn toàn step: `Enforce automated tests and coverage` (chạy `npm run test:coverage`).
   - Cập nhật script `audit:ci` trong `package.json` từ `"npm run test:audit-policy && node scripts/audit-ci.mjs"` thành `"node scripts/audit-ci.mjs"`, tách biệt kiểm tra chính sách bảo mật khỏi việc thực thi test.

2. **`wedding-be/.github/workflows/ci.yml`**:
   - Job `quality`: Đã **XÓA** step `Run automated tests (optional)` (`npm test || true`).
   - Job `postgresql-integration`: Đã **XÓA** hai steps: `Run PostgreSQL integration tests (optional)` (`npm run test:integration || true`) và `Enforce full-suite coverage with PostgreSQL (optional)` (`npm run test:coverage || true`).
   - Giữ nguyên các gates quan trọng: `Migration deploy smoke` (`prisma migrate deploy`), lint, typecheck, OpenAPI check, dependency audit.

3. **`wedding-manage-web/.github/workflows/ci.yml`**:
   - Job `quality`: Đã **XÓA** step `Run automated tests (optional)` (`npm test || true`).
   - Cập nhật script `audit:ci` trong `package.json` từ `"npm run test:audit-policy && node scripts/audit-ci.mjs"` thành `"node scripts/audit-ci.mjs"`.

---

## 4. Kết Quả Kiểm Tra Tĩnh Cục Bộ (Lint & Typecheck)

> **LƯU Ý QUAN TRỌNG**: Thực hiện nghiêm ngặt chỉ thị của chủ dự án: **KHÔNG CHẠY BẤT KỲ LỆNH TEST NÀO** (không unit/integration/coverage test, không typography test, không E2E/Playwright, không benchmark).

| Repository | Kiểm tra | Lệnh thực thi | Mã thoát (Exit Code) | Kết quả |
|---|---|---|---|---|
| **wedding-be** | Linter | `npm run lint` | `0` | **PASS (0 warnings, 0 errors)** |
| **wedding-be** | TypeScript | `npm run typecheck` | `0` | **PASS (0 type errors)** |
| **wedding-web** | Linter | `npm run lint` | `0` | **PASS (0 warnings, 0 errors)** |
| **wedding-web** | TypeScript | `npm run typecheck` | `0` | **PASS (0 type errors)** |
| **wedding-manage-web** | Linter | `npm run lint` | `0` | **PASS (0 warnings, 0 errors)** |
| **wedding-manage-web** | TypeScript | `npm run typecheck` | `0` | **PASS (0 type errors)** |

---

## 5. Hướng Dẫn Kiểm Thử Thủ Công (Dành Cho Chủ Dự Án)

Để xác nhận luồng hoạt động mà không phụ thuộc automated runner, chủ dự án có thể thực hiện kiểm tra thủ công theo kịch bản dưới đây:

### 5.1. Kịch bản 1: Cập nhật danh mục nhà hàng (Catalog Invalidation)
1. Mở Manager Web trên trình duyệt A tại trang **Nhà hàng & Sảnh** (`/catalog` hoặc tab `venue`).
2. Mở một phiên Manager khác hoặc dùng Postman/cURL gửi yêu cầu cập nhật tên sảnh hoặc mô tả nhà hàng (`PATCH /api/v1/management/catalog/restaurant`).
3. **Kỳ vọng**: Trình duyệt A lập tức nhận sự kiện `catalog.updated` qua WebSocket, `addCatalogInvalidationListener` kích hoạt refetch ngầm; giao diện hiển thị tên mới mà không cần ấn F5 hoặc reload trang.

### 5.2. Kịch bản 2: Cập nhật tổng quan & nhiều tiệc của Couple
1. Đăng nhập tài khoản Couple có 2 tiệc cưới trên trình duyệt B tại trang **Tổng quan** (`/tong-quan`).
2. Tại trình duyệt quản trị (Manager), thực hiện xác nhận đặt cọc hoặc điều chỉnh kịch bản tiệc cho tiệc thứ hai (không phải tiệc đầu tiên đang hiển thị).
3. **Kỳ vọng**: Trình duyệt B tự động nhận sự kiện cập nhật tiệc tương ứng, giao diện danh sách tiệc tự động làm mới tiến trình tiệc mà không bị bỏ sót.

### 5.3. Kịch bản 3: Thu hồi phiên đăng nhập & hết hạn token (Revocation & Eviction)
1. Mở kết nối WebSocket từ trang Couple hoặc Manager.
2. Từ trang Hồ sơ hoặc từ phiên quản trị khác, thực hiện ấn **Đăng xuất trên các thiết bị khác** (`POST /api/v1/auth/sessions/revoke`).
3. **Kỳ vọng**: Ngay lập tức backend broadcast `session.revoked` và thực hiện evict socket. Trình duyệt chuyển trạng thái sang `disconnected` và điều hướng về trang đăng nhập an toàn, không còn nhận thêm bất kỳ dữ liệu nhạy cảm nào.

### 5.4. Kịch bản 4: Gián đoạn và phục hồi Redis / Outbox Relay
1. Khởi động backend với biến môi trường `REDIS_URL`.
2. Tạo 1 bản ghi outbox hoặc thực hiện thao tác nghiệp vụ, sau đó khởi động lại tiến trình backend.
3. **Kỳ vọng**: Outbox relay tiếp tục quét từ vị trí cursor đã giao mà không bị kẹt ở 50 hàng đầu tiên; các sự kiện chưa giao được tiếp tục gửi đến client đầy đủ.
