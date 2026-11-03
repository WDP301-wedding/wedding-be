# Dropdowns, phân trang và hồ sơ tiệc hủy

Phạm vi: wedding-web, wedding-manage-web và API hỗ trợ trong wedding-be. Không thay đổi wedding-app; không chạy test tự động trong lượt này.

## Thay đổi

- Hai web dùng HySelect dựa trên Base UI cho các select một lựa chọn. Giữ native select ẩn làm nguồn dữ liệu cho form, validation và các handler hiện có. Popup đóng khi chọn, hỗ trợ bàn phím, Escape và bấm ngoài.
- Tổng quan quản lí lấy trang dữ liệu, tổng số, tìm kiếm và sắp xếp từ BE. Không phân trang lại trên một tập dữ liệu đã bị cắt ngắn. Cột thao tác dùng menu chung.
- Hồ sơ hủy chuyển sang mục Tiệc đã hủy. Danh sách đang hoạt động, tra cứu và lựa chọn tiệc trên web loại bỏ hồ sơ hủy. Đường dẫn vận hành cũ kiểm tra trạng thái và chuyển về hồ sơ lưu trữ.
- Lưu trữ giữ thông tin hợp đồng, lịch sử tài chính và nghiệp vụ hoàn tiền được phân quyền. Không xóa hoặc viết lại chứng từ, không thay số liệu kế toán bằng bộ lọc UI.

## API mới

- GET /management/booking-page
- GET /management/consultation-page
- GET /booking-archive
- GET /bookings/{bookingId}/archive
- GET /bookings/{bookingId}/navigation

API trang dùng page, pageSize, q; dữ liệu trả về gồm items, page, pageSize, total, totalPages. Trang quản lí có bộ lọc/sắp xếp và số đếm phù hợp. Tất cả đọc theo quyền hiện có; dữ liệu nhạy cảm về người quản lí không đưa vào DTO lưu trữ của Couple.

Không cần migration hoặc biến môi trường mới. Phát hành BE có các API trên trước hai frontend. Các bản pin hợp đồng API hiện có không được giả mạo thành một commit BE chưa phát hành.

## Kiểm tra tay khi chạy hệ thống

1. Mở dropdown trạng thái/ngày tiệc, chọn bằng chuột và bàn phím: đúng thiết kế, đổi giá trị, tự đóng. Kiểm tra form required và trường có label.
2. Tổng quan: chuyển trang, đổi số dòng, tìm kiếm, lọc, sắp xếp; tổng số và trang không bị giới hạn bởi trang dữ liệu cũ. Chọn thao tác trong menu mở đúng hồ sơ.
3. Mở Tiệc đã hủy bằng tài khoản Manager và Couple. Couple chỉ thấy tiệc có quyền truy cập; thử URL tiệc khác phải bị từ chối.
4. Tiệc đã hủy không xuất hiện trong danh sách và bộ chọn hoạt động. Mở lại URL vận hành cũ phải chuyển về lưu trữ, không hiện form thao tác tiệc.
5. Kiểm tra lịch sử thanh toán/hoàn tiền trong lưu trữ và số liệu tài chính tổng hợp không bị mất do lọc tiệc hủy.
6. Hủy một tiệc trong môi trường thử nghiệm được phép, theo dõi danh sách qua realtime; không dùng dữ liệu sản xuất để thử thao tác hủy.

Các bước trên là hướng dẫn nghiệm thu, không phải tuyên bố đã chạy kiểm thử UI hoặc đã triển khai production.
