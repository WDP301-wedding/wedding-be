# Brief bàn giao frontend và thiết kế màn hình bằng Stitch

Ngày 13/10/2026 · Backend sau merge PR #40: `d257be8507dd83e9da73ac69605646a8fbcc7209`.
Mục tiêu: thiết kế hệ thống quản lý tiệc cưới cho **một nhà hàng**, từ tư vấn đến
hợp đồng, tiền cọc, chuẩn bị tiệc, vận hành và quyết toán. Đây là brief màn hình;
DTO, quyền và trạng thái thực tế lấy từ Swagger, không tự thêm nghiệp vụ.

## 1. Kênh, vai trò và luồng chính

Phân kênh dưới đây là gợi ý tổ chức UI; frontend quyết định bố cục và điều hướng
trong ba repository của mình, trong giới hạn quyền/backend và khác biệt Web–Android.

| Kênh                 | Người dùng và mục đích                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `wedding-web`        | Khách tìm hiểu nhà hàng; Couple quản lý tiệc và dùng trình thiết kế thiệp đầy đủ trên Web. Guest mở thiệp qua liên kết.                  |
| `wedding-manage-web` | Manager quản trị nhà hàng, xử lý khách hàng/tiệc, in ấn, tài chính, nhân sự và báo cáo; có thể bố trí khu tác nghiệp Staff.              |
| `wedding-app`        | Couple theo dõi tiệc, thông báo và các thao tác được Android hỗ trợ; Staff tác nghiệp check-in nếu team app chọn triển khai vai trò này. |

Luồng: **Xem catalog → gửi yêu cầu tư vấn → Manager tạo/chuyển đổi hồ sơ và mời
Couple → chọn sảnh/ngày/ca, menu, dịch vụ, loại thiệp → duyệt timeline và hợp đồng
→ cọc được backend xác nhận → chuẩn bị thiệp/nhóm khách/sơ đồ bàn/in → vận hành tiệc
→ chi phí phát sinh, hóa đơn cuối và thanh toán số dư.**

Couple có quyền `RESTRICTED` trước cọc và `FULL` sau xác nhận thanh toán; UI đọc
quyền từ backend. Khách công khai không tự đăng ký tài khoản Couple/Manager/Staff.
Guest chỉ xem thiệp; Guest không phải tài khoản Couple hay Staff.

## 2. Danh sách nhóm màn hình cần thiết

Một nhóm có thể dùng trang chi tiết, tab, drawer hoặc modal; không cần mỗi thao tác
một trang. Dùng ID để chia các lượt prompt Stitch.

