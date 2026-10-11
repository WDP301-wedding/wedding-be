# Kế hoạch bước 6: BE-11–16

Ngày lập: 2026-10-11, Asia/Saigon. Baseline đọc: `main@07afed1`.
Trạng thái: BE-11–16 đã đạt local/CI, merge qua PR #29 vào `main@0d3a7fa`
và deploy Railway theo chấp thuận của chủ dự án. Chưa nghiệm thu đầy đủ hành trình
nghiệp vụ online; chưa có approval độc lập của thành viên khác trong đội.
Lần kiểm thử lại local trên code đã merge: 36 tests / 11 files đạt; xem
[báo cáo CI, deploy và kiểm thử lại](evidence/be11-16-merge-deploy-local-recheck-2026-10-11.md).
Quyết định của chủ dự án ngày 2026-10-11: giữ nguyên code đã merge, chỉ cập nhật
tài liệu và dừng chuẩn bị test sandbox trong lần làm việc này. Không tạo booking
thử quá khứ; nghiệm thu online/RV-14 vẫn chưa có bằng chứng, không ghi pass.
Kết quả: [bằng chứng bước 6](evidence/be11-16-step6-results-2026-10-11.md).
Checklist thực thi duy nhất: [backend-revision-todo.md](backend-revision-todo.md).
Các phần nhỏ bên dưới thuộc sáu task hiện có, không phải một backlog thứ hai.

## 1. Nguồn và quy trình áp dụng

- [AGENTS.md](../AGENTS.md), [CONTRIBUTING.md](../CONTRIBUTING.md).
- [Scope đã xác nhận](../docs/backend-scope-2026-10-10.md), đặc biệt mục 6–9.
- [SPEC-commercial-contracts](../SPEC-commercial-contracts.md).
- [Quy trình đội](../docs/team-implementation.md), [migrations](../docs/database-migrations.md),
  [quality gates](../docs/cross-repo-development.md).
- [Payments](../SPEC-payments-billing.md), [Invitation](../SPEC-invitation-studio.md),
  [Booking](../SPEC-booking-lifecycle.md): dùng các amendment backend mới nhất khi
  chúng thay thế hành vi BASE/PRINT cũ.
- [ADR-010](../docs/decisions/0010-freeze-full-commercial-contracts-before-deposit.md),
  [BE-06–10 handoff](../docs/be06-10-commercial-contracts.md),
  [kết quả API](evidence/be06-10-api-results-2026-10-11.md),
  [runtime bước 5](evidence/rv13-media-ai-runtime-2026-10-11.md).

Mỗi phần việc đi từ `main` mới nhất vào nhánh `codex/<owner>-<slice>`, làm một
thay đổi tập trung, kiểm tra, review và mở PR. Merge qua GitHub sau ít nhất một
approval của thành viên khác và tất cả CI gate đạt; cập nhật `main` trước phần
tiếp theo. Không push trực tiếp vào `main`. Không tự hạ test/coverage gate.

Một phần việc thường tối đa năm file do người viết. Tách riêng schema/migration,
owner service, HTTP và wiring nếu vượt giới hạn; generated OpenAPI được theo dõi
riêng. Chỉ một luồng xuất bản migration và OpenAPI. Không sửa migration đã áp dụng.
Không cần hỏi lại các quy tắc kinh doanh đã được chủ dự án xác nhận.

## 2. Baseline và điều kiện bắt đầu

- Hợp đồng gốc, duyệt/PDF, cọc tổng hợp đồng và CONTRACT charge đã có trên `main`.
- Bước 5 có bằng chứng developer: cọc sandbox thật, media, public invitation/QR,
  một Gemini generation và recovery. Đây là checkpoint đã lưu, không phải lần
  kiểm tra live mới của kế hoạch này.
- Backlog BE-06–10 vẫn mở. Trước nghiệm thu bước 6, lập ma trận đối chiếu từng
  tiêu chí với bằng chứng mới, chạy lại regression liên quan và ghi rõ phần thiếu.
  Không đánh dấu hoàn tất chỉ vì có code hoặc một happy path đạt.
- RV-04/05/07 còn mở; theo dõi riêng. Chúng không ngăn chuẩn bị phần nghiệp vụ
  BE-11–16 trên PostgreSQL dùng riêng, nhưng phải được đóng ở checkpoint liên quan.
