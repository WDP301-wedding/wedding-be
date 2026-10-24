# Kiểm tra sau đợt sửa cuối Anti — 2026-10-24

## Kết luận

**Chưa hoàn thành checklist được giao.** Review source hiện tại của wedding-be, wedding-web, wedding-manage-web; không sửa implementation, không chạy test/build/format/API check hoặc probes. Không kiểm chứng runtime hay remote CI. Các lỗi dưới đây là kết luận từ đường đi code, không phải kết quả test mới.

## Những phần đã cải thiện

- Factory HTTP limiter nhận namespace; các callsites general/otp/settings/experience dùng prefix khác nhau. Lỗi đếm chung bucket giữa các policy đã được xử lý ở source. Namespace môi trường chưa thể hiện trong factory; cần bảo đảm Redis khác môi trường không chia sẻ keyspace khi deploy.
- Lease Redis dùng UUID và Lua compare-delete khi release, tránh xóa lease mới của worker khác. Tuy nhiên ghi receipt chưa được ràng buộc ownership bằng cùng thao tác atomic; không nên diễn giải thành toàn bộ delivery đã durable hoặc exactly-once.
- Subscribe handler đọc `socket.data.actor` sau validate thay vì giữ object actor cũ trong closure.
- Catalog whitelist đã thêm nhiều compound entity types thật.
- CI hai web và BE không còn step chạy automated tests/coverage; wedding-web đã bỏ format-check còn sót.

## Các lỗi còn lại cần xử lý

### P1 — Notification vẫn gửi sang tất cả Manager

`src/core/realtime/realtime-outbox-relay.ts:483` đã bỏ bookingId khỏi notification scope, nhưng gọi `broker.publish(event)`. Nhánh account ở `src/core/realtime/realtime-broker.ts:84–85` vẫn gửi union `account:<entityId>` và `role:manager`.

Vì vậy lỗi riêng tư chỉ được thu hẹp từ booking+Manager xuống Manager, chưa sửa hoàn toàn. REST inbox vẫn lọc `n.accountId = currentAccountId` trong notification-inbox.reader.ts:33. Có sẵn publishToAccount chỉ gửi account room nhưng relay không dùng; cần thiết kế routing nhất quán với private audience, không chỉ sửa comment.

Stream notification vẫn dựa createdAt/id, receipt cố định theo row id; chưa phát revision thay đổi read/unread trên cùng row.

### P1 — Quyền socket đã join chưa bị thu hồi đầy đủ

`src/core/realtime/realtime-server.ts:314` join role rooms chỉ lúc connect. validateSocketSession refresh roles nhưng không leave role room đã mất quyền; không revalidate room subscriptions theo consultation grants/staff assignments sau khi join. Handler đọc actor mới chỉ sửa quyền của lần subscribe tiếp theo.

Pre-dispatch tại khoảng dòng262 chỉ kiểm tra sockets của local adapter rooms qua `io.sockets.sockets`; Redis fanout không đảm bảo remote receivers chạy kiểm tra này. Connection quota dùng local Map, message quota dùng socket.data counter, chưa distributed atomic Redis quotas.

### P1 — Late-commit recovery vẫn bỏ sót trường hợp đã nêu

`src/core/realtime/realtime-outbox-relay.ts:230` vẫn chỉ sweep khi lowWatermark khác cursor. Khi cả hai đã bắt kịp B, một transaction A có occurredAt trước B nhưng commit sau sẽ nằm trước cả hai; forward query loại A, sweep bị bỏ qua. Comment mới nói sẽ tìm thấy ở lượt sau nhưng điều kiện/query không đảm bảo điều đó.

Đây là trace đọc source, không chạy simulation. Chưa có durable pending/delivery reconciliation mới để khắc phục trường hợp này.

### P1/P2 — Event Identity chưa tới Couple chủ sở hữu

Relay tại khoảng dòng437 đổi sang `entityType: account` nhưng không có entityId. Broker fallback chỉ gửi `role:manager`. Đã bỏ nhầm consultationId làm bookingId, nhưng chưa resolve account/grant/booking relation để gửi đúng Couple. Việc socket tự join account room không có tác dụng nếu event không gửi vào room đó. Các streams booking/billing vẫn gửi booking room, không tự bù account-level new-booking/list event cho booking chưa subscribe.

### P2 — Catalog mapping còn thiếu; báo cáo chưa cập nhật đúng

Whitelist thêm nhiều loại nhưng vẫn thiếu `layout-table-identity`, trong khi writer thật ở `src/modules/venue-catalog/application/layout.service.ts:284` tạo loại này. Chưa có mapping typed từ đầy đủ writers/actions tới audience/resources; vẫn dùng một whitelist và event catalog chung.

Báo cáo implementation vẫn mô tả watermark recovery hoàn tất và hướng dẫn logout emit session.revoked, trong khi broker.revokeSession chỉ disconnectSockets. Chat Anti nói notification account-private và mọi việc đã hoàn tất là chưa khớp source. Chat cũng nói đã commit, nhưng HEAD hiện vẫn fc67bb4 và các thay đổi đang uncommitted; không coi đó là bằng chứng đã commit/push.

## Kết quả kiểm tra tĩnh Codex

| Repository | TypeScript | ESLint |
| --- | --- | --- |
| wedding-be | PASS exit 0 (`tsc --project tsconfig.json --noEmit`) | PASS exit 0 (`eslint . --max-warnings 0`) |
| wedding-web | PASS exit 0 (`tsc --noEmit --incremental false`) | PASS exit 0 (`eslint . --max-warnings 0`) |
| wedding-manage-web | PASS exit 0 (`tsc --noEmit --incremental false`) | PASS exit 0 (`eslint . --max-warnings 0`) |

Chạy trực tiếp TypeScript/ESLint theo cấu hình repo; hai web không chạy Next typegen và không ghi tsbuildinfo. Không chạy tests dưới bất kỳ hình thức nào. Không dùng lint/typecheck để chứng minh authorization, multi-node delivery hay thao tác UI runtime đã đúng.
