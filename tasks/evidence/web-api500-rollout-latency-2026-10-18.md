# Kết quả khởi động lại backend và đo API — 18/10/2026

Đã áp dụng cấu hình được chủ dự án duyệt và khởi động lại backend Railway.
**38/38 API đọc được đo trả HTTP 200; 30/30 request trong các nhóm tái hiện ảnh lỗi trả 200.**
Tổng 234 thao tác HTTP được đối chiếu đủ request ID với log của deployment mới;
không có HTTP 5xx trong các thao tác này. Đây là kết quả kiểm tra có giới hạn,
không phải cam kết không còn lỗi ở mọi tải.

## Cấu hình và deployment

- Thay đổi duy nhất: `DB_POOL_ACQUIRE_TIMEOUT_MS=2000 -> 10000`.
- Deployment mới: `df563b30-08b6-41bc-949d-cb908f2650b9`; deployment cũ đã dừng.
- Source: `cc2999acdd24dc87e713806328022b160585c599`.
- Image giữ nguyên: `sha256:d201a414b903413b28724591c52f2ab3a3cc0492818dd42d58ed2af370d55892`.
- Snapshot deployment xác nhận giá trị 10000; giữ SFO, một replica, worker cấu hình bật,
  pool chung 1, Catalog 3, Analytics 2, reserve 36 và HTTP deadline 30 giây.
- Ngân sách kết nối giữ `12 * 2 + 36 = 60`; không lấy phần dự phòng provider để tăng pool.
- Rollback: khôi phục giá trị 2000 và redeploy; chưa cần sử dụng.

## Cách đo và phạm vi

