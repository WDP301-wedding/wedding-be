# Đồng bộ workspace với database đang triển khai

Ngày xác minh: 2026-10-13 (Asia/Saigon). Phạm vi: `wedding-be`.

## Kết quả và quyết định

Workspace ban đầu ở `codex/spec11-staging@56feb37`, một candidate Notifications
khác bộ code đã được merge và triển khai. Database không thiếu migration của bản
đang chạy: toàn bộ **60 tên/checksum migration** khớp `origin/main@6561499`.
Source đúng có **144 model**, database public có **144 bảng ứng dụng** và
`_prisma_migrations`, tổng cộng 145 bảng.

Đã tạo nhánh `codex/align-deployed-schema` từ
`65614996301481b1fb28dcb6ce24bf1a460b5338`, giữ dữ liệu và chỉnh sửa cục bộ.
Không viết migration mới, không đổi bảng/cột, không sửa migration đã áp dụng và
không triển khai nhánh staging cũ vào database này. Việc tạo thêm cột `accountId`
để phục vụ schema cũ sẽ duy trì hai implementation khác nhau, nên không được làm.

Các bước thực hiện theo thứ tự:

1. Đọc trạng thái Railway, OpenAPI và lịch sử migration thực tế.
2. Xác định dòng code đã merge làm chuẩn; reviewer độc lập kiểm tra phương án.
3. Đối chiếu tên/checksum, định nghĩa SQL và trạng thái enforcement trước khi kết luận không cần
   migration chuyển tiếp. Sao lưu source, local settings và bằng chứng cũ.
4. Kiểm tra database trống, chạy migration lặp và bản khôi phục local có dữ liệu.
5. Xác minh deployment đang phục vụ đã cùng commit/schema/API. Không yêu cầu
   redeploy khi target đã khớp; không có mutation Railway hoặc database dùng chung
   do đợt đồng bộ này thực hiện.

## Schema và dữ liệu

Đối chiếu database live bằng transaction READ ONLY với database dựng từ migrations:

| Thành phần                   | Số lượng | Kết quả                                                            |
| ---------------------------- | -------: | ------------------------------------------------------------------ |
| Cột bảng ứng dụng            |    1.147 | Khớp type/null/default/identity/generated                          |
| Giá trị enum                 |      105 | Khớp tên, giá trị và thứ tự                                        |
| Index                        |      405 | Khớp định nghĩa và valid/ready/live; tất cả hợp lệ                 |
| Constraint                   |      558 | Khớp định nghĩa, validated/deferrable/deferred; tất cả đã validate |
| User trigger                 |      157 | Khớp định nghĩa và trạng thái enabled                              |
| Internal enforcement trigger |      620 | Khớp bảng/function/type/enabled và số lượng; tất cả đang bật       |
| Function                     |       80 | Khớp thân hàm; 7 hàm khác search_path theo môi trường              |
| RLS flags                    | 144 bảng | Khớp trạng thái đã triển khai, không thay đổi quyền                |
| Policy trong public          |        0 | Khớp baseline; không có chỉnh sửa policy                           |

Migration `20261013003000_reporting_scope_and_planning_invalidation` dùng
`SET search_path FROM CURRENT`. Đường dẫn chính xác được lưu ở local clean là
`"$user", public`; ở live/restored là `"\$user", public, extensions`. Phần thân 80
hàm khớp; khác đường dẫn không tự chứng minh hành vi tương đương.

Đã kiểm tra namespace trong transaction READ ONLY dưới từng đường dẫn đã lưu:
cả 144 bảng đều resolve tới bảng public tương ứng; các hàm Analytics được gọi
không ghi rõ schema đều resolve tới function public tương ứng. Hai namespace
literal `$user`/`\$user` đều không tồn tại ở các target kiểm tra. Kết luận này chỉ
áp dụng cho trạng thái namespace/role hiện tại; đổi role hoặc tạo namespace mới
cần kiểm tra lại. Không sửa search_path của hàm live. Bản restore local được thêm
schema `extensions` và pgcrypto local để mô phỏng môi trường chứa extension;
7 hàm đang đối chiếu không gọi `digest()` của pgcrypto.

Đợt này so sánh các thuộc tính catalog đã liệt kê, gồm trạng thái enforcement;
không tuyên bố đồng nhất mọi quyền PostgreSQL/ACL. Không thay đổi grants, roles
hoặc RLS của database live.

PostgreSQL dump/restore có thể làm phẳng nhóm AND trong biểu thức CHECK. Đã chạy
thêm dump/restore của database clean trên cùng PostgreSQL 18.6 để đối chiếu:
toàn bộ 558 constraint của hai bản khôi phục khớp. Không bỏ qua hoặc xóa constraint.

`prisma migrate diff --from-config-datasource --to-schema` vẫn đề xuất bỏ các
SQL foreign key/index bổ sung không biểu diễn đầy đủ trong Prisma model. **Không
áp dụng SQL diff này.** Baseline để xác minh là migrations đã áp dụng và native
catalog; diff datamodel không thay thế các guard SQL của dự án.