- Tại baseline chưa có model phụ lục/phát sinh/hóa đơn cuối mới. `BillingInvoice` là snapshot
  ledger; không được coi nó đã đáp ứng bản quyết toán thương mại có item lines.
- Print approval tại baseline đăng ký `PRINT_ORDER`; BE-12 thêm nhánh fulfillment theo hợp
  đồng đã trả nghĩa vụ, giữ nguyên đường legacy và guard ngăn thu trùng.
- Ledger schema tại baseline chưa có các nguồn `CONTRACT_APPENDIX`,
  `INCIDENTAL_FINALIZATION`, `INVOICE_ADJUSTMENT`. Đây là prerequisite có migration
  và kiểm tra riêng, không chỉ thêm hằng số ở consumer.

## 3. Các quy tắc không thay đổi

1. Booking sở hữu phụ lục; Payments sở hữu ledger/phát sinh/hóa đơn/điều chỉnh;
   Invitation sở hữu nội dung in và fulfillment. Consumer dùng owner port,
   không đọc/ghi bảng của owner khác để bỏ qua quy tắc.
2. Phụ lục chứa lý do, predecessor chính xác, before/after và signed delta. Cả
   Manager và Couple duyệt cùng revision; chỉ approval thứ hai mới kích hoạt
   nghĩa vụ mới. Giữ nguyên hợp đồng gốc, cọc và bằng chứng thanh toán cũ.
3. Tổng thỏa thuận hiệu lực không âm. Catalog thay đổi không sửa snapshot đã duyệt.
   Phụ lục không tự thu thêm cọc; sau finalization dùng invoice adjustment.
4. Số thiệp nằm trong hợp đồng không tạo thêm PRINT_ORDER charge. Thay số lượng,
   giá hoặc lựa chọn thương mại cần phụ lục được hai bên duyệt; fulfillment không
   tự quyết định giá. Thay đổi sau sản xuất giữ nguyên lịch sử sản xuất, xử lý
   order mới với nguồn thương mại mới tương ứng.
5. Manager nhập phát sinh sau authoritative event end cho booking CONFIRMED/COMPLETED
   không bị hủy. Không chờ job +12 giờ. Couple đọc, không cần duyệt phát sinh;
   Staff không được ghi. Billing không dùng số người check-in để tính tiền.
6. Chốt hóa đơn tạo snapshot và đăng ký đúng các khoản chưa có trong ledger trong
   một UoW. Hợp đồng/phụ lục đã đăng ký được tham chiếu, không cộng lại như charge mới.
7. Điều chỉnh cần lý do, predecessor, actor/time, immutable debit/credit lines và
   invoice revision mới. Không sửa/xóa hóa đơn đã chốt. Credit không đồng nghĩa
   với refund đã thực hiện; refund vẫn theo workflow Manager hiện có.
8. Payment chưa có kết luận giữ nguyên amount/version đã pin, không tự mở khóa
   khi hết hạn. Chặn thay đổi tiền xung đột đến khi có reconciliation xác minh.
9. Giữ legacy BASE/PRINT/payment history. New-model behavior dùng discriminator
   rõ ràng, không chuyển đổi booking đã có monetary evidence một cách ngầm định.

## 4. Thứ tự triển khai và nghiệm thu

Đường triển khai chính: BE-11 → BE-12 → BE-13 → BE-14 → BE-15 → BE-16.
Mỗi hàng dưới đây là một phần việc tập trung; file mới ghi là đề xuất, tên cuối
cùng theo pattern owner hiện có. Nếu schema/route/wiring vượt năm file thì tách
PR prerequisite riêng trước khi triển khai phần phụ thuộc.

### BE-11: Phụ lục và tổng thỏa thuận hiệu lực

Phụ thuộc: provider BE-07/10 thực tế và Booking UoW.

