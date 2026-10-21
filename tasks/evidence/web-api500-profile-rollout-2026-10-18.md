# Triển khai và kiểm tra lại lỗi profile 500 — 2026-10-18

## Kết quả

PR [#64](https://github.com/WDP301-wedding/wedding-be/pull/64) đã merge sau khi chủ dự án duyệt triển khai.
Railway chạy commit `9bbd251fa318abed8210e1b15aa72a825d7e9876`, deployment `5d548270-df78-4010-8f53-f7c3e87607b8`,
image `sha256:84f84ccac8cd53ace49400aa22dad10f769dcfb55d0753ba94fa1df158d94d70`; bản cũ đã dừng.
Kết quả đợt kiểm tra: **đạt trong phạm vi đã đo**.

- 152/152 lần gọi tuần tự trên 38 API đọc; ba mẫu qua Vercel và một mẫu trực tiếp/API.
- 80/80 lần gọi trong 20 đợt bốn request profile/proposal/contracts; 16 đợt qua Vercel, bốn đợt trực tiếp.
- 24/24 lần gọi trong bốn đợt sáu request giống nhóm lỗi ảnh đầu; ba đợt Vercel, một đợt trực tiếp.
- 0 HTTP 5xx và 0 lỗi transport trong các mẫu Node được lưu.
- 48 response profile được đối chiếu log, gồm 40 khi gọi đồng thời,
  4 tuần tự và 4 từ trình duyệt; status quan sát: 200.
- 295/295 mẫu giữ lại khớp log đúng deployment. OpenAPI qua Vercel và trực tiếp khớp artifact.

Không có retry tự động của bộ đo. Thời gian client tính tới khi tải xong response.
Ba mẫu tuần tự chỉ cho thứ hạng tham khảo; không dùng để suy ra p95/SLA hoặc năng lực tải.
Thời gian đo Node: 2026-10-18T01:28:50.324Z đến 2026-10-18T01:38:04.345Z (UTC).

## Kiểm tra trên web

Đăng nhập bằng tài khoản Couple được chủ dự án cung cấp; mở đúng Orchid Hall và trang
`/khong-gian/thoa-thuan/ten` cho booking đã báo lỗi. Ba lượt đầu hiển thị form tên và không
có hộp lỗi; response profile mất khoảng 0.92–0.98 giây.
Một lượt thu lại metadata cũng trả 200. Không sửa hoặc lưu tên.

Ảnh sau triển khai: [profile-after.png](../../output/playwright/api500-profile-rollout-20261018/profile-after.png).
Lượt capture hoàn chỉnh giữ 22 response API và một probe thu hồi phiên;
không có 5xx. Logout qua UI, dùng lại bearer cũ trả 401.
Các phiên Node cũng được logout và kiểm tra sử dụng lại trả 401.

Lần lưu metadata đầu gặp lỗi công cụ VM không hỗ trợ dynamic import; dữ liệu toàn bộ lượt đó
không được xuất. Chỉ ba response profile có request ID đã quan sát được giữ và đối chiếu;
không coi đó là toàn bộ số request trình duyệt. Lần đợi chữ Orchid Hall ban đầu khớp option ẩn
vì web tự chọn một fixture khác trong cùng tài khoản; đã chuyển bằng URL booking chính xác.
Đây là lỗi thao tác/thu bằng chứng, không phải kết quả HTTP 500.
Lỗi console trước đăng nhập ở refresh 401 được giữ riêng; không đồng nhất với lỗi profile 500.

## Các API còn chậm

Ngưỡng điều tra: median ba mẫu Vercel >=2 giây, có **23 URL template**.
Giá trị tính bằng giây; thứ tự giảm dần theo median. Các nhóm alias được liệt kê đúng URL,
không coi là hai triển khai reader khác nhau.

| API | Median Vercel | Max Vercel |
| --- | ---: | ---: |
| `/bookings/{bookingId}/payments/{attemptId}` | 5.45 | 5.45 |
| `/bookings/{bookingId}/seating-plans/{planId}` | 5.31 | 5.36 |
| `/bookings/{bookingId}/seating-plans/current` | 5.28 | 5.36 |
| `/bookings/{bookingId}/seating-layout-options` | 4.71 | 4.74 |
| `/invitation-templates` | 4.38 | 4.39 |
| `/bookings/{bookingId}/invitations` | 4.23 | 4.24 |
| `/bookings/{bookingId}/invitations/{designId}` | 4.08 | 4.21 |
| `/bookings/{bookingId}/contracts/{revisionId}/pdf` | 3.91 | 3.96 |
| `/bookings/{bookingId}/attendance-summary` | 3.58 | 3.60 |
| `/bookings/{bookingId}/guests/{guestId}/personalized-invitations` | 3.52 | 3.66 |
| `/bookings/{bookingId}/guest-groups` | 3.34 | 4.32 |
| `/bookings/{bookingId}/guests` | 3.22 | 3.22 |
| `/bookings/{bookingId}/guest-plan` | 3.21 | 3.34 |
| `/bookings/{bookingId}/contracts` | 3.21 | 3.21 |
| `/bookings/{bookingId}/check-in-settings` | 3.14 | 4.25 |
| `/bookings/{bookingId}/billing` | 2.86 | 4.06 |
| `/bookings/{bookingId}/print-orders` | 2.47 | 2.49 |
| `/bookings/{bookingId}/contract-appendices` | 2.46 | 2.48 |
| `/management/bookings/{bookingId}/incidental-expenses` | 2.40 | 2.41 |
| `/bookings/{bookingId}/incidental-expenses` | 2.30 | 4.15 |
| `/bookings/{bookingId}/final-invoices` | 2.14 | 2.27 |
| `/catalog/restaurant` | 2.04 | 2.05 |
| `/catalog/halls/{hallId}` | 2.00 | 2.03 |

Profile median tuần tự qua Vercel: **0.78 giây**;
max profile khi gộp các pha: 5.33 giây client /
4.26 giây backend. Không so sánh cải thiện phần trăm với các
cohort khác thời điểm/fixture state; lỗi transaction admission đã có bằng chứng hồi quy riêng.

## Toàn bộ 38 API đã đo

| API | Median Vercel | Max Vercel | Trực tiếp (1 mẫu) | Status |
| --- | ---: | ---: | ---: | --- |
| `/bookings/{bookingId}/payments/{attemptId}` | 5.45 | 5.45 | 5.21 | 200 |
| `/bookings/{bookingId}/seating-plans/{planId}` | 5.31 | 5.36 | 5.08 | 200 |
| `/bookings/{bookingId}/seating-plans/current` | 5.28 | 5.36 | 5.07 | 200 |
| `/bookings/{bookingId}/seating-layout-options` | 4.71 | 4.74 | 4.44 | 200 |
| `/invitation-templates` | 4.38 | 4.39 | 4.15 | 200 |
| `/bookings/{bookingId}/invitations` | 4.23 | 4.24 | 3.94 | 200 |
| `/bookings/{bookingId}/invitations/{designId}` | 4.08 | 4.21 | 3.94 | 200 |
| `/bookings/{bookingId}/contracts/{revisionId}/pdf` | 3.91 | 3.96 | 3.46 | 200 |
| `/bookings/{bookingId}/attendance-summary` | 3.58 | 3.60 | 3.19 | 200 |
| `/bookings/{bookingId}/guests/{guestId}/personalized-invitations` | 3.52 | 3.66 | 3.27 | 200 |
| `/bookings/{bookingId}/guest-groups` | 3.34 | 4.32 | 2.96 | 200 |
| `/bookings/{bookingId}/guests` | 3.22 | 3.22 | 2.96 | 200 |
| `/bookings/{bookingId}/guest-plan` | 3.21 | 3.34 | 2.96 | 200 |
| `/bookings/{bookingId}/contracts` | 3.21 | 3.21 | 2.98 | 200 |
| `/bookings/{bookingId}/check-in-settings` | 3.14 | 4.25 | 2.88 | 200 |
| `/bookings/{bookingId}/billing` | 2.86 | 4.06 | 2.45 | 200 |
| `/bookings/{bookingId}/print-orders` | 2.47 | 2.49 | 2.09 | 200 |
| `/bookings/{bookingId}/contract-appendices` | 2.46 | 2.48 | 2.21 | 200 |
| `/management/bookings/{bookingId}/incidental-expenses` | 2.40 | 2.41 | 2.17 | 200 |
| `/bookings/{bookingId}/incidental-expenses` | 2.30 | 4.15 | 2.00 | 200 |
| `/bookings/{bookingId}/final-invoices` | 2.14 | 2.27 | 1.85 | 200 |
| `/catalog/restaurant` | 2.04 | 2.05 | 1.74 | 200 |
| `/catalog/halls/{hallId}` | 2.00 | 2.03 | 0.67 | 200 |
| `/bookings/{bookingId}/proposal` | 1.99 | 1.99 | 1.75 | 200 |
| `/catalog/halls` | 1.62 | 2.01 | 1.26 | 200 |
| `/catalog/dishes` | 1.58 | 1.60 | 1.34 | 200 |
| `/catalog/print-offerings` | 1.54 | 1.56 | 1.27 | 200 |
| `/catalog/services` | 1.41 | 1.42 | 1.11 | 200 |
| `/catalog/menu-packages` | 1.40 | 1.42 | 1.12 | 200 |
| `/notifications/inbox` | 1.37 | 2.16 | 1.26 | 200 |
| `/notifications/unread-count` | 1.32 | 1.94 | 0.96 | 200 |
| `/couple/bookings` | 1.23 | 1.24 | 0.99 | 200 |
| `/notifications/preferences` | 0.96 | 1.64 | 0.67 | 200 |
| `/notifications/android-installations` | 0.91 | 1.49 | 0.66 | 200 |
| `/auth/profile` | 0.80 | 0.90 | 0.63 | 200 |
| `/consultations/{consultationId}/couple-profile` | 0.78 | 0.88 | 0.52 | 200 |
| `/auth/sessions` | 0.78 | 0.79 | 0.53 | 200 |
| `/auth/me` | 0.76 | 1.72 | 1.65 | 200 |

## Cấu hình, dữ liệu và CI

Chỉ triển khai hai file đã review; tree của merge trùng tree commit đã duyệt.
[CI merge](https://github.com/WDP301-wedding/wedding-be/actions/runs/39085822061) đạt ngay lần đầu:
1440 unit, 58 contract, 549 integration và 2047 test ở lượt coverage đầy đủ;
line 97.56%, branch 93.48%, các ngưỡng per-file 80% giữ nguyên. Lint, typecheck, format,
build, OpenAPI và audit đều đạt.

Pool common/catalog/analytics vẫn 1/3/2, acquisition 10000 ms, idle 60000 ms;
planned processes 2, reserve 36, cap 60 và một replica SFO giữ nguyên.
Digest toàn bộ cấu hình không đổi trước/sau. Notifications bật, Seating giữ mặc định;
không suy ra mọi worker đã hoàn tất chỉ từ trạng thái cấu hình.

17 nhóm bảng nghiệp vụ/profile giữ nguyên hash;
60 migration giữ nguyên checksum và khớp source. Không có migration mới, reset hoặc xóa dữ liệu nghiệp vụ.
Payment status chỉ đọc attempt MANUAL đã xác minh bằng SQL read-only, không gọi VNPay
reconciliation/IPN hay thanh toán. Không gọi generation hoặc sửa frontend.

Giữ [bằng chứng lỗi trước triển khai](web-api500-profile-contention-2026-10-18.md),
bao gồm 500 thật, CI lỗi lần đầu và timeout Windows. Kết quả hiện tại chỉ đóng bước triển khai
và kiểm tra đọc đã nêu; PERF-13/capacity, các role/lệnh ghi/provider và production NO_GO
vẫn là các phạm vi riêng. Không cam kết mọi request tương lai sẽ không lỗi.

[Receipt JSON](web-api500-profile-rollout-2026-10-18.json). Artifact operator ở
`output/api500-profile-rollout-20261018/`; log-correlation.json giữ toàn bộ request ID và số đo backend.
