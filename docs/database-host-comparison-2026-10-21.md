# So sánh PostgreSQL Supabase và Railway — 21/10/2026

Hoàn tất thử nghiệm có kiểm soát do chủ dự án yêu cầu. Cấu hình PostgreSQL cùng region và mạng riêng Railway giảm rõ độ trễ backend trên bộ dữ liệu và workload này. Kết quả hỗ trợ chuẩn bị chuyển database của demo; việc chuyển traffic và nghiệm thu khi bật worker cần một đợt triển khai riêng.

## Cấu hình và phương pháp

- Mã ứng dụng: `7be274ec344683d6a3b6e56c45d27c730c7c62cb`; cùng một container/image `sha256:7e9a2911f9fdcd849212927b8cac1d7bf6c68b986488d9ea6095db9a3e57fbb2` cho cả sáu lượt. Không sửa mã ứng dụng, API, dependency, pool hay migration.
- Backend thử: US West, một replica, giới hạn 1 CPU/1 GB; mỗi lượt khởi động một tiến trình ứng dụng mới từ bản build này. Dịch vụ chính giữ nguyên deployment, image, cấu hình và biến môi trường.
- A: PostgreSQL Supabase Sydney hiện có, kết nối trực tiếp và TLS verify-full. B: container PostgreSQL chuẩn `postgres:17.6` trên Railway US West, một CPU/1 GB, mạng riêng, TLS verify-full với chứng thư riêng được ghim CA. Đây là thử nghiệm container PostgreSQL trên Railway, không phải nghiệm thu một cấu hình HA/managed template.
- Sao chép schema `public`: 147 bảng, đủ 65 migration cùng lịch sử/checksum và các index. Schema Auth/Storage/Realtime của Supabase, role, owner và ACL không nằm trong bản sao. Bản export được phục hồi bằng pg_restore trong container database thử.
- 142 bảng ổn định khớp snapshot ban đầu. Năm bảng trạng thái nền/analytics thay đổi theo thời gian được ghi riêng: AnalyticsGeneration, AnalyticsHead, AnalyticsProjection, NotificationRecipient, NotificationScheduleScan. Hai bảng notification đã khác snapshot trước khi dump; dữ liệu nghiệp vụ được đo và kiểm tra riêng.
- Thứ tự A1–B1–B2–A2–A3–B3; mỗi lượt có một mẫu đầu và 20 mẫu ổn định cho 16 nhóm API. Các request chạy nối tiếp, cách nhau tối thiểu 750 ms. p50/p95 dùng nearest-rank; bảng tổng hợp có 60 mẫu ổn định mỗi API cho mỗi cấu hình.
- Đo HTTP qua loopback trong container Railway. Các con số phản ánh thời gian backend và kết nối DB, không bao gồm trình duyệt, Vercel hoặc đường mạng tới người dùng.
- Notification worker, FCM, Seating reconciliation và AI jobs tắt trên ứng dụng thử; thông tin mail giả, không có key Gemini/VNPay. Dịch vụ chính và worker hiện có không đổi. Không gọi thanh toán, tạo ảnh, gửi thư hoặc thao tác ghi nghiệp vụ. Login/logout và cập nhật projection qua Analytics GET được ghi nhận riêng.

## Kết quả API

2016/2016 request nghiệp vụ thành công; 2064 thao tác tổng cộng khớp log backend. Không có lỗi truy vấn trong các log được đối chiếu. 48 so sánh nội dung nghiệp vụ theo cặp khớp sau chuẩn hóa: bỏ sessionId riêng của lần đăng nhập, requestId/generationId/refreshedAt và query string của signed URL; accountId, email, vai trò và các trường nghiệp vụ còn lại vẫn được so sánh.

Đơn vị: mili giây. Mẫu đầu không nằm trong percentile.

