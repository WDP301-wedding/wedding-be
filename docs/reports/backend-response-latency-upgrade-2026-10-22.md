# Backend Response Latency Upgrade & CI Optimization Report — 2026-10-22

## 1. Executive Summary

Theo chỉ thị trực tiếp từ chủ dự án (`BE_LATENCY_REVIEW_FIX_AND_FAST_CI_20261022`), toàn bộ các phát hiện F1–F4 từ đợt review của Codex (`docs/reports/codex-review-latency-upgrade-2026-10-22.md`) đã được xử lý triệt để trong repository `wedding-be`. Đồng thời, workflow CI backend (`.github/workflows/ci.yml`) đã được cấu hình tối ưu để chạy nhanh mặc định trên push/pull_request, loại bỏ kiểm tra format check khỏi CI, và đưa toàn bộ test suites thành tùy chọn qua `workflow_dispatch` với input `run_tests` (default: `false`).

Tất cả các thay đổi tuân thủ nghiêm ngặt các quy tắc:

- Chỉ chỉnh sửa backend `wedding-be`; không chạm vào bất kỳ frontend code nào (`wedding-web`, `wedding-manage-web`, `wedding-app`).
- Giữ nguyên các tối ưu trước đó; không reset/discard git history.
- Không tự động commit, push, merge, deploy hay can thiệp branch protection/repository settings.
- Không sử dụng credentials production, không thực hiện giao dịch tiền thật VNPay hay ghi dữ liệu ngoài môi trường test cục bộ.

---

## 2. Chi tiết sửa đổi F1–F4 & Callsites

### F1 / P1: Preview Revoke Race

- **Nguyên nhân gốc:** `media.service.ts` gọi `requireActor` hai lần trước và sau `createSignedReadUrl`, nhưng cả hai lần đều nằm bên ngoài database transaction của `repository.previewAsset`. Khi session bị revoke ngay trước lần đọc thứ hai, transaction thứ hai chỉ đọc asset/file mà không re-check quyền sở hữu và hiệu lực session, dẫn đến việc API vẫn trả về signed URL.
- **Giải pháp xử lý:**
  - Bổ sung callback `authorize?: (scopedContext: MediaRequestContext) => Promise<void>` vào contract `previewAsset` của `MediaRepository`.
  - Trong `media.service.ts:preview()`, truyền callback `authorize` (gọi `this.requireActor(input.bookingId, scopedContext)`) vào cả lần đọc initial và final.
  - Trong `prisma-media.repository.ts:previewAsset()`, callback `authorize` được thực thi **bên trong** `boundary.runRead` (hoặc PostgreSQL transaction với `pg_advisory_xact_lock_shared`), bảo đảm việc kiểm tra hiệu lực session (`FOR SHARE` trên `Session`/`Account`) diễn ra cùng boundary với việc đọc metadata của file.
  - Quá trình signing URL (`storage.createSignedReadUrl`) tiếp tục được giữ **bên ngoài** mọi database transaction / lock.