| ID / vai trò        | Màn hình và nội dung chính                                                                                                                                                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 · Public         | Trang chủ/nhà hàng: ảnh, giới thiệu, sảnh, menu, dịch vụ, CTA yêu cầu tư vấn.                                                                                                                                                                                          |
| P2 · Public         | Catalog và chi tiết sảnh/menu: sức chứa, ảnh, giá, combo món, dịch vụ và mẫu/loại thiệp đủ điều kiện.                                                                                                                                                                  |
| P3 · Public         | Form tư vấn: tên liên hệ, email, điện thoại, ngày/số người dự kiến, lời nhắn; tên cô dâu/chú rể có thể bổ sung sau; trạng thái gửi thành công. Ngày dự kiến theo giới hạn backend, không quảng cáo giữ chỗ tức thì.                                                    |
| A1 · Tài khoản      | Đăng nhập; nhận lời mời workspace; quên mật khẩu/thiết lập mật khẩu bằng OTP. Không thiết kế flow reset bằng link đã deprecated.                                                                                                                                       |
| A2 · Tài khoản      | Hồ sơ cá nhân, đổi mật khẩu bằng OTP, phiên đăng nhập/thu hồi phiên, đăng xuất.                                                                                                                                                                                        |
| C1 · Couple         | Danh sách tiệc của mình và tổng quan tiệc: ngày/ca/sảnh, tiến độ, quyền hiện tại, việc cần làm; các tab bị khóa có lý do và CTA phù hợp.                                                                                                                               |
| C2 · Couple         | Hồ sơ cô dâu/chú rể; đề xuất tiệc và timeline; chọn nhiều combo menu, số bàn, dịch vụ/số lượng, loại/số thiệp; hợp đồng chi tiết, PDF và hai bên duyệt.                                                                                                                |
| C3 · Couple         | Tiền cọc và kết quả thanh toán: số phải trả, lịch sử, đang xử lý/chưa rõ kết quả/thất bại/thành công; gửi yêu cầu đổi timeline hoặc hủy theo quyền.                                                                                                                    |
| C4 · Couple FULL    | Nhóm khách và danh sách tên tùy chọn: tên/màu nhóm, số người dự kiến nhập riêng, thêm/sửa/lưu trữ khách; import có preview/lỗi từng dòng; cấp liên kết thiệp cá nhân, gửi khi có người nhận rõ ràng.                                                                   |
| C5 · Couple FULL    | Chọn mẫu sơ đồ bàn phù hợp; xem hình bàn, gán nhãn Group, cảnh báo sức chứa, xác nhận. Không kéo thả tự vẽ hình học hoặc xếp từng người vào từng ghế.                                                                                                                  |
| C6 · Couple FULL    | Studio thiệp Web: mẫu, ảnh riêng, chữ, xem trước, phiên bản, xuất bản/gỡ xuất bản, chia sẻ link/QR. Android chỉ sửa `textFields` trên thiết kế có sẵn; không sao chép toàn bộ editor Web sang app. Tạo ảnh AI là thao tác có trạng thái chờ/lỗi và điều kiện provider. |
| C7 · Couple FULL    | Đơn in: file/PDF, nội dung và số lượng theo hợp đồng, báo giá/duyệt, sản xuất/nhận; phụ lục với trước–sau, chênh lệch và hai bên duyệt; xem phát sinh, hóa đơn, số dư/credit.                                                                                          |
| M1 · Manager        | Inbox tư vấn, chuyển đổi/đóng yêu cầu, tạo consultation, mời workspace; tìm hồ sơ và mở ngữ cảnh booking.                                                                                                                                                              |
| M2 · Manager        | Lịch sảnh/ngày/ca và availability; đề xuất tiệc, timeline/hợp đồng/phụ lục, duyệt; xử lý yêu cầu thay đổi/hủy, hoàn tất tiệc. Một sảnh chỉ có một tiệc đã xác nhận cho cùng ngày và ca.                                                                                |
| M3 · Manager        | Catalog: thông tin nhà hàng, ca, sảnh, món/combo, dịch vụ, loại thiệp, mẫu thiệp, mẫu timeline và mẫu sơ đồ; bản nháp/phiên bản/xuất bản/ngừng dùng, ảnh và giá.                                                                                                       |
| M4 · Manager        | Đơn in toàn nhà hàng: báo giá, sản xuất, sẵn sàng, bàn giao; thay thế/hủy theo điều kiện và giữ lịch sử.                                                                                                                                                               |
| M5 · Manager        | Tài chính từng tiệc: chứng từ thu thủ công, lịch sử thanh toán, quy trình hoàn tiền; thêm/sửa phát sinh sau giờ kết thúc; chốt hóa đơn và tạo bản điều chỉnh có lý do.                                                                                                 |
| M6 · Manager        | Tài khoản Staff: cấp quyền từ email, bật/tắt quyền tác nghiệp, phân công/thu hồi; cấu hình check-in; nhật ký và sửa sai có lý do; ngoại lệ sơ đồ bàn trong sức chứa vật lý.                                                                                            |
| M7 · Manager        | Dashboard/báo cáo: tiền đã thu và công nợ, booking, sử dụng sảnh, in ấn, nhóm/số người/check-in; lọc ngày/sảnh và độ mới dữ liệu; xuất JSON tổng hợp theo API.                                                                                                         |
| S1 · Staff          | Mở booking được giao, tìm người theo tên/điện thoại, phân biệt trùng tên bằng Guest ID/nhóm/thông tin an toàn; xem gợi ý bàn, check-in và hoàn tác bản ghi của mình trong thời gian cho phép.                                                                          |
| S2 · Staff          | Kết quả thao tác/nhật ký, đã check-in, check-in đang tắt, hết thời gian, không được phân công; không có quyền sửa khách, số người, hợp đồng hoặc tiền.                                                                                                                 |
| N1 · Couple/Manager | Inbox thông báo, số chưa đọc, đánh dấu đọc, tùy chọn nhận; Manager thêm màn trạng thái gửi/người nhận và xử lý lỗi theo API.                                                                                                                                           |
| G1 · Guest          | Thiệp công khai/cá nhân: thông tin cưới được xuất bản, thời gian, địa điểm, ảnh/nội dung, QR/chia sẻ; link hết hạn/đã thu hồi/chưa xuất bản. Chỉ đọc, không RSVP hoặc check-in.                                                                                        |

