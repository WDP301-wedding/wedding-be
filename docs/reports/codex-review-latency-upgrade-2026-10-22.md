# Codex review — Anti latency upgrade — 2026-10-22

## Kết luận

**Chưa đạt để phát hành.** Có cải thiện thật, nhưng phần upload quan trọng nhất chưa được nối vào service; preview và payment cooldown có regression đã tái hiện. Giới hạn concurrency catalog cũng không đúng ở hall page.

Review diff chưa commit trên HEAD `6554a69c35cc2342cc28046a21d9559c2bf7adc7`: 13 file tracked thay đổi, khoảng +1186/-98 dòng khi bắt đầu. Chỉ wedding-be; Codex không sửa implementation/contract/config, không commit/push/deploy, không nhắn thêm Anti trong lượt review này.

Đã đọc lời báo hoàn tất của Anti qua IDE CDP. File báo cáo được yêu cầu `docs/reports/backend-response-latency-upgrade-2026-10-22.md` **chưa tồn tại** tại lúc review. Không có bảng trước/sau hoặc danh sách deferred trong artifact đó để kiểm chứng.

## Findings cần xử lý

### F1 — P1: Preview trả signed URL sau khi session đã bị revoke trước final read

- `src/modules/invitation-studio/application/media.service.ts:261–272`: hai lần `requireActor` đều chạy ngoài `repository.previewAsset` transaction.
- `src/modules/invitation-studio/infrastructure/prisma-media.repository.ts:294–307`: `runRead` chỉ đọc asset/policy; callback không enlist current Identity/Booking access guard.
- Boundary tự nó xác thực scope/transaction identity, không tự kiểm tra session/booking access.

Native PostgreSQL reproduction: upload synthetic media hợp lệ; hook ngay trước lần `previewAsset` thứ hai, commit `Session.status=REVOKED` bằng connection riêng, rồi cho final read tiếp tục. Preview vẫn trả signed URL. Resolver độc lập sau đó từ chối cùng token với HTTP-equivalent 401.

Đây là khoảng trống giữa final authorization và final projection transaction. Cách sửa: final boundary phải thực hiện fresh authorization với scoped context, giữ authority/booking eligibility locks cùng exact-asset read tới commit; external signing vẫn ở ngoài transaction. Giữ việc ghi denied audit đúng rollback/deferred semantics. Không chỉ thêm một preflight read khác bên ngoài boundary.

### F2 — P1: Upload lease mới không được gọi; điểm chậm upload vẫn nguyên

- `media.service.ts:70`: upload vẫn dùng `runCommand/runLocked`.
- `media.service.ts:82`, `:93`: inspect và Storage.put vẫn nằm trong callback đó; journal vẫn cần connection riêng khi acceptance tx đang mở.
- `prisma-media.repository.ts:323`, `:585`, `:741`: claim/accept/release mới có implementation nhưng không có production callsite trong service.
- `memory-media.repository.ts` cũng thêm các method tương ứng. Tổng cộng khoảng 700 dòng implementation mới ở hai adapter chưa được upload flow sử dụng.

Native PG probe chặn Storage.put bằng controlled gate: transaction khác **không lấy được shared booking lock** trong lúc upload chờ. Vì vậy không thể coi nhiệm vụ chuyển upload IO ra khỏi transaction đã xong. Không phải vấn đề suy đoán từ diff.

Cần hoàn thiện service orchestration claim → inspect/provider ngoài DB → fresh scoped revalidation + atomic accept → release/recovery, hoặc bỏ scaffolding chưa dùng và báo deferred rõ. Không nối thẳng các method hiện tại mà bỏ review: accept path hiện chưa thể thay thế đầy đủ service guards, cutoff/policy/quota revalidation và recovery safeguards của đường cũ.

### F3 — P1: Payment cooldown ghi đè trạng thái mới bằng kết quả cũ

- `src/modules/payments-billing/http/payments-billing.http-services.ts:356–360`.
- Endpoint đã gọi `ledger.getAttempt` mới, nhưng cache chưa hết 3 giây sẽ ghi đè `status/applicationStatus/checkoutUrl` bằng result cũ mà không đối chiếu state/evidence/revision.

Controlled boundary reproduction: request đầu đọc PENDING và lưu cooldown; cập nhật dữ liệu giả lập ở ledger boundary thành SUCCEEDED (mô phỏng IPN/settlement đã commit); request thứ hai gọi getAttempt mới và nhận SUCCEEDED nhưng HTTP-service result vẫn **PENDING**, reconcile không chạy lại. Đã assert đầy đủ call count và response, không gọi VNPay thật.

Cache này còn không có capacity bound hoặc cleanup expired entries; các attemptId đã hết hạn vẫn giữ trong Map nếu không được thay thế, tạo tăng memory theo lịch sử attempt/process.

Cách sửa: cooldown chỉ giới hạn **provider polling**, không cache đè trạng thái nghiệp vụ đọc mới. Terminal/evidence/checkout expiry và settlement phải thắng kết quả cũ. Giữ single-flight nhưng kiểm tra lại current state/application evidence khi có race; cache phải bounded/expired eviction, clock/policy rõ. Không biến unknown thành failed.

### F4 — P2: Hall page nhân giới hạn concurrency 6 thành 36

- `src/modules/venue-catalog/application/catalog-media.service.ts:236–241`.
- Outer map chạy tối đa 6 hall; mỗi hall mở inner map tới 6 asset calls. Hai limiter độc lập làm peak 6 × 6, chưa tính nhiều request cùng lúc.

