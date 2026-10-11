# RV-14–20 — merge PR #32 và kiểm tra Swagger

Kiểm tra ngày 2026-10-12, múi giờ Asia/Saigon. Báo cáo local sau merge;
không thuộc nội dung commit đã được CI kiểm thử và triển khai.

## Source và merge

- [PR #32](https://github.com/WDP301-wedding/wedding-be/pull/32) đã merge bằng
  merge commit lúc **03:29:10**, giữ nguyên lịch sử nguồn.
- Head trước merge: `73589c683f37c43465c0d13949bb824d183f1ccd`.
- Commit `main`: `054d670d6a7edd4d8028004271b02fab5c60973f`.
- [CI đúng head](https://github.com/WDP301-wedding/wedding-be/actions/runs/38171584370)
  thành công ở cả hai job; không xung đột, không có GitHub review yêu cầu sửa.
- Review độc lập bằng agent phát hiện và xác nhận đã sửa lỗi fingerprint
  retention bỏ sót đích `host`/`port` do PostgreSQL query override.
  [Review và kiểm chứng hồi quy](rv14-20-pr32-review-2026-10-12.md) đã nằm trên `main`.
  Test hồi quy thất bại trên source cũ và pass trên bản sửa; phép mutation giới
  hạn batch cũng bị test phát hiện. Không chạy retention trên dữ liệu chia sẻ.
- Chủ dự án trực tiếp yêu cầu merge trong chat. Agent review và owner
  authorization không được tính thành independent team-member GitHub approval.
  Không sửa CONTRIBUTING hay hạ gate; connector diagnostics gặp lỗi HTTP 404,
  CI được xác minh qua GitHub API trên đúng source.
- Checkout local đã fast-forward tới commit merge. Ba báo cáo BE cũ untracked
  được giữ nguyên; báo cáo này được lưu local, không push trực tiếp vào `main`.

## CI sau merge

[CI trên commit merge](https://github.com/WDP301-wedding/wedding-be/actions/runs/38172405227)
thành công ở cả hai job:

| Gate | Kết quả |
| --- | --- |
| Format, lint, typecheck, OpenAPI, build, dependency audit | Pass theo policy hiện tại |
| Unit / contract | 134 files / 1.234 unit tests; 12 files / 37 contract tests |
| PostgreSQL migration / integration | 68 files / 382 integration tests pass |
| Full coverage | 214 files / 1.653 tests pass; statements 96,51%, branches 93,56%, functions 98,48%, lines 97,33%; ngưỡng từng file giữ nguyên 80% |

## Deployment và Swagger

Railway auto-deploy đợi CI và triển khai đúng commit merge từ nhánh `main`.
Deployment `2fd330bc-cc72-43f3-9506-90bf5fd62c2b` có trạng thái **SUCCESS**,
đã là deployment active duy nhất lúc **03:38:04**. Pre-deploy tìm thấy 44
migrations và không có migration chờ áp dụng. Không upload source riêng hoặc
thay cấu hình để bỏ qua CI.

HTTP kiểm tra sau deployment lúc **03:38:06**; trình duyệt reload và kiểm tra
endpoint PDF lúc **03:38:33**, Try it out lúc **03:39:06**:

- [Swagger](https://wedding-be-production-e1dc.up.railway.app/docs) tải bình
  thường; HTML, bundle, initializer, CSS và font được yêu cầu trả HTTP 200.
  Console: **0 errors, 0 warnings**, không có lỗi render/spec.
- [Canonical OpenAPI](https://wedding-be-production-e1dc.up.railway.app/api/v1/openapi.json)
  khớp từng byte với artifact trên commit merge; SHA-256
  `55c15733cdc25a9151c724e311cb5753f9b41124a15c879cf73cc3c90c108b9e`.
- OpenAPI 3.1: **144 paths, 166 operations, 73 schemas**; 1.525 local schema
  references đều resolve, 166 operation ID không trùng.
  `/docs/openapi.json` giữ nguyên components và operations, đổi prefix đúng
  `/api/v1`, giữ `/health`, dùng server `/` để gọi cùng backend origin.
- Endpoint PDF A5 mới hiển thị đủ hai UUID, query `disposition`
  inline/attachment, bearer authorization, response `application/pdf`,
  `Content-Disposition`, hai digest và renderer-version headers. Backend
  anonymous GET trả **401 AUTHENTICATION_REQUIRED**, không trả PDF.
- Swagger **Try it out** gọi đúng
  `/api/v1/catalog/halls?limit=20` và trả **200** trên deployment mới.
- Cả 14 request ID của HTTP probe, PDF bị từ chối và catalog Try it out đều
  xuất hiện trong log chính deployment `2fd330bc-cc72-43f3-9506-90bf5fd62c2b`.
  Bằng chứng này đối chiếu các response với instance triển khai từ commit merge.
- `/health/live`, `/health/ready` trả 200. Không dùng health thay bằng chứng
  nghiệm thu nghiệp vụ hoặc live provider.

[Receipt JSON đã lọc](rv14-20-pr32-merge-swagger-2026-10-12.json) lưu source,
merge, CI, deployment, HTTP và browser checks. Raw metadata/logs và browser
artifacts lưu local ignored `.local-demo/rv32-*`; không chứa trong commit merge.
Mô tả PR đã cập nhật theo bản sửa cuối và CI trên commit merge. Không cần sửa
Swagger hoặc OpenAPI thêm sau khi merge; không phát sinh tracked source change.

Đích đã được chủ dự án duyệt là staging dành riêng cho phát triển, dù tên
environment trên Railway là `production`. Kiểm tra Swagger chỉ dùng HTTP GET;
không thanh toán mới, paid generation, email, business-data mutation hoặc shared
retention. Đây là bằng chứng merge/deployment/tài liệu API; không thay thế hồ sơ
live provider hoặc production readiness riêng.