| Nhóm API              | Supabase p50 | Supabase p95 | Railway p50 | Railway p95 | Giảm p95 |
| --------------------- | -----------: | -----------: | ----------: | ----------: | -------: |
| Phiên đăng nhập       |        158.1 |        183.6 |         6.6 |        10.8 |    94.1% |
| Danh sách booking     |        753.9 |        783.4 |        17.4 |        25.1 |    96.8% |
| Hộp thông báo         |        603.7 |        636.2 |        16.5 |        27.7 |    95.6% |
| Số thông báo chưa đọc |        603.8 |        631.1 |        16.2 |        21.8 |    96.5% |
| Mẫu thiệp (Manager)   |        769.3 |        794.9 |        18.8 |        26.5 |    96.7% |
| Đơn in (Manager)      |        920.9 |        947.4 |        22.4 |        30.6 |    96.8% |
| Tổng quan analytics   |      1,384.7 |      3,401.8 |          29 |        35.9 |    98.9% |
| Danh sách sảnh        |        692.4 |        935.1 |       532.9 |       583.6 |    37.6% |
| Danh sách món         |      1,120.5 |      1,211.7 |       527.6 |       581.4 |      52% |
| Nhóm khách            |      2,805.8 |      2,827.8 |        53.8 |        68.8 |    97.6% |
| Danh sách khách       |      2,807.2 |      2,829.3 |        52.2 |        65.7 |    97.7% |
| Kế hoạch khách        |      2,805.3 |        2,827 |        51.8 |        67.9 |    97.6% |
| Sơ đồ hiện tại        |      3,209.1 |      3,285.5 |        60.8 |        86.4 |    97.4% |
| Lựa chọn bố cục       |      3,365.9 |      3,525.7 |        64.3 |        86.6 |    97.5% |
| Danh sách thiệp       |      3,591.1 |      3,746.7 |        66.8 |          85 |    97.7% |
| Billing               |        2,617 |      2,670.9 |        47.7 |        70.3 |    97.4% |

Khoảng p95 của ba lượt độc lập, không phải khoảng tin cậy thống kê:

| Route                  | Supabase p95 min–max | Railway p95 min–max | Nội dung nghiệp vụ |
| ---------------------- | -------------------: | ------------------: | ------------------ |
| identity               |          165.8–183.6 |            8.3–12.1 | Khớp               |
| overview               |          752.2–795.8 |             20–26.6 | Khớp               |
| inbox                  |          609.8–663.8 |           21.9–27.9 | Khớp               |
| unread                 |          605.1–631.6 |           20.6–22.5 | Khớp               |
| templates              |          759.4–797.4 |           24.5–26.8 | Khớp               |
| print-orders           |          914.7–951.9 |           26.9–31.8 | Khớp               |
| analytics              |      2,784.8–3,464.4 |           32.8–35.9 | Khớp               |
| halls                  |          741.2–935.1 |         556.2–586.1 | Khớp               |
| dishes                 |      1,168.5–1,226.3 |         551.9–628.8 | Khớp               |
| guest-groups           |        2,709.1–2,843 |           61.9–77.3 | Khớp               |
| guests                 |      2,697.3–4,028.5 |           57.9–73.1 | Khớp               |
| guest-plan             |      2,703.8–2,828.3 |           61.9–67.9 | Khớp               |
| seating-plans/current  |      3,163.8–3,285.8 |            68–136.8 | Khớp               |
| seating-layout-options |      3,461.9–3,588.5 |           78.6–86.6 | Khớp               |
| invitations            |      3,609.9–3,752.2 |             75.4–85 | Khớp               |
| billing                |      2,563.4–2,676.2 |           59.2–73.1 | Khớp               |

## Kết nối DB

Mỗi lượt có 20 SELECT 1 sau một lần làm nóng; thời gian thiết lập kết nối được tách riêng. Cả hai bên dùng PostgreSQL 17.6 và TLS 1.3/256 bit.

| Lượt       | RTT p50 | RTT p95 | Kết nối mới |
| ---------- | ------: | ------: | ----------: |
| supabase-1 |     156 |   157.9 |     1,158.9 |
| railway-1  |     1.8 |       2 |        71.1 |
| railway-2  |     2.1 |     5.2 |        72.7 |
| supabase-2 |   151.5 |   151.9 |     1,126.6 |
| supabase-3 |   154.7 |   157.4 |     1,136.5 |
| railway-3  |       2 |     3.9 |        80.1 |

