# Rà soát tương thích món ăn và thực đơn trước deploy

Ngày: 2026-11-03, Asia/Saigon.
Backend được rà soát: `0e6310b`; manage-web: `62b92ff`.
Kết luận: **chưa nên deploy nguyên trạng**. Lịch sử phiên bản vẫn được giữ,
nhưng có các vấn đề ảnh, phụ thuộc món–gói và xung đột chỉnh sửa cần xử lý.
Lần rà soát này không sửa mã tính năng và không deploy.

## Phát hiện đã tái hiện

### F1 — P1: chỉnh sửa sang phiên bản mới không kế thừa ảnh

`cloneDishVersion` và `cloneMenuPackageVersion` sao chép nội dung, giá và danh sách
món nhưng không sao chép liên kết `CatalogMediaAsset`. Ảnh gắn với version ID.
Luồng Chỉnh sửa mới gọi chính các hàm clone này; bộ chọn ảnh chỉ còn hiển thị
version mới nhất.

Thử trên database tạm với storage giả, không gọi nhà cung cấp thật:

| Đối tượng    | Ảnh ở v1 | Ảnh ở v2 sau clone |
| ------------ | -------: | -----------------: |
| Món ăn       |        1 |                  0 |
| Gói thực đơn |        1 |                  0 |

Ảnh cũ vẫn còn, nhưng API của phiên bản mới trả danh sách ảnh rỗng nếu không tải
lại thủ công. Cần có cơ chế kế thừa/sao chép ảnh khi chỉnh sửa, giữ nguyên ownership
và nội dung lịch sử; không chuyển ảnh khỏi phiên bản cũ. Đây là hành vi của clone
cũ bị lộ rõ khi clone trở thành luồng Chỉnh sửa mặc định.

Nguồn: `src/modules/venue-catalog/application/menu.service.ts`,
`src/modules/venue-catalog/application/catalog-media.service.ts`,
`../wedding-manage-web/src/features/venue-catalog/catalog-media-gateway.ts`.

### F2 — cần chốt nghiệp vụ: xóa món không ngừng gói đang chứa món đó

Đã xác minh sau khi xóa mềm món: danh sách món công khai có 0 món, nhưng gói chứa
phiên bản cũ của món vẫn hiện trong danh sách công khai và vẫn được phép chọn cho
hợp đồng mới. Gói cũ không tự đổi tên, giá hay thành phần khi món có phiên bản mới.

Giữ nguyên hợp đồng/lịch sử là đúng. Tuy nhiên, chưa có quy tắc xử lý **gói đang
bán** khi một món bị xóa/ngừng. Cần quyết định rõ một trong các chính sách như chặn
xóa khi còn gói đang bán tham chiếu, hoặc yêu cầu quản lý cập nhật/ngừng các gói
phụ thuộc trước. Không tự sửa các gói hoặc hợp đồng lịch sử.

Nguồn: `catalog-query.service.ts:listPublicMenuPackages`,
`menu.service.ts:requireCurrentMenuPackageVersion/requireCurrentMenuPackageHeaders`.

### F3 — P2: sửa gói dùng món cũ rồi công bố sẽ gặp lỗi không rõ cách khắc phục

Kịch bản đã tái hiện: gói đang dùng món v1; quản lý công bố món v2; sau đó mở sửa
gói, chỉ đổi tên/giá và bấm Lưu và công bố. Lưu nháp thành công, nhưng công bố bị
từ chối bằng `409 CATALOG_DISH_REFERENCE_CONFLICT`. Giao diện hiện gom lỗi này
thành thông báo chung rằng phiên bản đã thay đổi và cần tải lại.

Backend đúng khi kiểm tra dependency trước công bố. Giao diện cần chỉ rõ món nào
đã cũ/ngừng/xóa và hỗ trợ thay thế nó trong bản nháp. Không tự thay món trong gói
đã công bố hoặc hợp đồng đã chốt.

Nguồn: `menu.service.ts:publishMenuPackage`,
`../wedding-manage-web/src/features/venue-catalog/menu-aggregate-list.tsx`,
`../wedding-manage-web/src/features/venue-catalog/food-catalog-shared.tsx`.

### F4 — P2: bảo vệ xóa chưa nhận biết bản nháp vừa được người khác sửa

