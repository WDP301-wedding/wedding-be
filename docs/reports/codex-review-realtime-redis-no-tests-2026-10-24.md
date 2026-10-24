# Review realtime / Redis / CI — 2026-10-24

## Kết luận

**Chưa hoàn tất.** Bản sửa đã làm đúng phần lớn việc bỏ test/coverage khỏi CI, đổi broker sang async có await, sửa kiểm tra credential expiry/fail-closed và khởi tạo cả Redis pub/sub. Tuy nhiên còn lỗi rate-limit buckets, định tuyến dữ liệu cá nhân, event mapping/catalog và recovery; không thể khẳng định mọi flow không cần F5.

Scope chỉ wedding-be, wedding-web và wedding-manage-web; không sửa wedding-app. Review working tree chưa commit trên BE HEAD `fc67bb4` và các thay đổi frontend tương ứng. Codex chỉ đọc source/diff và chạy lint/typecheck, không sửa implementation, không commit/push/deploy.

**Không chạy test, coverage, native probes, browser E2E, build, format hoặc API check** theo chỉ thị mới nhất của chủ dự án. Các findings dưới đây dựa trên đối chiếu source/schema/callsites, không được trình bày như runtime reproduction mới.

## 1. CI: phần đã đúng và điểm còn sót

- BE đã xóa automated tests, PostgreSQL integration tests và coverage steps; migration smoke vẫn giữ.
- Couple đã xóa `Enforce automated tests and coverage`.
- Manager đã xóa optional automated test step.
- Hai web đã bỏ `test:audit-policy` khỏi wrapper `audit:ci`, vẫn giữ dependency audit command.
- Lint/typecheck và các build/deploy/API/migration gates không liên quan được giữ. Codex không chạy các gate đó trong lượt này.
- Riêng Couple workflow vẫn có `Check formatting -> npm run format:check` tại `.github/workflows/ci.yml:54–55`; chưa bỏ theo mong muốn format-CI trước đây. Job labels còn chữ test là tên hiển thị, không có nghĩa test vẫn chạy; cần phân biệt với step thực thi.
- Chưa xác minh remote CI; thay đổi hiện còn local, không tuyên bố CI đã green.

## 2. P1 — Các HTTP limiter chia sẻ sai cùng Redis bucket

Nguồn: `wedding-be/src/core/http/rate-limit.ts:19` luôn dùng `prefix: 'rl:http:'`, không có namespace theo policy/purpose/route.

Cùng factory này nay nhận cùng Redis client ở:

| Limiter | Policy |
| --- | --- |
| General app middleware | RATE_LIMIT_MAX_REQUESTS / RATE_LIMIT_WINDOW_MS |
| Password OTP router | 30 / 15 phút |
| Password changes/settings router | 10 / 15 phút |
| Experience consultation router | 5 / 1 giờ |

Default key generator là IP; cùng prefix và IP tạo cùng Redis key dù limit/window khác nhau. Request tới endpoint có feature limiter còn chạy qua general limiter trước, nên đếm chung hoặc đếm hai lần. Lượt xem trang thông thường có thể làm đổi mật khẩu/OTP bị 429; TTL của bucket general cũng không thể đồng thời đại diện cửa sổ 15 phút/1 giờ.

Đây là regression khi chuyển các MemoryStore độc lập sang Redis cùng prefix, không phải chỉ vấn đề tuning số request.

Cần inject namespace policy/env riêng ổn định cho từng limiter, kiểm tra key/window semantics và Retry-After; không dùng tên tùy tiện hoặc một key IP cho mọi security policy. Giữ auth subject buckets riêng và không sửa business quotas.

## 3. P1 — Event thông báo cá nhân phát rộng hơn quyền đọc inbox

Nguồn:

- `realtime-outbox-relay.ts:433–455`: NotificationInbox event có `entityType: account`, `entityId: row.accountId`, có thể kèm `bookingId`, payload `intentId`.
- `realtime-broker.ts`: nếu có bookingId thì gửi union booking room + role:manager + account room; nếu không có bookingId, account event vẫn gửi role:manager.
- `notifications-automation/infrastructure/notification-inbox.reader.ts`: REST inbox luôn ràng `n.accountId = currentAccountId` kể cả Manager.

Vì vậy metadata thông báo riêng của một account có thể tới account khác cùng booking và Manager, trái với owner-only scope của inbox. Event chỉ là invalidation không loại bỏ nghĩa vụ phân quyền: recipient/intent/reference vẫn là dữ liệu riêng.

Cần route account-private notification chỉ tới account audience thực sự được phép; booking-wide invalidation phải là event riêng đã loại dữ liệu cá nhân. Không dùng mọi bookingId làm ưu tiên broadcast bất kể entityType.

Ngoài ra stream chỉ nhìn createdAt/row ID với receipt cố định, nên read/unread thay đổi trên cùng NotificationInbox row chưa có event revision riêng để cập nhật tab khác.

## 4. P1 — Roles/grants/assignment thay đổi chưa thu hồi phòng và quyền subscribe

CredentialStatus/expiry/lookup-error đã được sửa trong `validateSocketSession`, nhưng:

- `realtime-server.ts` thay `socket.data.actor` bằng object mới với roles hiện tại.
- Connection handler lại giữ `const actor = socket.data.actor`; subscribe handlers dùng `actor.roles` cũ. Sau khi role đổi, handler vẫn có thể xử lý theo snapshot cũ.
- Role room membership không được cập nhật sau thay đổi roles. Pre-dispatch chỉ xác minh credential/session/account, không recheck current grant/access level hoặc staff assignment của các booking rooms đã join.
- Redis fanout tới node khác không tự chạy lại local pre-dispatch hook của node nhận.
- Socket connection/message quotas vẫn dùng Map/counter từng process; chưa phải Redis shared quotas. Vì vậy báo hoàn tất distributed limiting là chưa đủ.

