Archived checkpoint on 2026-10-10. This preserves the 2026-10-09 results and
limitations, not current runtime/release acceptance. Current contracts are in
[the active hand-off](../../docs/spec-05-w2-w4-handoff.md); live gates remain in
[the RV backlog](../backend-revision-todo.md).

# SPEC-05 đợt 2–4: API, sửa lỗi và bàn giao

Ngày: 2026-10-09. Phạm vi: backend đợt 2–4 trên `huy/spec-05-06`.
Nguồn: PRODUCT-REQUIREMENTS MED/PRN/QRC; SPEC-invitation-studio §§3–10;
CONTRACT-BASELINE §§6.5,21.10; SPEC-seating-plan; docs/team-implementation;
tasks/plan và tasks/todo. Trạng thái kiểm chứng cuối xem plan20.16.

Kiểm chứng:104/104 tests trên6 file đạt, native PostgreSQL và provider SDK offline;
coverage các file sửa đợt2–4 đạt98.82% lines/94.05% branches và per-file80%.
Typecheck/build đã đạt ở checkpoint trước; lint file sửa/OpenAPI check đạt. Lần
typecheck toàn checkout cuối có4 lỗi possibly-undefined trong print-order-native.test.ts
đợt5 đang được viết; cần owner đợt5 sửa rồi chạy lại toàn gate. Full run trước đó964 tests đạt nhưng
coverage toàn repository chưa xanh do đợt5 đang được bổ sung; không suy test tập trung
thành nghiệm thu toàn dự án. Các tick phản ánh backend implementation, không owner review.

## Các API đã gắn server

Tất cả đường dẫn dưới đây có prefix `/api/v1`. Có 19 operation thuộc đợt 2–4,
không tính 5 operation media đợt 1 hoặc print-order của đợt 5.

| Method | Path                                                                               | Công việc                                             |
| ------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------- |
| GET    | `/invitation-templates`                                                            | Template active; Couple cần booking FULL/confirmed.   |
| GET    | `/management/invitation-templates`                                                 | Manager đọc thư viện, có tùy chọn archive.            |
| POST   | `/management/invitation-templates`                                                 | Manager tạo template/version.                         |
| GET    | `/management/invitation-templates/{templateId}`                                    | Manager đọc current hoặc version bất biến.            |
| PATCH  | `/management/invitation-templates/{templateId}`                                    | Manager revise/archive với CAS.                       |
| GET    | `/bookings/{bookingId}/invitations`                                                | Danh sách thiết kế riêng, phân trang.                 |
| POST   | `/bookings/{bookingId}/invitations`                                                | Couple Web tạo thiết kế có cấu trúc.                  |
| GET    | `/bookings/{bookingId}/invitations/{designId}`                                     | Đọc thiết kế thuộc booking được cấp quyền.            |
| POST   | `/bookings/{bookingId}/invitations/{designId}/revisions`                           | Tạo revision; Android chỉ sửa textFields.             |
| POST   | `/bookings/{bookingId}/invitations/{designId}/publication`                         | Publish exact design/publication revision.            |
| DELETE | `/bookings/{bookingId}/invitations/{designId}/publication`                         | Unpublish; giữ lịch sử.                               |
| POST   | `/bookings/{bookingId}/invitation-image-generations`                               | Sinh một ảnh PNG riêng; retry cùng intent.            |
| GET    | `/bookings/{bookingId}/invitation-image-generations`                               | Manager đọc intent PENDING, cursor/limit 1–100.       |
| POST   | `/bookings/{bookingId}/invitation-image-generations/{intentDigest}/reconciliation` | Manager kết thúc intent chưa xác định với evidence.   |
| POST   | `/bookings/{bookingId}/invitation-derived-assets`                                  | Tạo PNG dẫn xuất riêng, có giới hạn và bỏ metadata.   |
| GET    | `/public/invitations/{slug}`                                                       | Public DTO tối thiểu của revision đã publish.         |
| GET    | `/public/invitations/{slug}/render`                                                | HTML escape với CSP.                                  |
| GET    | `/public/invitations/{slug}/qr`                                                    | PNG QR chung cho booking, chỉ xem nội dung công khai. |
| GET    | `/public/invitation-assets/{slug}`                                                 | Chỉ ảnh dẫn xuất thuộc publication hiện tại.          |