Đo trực tiếp qua [web Vercel](https://wedding-web-silk.vercel.app/) và
[Railway backend](https://wedding-be-production-e1dc.up.railway.app/), dùng tài khoản
Couple được cung cấp riêng trong chat và booking test có sẵn. Không lưu mật khẩu,
token, signed URL, nội dung hồ sơ/khách/hợp đồng vào báo cáo.

Mỗi route: 3 lượt tuần tự qua Vercel và 1 lượt qua Railway. Nhóm 6 request trong ảnh
được gọi đồng thời 3 lần qua Vercel và 2 lần qua Railway, bao gồm lượt smoke ban đầu.
Thời gian client tính đến khi tải xong toàn bộ phản hồi. Cột backend lấy từ log request
tương ứng; cột Railway chỉ có một mẫu, không dùng để kết luận phần chênh lệch do proxy.
Lượt khám phá ban đầu được giữ riêng, không trộn vào median.
Đo trang đầu với các query thực tế: guests ACTIVE limit=50, billing limit=25,
halls/menu-packages limit=12, dishes limit=20, services/print-offerings limit=50,
invitations/print-orders/templates limit=20. Request pattern đầy đủ nằm trong JSON;
không khẳng định mọi trang cursor hay kích thước dữ liệu khác có cùng tốc độ.

Ngưỡng **median từ 2 giây** là tiêu chí phân loại để ưu tiên trong đợt này, không phải
SLA đã được thống nhất. Với ba mẫu không gọi giá trị lớn nhất là p95.
Có **21 đường dẫn** vượt ngưỡng, tương ứng **20 nhóm API chính**:
route management incidental-expenses là alias của route Couple incidental-expenses,
dùng cùng handler đọc và không tạo thêm một nhóm chức năng cần tối ưu.
Xem bảng theo thứ tự chậm giảm dần bên dưới.

Đã kiểm kê toàn bộ **220 operation**, gồm **82 GET**,
trong OpenAPI. 38 route Public/Couple có dữ liệu đã được đo, gồm 37 route chính
và một alias management incidental-expenses; health được
smoke riêng. Các route cần quyền khác, thiếu dữ liệu, callback và thao tác ghi được
liệt kê riêng. Chưa kiểm tra toàn bộ hành vi của 220 operation.

## Bảng thời gian

Đơn vị: giây. Mọi dòng dưới đây trả HTTP 200 trong cả 4 lượt đo.

| STT | API | Vercel median, n=3 | Vercel max | Backend median | Railway, n=1 | Phân loại |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 1 | `GET /api/v1/bookings/{bookingId}/payments/{attemptId}` | 5.44 | 5.53 | 4.80 | 4.05 | Ưu tiên cải thiện |
| 2 | `GET /api/v1/bookings/{bookingId}/seating-plans/current` | 5.17 | 5.30 | 4.50 | 4.84 | Ưu tiên cải thiện |
| 3 | `GET /api/v1/bookings/{bookingId}/seating-plans/{planId}` | 5.16 | 11.68 | 4.65 | 4.88 | Ưu tiên cải thiện |
| 4 | `GET /api/v1/bookings/{bookingId}/seating-layout-options` | 4.52 | 4.62 | 4.05 | 4.30 | Ưu tiên cải thiện |
| 5 | `GET /api/v1/invitation-templates` | 4.22 | 4.23 | 3.75 | 3.97 | Ưu tiên cải thiện |
| 6 | `GET /api/v1/bookings/{bookingId}/invitations` | 4.06 | 4.08 | 3.45 | 3.78 | Ưu tiên cải thiện |
| 7 | `GET /api/v1/bookings/{bookingId}/invitations/{designId}` | 3.92 | 3.95 | 3.45 | 3.85 | Ưu tiên cải thiện |
| 8 | `GET /api/v1/bookings/{bookingId}/contracts/{revisionId}/pdf` | 3.67 | 3.82 | 3.12 | 3.37 | Ưu tiên cải thiện |
| 9 | `GET /api/v1/bookings/{bookingId}/guests/{guestId}/personalized-invitations` | 3.60 | 3.60 | 3.12 | 3.34 | Ưu tiên cải thiện |
| 10 | `GET /api/v1/bookings/{bookingId}/attendance-summary` | 3.44 | 3.48 | 2.85 | 3.07 | Ưu tiên cải thiện |
| 11 | `GET /api/v1/bookings/{bookingId}/guest-groups` | 3.29 | 4.37 | 2.81 | 3.03 | Ưu tiên cải thiện |
| 12 | `GET /api/v1/bookings/{bookingId}/guests` | 3.27 | 3.28 | 2.81 | 3.03 | Ưu tiên cải thiện |
| 13 | `GET /api/v1/bookings/{bookingId}/guest-plan` | 3.26 | 3.41 | 2.81 | 3.05 | Ưu tiên cải thiện |
| 14 | `GET /api/v1/bookings/{bookingId}/contracts` | 3.14 | 3.16 | 2.67 | 2.92 | Ưu tiên cải thiện |
| 15 | `GET /api/v1/bookings/{bookingId}/check-in-settings` | 3.00 | 4.08 | 2.55 | 2.78 | Ưu tiên cải thiện |
| 16 | `GET /api/v1/bookings/{bookingId}/billing` | 2.85 | 4.08 | 2.25 | 2.52 | Ưu tiên cải thiện |
| 17 | `GET /api/v1/management/bookings/{bookingId}/incidental-expenses` | 2.78 | 4.02 | 1.84 | 2.62 | Ưu tiên cải thiện |
| 18 | `GET /api/v1/bookings/{bookingId}/contract-appendices` | 2.41 | 2.42 | 1.94 | 2.16 | Ưu tiên cải thiện |
| 19 | `GET /api/v1/bookings/{bookingId}/print-orders` | 2.41 | 2.55 | 1.80 | 2.02 | Ưu tiên cải thiện |
| 20 | `GET /api/v1/bookings/{bookingId}/incidental-expenses` | 2.28 | 2.33 | 1.79 | 2.08 | Ưu tiên cải thiện |
| 21 | `GET /api/v1/bookings/{bookingId}/final-invoices` | 2.14 | 2.34 | 1.65 | 1.90 | Ưu tiên cải thiện |
| 22 | `GET /api/v1/catalog/halls/{hallId}` | 1.97 | 2.03 | 1.52 | 0.66 | Dưới ngưỡng 2 s |
| 23 | `GET /api/v1/catalog/restaurant` | 1.96 | 2.02 | 1.50 | 1.72 | Dưới ngưỡng 2 s |
| 24 | `GET /api/v1/bookings/{bookingId}/proposal` | 1.95 | 1.99 | 1.49 | 1.72 | Dưới ngưỡng 2 s |
| 25 | `GET /api/v1/notifications/inbox` | 1.92 | 2.65 | 0.92 | 1.14 | Dưới ngưỡng 2 s |
| 26 | `GET /api/v1/auth/me` | 1.85 | 2.18 | 1.26 | 0.58 | Dưới ngưỡng 2 s |
| 27 | `GET /api/v1/catalog/dishes` | 1.62 | 1.98 | 1.15 | 1.37 | Dưới ngưỡng 2 s |
| 28 | `GET /api/v1/catalog/halls` | 1.52 | 1.55 | 1.03 | 1.37 | Dưới ngưỡng 2 s |
| 29 | `GET /api/v1/catalog/print-offerings` | 1.51 | 1.59 | 1.05 | 1.28 | Dưới ngưỡng 2 s |
| 30 | `GET /api/v1/notifications/unread-count` | 1.44 | 1.98 | 0.77 | 0.99 | Dưới ngưỡng 2 s |
| 31 | `GET /api/v1/catalog/services` | 1.40 | 1.50 | 0.90 | 1.11 | Dưới ngưỡng 2 s |
| 32 | `GET /api/v1/catalog/menu-packages` | 1.36 | 1.41 | 0.90 | 1.13 | Dưới ngưỡng 2 s |
| 33 | `GET /api/v1/consultations/{consultationId}/couple-profile` | 1.21 | 1.21 | 0.75 | 0.97 | Dưới ngưỡng 2 s |
| 34 | `GET /api/v1/couple/bookings` | 1.21 | 1.21 | 0.75 | 1.00 | Dưới ngưỡng 2 s |
| 35 | `GET /api/v1/notifications/android-installations` | 0.94 | 0.94 | 0.46 | 0.67 | Dưới ngưỡng 2 s |
| 36 | `GET /api/v1/notifications/preferences` | 0.94 | 0.95 | 0.46 | 0.69 | Dưới ngưỡng 2 s |
| 37 | `GET /api/v1/auth/sessions` | 0.79 | 0.81 | 0.31 | 0.54 | Dưới ngưỡng 2 s |
| 38 | `GET /api/v1/auth/profile` | 0.76 | 0.79 | 0.31 | 0.66 | Dưới ngưỡng 2 s |

## Các nhóm request đồng thời

Nhóm giữ đúng các path trong ảnh: check-in-settings, guests ACTIVE limit=50,
attendance-summary, guests ACTIVE limit=50 lặp lại, contract-appendices, billing limit=1.
Lượt gọi lặp guests được giữ để tái hiện cách trang gửi request, không gộp mất khỏi mẫu.

| Đường gọi | Số request | HTTP | Median | Max |
| --- | ---: | --- | ---: | ---: |
| vercel | 18 | 200 | 5.13 | 15.26 |
| railway | 12 | 200 | 4.21 | 6.62 |

## Thứ tự cải thiện đề xuất

1. **Seating và trạng thái thanh toán**: ưu tiên current/detail/layout-options và
   payment-attempt status. Status được đo trên attempt MANUAL có sẵn, không bao gồm
   thời gian VNPay reconciliation. Giảm các lần đọc lại authority/ledger/booking trong
   một request và giữ đúng bằng chứng tiền; không bỏ xác thực hay suy luận settlement.
   Với Seating, giảm số lượt lấy lại các fact
   planning/layout/group trong một lần đọc và thời gian giữ transaction, đồng thời
   giữ revalidation, snapshot, quyền truy cập và cơ chế chống race.
2. **Invitation Studio**: danh sách/chi tiết thiệp và template. Rà soát các bước đọc
   quyền/booking lặp trước và sau truy vấn, tiếp tục batch đầu mục/current revision.
   Không bỏ bước kiểm tra quyền hoặc cache dữ liệu riêng giữa các tài khoản để đổi tốc độ.
3. **Guest/Staff**: groups, plan, guests, personalized metadata và check-in/attendance.
   Đo số round-trip trong xác thực/transaction và cạnh tranh pool với Seating worker.
4. **Commercial/Billing**: status/PDF/contracts/billing/appendices và các route vượt
   ngưỡng còn lại. Tách chi phí đọc số dư/history/render; giữ nguyên bằng chứng tiền,
   idempotency và lịch sử bất biến.

Đây là hướng điều tra theo số đo và cấu trúc mã hiện tại, chưa phải bằng chứng SQL
nào là bottleneck. Diagnostics vẫn tắt; không có query-level attribution mới trong đợt này.
Tăng thời gian chờ giúp request có cơ hội lấy kết nối, **không làm truy vấn nhanh hơn**.
Không tự động tăng pool, giảm reserve, đổi region hoặc triển khai thêm tối ưu mã.

## GET chưa thể đo trong phạm vi tài khoản/dữ liệu hiện có

| API | Lý do |
| --- | --- |
| `/billing/callbacks/vnpay` | Not invoked: provider callback can reconcile money |
| `/bookings/{bookingId}/final-invoices/{invoiceRevisionId}` | Not measurable on retained booking: No final invoice in this existing booking |
| `/bookings/{bookingId}/invitation-image-generations` | Not measured: requires another role |
| `/bookings/{bookingId}/media/{assetId}` | Not measurable on retained booking: No attached original media in this existing booking |
| `/bookings/{bookingId}/print-orders/{orderId}` | Not measurable on retained booking: No print order in this existing booking |
| `/bookings/{bookingId}/printable-revisions/{printableRevisionId}/file` | Not measurable on retained booking: No retained printable revision in this existing booking |
| `/guest/invitation` | Not measurable on retained booking: No supplied existing guest capability; issuing credentials changes business data |
| `/management/analytics/attendance` | Not measured: requires another role |
| `/management/analytics/bookings` | Not measured: requires another role |
| `/management/analytics/exports/overview` | Not measured: requires another role |
| `/management/analytics/overview` | Not measured: requires another role |
| `/management/analytics/print-orders` | Not measured: requires another role |
| `/management/analytics/revenue` | Not measured: requires another role |
| `/management/availability` | Not measured: requires another role |
| `/management/catalog/dishes` | Not measured: requires another role |
| `/management/catalog/dishes/{dishId}` | Not measured: requires another role |
| `/management/catalog/halls` | Not measured: requires another role |
| `/management/catalog/layout-templates` | Not measured: requires another role |
| `/management/catalog/layout-templates/{templateId}` | Not measured: requires another role |
| `/management/catalog/menu-packages` | Not measured: requires another role |
| `/management/catalog/menu-packages/{packageId}` | Not measured: requires another role |
| `/management/catalog/restaurant` | Not measured: requires another role |
| `/management/catalog/shifts` | Not measured: requires another role |
| `/management/catalog/timeline-templates` | Not measured: requires another role |
| `/management/catalog/timeline-templates/{templateId}` | Not measured: requires another role |
| `/management/catalog/{resource}/{resourceId}/media` | Not measured: requires another role |
| `/management/consultation-requests` | Not measured: requires another role |
| `/management/events/{bookingId}/assignments` | Not measured: requires another role |
| `/management/invitation-templates` | Not measured: requires another role |
| `/management/invitation-templates/{templateId}` | Not measured: requires another role |
| `/management/notifications` | Not measured: requires another role |
| `/management/notifications/recipient` | Not measured: requires another role |
| `/management/print-offerings` | Not measured: requires another role |
| `/management/print-orders` | Not measured: requires another role |
| `/management/print-orders/{orderId}` | Not measured: requires another role |
| `/management/services` | Not measured: requires another role |
| `/public/invitation-assets/{slug}` | Not measurable on retained booking: No active public publication in this existing booking |
| `/public/invitations/{slug}` | Not measurable on retained booking: No active public publication in this existing booking |
| `/public/invitations/{slug}/qr` | Not measurable on retained booking: No active public publication in this existing booking |
| `/public/invitations/{slug}/render` | Not measurable on retained booking: No active public publication in this existing booking |
| `/staff/events/{bookingId}/guests/search` | Not measured: requires another role |
| `/staff/events/{bookingId}/guests/{guestId}/check-ins` | Not measured: requires another role |

138 operation không phải GET không được dùng để thử thay đổi dữ liệu; riêng
login/logout bình thường phục vụ kiểm tra được thực hiện và xác nhận thu hồi phiên.
Payment status được đo trên attempt MANUAL có sẵn; không gọi VNPay reconciliation/IPN.

## Bằng chứng và giới hạn

- Các phiên kiểm tra đã logout 204; sử dụng lại credential trả 401.
- Đối chiếu log: 234/234 request đúng deployment; diagnostics không bật.
- 15 nhóm dữ liệu nghiệp vụ của booking và checksum 60 migration giữ nguyên trước/sau.
- Chỉ cấu hình thời gian chờ thay đổi; source, image, OpenAPI, provider và frontend giữ nguyên.
- Worker cấu hình bật không tự chứng minh mọi sweep/delivery đã hoàn thành.
- Giữ nguyên bằng chứng lỗi và các thử nghiệm không đạt trong
  [điều tra trước triển khai](web-api500-investigation-2026-10-18.md).
- PERF-13, năng lực tải tổng thể và production NO_GO vẫn là các cổng riêng.

[Receipt JSON với toàn bộ số đo và request ID](web-api500-rollout-latency-2026-10-18.json).
Artifact operator nằm trong `output/api500-rollout-20261018/`.