Đã tái hiện: quản lý A tải món với aggregate revision 1; quản lý B lưu thay đổi
bản nháp, tăng version revision nhưng aggregate revision vẫn là 1; A gửi DELETE
với expectedRevision 1 và hệ thống vẫn chấp nhận. Nội dung B không bị xóa vật lý,
nhưng bị ẩn theo toàn bộ món và không thể khôi phục bằng API thông thường.

Cần kiểm tra thêm draft revision khi xóa, hoặc đồng bộ revision của aggregate với
thay đổi nội dung, rồi kiểm thử đồng thời cho cả món và gói. Khóa giao dịch hiện
tại tuần tự hóa ghi nhưng chưa bảo vệ quyết định dựa trên nội dung đã cũ này.

Nguồn: `catalog-version.repository.ts:archiveFood/compareAndSwapDraft`.

## Phiên bản cũ trong database

- `DishVersion`, `MenuPackageVersion` và `MenuPackageItem` vẫn giữ các bản đã công
  bố. Công bố v2 chuyển v1 sang `SUPERSEDED`, không xóa v1.
- Xóa mềm chỉ đặt `archivedAt`, chuyển aggregate sang `RETIRED` và ẩn khỏi danh
  mục. Không xóa các phiên bản hay thành phần gói.
- Database có trigger ngăn sửa/xóa nội dung phiên bản đã công bố và thành phần
  của chúng. Migration mới chỉ thêm cột/ràng buộc, không dọn lịch sử.
- Lưu bản nháp nhiều lần cập nhật cùng một dòng nháp và tăng revision; không lưu
  nguyên nội dung từng lần sửa nháp thành một phiên bản lịch sử riêng.
- Manage-web ưu tiên bản nháp mới nhất; website/app công khai dùng bản đã công bố.
- Đã đọc trực tiếp database demo: món đã xóa vẫn còn v1 giá 175.000 VND và v2 giá
  195.000 VND; gói đã xóa vẫn còn v1 giá 4.200.000 VND và v2 giá 4.300.000 VND.
  Đây là dữ liệu kiểm thử local, không phải thống kê database production.

Nguồn: `prisma/schema.prisma`,
`prisma/migrations/20261005000000_venue_catalog_core/migration.sql`,
`prisma/migrations/20261103010000_food_catalog_soft_delete/migration.sql`.

## Kiểm tra liên quan và giới hạn

- Script kiểm tra dùng database mới `catalog_audit_<uuid>` trên PostgreSQL demo
  `127.0.0.1:55435`, áp dụng toàn bộ migration rồi hủy đúng database tạm sau kiểm
  tra. Storage dùng `FakeStorageProvider`. Không truy cập/ghi database production,
  không thanh toán thật và không gọi tạo ảnh trả phí.
- Script xác nhận giữ 2 phiên bản món, 2 phiên bản gói, 2 dòng thành phần, 2 ảnh
  sau xóa; exact menu snapshot và giá gốc không đổi qua sửa/xóa món/gói.
- 2 kiểm thử PostgreSQL về lịch sử món/thực đơn và xóa mềm chạy lại đều đạt.
- Kiểm thử tích hợp hợp đồng/PDF được chạy thêm nhưng không qua assertion ở
  bước mô hình booking ban đầu (`commercial-contracts-api.test.ts:573`), trước
  bước kiểm tra PDF. Vì vậy không coi toàn bộ luồng hợp đồng/PDF là đã đạt trong
  lần rà soát này. Các kiểm thử tổng thể chưa xanh vẫn là điều kiện chặn phát hành.
- Qua đọc mã, hợp đồng, phụ lục, PDF và hóa đơn dùng document/line snapshot;
  thay đổi catalog không viết lại các tài liệu này. Báo cáo dùng nguồn snapshot.
- Website và app vẫn gọi cùng các GET catalog; thay đổi DELETE là bổ sung.
  Các vấn đề ảnh và gói vẫn chứa món đã xóa nêu trên sẽ truyền qua API tới các
  ứng dụng tiêu thụ dữ liệu, nên không chỉ ảnh hưởng manage-web.
- Phải áp dụng migration, triển khai backend rồi mới triển khai manage-web mới.
  Script Render hiện có bước migrate trước startup, cần kiểm tra log thực tế ở
  lần deploy được chủ dự án cho phép. Không dùng health 200 thay bằng chứng tính năng.

Bằng chứng local (bị gitignore): `.local-demo/catalog-cross-audit.mts`,
`.local-demo/catalog-cross-audit-result.json`,
`.local-demo/catalog-cross-contract-tests.json`.