## 3. Quy tắc bắt buộc thể hiện trong thiết kế

- Group hoạt động khi **không có danh sách tên**. Có thể không nhập, nhập một phần
  hoặc đầy đủ tên; các luồng cọc/thiệp/sơ đồ/in/quyết toán không ép nhập tên khách.
  Không có Household, RSVP, deadline trả lời, nhắc RSVP hay thống kê phản hồi.
- `planningHeadcount` nhập riêng; thêm/xóa/import khách không đổi con số này.
  Tách “dự kiến”, “tên đã lập danh sách”, “tên đã check-in”; không dùng danh sách
  một phần để tính tỷ lệ tham dự toàn tiệc. Đi cùng khách vẫn được phép; không tự
  thêm trường đếm người đi kèm khi yêu cầu chưa được chốt.
- Check-in mặc định `NONE`: hiển thị **“Chưa ghi nhận”**, không phải 0. Chỉ
  Couple FULL/Manager chủ động bật theo tên; Guest/QR công khai không có nút check-in.
- Tên cô dâu/chú rể là hai trường riêng, bắt buộc trước duyệt hợp đồng. Không tách
  tên từ tên tài khoản hoặc tự suy đoán dữ liệu cũ.
- Số tiền nguyên VND và tổng từ server; cọc = làm tròn lên 30% tổng hợp đồng.
  Phải duyệt đúng cùng phiên bản **timeline và hợp đồng** ở cả hai phía. Giữ giá
  đã chốt; sửa làm mất hiệu lực duyệt, đang có thanh toán chưa rõ kết quả có thể bị khóa.
- Sau cọc, thay đổi thỏa thuận dùng phụ lục có lý do và hai bên duyệt. In số lượng
  đã nằm trong hợp đồng không thu lại lần hai. Manager chốt phát sinh/hóa đơn;
  Couple chỉ đọc phát sinh, không có bước Couple duyệt hóa đơn. Không ghi đè lịch sử.
- Hiển thị hợp đồng, cọc, đơn in, hoàn tất tiệc và quyết toán là các trạng thái riêng.
  Redirect VNPay không đủ để báo “đã thanh toán”; phải đọc trạng thái attempt từ backend.
- Manager chỉ nhập phát sinh sau giờ kết thúc tiệc. Tổng cuối = hợp đồng + phụ lục
  đã duyệt + phát sinh; tách đã thu, còn phải thu và credit/hoàn tiền. Check-in không
  quyết định tiền. Có thể có hóa đơn không phát sinh.
- Hoàn tiền dùng phê duyệt và chứng từ Manager; không thiết kế hoàn VNPay tự động.
  Ảnh/thiệp phải thể hiện thời hạn chỉnh sửa và trạng thái bị khóa từ backend.
  Hiển thị lịch sự kiện theo `Asia/Ho_Chi_Minh`, chuyển timestamp UTC đúng giờ Việt Nam.

## 4. Trạng thái UI và định hướng thị giác

Mỗi nhóm cần: có dữ liệu, rỗng, đang tải/gửi, thành công, lỗi từng trường, lỗi mạng,
hết phiên, thiếu quyền, dữ liệu/phiên bản đã đổi cần tải lại; xác nhận thao tác quan
trọng và khóa nút khi đang gửi. Thêm “provider chưa sẵn sàng”, “thanh toán chưa rõ
kết quả”, “báo cáo cũ/nguồn chưa sẵn sàng”; không biến dữ liệu thiếu thành 0.

Gợi ý: giao diện tiếng Việt, font hỗ trợ dấu; khách/Couple ấm áp, ivory–xanh đậm–gold
nhẹ, ảnh cưới và khoảng thở; Manager ưu tiên bảng/lọc/tổng tiền rõ; Staff nút lớn,
tương phản cao, thao tác nhanh. Thiết kế desktop 1440px và mobile 390px, component
nhất quán, trạng thái không chỉ dùng màu, điều hướng bàn phím và vùng chạm dễ dùng.
Đây là hướng thẩm mỹ đề xuất, không phải yêu cầu nghiệp vụ đã khóa.

## 5. API để frontend triển khai