| Phần | Kết quả/tiêu chí nghiệm thu | Vùng file dự kiến | Kiểm tra |
| --- | --- | --- | --- |
| 11.1 | Schema phụ lục, immutable revisions/approvals, typed commercial reader và policy signed delta; từ chối predecessor cũ/tổng âm | `prisma/schema.prisma`, migration mới, Booking domain/port và test | Migration empty/upgrade; arithmetic/overflow và predecessor tests |
| 11.2 | Payments registrar cho approved appendix: delta dương/âm/0, unique source, replay và rollback; giữ legacy sources | Payments ledger port/domain/repository/registrar và test; enum/guards ở prerequisite migration riêng | Real PostgreSQL ledger conformance, rollback, duplicate và negative-delta tests |
| 11.3 | Tạo/submit/dual approve qua owner services; approval thứ hai kích hoạt effective revision và delta posting nguyên tử | Booking service/repository/test; HTTP/schema/wiring/OpenAPI tách phần publication | Race hai phụ lục cùng predecessor; approval/pinning/finalization conflict; RBAC và idempotency qua HTTP |

Chỉ đạt BE-11 khi code/HTTP thực chạy, effective total đúng và failed posting không
để lại phụ lục đã active. Các approvals và original deposit không bị viết lại.

### BE-12: Fulfillment thiệp theo hợp đồng

Phụ thuộc: BE-05/10/11, exact printable snapshot và Billing registrar.

| Phần | Kết quả/tiêu chí nghiệm thu | Vùng file dự kiến | Kiểm tra |
| --- | --- | --- | --- |
| 12.1 | Liên kết print line với contract/approved appendix line và source revision; quản lý lượng đã phân bổ để không dùng cùng nghĩa vụ cho hai order vượt tổng | Schema/migration, Invitation port/policy và tests | Concurrent allocation, wrong booking/source/template/material và quantity bounds |
| 12.2 | Content approval giữ snapshot đúng revision; in lượng đã thỏa thuận không tạo charge mới; tăng/giảm đi qua approved appendix | Invitation print service, Booking entitlement reader, owner conformance tests | Contract charge count không đổi; signed delta đúng một lần; legacy print regression |
| 12.3 | Production/cancel/replacement và HTTP phân biệt fulfillment với thay đổi thương mại; lịch sử sản xuất giữ nguyên | Invitation print router/schema/service tests; publication tách riêng | Không sản xuất khi nguồn stale/pending; cancel không tự credit toàn bộ CONTRACT; retry/rollback/race |

Checkpoint A sau BE-11–12: approved appendix → exact print fulfillment → ledger
không thu trùng; không cần tên Guest, seating hoặc renderer file in.

### BE-13: Phát sinh draft và event-end policy

Phụ thuộc: BE-10 và Booking lifecycle/event-end reader thực tế.

| Phần | Kết quả/tiêu chí nghiệm thu | Vùng file dự kiến | Kiểm tra |
| --- | --- | --- | --- |
| 13.1 | Persist draft head/revision và line: name, quantity, unit, integer unitPriceVnd, optional note; total do server tính | Schema/migration, Payments expense domain và test | Migration; quantity/price/overflow/NFC validation |
| 13.2 | Manager-only owner service ở authoritative event end; CONFIRMED/COMPLETED, non-cancelled; expected revision, audit | Payments expense service/repository/port và test | Trước/đúng/sau end; chưa chạy completion worker vẫn dùng được; quyền và stale revision |

### BE-14: API phát sinh

Phụ thuộc: BE-13.

| Phần | Kết quả/tiêu chí nghiệm thu | Vùng file dự kiến | Kiểm tra |
| --- | --- | --- | --- |
| 14.1 | CRUD draft strict schemas; Idempotency-Key; cross-booking concealment; không nhận client total/role | Payments HTTP router/schema và integration test | Manager CRUD, Couple/Staff denial, duplicate, changed-body key reuse, concurrent edits |
| 14.2 | Mount runtime và OpenAPI đúng code; read surface cho Couple qua authorized invoice/draft read contract theo scope | Payments composition/OpenAPI và contract tests | Actual HTTP examples, no-store, artifact digest; chưa đăng route spec-only |

Checkpoint B sau BE-13–14: Manager CRUD phát sinh tại event end, Couple đọc dữ liệu
được phép; chưa finalize thì chưa có charge phát sinh trong ledger.

### BE-15: Hóa đơn cuối

Phụ thuộc: BE-11/12/14.