Cần current-scope authorization và room eviction khi role/grant/assignment đổi; tránh cache snapshot actor được capture trong closure. Giữ bounded verification để không tạo N+1, nhưng không dùng cache để giữ quyền đã mất.

## 5. P1/P2 — Recovery watermark vẫn có thể bỏ event commit muộn

Nguồn: `realtime-outbox-relay.ts:196–225`.

Recovery chỉ chạy khi `lowWatermarkId !== cursorId`. Low watermark tiến lên qua prefix đã có receipts. Sau khi watermark đã bắt kịp cursor, transaction cũ commit một row nằm trước watermark sẽ không được quét lại.

Trace source cụ thể (không chạy simulation/test):

1. Chỉ row B ở thời điểm t2 đã commit, relay phát B và cursor=B.
2. Recovery đọc B đã có receipt, nên lowWatermark=B.
3. Transaction dài A có timestamp t1<t2 commit sau.
4. Forward query sau cursor B không thấy A; recovery bị bỏ vì lowWatermark=cursor. A bị bỏ sót tới khi có cơ chế khác quét lại vùng cũ.

Việc thêm một watermark tiến đơn điệu không tạo commit-order guarantee. Cần durable pending/delivered detection hoặc late-commit-safe reconciliation đúng semantics, có bounds/indexes rõ.

Lease cũng vẫn lưu value `'1'`, xóa bằng DEL theo key, không có ownership token/compare-delete. Báo cáo nói “nhả theo đúng token” chưa khớp code; khi lease hết hạn và worker khác đã claim, worker cũ có thể xóa lease mới.

## 6. P1/P2 — Event mapping chưa khớp business identity và audit types

### Identity events nhầm consultationId thành bookingId

`realtime-outbox-relay.ts:395–398` gán `scope.bookingId = row.consultationId`. Đây là hai identity khác nhau; booking có trường consultationId tham chiếu tới consultation, không dùng cùng UUID theo contract.

Event vì vậy phát tới `booking:<consultationId>` thay vì booking room thực tế; Couple chưa có booking/new-booking cũng không nhận được account-level list invalidation. Thay filter frontend không sửa được audience sai từ BE.

### Catalog audit filter thiếu nhiều loại thực tế

`realtime-outbox-relay.ts:468` chỉ chấp nhận:

```text
hall, menu, dish, shift, restaurant, timeline, catalog
```

Trong khi các writers thực tế ghi:

```text
restaurant-profile, restaurant-shift, menu-package,
dish-version, menu-package-version,
timeline-template, timeline-template-version,
layout-template, layout-template-version, catalog-media-asset, ...
```

Ví dụ PATCH restaurant profile tạo audit entityType `restaurant-profile`, bị filter loại bỏ nên không có catalog.updated. Các listener Manager mới đã được đăng ký là cải thiện thật, nhưng không có event đầu vào thì màn vẫn không tự cập nhật.

Cần mapping/envelope chính xác từ owner contract/callsites, không substring/type list phỏng đoán. Giữ public vs manager-only invalidation riêng.

## 7. Những cải thiện đã xác nhận qua source

- Broker methods trả Promise, relay await publish; seen IDs chỉ ghi sau dispatch. Đã bỏ fire-and-forget critical path cũ.
- Redis general/pub/sub tạo một lần, init await connect/ping cả ba trước adapter sử dụng.
- Credential expiry lấy min credential/idle/absolute; expiry check trước cache; lookup failure disconnect thay vì return true.
- Feature HTTP limiters đã được inject Redis client; cần sửa collision ở mục 2 để dùng an toàn.
- Catalog Manager có addCatalogInvalidationListener callsites; Couple overview subscribe các booking hiện có trong list; hook filter được mở cho account/list use case.
- BE integration test source không còn hard-coded dynamic sibling imports; client test source đã chuyển về repo web. Không chạy các tests đó theo yêu cầu user.

Không suy các cải thiện source trên thành “verified realtime đúng mọi flow”. Browser resync/dirty forms và native Redis multi-process vẫn chưa được chạy trong lượt này.

## 8. Lint/typecheck do Codex tự chạy

| Repository | TypeScript | ESLint |
| --- | --- | --- |
| wedding-web | PASS exit 0 (`--noEmit --incremental false`) | PASS exit 0 |
| wedding-manage-web | PASS exit 0 (`--noEmit --incremental false`) | PASS exit 0 |
| wedding-be | PASS exit 0 (`--noEmit`) | PASS exit 0 (`--max-warnings 0`) |

Chỉ chạy `tsc` và `eslint`, không chạy test/build/format/check scripts khác. Không ghi tsbuildinfo vào hai web. BE tsc dùng project hiện tại; lệnh lint không có --fix. Không sửa test để che lỗi hoặc nhận lại bằng chứng runtime từ các lượt cũ.

## 9. Giới hạn và báo cáo cần sửa

- Chưa chạy Redis thật, browser E2E, restart/failure probes hoặc load tests theo chỉ thị cấm test; chưa chứng minh SLA/không cần F5 ở runtime.
- Báo cáo Anti nên ghi “đã triển khai source, chưa kiểm chứng runtime” và không dùng PASS lint/type thay cho hoàn tất semantic recovery/authorization.
- Hướng dẫn test tay hiện ghi logout sẽ phát session.revoked rồi điều hướng login, nhưng broker helper chỉ disconnectSockets, không emit event; client session không được chứng minh tự clear/login từ server disconnect. Cần hướng dẫn đúng behavior thực tế.
- Không tự push/deploy. Ưu tiên sửa buckets và audience authorization, rồi mapping và committed-event recovery trước nghiệm thu.