- [Swagger staging](https://wedding-be-spec11-spec11-staging.up.railway.app/docs/),
  [OpenAPI gốc](https://wedding-be-spec11-spec11-staging.up.railway.app/api/v1/openapi.json).
  Base API: `https://wedding-be-spec11-spec11-staging.up.railway.app/api/v1`.
- [Swagger developer hiện có](https://wedding-be-production-e1dc.up.railway.app/docs/)
  cũng đã kiểm tra và khớp cùng digest. Thống nhất target trước khi tích hợp;
  tài khoản/booking của hai database không dùng lẫn nhau.
- Chuẩn đã kiểm tra: OpenAPI 3.1, **218 endpoint**; SHA-256
  `6a8be82541ca2d8ce274f9817d10bcd300c91de2f5e734055cf9108b23db0915`.
  Swagger UI tự thêm `/api/v1`; health vẫn ở `/health/*`.
- Tra theo nhóm: Identity/Product experience, Venue Catalog/commercial catalog,
  Booking Lifecycle/lifecycle, Guest management, Seating plan, Invitation Studio/
  Media/Print Orders, Payments and Billing, Staff operations, Notifications, Analytics.
  Method/DTO/quyền lấy từ OpenAPI; không suy ra quyền chỉ từ tên URL.
- Web dùng phiên Web và refresh cookie HttpOnly; Android dùng phiên Android.
  Private API dùng bearer access token; giữ đúng `Idempotency-Key`, revision và
  cursor khi endpoint yêu cầu. Thông báo lỗi theo `error.code`, giữ `requestId` để hỗ trợ.
- Staff hiện cần `bookingId` từ workflow phân công; **chưa có API liệt kê mọi sự kiện
  được giao cho Staff**. Đừng thiết kế dashboard Staff như thể API đó đã tồn tại.
- Catalog công khai không có flow tự giữ chỗ/checkout ngay; availability là API
  Manager. Guest không có dashboard; export analytics hiện là JSON, không giả định XLSX.
- [Hand-off kỹ thuật và quyền theo owner](spec11-final-backend-handoff.md),
  [nguồn yêu cầu ưu tiên](backend-scope-2026-10-10.md).

Staging chỉ có dữ liệu thử. Code/API có thể dùng để thiết kế và tích hợp; quyết định
phát hành vẫn **NO_GO** vì gate runtime/provider còn mở. Email worker đang tắt,
VNPay chỉ sandbox; không tự thử tiền thật/tạo ảnh AI có phí. FCM backend đã chuẩn bị,
team app cấu hình/test/nghiệm thu sau; thiết kế inbox và trạng thái push chưa bật,
không ghi rằng push trên thiết bị đã được nghiệm thu.

## 6. Prompt mẫu cho Stitch

Sao chép prompt dưới đây, kèm các hàng màn hình và quy tắc liên quan ở mục 2–3.
Chạy từng nhóm 3–5 màn hình, dùng cùng design system cho các lượt tiếp theo.

```text
Thiết kế UI tiếng Việt cho hệ thống quản lý tiệc cưới của một nhà hàng.
Vai trò: [Public/Couple RESTRICTED/Couple FULL/Manager/Staff/Guest].
Kênh: [Web desktop + responsive mobile/Android].
Nhóm màn hình: [ID và nội dung từ brief].
Luồng cần nối: [điểm vào → hành động → kết quả → màn tiếp theo].
Dữ liệu và hành động: bám đúng các hàng màn hình và quy tắc được đính kèm.
Phong cách: [khách/Couple: ivory, xanh đậm, gold nhẹ; Manager: bảng rõ ràng;
Staff: nút lớn, tương phản cao]. Font có dấu tiếng Việt. Desktop 1440, mobile 390.
Tạo component và điều hướng nhất quán; cung cấp trạng thái có dữ liệu, rỗng,
loading/submitting, thành công, lỗi validation/mạng, thiếu quyền/hết phiên,
phiên bản thay đổi và chức năng/provider chưa sẵn sàng. Nêu CTA chính và điều
kiện ẩn/khóa cho từng màn. Dữ liệu ví dụ phải nhất quán giữa màn và đúng vai trò.
Nhóm khách dùng được khi không có tên; số người dự kiến nhập riêng.
Check-in tắt = chưa ghi nhận; không RSVP/Household hoặc đếm người đi kèm.
Tổng tiền do backend tính; không báo thanh toán thành công từ redirect.
Editor thiệp đầy đủ chỉ Web; Android chỉ sửa textFields của thiết kế có sẵn.
Chỉ thiết kế trong phạm vi được đính kèm, ghi riêng câu hỏi/dependency nếu thiếu
dữ liệu; không tự thêm API hoặc chức năng. Trả về screen map, màn hình, trạng thái,
component và chú thích chuyển màn; chưa cần sinh code tích hợp.
```