| Phần | Kết quả/tiêu chí nghiệm thu | Vùng file dự kiến | Kiểm tra |
| --- | --- | --- | --- |
| 15.1 | Immutable invoice head/revisions/lines và source references; policy snapshot contract + approved appendices + exact expense draft | Schema/migration, Payments invoice domain/port và tests | Migration/immutability; zero-expense và checked totals |
| 15.2 | Manager finalization trong shared UoW: pin source revisions, register incidental once, activate invoice, audit/outbox; lock expense edits/appendix activation | Payments invoice service/repository và cross-owner tests | Hai finalize đồng thời; replay; stale expense/appendix; injected failure rollback toàn bộ |
| 15.3 | Finalize và private itemized read APIs; totals/ledger agreement; terminal conflict sau chốt | Payments router/schema/composition/test; OpenAPI publication tách riêng | Couple read/Staff denial, zero-expense HTTP, original sources không thành charge lần hai |

Phải phân biệt immutable invoice content với thanh toán tiếp diễn. Invoice giữ
sourceBillingRevision/totals tại lúc chốt; billing read hiện tại tính payment/refund
mới từ ledger và nói rõ revision/as-of. Payment mới không viết lại invoice cũ.

### BE-16: Điều chỉnh và payment balance theo invoice revision

Phụ thuộc: BE-15 và payment reconciliation workflow hiện có.

| Phần | Kết quả/tiêu chí nghiệm thu | Vùng file dự kiến | Kiểm tra |
| --- | --- | --- | --- |
| 16.1 | Manager reasoned adjustment, exact invoice predecessor, immutable debit/credit và invoice successor; unique ledger source | Schema/migration, Payments adjustment domain/port/registrar và test | Tăng/giảm/0, total nonnegative, stale predecessor, ledger consistency và rollback |
| 16.2 | BALANCE amount do server tính, pin applicable invoice revision/digest cùng billing revision; cả VNPay/manual paths dùng invariant thống nhất | Payments attempt schema, balance services/repositories và test; migration riêng | Adjust-vs-checkout race, pending/unknown pin, verified failure release, late success và duplicate callback |
| 16.3 | Adjustment/read/status APIs trả outstanding/credit; refund approval/recording hiện có tương thích nguồn credit mới | Payments HTTP/providers/reporting và tests; OpenAPI publication tách riêng | Settled vs pending money, manual refund limits/replay/race, credit không tự refund; legacy regression |

Checkpoint C sau BE-15–16: full-contract deposit → appendix tăng/giảm → print
fulfillment → event-end expense → final invoice → adjustment → controlled balance
settlement/refund. Mọi invoice cũ và payment evidence giữ nguyên.

## 5. Bộ dữ liệu và công thức nghiệm thu

Ví dụ dùng số giả lập, không phải dữ liệu khách hàng:

- Contract: 47.000.000 VND; deposit đã settled: 14.100.000 VND.
- Approved appendix A: +3.000.000; B: -1.000.000.
- Incidental finalized: 2.000.000.
- Final total: 51.000.000; net paid: 14.100.000; outstanding: 36.900.000.
- Controlled balance settlement: +36.900.000 → outstanding 0.
- Invoice adjustment: -1.000.000 → credit 1.000.000, chưa có refund.
- Approved và recorded manual refund: 1.000.000 → net paid 50.000.000; credit 0.

```text
finalTotalVnd = originalContractTotalVnd + approvedAppendixDeltaVnd + incidentalTotalVnd
adjustedTotalVnd = finalTotalVnd + approvedInvoiceAdjustmentDeltaVnd
netPaidVnd = settledPaymentsVnd - settledRefundsVnd
balanceVnd = applicableInvoiceTotalVnd - netPaidVnd
outstandingVnd = max(balanceVnd, 0)
creditVnd = max(-balanceVnd, 0)
```

Ma trận bổ sung: zero-expense invoice; delta âm tạo overpayment; multi-menu;
archived source không đổi lịch sử; booking không có Guest list; print giảm dưới
lượng đã sản xuất; source reuse khác amount; concurrent approvals/finalize/adjust/
payment; provider UNKNOWN; rollback giữa ledger append và head activation; legacy
confirmed booking/payment không bị đổi model hoặc charge lần hai.

## 6. Verification và bằng chứng

- Mỗi phần: focused behavior tests, changed-file Prettier, `git diff --check` và
  kiểm tra type phù hợp. Tests tiền/quyền/race dùng owner implementation thật.