Kiểm tra đọc lại live bằng Prisma client mới: NotificationIntent đọc được đầy đủ
cột, không còn lỗi `accountId`. Vẫn có 4 tài khoản demo, 3 booking demo và 12 khách
mẫu. `.env` giữ nguyên SHA-256 trước/sau; tất cả file untracked cũ vẫn còn; nhánh
staging cũ vẫn trỏ tới commit gốc.

## Database cô lập và API

PostgreSQL kiểm tra riêng: `127.0.0.1:55439`; không dùng database demo local cũ
ở port 55435. Các database nhiệm vụ có tiền tố `alignment_`:

- Clean: 60 migrations tạo được 144 bảng ứng dụng.
- Foundation: Prisma migrate deploy thành công; lần chạy thứ hai không có pending
  migrations, giữ history thật cho các test runtime.
- Restored: khôi phục public từ dump riêng, giữ 145 bảng và dữ liệu demo.
- Normalized: database clean được dump/restore để kiểm tra normalization CHECK.

Worker, FCM và provider email/AI/VNPay/Storage bị tắt trong kiểm tra cô lập. Không
start worker trên dữ liệu restore. Chỉ tạo và thu hồi session kiểm tra ở database
local. 12 kiểm tra HTTP đạt:

- Manager đọc preferences/inbox/unread/status Notifications: 200.
- Couple/Staff không có quyền quản lý Notifications: 403; chưa đăng nhập: 401.
- Couple đọc hợp đồng của mình: 200; booking của Couple khác: 404.
- Manager đọc hợp đồng và nhóm ở hai workspace đã initialize: 200.

GET Groups có thể initialize dữ liệu nếu chưa có workspace; vì vậy không dùng
GET đó làm probe read-only trên database dùng chung. Kiểm tra Groups chỉ chạy
trên bản khôi phục local với hai fixture đã được initialize.

## Deployment, API và quality

Railway production đã được kiểm tra qua API read-only. Ban đầu deployment
`80d7d30` đang SUCCESS, `6561499` đang WAITING. Lần kiểm tra sau xác nhận deployment
`c73f82b4-0cd7-459a-a134-c4f39a553751` SUCCESS và source đúng `6561499`.
Đợt đồng bộ không kích hoạt deployment mới.

OpenAPI workspace và hosted đều có SHA-256
`6a8be82541ca2d8ce274f9817d10bcd300c91de2f5e734055cf9108b23db0915`.
Hosted readiness/docs/OpenAPI: 200; Notifications inbox và quản lý khi không
đăng nhập: 401. Không tạo session hoặc thực hiện nghiệp vụ có ghi dữ liệu trên host.

Local: Prisma generate/validate, typecheck, lint, build, API generate/check đạt.
[CI của đúng commit 6561499](https://github.com/WDP301-wedding/wedding-be/actions/runs/38413826090)
đạt cả hai jobs: 1.347 unit tests, 45 contract tests, 493 PostgreSQL integration
tests; coverage chạy đầy đủ **1.885 tests / 265 files**, lines 97,50%, branches
93,44% và giữ ngưỡng per-file. Đây là CI được đọc lại, không phải kết quả full
suite trên máy Windows.

Lần full test Windows đầu lỗi configuration do nhóm biến provider chưa được tắt
đồng bộ; đã sửa fence của runner riêng, không sửa `.env`. Lần full thứ hai có một
FCM test lỗi rồi được dừng sau thời gian cleanup dài; **không ghi full Windows
PASS**. Cùng suite FCM được chạy lại riêng bằng thread pool, giữ nguyên assertions
và timeout, đạt **8/8 tests**. Không thay đổi test discovery của full suite hoặc
source để làm test xanh. Kết quả local
HTTP/schema/migration và CI được phân biệt với provider acceptance; không coi
schema khớp, health 200 hoặc test controlled là email/FCM/AI/payment live thành công.
NO_GO và các giới hạn acceptance đã ghi trong release hand-off không được sửa.

## Backup và hướng dẫn tiếp tục

Source cũ được giữ ở nhánh `codex/spec11-staging@56feb37` và archive riêng;
local settings, bằng chứng candidate-only và các file seed riêng được sao lưu,
đối chiếu hash trước khi switch. Backup/dump/credential đều ở thư mục Git bỏ qua
`.local-demo/schema-alignment-20261013`; không đưa chúng vào PR/evidence công khai.
Giữ recovery manifest trước khi xóa các artifact riêng.

Các thay đổi CORS localhost và Swagger trước khi đồng bộ đã có tương đương trên
main, nên không có diff source cần deploy. Bản ghi seed lịch sử không bị viết lại;
runbook demo được cập nhật để chặn chạy script seed cũ có imports/schema lỗi thời.
Dữ liệu demo và mật khẩu đã tạo vẫn dùng được; mật khẩu Manager không đổi.

Tiếp tục phát triển từ source đã đồng bộ. Khi main cập nhật, fetch và đối chiếu
migrations trên đúng target; không dùng `db push`, sửa migration cũ hoặc chạy SQL
datamodel diff để ép database theo candidate khác. Thay đổi schema mới thật sự
cần migration forward, kiểm tra empty/upgrade/replay và rollback trên target riêng.

Bằng chứng tổng hợp: `tasks/evidence/schema-alignment-2026-10-13.json`.
