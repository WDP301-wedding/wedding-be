# Realtime / Redis — Codex tiếp quản sửa trực tiếp, 2026-10-24

## Phạm vi và trạng thái

Codex tiếp quản sau khi Anti đã dừng; không giao tiếp nhiệm vụ sửa cho Anti nữa. Chỉ sửa wedding-be, wedding-web, wedding-manage-web. Giữ các thay đổi có sẵn của user/Anti. Không sửa wedding-app, không commit/push/deploy, không chạy migration trên bất kỳ database nào.

Đã triển khai các sửa bên dưới trong source. Chỉ chạy ESLint và TypeScript; **không chạy tests/coverage, browser E2E, Redis probes, benchmark, build, format, API check hoặc database migration smoke**. Không dùng kết quả static để khẳng định runtime/multi-node/deployment đã đạt hay bảo đảm thời gian response.

## Sửa nguyên nhân

| Finding cũ | Giải pháp hiện tại |
| --- | --- |
| Notification cá nhân vẫn broadcast Manager | Broker ưu tiên entityType account trước booking; bắt buộc entityId, chỉ phát account room, không fallback role:manager. Booking reference giữ lại để kiểm quyền inbox hiện hành trước delivery. |
| Read/unread không cập nhật tab khác | Trigger NotificationInbox INSERT và UPDATE revision ghi durable queue ngay trong transaction. Receipt khóa theo stream/eventId/revision; thay đổi cùng row có invalidation riêng. UI đọc lại dữ liệu có thẩm quyền, không suy unread count từ hint. |
| Role/grant/assignment bị thu hồi nhưng socket giữ room | Kiểm quyền theo lô từ credentials/session/account/roles/grants/assignments hiện hành trước dispatch. Rà role/booking rooms và leave khi mất quyền. Periodic audit local từng node cập nhật membership, không dùng positive grant cache để phát dữ liệu. |
| Remote node bỏ qua pre-dispatch | `fetchSockets()` qua Redis adapter lấy cả remote sockets; cùng batch authority check rồi emit đến socket IDs đã được phép. Không broadcast lại toàn room chưa kiểm tra. Khi authority lookup hoặc adapter lookup lỗi, delivery retry; periodic audit lỗi thì disconnect fail-closed. |
| Socket quotas mới chỉ local Map | Redis Lua reservation atomically giới hạn số kết nối theo IP/account trên nhiều node; lease có TTL, heartbeat và release theo socket ID. Counter message dùng Redis, giữ policy per-socket. Local fallback chỉ khi không cấu hình Redis ở development; cấu hình Redis bị lỗi không tự chuyển quota sang local. |
| Event commit muộn nằm sau watermark đã đóng | Bỏ cursor/watermark/Redis receipt TTL cũ. Thêm PostgreSQL `RealtimeDelivery`; trigger ghi queue cùng transaction nguồn nên commit muộn luôn tạo pending row. Claim bằng `FOR UPDATE SKIP LOCKED`, partial pending index và batch giới hạn. Không quét lại lịch sử đã delivered mỗi poll. |
| Worker cũ xóa lease/ghi receipt của worker mới | Claim UUID token trong DB; renew/finish đều kiểm token; delivered finish còn kiểm lease chưa hết hạn. Ghi receipt và nhả lease cùng một UPDATE. Retry backoff tránh một nhóm poison records chặn mãi các pending records khác. |
| consultationId bị dùng làm bookingId hoặc không có recipient | Resolve consultation grants theo batch. Manager và từng Couple có envelope riêng, account-level list invalidation không phụ thuộc booking đã subscribe. Booking outbox cũng có account-level list hint, để booking mới xuất hiện mà không cần F5. |
| Catalog thiếu layout-table-identity và các writers khác | Mapping rõ entity type → resource invalidations trong `catalog-events.ts`, gồm layout-table-identity, print-offering, restaurant-service và các version writers thực tế. SQL trigger/backfill sử dụng cùng danh sách được ghi rõ. Catalog hint không có private action/draft entityId/payload. |
| Consumer catalog chưa đầy đủ / burst / mất form | Manager bổ sung listener timeline/layout/media cùng venue/food. Hook gom burst, single-flight cho background invalidation, hoãn refresh khi form dirty; kiểm dirty lại trước áp snapshot để không remount form theo revision mới trong lúc nhập. Reset/lưu/đóng form cho phép xử lý invalidation đang chờ. Reconnect làm sạch catalog cache và resync. |
| Logout/revocation chỉ disconnect, hướng dẫn không đúng | Broker phát session.revoked trước disconnect. Hai client xử lý event và clear session. Manager điều hướng qua Next router trong client boundary và bỏ snapshot trước revoke. Epoch fence chặn kết quả refresh/restore cũ phục hồi lại phiên sau revoke. Refresh token/socket rotation và reconnect khi access token hết hạn dùng session flow hiện có. |

Giữ nguyên tiền VND, settlement/payment idempotency, immutable contract/invoice history, API nghiệp vụ và migrations đã áp dụng. Không thêm package/dependency hoặc tắt lint rules. Không thay UI/CSS thông thường.

## File chính