- PostgreSQL dùng riêng: cấu hình cả DATABASE_URL, MIGRATION_DATABASE_URL và
  TEST_MIGRATION_DATABASE_URL vào loopback/disposable target. Không để test thừa
  hưởng database/provider chung từ `.env`. Skip integration không tính là đạt.
- Checkpoint API/provider: typecheck, lint, unit/full tests, build, contract tests,
  API generate/check, integration, per-file coverage, dependency audit và formatting.
- Migration: empty install, upgrade có legacy/full-contract fixtures, SQL guards
  chống sửa history và race; chỉ forward migrations.
- Tạo báo cáo riêng BE-11–16: từng tiêu chí → test/evidence, commit, migration,
  provider/schema/OpenAPI digest, actual requests/responses và totals/ledger IDs
  đã redacted. Tách implemented/offline/configured/live.
- Bước 6 kết thúc khi sáu task được wired và verified, checkpoint C đạt, CI xanh,
  reviewer chấp thuận và evidence cập nhật. Live balance sandbox là RV-14 ở bước 7;
  printable file renderer là RV-17/18 ở bước 7; BE-17 hand-off tổng thể ở bước 8.
  Không nhận các kết quả controlled transport thành live provider acceptance.

## 7. Thông tin từ chủ dự án

Nghiệp vụ cốt lõi đã được chốt trong scope; không cần hỏi lại tỷ lệ cọc, người duyệt
phụ lục, quyền phát sinh/finalization, companion/check-in hay Guest-list prerequisite.
Không có yêu cầu credential provider mới để triển khai và kiểm tra local bước 6.

Thông tin hữu ích nhưng không chặn phần local:

1. Nếu có mẫu thực tế muốn dùng nghiệm thu: một phụ lục tăng/giảm dịch vụ/thiệp,
   danh sách phát sinh và cách trình bày hóa đơn. Nếu không cung cấp, dùng synthetic
   fixtures ở mục 5 và các bounds/fields đã được duyệt.
2. Trước runtime/deployment rehearsal: target developer/staging, database dùng riêng,
   test booking và tài khoản Manager/Couple được phép dùng. Mặc định chuẩn bị local
   disposable; việc cho phép test cũ không tự mở rộng sang thay đổi dữ liệu mới trên
   target chung. Không gửi mật khẩu/key/token vào tài liệu hay chat.
3. Người review PR của đội, nếu muốn chỉ định; không cần để soạn code/test local,
   nhưng CONTRIBUTING yêu cầu approval thành viên khác trước merge.

Hai lựa chọn đề xuất cần được ghi rõ ở thời điểm triển khai, không coi là scope đã
duyệt riêng: phân bổ entitlement thiệp qua nhiều production order/batch nếu client
cần; và quy ước invoice numbering/display cho bản quyết toán mới. Với phạm vi tối
thiểu, dùng explicit contract-line allocation có tổng không vượt entitlement và
server-generated stable identity; không yêu cầu chủ dự án chọn tên bảng/route/lock.

## 8. Rủi ro và cách kiểm soát

| Rủi ro | Cách kiểm soát |
| --- | --- |
| Thu trùng contract/print/appendix ở finalization | Typed source revisions, unique constraints; chỉ post phần chưa có; cross-owner ledger assertions |
| Credit âm bị biểu diễn sai hoặc bị clamp mất | Signed delta policy, positive debit/credit ledger facts, checked safe integers; kiểm tra net paid/refund/overpayment |
| Approval/finalization/payment cùng sửa tổng | Chung Booking serialization/UoW và optimistic revisions; lock theo thứ tự owner hiện có |
| Thay source revision khi payment UNKNOWN | Durable invoice/amount pin; only proven reconciliation có thể giải quyết |
| Bỏ qua nghĩa vụ đã sản xuất khi giảm thiệp | Track allocations/production evidence; từ chối rewrite lịch sử, explicit successor/order theo agreed delta |
| Gọi provider hoặc dùng shared DB do env kế thừa | Disposable env explicit; controlled transports; live action có target/scope riêng |
| Checklist cũ không theo kịp evidence | Đối chiếu BE-06–10 và cập nhật link/status có bằng chứng; không sửa lịch sử để giả lập acceptance |
