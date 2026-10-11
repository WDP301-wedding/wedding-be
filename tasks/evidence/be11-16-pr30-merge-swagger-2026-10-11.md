# BE-11–16 — merge PR #30 và kiểm tra Swagger

Kiểm tra ngày 2026-10-11, múi giờ Asia/Saigon. Báo cáo local sau merge;
không thuộc nội dung commit được kiểm thử và triển khai dưới đây.

## Source và merge

- [PR #30](https://github.com/WDP301-wedding/wedding-be/pull/30) đã merge lúc
  **21:15:44** bằng merge commit, giữ nguyên lịch sử các commit nguồn.
- Head trước merge: `3d26a703434cf6ff80e92faabcddb2097917099d`.
- Commit trên `main`: `191116bb078ec2716d10d2ce14b40362ea6b50dd`.
- Trước merge: không xung đột, không có review conversation chưa giải quyết;
  [CI trên đúng head](https://github.com/WDP301-wedding/wedding-be/actions/runs/38145474386)
  thành công ở cả hai job bắt buộc.
- Chủ dự án trực tiếp yêu cầu merge. GitHub không ghi nhận independent
  team-member review; owner authorization không được tính là independent review.
  Yêu cầu review thông thường trong CONTRIBUTING vẫn được giữ nguyên.
- Checkout chính đã fast-forward tới commit merge; hai báo cáo untracked cũ
  được giữ nguyên, không có tracked source change sau merge.

## CI sau merge và deployment

[CI trên commit merge](https://github.com/WDP301-wedding/wedding-be/actions/runs/38146464480)
thành công ở cả hai job:

| Kiểm tra | Kết quả |
| --- | --- |
| Format, lint, typecheck, unit/contract, OpenAPI, build, audit | Pass theo policy hiện tại; audit giữ exception chưa hết hạn `1145093` |
| Migrations trên PostgreSQL CI trống | 44 migrations áp dụng thành công |
| Integration | 66 files, 370 tests pass |
| Full coverage | 209 files, 1.622 tests pass; lines 97,33%, branches 93,53%; gate mỗi file >=80% pass |
| Railway tự động, Wait for CI | GitHub deployment `6996782417`, source đúng commit merge, status success lúc **21:26:01** |

Deployment dùng pipeline/pre-deploy migration sẵn có. Không upload nguồn khác
hoặc thay cấu hình Railway để bỏ qua CI.

## Swagger/OpenAPI sau deployment

HTTP kiểm tra lúc **21:27:20**; trình duyệt kiểm tra lại tới **21:28:07**.

- [Swagger](https://wedding-be-production-e1dc.up.railway.app/docs) và toàn bộ
  JavaScript/CSS/font được trình duyệt yêu cầu trả 200; không có console error,
  warning hoặc Swagger spec/render error.
- [Canonical OpenAPI](https://wedding-be-production-e1dc.up.railway.app/api/v1/openapi.json)
  khớp từng byte với artifact trong commit merge, SHA-256
  `bd2f087e274524a967850334a106d51fa566669a823f2aa51fff427104905747`.
- Browser spec `/docs/openapi.json` khớp toàn bộ canonical document sau đúng
  phép đổi prefix: API dùng `/api/v1`, health giữ `/health`; server là `/`.
- OpenAPI 3.1.0: **143 paths, 165 operations**. Có đủ 13 operations của appendix,
  incidental expenses và immutable invoice; approval công bố `SOURCE_ALLOCATED`.
- `/health/live`, `/health/ready`, catalog halls và dishes trả 200. Readiness của
  source này kiểm tra trạng thái và checksum 44 shipped migrations; không suy ra
  toàn bộ schema hoặc business journey từ health.
- Ba GET riêng tư (appendices, invoices, management expenses) khi không có token
  trả **401 `AUTHENTICATION_REQUIRED`**.
- Sau deployment, Swagger **Try it out** gọi đúng
  `/api/v1/catalog/halls?limit=20` trên cùng backend origin và trả **200**.

Raw HTTP evidence, canonical/browser responses, merge/deployment metadata và CI
logs được giữ trong thư mục local ignored
`C:\Users\DELL\.codex\worktrees\review-be11-16\wedding-be\test-results\be11-16-fixes`.

## Ranh giới

Đây là bằng chứng merge, CI, deployment và kiểm tra Swagger/read-only API.
Full deployed commercial journey và RV-14 balance sandbox vẫn là checkpoint
riêng; không có paid generation, thanh toán hoặc business-data write trong lần
kiểm tra Swagger này. Kết quả sửa code và journey local nằm trong
[repair evidence](be11-16-repairs-2026-10-11.md).
