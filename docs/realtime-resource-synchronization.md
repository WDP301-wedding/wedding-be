# Đồng bộ realtime giữa hai web

Phạm vi: wedding-web, wedding-manage-web và đường phát sự kiện tương ứng ở BE.
Không thay đổi nghiệp vụ phê duyệt, tính tiền, idempotency hay quyền truy cập.

## Cơ chế

- Outbox và audit được ghi cùng transaction với thay đổi nghiệp vụ. Migration
  `20261027010000_realtime_resource_invalidations` mở rộng bộ lọc audit cho yêu cầu
  tư vấn, phân công và invalidation thiết kế thiệp; không sửa migration cũ.
- Contract và appendix được phát dưới `contract.updated`. Resources bao gồm đường
  đọc hợp đồng và phụ lục. Yêu cầu tư vấn chỉ phát invalidation tới manager.
- Mỗi màn sở hữu hàng đợi đọc riêng, gom sự kiện trong một đợt, giữ một lượt đọc
  tiếp theo nếu có sự kiện khi đang đọc. Kết nối lại và xác nhận subscription đều
  yêu cầu đồng bộ lại dữ liệu có thẩm quyền từ server.
- Form đang soạn và lệnh ghi có thể giữ invalidation chờ hoàn tất/hủy; không tự
  gửi lại lệnh ghi, thay idempotency key hoặc tự phê duyệt khi nhận sự kiện.
- Số trang thông báo đã mở và lựa chọn nguồn in được giữ khi đồng bộ nền.

## Trạng thái xuất bản thiệp

`print_order.updated` có thể mang `payload.publication` với:

- `publicationRevision`: số nguyên không âm, tăng theo identity xuất bản.
- `published`: có bản xuất bản hiện hành hay không.
- `publicSlug`, `publishedRevisionId`, `designRevisionId`: nullable khi chưa xuất bản.

BE đọc theo batch từ identity và revision bất biến. Snapshot được gửi qua broker
có kiểm tra lại quyền, cho manager hoặc couple có quyền FULL; không gửi cho staff
hay couple RESTRICTED. Snapshot cũng được gửi khi đăng ký lại booking để khôi phục
trạng thái sau mất kết nối. Không có nội dung thiệp, danh sách khách hoặc ảnh trong
payload này. Client kiểm tra schema và không nhận snapshot thấp hơn revision đang có.

## Triển khai

1. Áp dụng migration mới bằng quy trình `npm run db:migrate:deploy` của BE, rồi
   triển khai phiên bản BE chứa relay và snapshot mới. Không chạy lệnh này vào DB
   live chỉ để kiểm tra code.
2. Build/deploy lại cả hai web. `NEXT_PUBLIC_REALTIME_URL` là origin HTTPS của BE,
   không có `/api/v1`; nếu bỏ trống, web khách lấy origin từ rewrite API trong
   `vercel.json`, manager lấy từ cấu hình backend hiện có. Giá trị public được chốt
   khi build nên sửa env sau build không làm bundle cũ thay đổi.
3. BE dùng cấu hình realtime/CORS/Redis hiện hữu, không cần biến môi trường mới.
   Nếu nhiều replica, Redis adapter phải hoạt động để phát sang kết nối ở replica khác.

Chu kỳ relay hiện là 2 giây, cộng thời gian mạng và API đọc lại; đây không phải cam
kết độ trễ dưới 800 ms.

## Xác nhận thủ công sau phát hành

- Khách gửi hợp đồng; manager đang mở cùng tiệc thấy bản/chờ duyệt thay đổi mà không F5.
- Manager duyệt; khách đang mở hợp đồng thấy đúng trạng thái. Làm tương tự với phụ lục.
- Gửi yêu cầu tư vấn mới, ghi nhận thanh toán, thay đổi đơn in, tạo/sửa thiệp và
  check-in: màn tương ứng ở phiên còn lại tự đồng bộ.
- Kiểm tra chuông, hộp thư và thẻ thông báo mới; giữ được số trang hộp thư đã mở.
- Ngắt/kết nối lại mạng, đổi tiệc và làm mới token; không giữ dữ liệu của tiệc trước.
- Khi đang soạn hợp đồng/phụ lục/thiệp, cập nhật nền phải chờ; hủy bản soạn hoặc
  hoàn tất thao tác để nhận bản mới. Quyền bị thu hồi vẫn phải bị từ chối.

Các bước trên là hướng dẫn xác nhận sau phát hành, không phải bằng chứng đã chạy.
Lượt sửa này không chạy automated test hoặc build/deploy live.