- BE: `src/core/realtime/{realtime-broker,realtime-server,realtime-outbox-relay,realtime-audience,realtime-limits,delivery-queue,catalog-events}.ts`.
- Schema: `prisma/schema.prisma`; migration mới `prisma/migrations/20261024010000_realtime_durable_delivery/migration.sql`.
- Hai web: realtime client và identity session.
- Manager: `session-revocation-boundary.tsx`, root layout chỉ thêm React boundary không thêm DOM wrapper; `use-catalog-live-refresh.ts`, các panel catalog và cache resync listener.
- CI: giữ phần Anti đã bỏ automated test/coverage ở ba repo và format check của Couple. Các gates audit/build/API/migration không liên quan không bị xóa trong lượt này.

## Migration và phát hành

1. **Migration chưa được chạy.** Cần áp dụng migration forward mới trước khi chạy relay phiên bản này. Không viết lại migration cũ. Không đọc/chạy trên production trong lượt làm việc này.
2. Migration tạo queue, trigger nguồn và backfill events cũ. Backfill có thể phát lại các invalidation lịch sử một lần; client refetch trạng thái hiện tại, không chạy lại command nghiệp vụ. Cần dự trù thời gian migration/backfill theo lượng dữ liệu staging thật; chưa đo và chưa chạy.
3. Queue sử dụng database/schema hiện hành của Prisma client, không namespace production hardcode. Redis adapter/counters socket có namespace môi trường. HTTP buckets đã được tách purpose ở đợt trước; các môi trường triển khai vẫn cần Redis/database configuration tách đúng.
4. Redis adapter channel key đã có namespace môi trường. Cần cập nhật toàn bộ BE nodes cùng phiên bản/drain node cũ khi cutover; không kỳ vọng fanout giữa node cũ dùng key cũ và node mới. Reconnect client thực hiện authoritative resync.
5. Receipt là accepted server-side invalidation dispatch, **không phải durable client ACK hoặc exactly-once**. Client mất kết nối lấy lại dữ liệu qua resync; event IDs dùng dedup, dữ liệu thật vẫn do REST/authorization quyết định. Không tuyên bố provider feature live hoặc deployment green.
6. Khi thêm catalog writer entity type mới, cập nhật typed mapping và migration forward cho trigger; không sửa migration này sau khi đã được áp dụng.

## Kết quả static trên source cuối

| Repository | TypeScript | ESLint |
| --- | --- | --- |
| wedding-be | PASS exit 0 | PASS exit 0, không warning |
| wedding-web | PASS exit 0 | PASS exit 0, không warning |
| wedding-manage-web | PASS exit 0 | PASS exit 0, không warning |

Commands: BE `tsc --project tsconfig.json --noEmit`; hai web `tsc --project tsconfig.json --noEmit --incremental false` (không Next typegen, không tsbuildinfo write). ESLint mỗi repo: `eslint . --max-warnings 0`, không --fix. Node dùng bundled Node24 theo engines. Bản trước phát hiện unused argument và Next internal navigation warning; đã sửa nguyên nhân, không suppress rule.

## Hướng dẫn kiểm tra tay sau khi phát hành vào staging

- Dùng hai account khác nhau và hai phiên của cùng account: tạo thông báo thuộc account A, kiểm UI/WS frames account B/Manager khác không nhận metadata A. Đánh dấu đọc ở tab A1, badge/list tab A2 tự cập nhật.
- Mở overview Couple, Manager tạo/cập nhật booking thuộc Couple đó: booking mới hoặc thay đổi list tự xuất hiện dù chưa subscribe booking mới. Các request dữ liệu tiếp theo vẫn phải qua quyền REST.
- Mở các tab venue/food/timeline/layout/media ở hai phiên Manager; sửa một entity ở phiên kia, tab đang xem làm mới. Đang nhập form thì bản nháp giữ nguyên; lưu/reset/đóng form mới áp thông tin nền. Không tự thực hiện payment/cancellation/provider dispatch để kiểm chứng.
- Thu hồi phiên qua UI đã có: phiên bị thu hồi dừng nhận dữ liệu, clear auth và hiện login/access gate. Đổi role/grant/phân công trong sandbox: socket đang mở không tiếp tục nhận nội dung đã mất quyền.
- Ngắt mạng rồi kết nối lại, hoặc để access token hết hạn: session refresh còn hợp lệ thì reconnect và resync; session đã revoke không được resurrect bởi response refresh đang bay.
- Late-commit, worker crash/lease expiry và fanout nhiều node cần kiểm chứng riêng trong môi trường staging được phép. Chưa thực hiện các kiểm chứng này do chỉ thị không chạy test.

## Tài liệu hiện hành sau khi dọn tài liệu

Báo cáo này thay các bản giao việc realtime, báo cáo implementation Anti và hai
review source trung gian ngày 2026-10-24 đã được dọn. Bảng nguyên nhân/giải pháp,
điều kiện migration, namespace môi trường và giới hạn kiểm chứng ở trên là trạng
thái bàn giao hiện hành; dọn tài liệu không phải một lượt kiểm chứng mới.

Hai review ngày 2026-10-23 được giữ riêng vì chứa kết quả probes/kiểm chứng lịch sử.
Các lỗi và kết luận tại thời điểm review đó không được dùng thay trạng thái source
hiện hành. Migration, multi-node, late-commit recovery và UI có xác thực vẫn cần
nghiệm thu đúng môi trường; không suy ra runtime PASS từ lint/typecheck.
