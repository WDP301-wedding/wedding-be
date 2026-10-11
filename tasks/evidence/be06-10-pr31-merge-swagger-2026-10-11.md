# BE-06–10 — merge PR #31 và kiểm tra Swagger

Kiểm tra ngày 2026-10-11, Asia/Saigon. Đây là báo cáo local sau merge;
không thuộc commit đã được CI kiểm thử/triển khai dưới đây.

## Merge và source

- [PR #31](https://github.com/WDP301-wedding/wedding-be/pull/31) đã merge lúc
  **23:37:20** bằng merge commit, giữ nguyên lịch sử nguồn.
- Head được kiểm thử: `87799003c7f2ad61174711b5f4d86c908535f37d`.
- Commit `main`: `2fcae5e5be2acdcd55a99df77036f8d34157b383`.
- Trước merge: không xung đột; không có review thread chưa giải quyết;
  cả hai job bắt buộc thành công trên đúng head.
- Chủ dự án trực tiếp yêu cầu merge trong chat. GitHub không ghi nhận
  independent team-member approval; yêu cầu trực tiếp của chủ dự án không
  được ghi nhận thành bằng chứng independent review. Không sửa CONTRIBUTING.
- Checkout local đã fast-forward tới commit merge. Hai báo cáo BE-11–16
  untracked có sẵn được giữ nguyên; không có tracked source change sau merge.

## CI và deployment sau merge

[CI trên đúng commit merge](https://github.com/WDP301-wedding/wedding-be/actions/runs/38156229300)
thành công ở cả hai job bắt buộc:

| Gate | Kết quả |
| --- | --- |
| Format, lint, typecheck, OpenAPI, build, audit | Pass theo policy hiện tại, không hạ ngưỡng hoặc thêm exception |
| Unit / contract | 1.218 unit tests; 34 contract tests pass |
| PostgreSQL migration / integration | Empty PostgreSQL áp dụng 44 migrations; 66 files / 375 tests pass |
| Full coverage | 209 files / 1.627 tests; lines 97,33%, branches 93,55%; gate từng file >=80% pass |
| Railway automatic deployment | GitHub deployment `6998509588`, đúng merge SHA, SUCCESS lúc **23:44:54** |

Deployment dùng pipeline tự động sẵn có. Không upload source riêng, bỏ qua CI,
thay cấu hình Railway hoặc thêm/sửa migration.

## Swagger sau deployment

HTTP kiểm tra lúc **23:46:11**, trình duyệt reload và Try it out lúc **23:46:54**.

- [Swagger](https://wedding-be-production-e1dc.up.railway.app/docs/) hiển thị
  OpenAPI 3.1.0 bình thường. Docs/initializer/bundle/CSS/font được tải với HTTP 200.
- [Canonical OpenAPI](https://wedding-be-production-e1dc.up.railway.app/api/v1/openapi.json)
  khớp từng byte với artifact của commit merge, SHA-256
  `bd2f087e274524a967850334a106d51fa566669a823f2aa51fff427104905747`.
- `/docs/openapi.json` có cùng operations/schema, đổi prefix đúng `/api/v1`
  cho API và giữ `/health` cho health. Sáu thao tác commercial contract hiện đủ
  trong nhóm Booking lifecycle: list, create, submit, approve, withdraw và PDF.
- Anonymous list/PDF contract trả **401 AUTHENTICATION_REQUIRED**. Trước deployment,
  Try it out trên contract list cũng gọi đúng URL và nhận đúng lỗi 401; console
  network error này là kết quả dự kiến của request không có token.
- Sau deployment, Swagger Try it out gọi đúng
  `/api/v1/catalog/halls?limit=20` trên backend hiện tại và trả **200**.
  Console sau reload: **0 errors, 0 warnings**, không có lỗi render/spec.
- `/health/ready` trả 200. Health không được dùng làm bằng chứng thay thế
  acceptance nghiệp vụ hoặc thanh toán.

Không cần sửa Swagger/OpenAPI hoặc tạo deployment bổ sung. PR chỉ bổ sung test
và hồ sơ nghiệm thu, nên digest OpenAPI giữ nguyên là kết quả đúng.

Raw merge/CI/deployment/HTTP evidence lưu ở ignored `test-results/be06-pr31-*`;
browser snapshots lưu ở local `output/playwright/be06-pr31/`.
Không thực hiện paid generation, thanh toán, email hoặc business-data mutation
trong lần kiểm tra này. [Nghiệm thu backend BE-06–10](be06-10-acceptance-2026-10-11.md)
và checklist đã nằm trên `main`; các RV/downstream gates khác giữ phạm vi riêng.
