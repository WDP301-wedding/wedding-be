# ADR 001: Lựa chọn Socket.IO (WebSocket Transport) và Redis cho Realtime Invalidation & Rate Limiting

- **Trạng thái**: Chấp thuận (Approved)
- **Ngày quyết định**: 2026-10-23
- **Phạm vi**: `wedding-be`, `wedding-web` (Couple), `wedding-manage-web` (Manager)
- **Người đề xuất**: Antigravity / Kiến trúc sư hệ thống

---

## 1. Bối cảnh & Vấn đề (Context)

Hiện tại, cả hai ứng dụng web của Manager (`wedding-manage-web`) và Couple (`wedding-web`) hoạt động theo mô hình request/response truyền thống qua REST API. Khi Quản lý hoặc Cặp đôi thực hiện các thay đổi (cập nhật kịch bản, duyệt hợp đồng, ghi nhận thanh toán/đặt cọc, cập nhật danh sách khách mời, sơ đồ bàn, đơn in thiệp, danh mục món ăn/sảnh), phía bên kia phải F5 (tải lại trang) thủ công mới thấy dữ liệu mới.

Đồng thời, bộ giới hạn tần suất HTTP (`rate-limit.ts`) và bộ giới hạn thử nghiệm (`AttemptThrottle` trong `identity-access`) hiện dùng `MemoryStore` trong bộ nhớ process, gây trở ngại khi triển khai trên nhiều instance hoặc khi cần chia sẻ hạn ngạch giữa các node.

## 2. Quyết định (Decision)

### 2.1. Giao thức và Transport Realtime

1. **Chọn Socket.IO v4** với transport cố định là **WebSocket** (`transports: ['websocket']`).
   - _Lý do_: Socket.IO cung cấp cơ chế phân chia phòng (rooms), xác thực kết nối ngay tại bước handshake (`auth` payload), quản lý vòng đời kết nối (reconnect, heartbeat, disconnection), và hỗ trợ sẵn adapter đa tiến trình qua Redis Pub/Sub (`@socket.io/redis-adapter`).
   - _Tính nhất quán_: Server và Client sử dụng cùng một phiên bản giao thức Socket.IO v4. Loại bỏ việc cài đặt song song nhiều thư viện WebSocket khác nhau.
   - _Không claim exactly-once_: Hệ thống coi WebSocket là kênh truyền tín hiệu **Invalidation & Read-Hint**, không truyền dữ liệu nghiệp vụ nhạy cảm, số tiền hay mã thông báo. Khi nhận tín hiệu, client sẽ kiểm tra authoritative state thông qua API HTTP hiện hữu với epoch guard và single-flight.

### 2.2. Cơ chế Xác thực và Phân quyền Realtime

1. **Xác thực tại Handshake**: Token xác thực (`accessToken`) được gửi qua `socket.handshake.auth.token`. Server từ chối kết nối nếu thiếu token hoặc token truyền qua query string/URL (để tránh rò rỉ vào access log).
2. **Kiểm tra Origin**: Server kiểm tra trường `Origin` tại handshake đối chiếu với danh sách `CORS_ALLOWED_ORIGINS` đã cấu hình, từ chối mọi yêu cầu upgrade không hợp lệ.
3. **Phòng ủy quyền (Authorized Rooms)**:
   - Client tự động tham gia các phòng cá nhân theo quyền: `account:{accountId}`, `session:{sessionId}`.
   - User có vai trò `MANAGER` tham gia `role:manager`.
   - Cặp đôi tham gia phòng `booking:{bookingId}` chỉ khi server xác minh được tài khoản là chủ sở hữu của booking đó với quyền truy cập hợp lệ (`RESTRICTED` hoặc `FULL`). Client không được tự ý chỉ định phòng tham gia.

### 2.3. Redis Multi-Instance Fanout & Rate Limiting

1. **Redis Client**: Sử dụng `ioredis` với quản lý kết nối tập trung, cấu hình timeout, backoff retry, TLS/auth từ `REDIS_URL`.
2. **Redis Adapter**: Sử dụng `@socket.io/redis-adapter` với 2 connection riêng biệt (Pub và Sub) để đồng bộ hóa broadcast giữa các tiến trình backend.
3. **Redis Rate Limiting**:
   - HTTP Rate Limiter: Sử dụng `rate-limit-redis` tích hợp với `express-rate-limit`, giữ nguyên header chuẩn `draft-8` và `Retry-After`.
   - Identity Attempt Throttle: Sử dụng script Lua nguyên tử (atomic `INCR` + `EXPIRE` + `TTL`) để đảm bảo không xảy ra race condition hay cửa sổ crash giữa việc tăng đếm và thiết lập TTL.
   - Socket Handshake & Message Limiter: Giới hạn số lượng kết nối và tần suất phát tin nhắn trên mỗi IP/Account để ngăn chặn tấn công DoS/Flood.

## 3. Hệ quả (Consequences)

- **Tích cực**:
  - Manager và Couple thấy các thay đổi hai chiều ngay lập tức mà không cần F5.
  - Hạn ngạch giới hạn tần suất được chia sẻ chính xác giữa các tiến trình backend khi cấu hình Redis.
  - Phân tách rõ ràng: Mutation và giao dịch nghiệp vụ luôn đi qua HTTP API với đầy đủ transaction, audit log và lock order. Socket chỉ làm nhiệm vụ phát tín hiệu invalidation post-commit.
- **Tiêu cực / Rủi ro cần kiểm soát**:
  - Khi mất kết nối mạng hoặc server khởi động lại, Socket.IO client phải thực hiện authoritative resync để bù đắp các sự kiện bị bỏ lỡ.
  - Cần bảo đảm môi trường không có Redis (ví dụ kiểm thử đơn vị nội bộ) có chính sách fallback rõ ràng, không để crash hệ thống nhưng phải báo rõ trạng thái degraded trong production.