Private routes kiểm tra Identity hiện tại; writes cần `Idempotency-Key`; mutation có
strict body/query và CAS phù hợp. Public routes không cần Bearer và không cấp quyền
guest/check-in/private library. Missing publication hoặc asset trả concealed404.

## Các application port đợt 4

- `InvitationPublicationReader.requirePublishedPublicInvitation` và `resolvePrintableRevision`.
- `PrintableSeatingContentRegistry.registerConfirmed` và `markRequiresReview`:
  `renderSnapshot` nhận readonly array/readonly rows; required ContractContext/UoW.
- `PrintableService.capture`: port nội bộ enlisted bởi approval đợt 5; không có
  endpoint public cho phép bỏ qua quote/billing/approval.
- `computePrintableSeatingDigest`, `seatingRenderSchema`, `validityProofSchema`
  được export qua application contracts để consumer không import repository.

## Những thiếu sót đã sửa

- Chặn opaque access/refresh token hệ thống, JWT và các nhãn credential trong prompt
  AI và text thiết kế trước provider I/O hoặc publication.
- Template list kiểm tra lại current role/FULL/booking trước trả DTO. Denial template
  và private HTTP authentication có audit riêng, không ghi token/body/resource guess.
- Registry nhận đúng readonly input. Conformance dùng chung fake/native bao phủ
  frozen input, duplicate/digest conflict, hai thứ tự invalidation, revision high-water,
  thiếu proof, authorization denial, unavailable và unknown provider failure/rollback.
- AI generation giữ PENDING khi output hợp lệ nhưng Storage/acceptance thất bại.
  Retry cùng command tìm đúng durable media upload journal, đọc lại private PNG và
  nhận vào media theo cùng intent/quota/cutoff/validation; không gọi lại Gemini.
- Nếu không có artifact xác minh được, intent vẫn PENDING. Manager có thể gửi
  `{ outcome: 'ABANDONED', evidenceReference: 'review-20261009-001' }` với key riêng.
  Kết quả FAILED/AI_GENERATION_ABANDONED và audit commit cùng transaction. Cùng key
  replay; key mới trên terminal intent conflict. Intent cũ không được generate lại.
  ABANDONED chỉ kết thúc xử lý nội bộ; không chứng minh provider không phát sinh phí,
  không tự hoàn tiền, không dùng timeout làm bằng chứng negative outcome.
- `application/publication.events.ts` định nghĩa strict payload/envelope cho publication
  và removal, giữ publishedRevisionId bắt buộc/non-null; outbox validate trước commit.

## Điều kiện còn cần owner/consumer

- Reviewed exact backend commit, committed OpenAPI digest và consumer pin trước
  Guest/client network integration. Working-tree digest không thay cho commit.
- Seating owner phải triển khai confirm/invalidate thực tế cùng Core UoW và chạy
  conformance/rollback/race với registry này. Hiện chưa có actual Seating producer;
  không dùng test fixture làm bằng chứng nghiệm thu producer.
- Digest recipe và additive removal/recovery contract được mô tả tại baseline21.11
  để owner/consumer review trước bàn giao/dispatch. Không tự ghi nhận đã được người
  khác review. Notification dispatch/reporting thuộc đợt 6; UI thuộc đợt 7.
- Có code đợt 5 được sửa đồng thời trong checkout. Gate toàn repository phải được
  chạy lại khi các thay đổi đó ổn định; không loại file đợt 5 khỏi gate toàn dự án.