Controlled provider probe với đúng 6 hall × 6 object keys khác nhau, maxConcurrency=6: đo peak **36 active createSignedReadUrl calls**. Không sleep giả độ trễ, dùng asynchronous scheduling boundary để quan sát concurrency.

Cách sửa: một semaphore/provider-work queue chia sẻ ở service/provider boundary; flatten asset work hoặc đặt gate ở từng external signing call, giữ output order và in-flight dedup. Per-list mapper không thay thế global/provider concurrency budget.

## Những cải thiện được xác nhận

- **Preview đã bỏ booking lock khi chờ ký URL:** native shared-lock probe lấy được lock trong lúc provider signing pending. Cần giữ cải thiện này khi sửa F1.
- Analytics đặt single-flight tại projector nên scheduler và HTTP cùng scope có thể dùng chung refresh; no-change path cập nhật checkpoints thay vì ghi/xóa toàn bộ generation rows. Tuy nhiên vẫn load toàn previous rows trước khi xét no-op; chưa phải incremental/read-light refresh hoàn chỉnh.
- Catalog có object-key in-flight dedup và bounded URL-cache size, có giảm signing lặp. Provider batch signing chưa được triển khai; F4 còn tồn tại.
- Guest import đã batch history/audit, report dùng Map lookup. Guest create/update chính vẫn chạy từng row; không được tuyên bố toàn bộ import đã bulk write.
- Media recovery receipts đã batch thay vì lookup từng attempt.
- Identity có cache theo transaction object và kiểm tra expiry; unit test mới xác nhận reuse. Chưa có regression mới chứng minh same-transaction authority mutation/invalidation; không kết luận cache đáp ứng mọi điều kiện chỉ từ happy-path test này.
- Catalog list-history, billing full-ledger append, search EXPLAIN/index và pool/worker sizing chưa có thay đổi tương ứng trong diff; cần ghi deferred/not-applicable cụ thể như task đã yêu cầu.

## Verification do Codex tự chạy

| Kiểm tra                                          | Kết quả                                                   |
| ------------------------------------------------- | --------------------------------------------------------- |
| TypeScript `tsc --project tsconfig.json --noEmit` | exit 0                                                    |
| ESLint toàn repo `eslint . --max-warnings 0`      | exit 0                                                    |
| Prettier check 13 file tracked đang thay đổi      | exit 0                                                    |
| `git diff --check`                                | exit 0                                                    |
| Targeted regression suite                         | **9 files / 119 tests passed**, exit 0, 55,84 giây        |
| Audit probes bổ sung                              | **5 probes matched observed behavior**, exit 0, 5,64 giây |

9 regression files:

```text
src/modules/identity-access/authorization/scoped-identity.reader.test.ts
src/modules/invitation-studio/application/media.service.test.ts
src/modules/venue-catalog/application/catalog-media.service.test.ts
src/modules/analytics-dashboard/application/projection.test.ts
src/modules/analytics-dashboard/application/analytics.service.test.ts
tests/integration/invitation-studio/media-native-providers.test.ts
tests/integration/invitation-studio/reader-boundaries.test.ts
tests/integration/analytics-dashboard.test.ts
tests/integration/guest-management.test.ts
```

5 probes gồm preview-unlocked (cải thiện), upload-still-locked (chưa làm), preview-after-revocation (regression), payment-fresh-success-overridden (regression), hall-signing-peak-36 (limiter sai). Các probe assert **hành vi quan sát được**, nên pass không có nghĩa implementation an toàn. Existing regression suite chưa bao phủ đủ các race mới này.

DB tests chỉ dùng PostgreSQL 18 riêng trên `127.0.0.1:55439`, mỗi suite tạo/drop UUID DB synthetic; Storage/VNPay có kiểm soát, không provider thật/tiền thật. Set DATABASE_URL/MIGRATION_DATABASE_URL/TEST_MIGRATION_DATABASE_URL sang local trước chạy, NODE_ENV=test và AUTH_ACCESS_TOKEN_TTL_SECONDS=1800. Cluster đã dừng.

Probe tạm đã xóa khỏi source, bản tái lập ở `C:/Users/Admin/AppData/Local/Temp/codex-latency-review-2026-10-22.test.ts`; đặt trong tests/integration/invitation-studio để giữ relative imports khi chạy lại. SHA256 `CEDAE39FDD575F0BD631AFCDBCE61043A79F4539460FE26BA1647E23DD7613D4`. Hai lượt probe đầu dùng fixture catalog chưa hợp lệ và fail ở validation fixture; đã sửa purpose/PNG magic bytes rồi chạy toàn bộ 5 probe đạt. Không tính lỗi fixture đó là implementation regression.

Còn cảnh báo pg hiện hữu về queued queries trên một client; không che/suppress. Không chạy live provider, production load test, browser E2E hay chứng minh production p95 <800 ms. Không tự xác nhận lại con số 1486 unit tests Anti báo trong chat; ở đây chỉ ghi những lệnh Codex thực sự chạy.

## Điều kiện trước release

Sửa F1/F3 trước; hoàn thiện hoặc báo đúng F2; sửa shared concurrency limiter F4. Bổ sung permanent regressions cho các race này, báo cáo trước/sau SQL/provider-call/lock/latency cùng workload, và status rõ cho hạng mục deferred. Type/lint/format pass là cần thiết nhưng không đủ để kết luận không break logic/flow.