- **Files & Callsites đã cập nhật:**
  - [`src/modules/invitation-studio/application/media.contracts.ts`](file:///c:/Users/Admin/Desktop/BE/wedding-be/src/modules/invitation-studio/application/media.contracts.ts) (dòng 115): Thêm tham số `authorize` vào interface `MediaRepository.previewAsset`.
  - [`src/modules/invitation-studio/application/media.service.ts`](file:///c:/Users/Admin/Desktop/BE/wedding-be/src/modules/invitation-studio/application/media.service.ts) (dòng 270–310): Định nghĩa `authorize` callback và truyền vào `previewAsset`.
  - [`src/modules/invitation-studio/infrastructure/memory-media.repository.ts`](file:///c:/Users/Admin/Desktop/BE/wedding-be/src/modules/invitation-studio/infrastructure/memory-media.repository.ts) (dòng 92–100): Thực thi `await authorize(context)` trong `previewAsset`.
  - [`src/modules/invitation-studio/infrastructure/prisma-media.repository.ts`](file:///c:/Users/Admin/Desktop/BE/wedding-be/src/modules/invitation-studio/infrastructure/prisma-media.repository.ts) (dòng 295–325): Thực thi `await authorize(scopedContext)` bên trong transaction scope.

### F2 / P1: Upload Lease Wiring & IO Outside Database Transaction

- **Nguyên nhân gốc:** `upload()` trước đây vẫn gói toàn bộ luồng trong `runCommand`/`runLocked` của repository. Do đó, các tác vụ decode/inspect hình ảnh và `Storage.put` (IO mạng bên ngoài) diễn ra trong khi đang giữ exclusive lock của booking. Ba phương thức `claimUploadLease`, `acceptUpload`, `releaseUploadLease` đã được tạo ra trước đó nhưng chưa được nối vào service.
- **Giải pháp xử lý:**
  - Tái cấu trúc hoàn chỉnh phương thức `upload()` trong `media.service.ts`:
    1. **Short DB Transaction (Claim):** Gọi `claimUploadLease` để ghi nhận command idempotency digest, kiểm tra replay (nếu đã có receipt thì trả về ngay lập tức không decode lại), và đặt reservation cho quota (`reservedFiles`, `reservedBytes`).
    2. **Outside DB Transaction (Inspect & Attempt):** Giải mã và kiểm tra kích thước ảnh bằng `inspectMedia` ngoài database transaction. Sau đó ghi nhận `recordUploadAttempt` độc lập.
    3. **Outside DB Transaction (Provider IO):** Gọi `storage.put()` đẩy file lên object storage hoàn toàn không giữ lock hay connection nào của database.
    4. **Scoped Revalidation:** Kiểm tra lại cutoff thời gian (`this.now().getTime() >= Date.parse(claim.cutoffAt)`) và actor authorization (`requireActor`).
    5. **Short DB Transaction (Atomic Accept):** Gọi `acceptUpload` với exclusive transaction ngắn để lưu `InvitationMediaAsset`, `InvitationMediaFile`, receipt idempotency, audit fact, và giải phóng lease reservation.
    6. **Guaranteed Release:** Toàn bộ khối xử lý từ sau khi claim lease được bọc trong `try ... finally`, bảo đảm nếu có lỗi (kể cả cutoff, quota hay provider lỗi) thì `releaseUploadLease` luôn được gọi để dọn dẹp reservation.
  - Ngăn chặn race condition khi upload thay thế (CAS): Bổ sung tracking `#activeReplacements` trong `MemoryMediaRepository` và `replace:${bookingId}:${assetId}` lease digest trong `PrismaMediaRepository` để reject ngay các request thay thế cùng một asset đang in-flight.
  - Quota reservation: Tính toán quota dựa trên tổng số asset đã accept cộng với các lease đang active, bảo đảm khi 101 upload chạy đồng thời thì đúng 100 upload được chấp thuận và upload thứ 101 bị từ chối với `MEDIA_QUOTA_EXCEEDED`.
- **Files & Callsites đã cập nhật:**
  - [`src/modules/invitation-studio/application/media.service.ts`](file:///c:/Users/Admin/Desktop/BE/wedding-be/src/modules/invitation-studio/application/media.service.ts) (dòng 72–165): Wiring toàn bộ orchestration `claimUploadLease` -> `inspectMedia` -> `recordUploadAttempt` -> `storage.put` -> `acceptUpload` -> `finally { releaseUploadLease }`.
  - [`src/modules/invitation-studio/application/media.contracts.ts`](file:///c:/Users/Admin/Desktop/BE/wedding-be/src/modules/invitation-studio/application/media.contracts.ts) (dòng 175): Bổ sung tham số `authorize` vào `acceptUpload`.
  - [`src/modules/invitation-studio/infrastructure/memory-media.repository.ts`](file:///c:/Users/Admin/Desktop/BE/wedding-be/src/modules/invitation-studio/infrastructure/memory-media.repository.ts): Cập nhật `claimUploadLease`, `acceptUpload`, `releaseUploadLease`, dynamic quota calculation, lease synchronization queue.
  - [`src/modules/invitation-studio/infrastructure/prisma-media.repository.ts`](file:///c:/Users/Admin/Desktop/BE/wedding-be/src/modules/invitation-studio/infrastructure/prisma-media.repository.ts): Hỗ trợ `authorize` callback và cutoff re-check bên trong `runAccept`.

### F3 / P1: VNPay Stale Cooldown Cache

- **Nguyên nhân gốc:** Cooldown cache 3 giây trong `PaymentsBillingHttpServices` ghi đè trạng thái `PENDING` cũ lên kết quả mới của `ledger.getAttempt`, ngay cả khi ledger đã ghi nhận thanh toán thành công (`SUCCEEDED`) qua IPN hoặc callback. Ngoài ra, cache dùng `Map` không có giới hạn dung lượng và không có cơ chế dọn dẹp TTL, gây rò rỉ bộ nhớ.
- **Giải pháp xử lý:**
  - Cài đặt `BoundedCooldownCache`: giới hạn tối đa 500 entries, tự động xóa entry hết hạn khi truy cập hoặc dọn dẹp entry cũ nhất (FIFO/LRU eviction) khi đạt ngưỡng capacity.
  - Tách bạch vai trò của cooldown: Cooldown chỉ dùng để điều tiết việc thăm dò provider bên ngoài (`vnpay.reconcile`), **không bao giờ ghi đè trạng thái nghiệp vụ**.
  - Khi `ledger.getAttempt` trả về trạng thái terminal (`SUCCEEDED`, `FAILED`) hoặc checkout URL đã hết hạn (`expiresAt <= now`), cache bị xóa bỏ ngay lập tức và trạng thái `applicationStatus`/settlement mới nhất từ ledger được ưu tiên.
- **Files & Callsites đã cập nhật:**
  - [`src/modules/payments-billing/http/payments-billing.http-services.ts`](file:///c:/Users/Admin/Desktop/BE/wedding-be/src/modules/payments-billing/http/payments-billing.http-services.ts) (dòng 40–110, 360–400): Thêm `BoundedCooldownCache` và logic ưu tiên terminal state.
  - [`src/modules/payments-billing/http/payments-billing.http-services.test.ts`](file:///c:/Users/Admin/Desktop/BE/wedding-be/src/modules/payments-billing/http/payments-billing.http-services.test.ts): Bổ sung 2 regression test độc lập kiểm tra race condition và expiry.

### F4 / P2: Catalog Media Concurrency Multiplication

- **Nguyên nhân gốc:** Trong `catalog-media.service.ts:listSignedHallPage`, mapper ngoài giới hạn 6 hall song song, và mỗi hall lại dùng limiter trong giới hạn 6 asset calls song song. Hai limiter lồng nhau dẫn đến peak $6 \times 6 = 36$ active signing calls tới storage provider.
- **Giải pháp xử lý:**
  - Cài đặt class `AsyncSemaphore` gắn trực tiếp tại provider boundary (`this.storage.createSignedReadUrl`). Semaphore này được chia sẻ trên toàn bộ instance của service và áp dụng cho tất cả các request đồng thời.
  - Tham số `maxConcurrency` được sanitize (`Math.max(1, Math.floor(options.maxConcurrency ?? 6))`), loại bỏ nguy cơ `0` hoặc `NaN` làm mất item.
  - Flatten xử lý danh sách hall: Duyệt hall và assets bằng `Promise.all` thông thường; toàn bộ việc điều tiết concurrency được đảm nhiệm duy nhất bởi semaphore chia sẻ tại tầng provider call.
  - Bảo toàn thứ tự danh sách trả về, cơ chế in-flight deduplication theo `objectKey`, và bounded URL cache.
- **Files & Callsites đã cập nhật:**
  - [`src/modules/venue-catalog/application/catalog-media.service.ts`](file:///c:/Users/Admin/Desktop/BE/wedding-be/src/modules/venue-catalog/application/catalog-media.service.ts) (dòng 125–170, 240–260): Tích hợp `AsyncSemaphore`.
  - [`src/modules/venue-catalog/application/catalog-media.service.test.ts`](file:///c:/Users/Admin/Desktop/BE/wedding-be/src/modules/venue-catalog/application/catalog-media.service.test.ts) (dòng 420–464): Kiểm tra 6 hall $\times$ 6 assets; khẳng định peak concurrency luôn $\le 6$.

---

## 3. Cấu hình CI Nhanh & Tùy Chọn Test (.github/workflows/ci.yml)

Theo chỉ thị mới nhất của chủ dự án, workflow `.github/workflows/ci.yml` được cấu hình lại với các nguyên tắc:

1. **Xóa hoàn toàn bước `npm run format:check`** khỏi CI pipeline của backend.
2. **Chạy nhanh mặc định (Test-OFF) trên push và pull_request:**
   - Thêm `workflow_dispatch` với input boolean `run_tests` (default: `false`).
   - Trên các sự kiện `push` và `pull_request`, `run_tests` tự động đánh giá là `false`.
   - Sử dụng biểu thức kiểm tra chuẩn: `${{ inputs.run_tests == true || inputs.run_tests == 'true' }}` để ngăn ngừa lỗi string `'false'` truthy trong GitHub Actions.
3. **Giữ nguyên các Job IDs và Check Names cần thiết cho Branch Protection:**
   - `quality` (Static, test, build, and audit gates): Chạy song song các bước `npm ci`, `npm run db:generate`, `npm run lint`, `npm run typecheck`, `npm run api:check`, `npm run build`, `npm run audit:ci`. Không chạy lặp lại unit/contract tests trong chế độ mặc định.
   - `postgresql-integration` (PostgreSQL migration and integration gates):
     - Bước `npm run db:migrate:deploy` (migration smoke test trên container PostgreSQL 17 độc lập) **luôn luôn chạy**, đảm bảo tính toàn vẹn của migrations kể cả khi tắt test suite.
     - Bước `npm run test:coverage -- --maxWorkers=2` chỉ chạy khi `run_tests` được kích hoạt.
4. **Loại bỏ việc chạy lại cùng test suite nhiều lần:**
   - Khi bật `run_tests`, lệnh `npm run test:coverage` chạy một lần duy nhất với PostgreSQL container; Vitest tự động include toàn bộ unit tests (`src/**/*.test.ts`), contract tests (`tests/contract/*.test.ts`) và integration tests (`tests/integration/*.test.ts`), đồng thời áp dụng ngưỡng coverage per-file. Loại bỏ các bước chạy riêng rẽ `test:unit`, `test:contract`, `test:integration` gây tốn kém thời gian runner.

### Hướng dẫn bật Test trong CI (Manual Run):

1. Vào tab **Actions** trên GitHub repository.
2. Chọn workflow **Backend CI** ở danh sách bên trái.
3. Nhấn nút **Run workflow** (bên phải giao diện).
4. Tích chọn checkbox **Run backend unit, contract, integration, and coverage tests** (`run_tests = true`).
5. Nhấn **Run workflow** để kích hoạt toàn bộ test suite và coverage gate.

---

## 4. Bằng Chứng Kiểm Thử Local (Verification Evidence)

Các lệnh kiểm tra đã được thực hiện trực tiếp trên workspace cục bộ với kết quả 100% pass:

| Lệnh                 | Mô tả                                                  | Mã thoát (Exit Code) | Thời gian thực thi |
| -------------------- | ------------------------------------------------------ | -------------------- | ------------------ |
| `npm run api:check`  | Kiểm tra tính nhất quán của OpenAPI manifest           | 0                    | ~4 giây            |
| `npm run typecheck`  | TypeScript compiler type-check (`tsc --noEmit`)        | 0                    | ~35 giây           |
| `npm run lint`       | ESLint kiểm tra toàn bộ codebase (`--max-warnings 0`)  | 0                    | ~1 phút 35 giây    |
| `npm run build`      | Build production bundle (`tsc -p tsconfig.build.json`) | 0                    | ~25 giây           |
| `npm run audit:ci`   | Dependency audit không có lỗ hổng bảo mật              | 0                    | ~4 giây            |
| `npx vitest run ...` | 6 targeted regression suites (85 tests)                | 0                    | ~3.12 giây         |

### Danh sách 6 Targeted Regression Test Suites đã pass:

1. `src/modules/invitation-studio/application/media.service.test.ts` (44 tests) — Pass
   - Bao gồm test: `serializes 101 concurrent originals across service instances: exactly 100 accept`.
   - Bao gồm test: `failed replacement preserves original, revision, quota and audit; pending intent survives`.
   - Bao gồm test: `rechecks revoked access and cutoff after upload: no partially accepted media`.
   - Bao gồm test: `stable command replay has one accepted file/audit and key reuse rejects changed content`.
   - Bao gồm test: `policy update queues behind upload and does not rewrite the captured policy`.
2. `src/modules/venue-catalog/application/catalog-media.service.test.ts` (11 tests) — Pass
   - Bao gồm test: `caps provider concurrency across nested hall page items to configured limit`.
3. `src/modules/payments-billing/http/payments-billing.http-services.test.ts` (2 tests) — Pass
   - Bao gồm test: `does not override fresh SUCCEEDED ledger status with stale PENDING cooldown`.
   - Bao gồm test: `never returns checkoutUrl when attempt is expired`.
4. `src/modules/identity-access/authorization/scoped-identity.reader.test.ts` (3 tests) — Pass
5. `src/modules/analytics-dashboard/application/projection.test.ts` (6 tests) — Pass
6. `src/modules/analytics-dashboard/application/analytics.service.test.ts` (19 tests) — Pass

---

## 5. Danh Mục Deferred & Giới Hạn Nghiệm Thu

1. **Hạng mục Deferred (Chưa triển khai):**
   - **Catalog List-History & Search EXPLAIN/Index:** Cần cập nhật query plans và migration index lớn, chưa thuộc phạm vi latency fix cấp bách đợt này.
   - **Billing Full-Ledger Append Projection:** Cần review kỹ lại tính bất biến của hợp đồng tài chính; giữ nguyên implementation hiện tại.
   - **Connection Pool Sizing & Worker Tuning:** Cần dữ liệu tải thực tế từ môi trường staging/production trước khi thay đổi connection pool budget.
2. **Giới hạn kiểm chứng (Blockers & Boundaries):**
   - Các integration tests native PostgreSQL yêu cầu container database độc lập trên port nội bộ (`127.0.0.1:55439` hoặc container CI `127.0.0.1:5432`). Môi trường local hiện không mở Docker daemon; việc chạy đầy đủ suite này đã được phân định rõ cho CI job `postgresql-integration` khi bật `run_tests`.
   - Không tuyên bố production live p95 < 800ms khi chưa thực hiện load test có tải thực trên hạ tầng production.