Giảm số lượt đi/về vẫn là hướng tối ưu bổ sung. Đặt database gần backend giúp giảm chi phí của các lượt còn lại. Không thể quy một tỷ lệ chính xác của toàn bộ chênh lệch API cho riêng mạng: phần cứng DB, tải nền và các trạng thái cache khác nhau. Analytics và media có chu kỳ refresh/signing; số lệnh driver, acquisition, thời gian server và từng lượt được lưu trong receipt.

## Bảo toàn và dọn tài nguyên

Đối chiếu sau thử nghiệm giữ nguyên deployment/cấu hình/biến môi trường của dịch vụ chính và lịch sử 65 migration ở cả hai bên. Các bảng thay đổi được giải thích riêng bằng phiên bảo mật, audit, projection và trạng thái nền; không có thay đổi ngoài nhóm dự kiến trong kiểm tra hậu kỳ. Booking, khách, hợp đồng/phụ lục, hóa đơn và ledger giữ nguyên dữ liệu được đối chiếu.

Các tiến trình ứng dụng đo đã đóng và SSH key riêng đã thu hồi. Công cụ Railway từ chối xóa TCP proxy với thông báo user did not approve; chủ dự án sau đó đã đồng ý rõ ràng xóa hai dịch vụ thử, proxy và volume bản sao. Lần gọi lại sau khi có đồng ý vẫn bị công cụ từ chối với cùng thông báo; chưa có cloud resource nào bị xóa. Trở ngại hiện tại là cơ chế phê duyệt của công cụ, không còn là thiếu đồng ý của chủ dự án. API deploymentStop ban đầu trả true nhưng chưa dừng replica; sau đó railway down đã dừng deployment. Connector xác nhận cả hai dịch vụ Offline, không còn active deployment hoặc pending work. Kiểm tra lại sau lần từ chối xác nhận hai dịch vụ vẫn không có deployment, volume còn gắn vào database thử và deployment/cấu hình/biến môi trường chính không đổi. Volume và cấu hình proxy vẫn giữ lại do công cụ chặn thao tác xóa; chi phí lưu trữ có thể tiếp tục phát sinh. Bản export đã xác minh và log thô vẫn ở thư mục local bị Git bỏ qua, không đưa credential/backup vào repository. Không thực hiện cutover hoặc thay đổi Supabase chính.

Chi phí CPU/RAM lý thuyết nếu cả hai dịch vụ dùng liên tục hết giới hạn trong toàn bộ 120 phút là khoảng USD 0.167, chưa gồm storage/network và các dịch vụ đã có. Đây không phải hóa đơn hoặc trần chi phí được nhà cung cấp bảo đảm; metric tài nguyên thực dùng được lưu riêng. Nếu tài nguyên chưa dừng/xóa thì phí hosting/storage có thể tiếp tục phát sinh sau cửa sổ đo. Không đổi gói hay thiết lập chi tiêu tài khoản. [Đơn giá Railway](https://docs.railway.com/pricing/plans#resource-usage-pricing).

## Quyết định và giới hạn

Ưu tiên chuẩn bị PostgreSQL cùng region với backend cho demo hiện tại. Trước cutover cần rehearsal chuyển dữ liệu cuối, kiểm tra quyền/role và job, thử khi bật worker trong môi trường được phép, chọn backup/restore và kế hoạch quay lại an toàn cho dữ liệu phát sinh sau chuyển. Supabase Storage có thể được giữ lại nhưng phụ thuộc file và signed URL cần kiểm chứng khi triển khai.

Đây là thử nghiệm đọc nối tiếp trên dữ liệu synthetic nhỏ; chưa phải load test, SLA hay nghiệm thu toàn bộ website/provider. Không áp dụng kết quả thành xếp hạng chung Railway và Supabase, hoặc khẳng định một region Supabase gần backend sẽ có kết quả tương tự khi chưa đo. Các quyết định RV/PERF/provider và production NO_GO trước đó giữ nguyên phạm vi.

[Receipt có số đo và kiểm tra](../tasks/evidence/database-host-comparison-2026-10-21.json); log thô và công cụ điều khiển local: `output/db-host-comparison-20261021/`.
