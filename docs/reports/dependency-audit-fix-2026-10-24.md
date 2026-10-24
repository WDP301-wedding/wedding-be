# Vá lỗi Audit locked dependencies — 2026-10-24

## Nguyên nhân và phạm vi

Hai run đã xác nhận fail đúng audit step:

- [wedding-be / 40057863626](https://github.com/WDP301-wedding/wedding-be/actions/runs/40057863626), commit `3f2b93459f2502f0ddc774699938dad1404edcda`; PostgreSQL migration job của run này đã success.
- [wedding-web / 40057883038](https://github.com/WDP301-wedding/wedding-web/actions/runs/40057883038), commit `1980a519d9a9c03081441dc08b61cc62752f22f3`; deployment bị skipped vì quality fail.

GitHub API cho đọc run/jobs nhưng tải logs trả 403. Vì vậy nguyên nhân chi tiết được xác nhận bằng **tái hiện đúng `npm run audit:ci` trên source tương ứng**, không tuyên bố đã đọc được log bị chặn. Lần chạy có quyền network/subprocess đầy đủ cho BE báo high advisories 1243066 (zod), 1243074 (body-parser), 1243083 (multer). Web báo high zod và undici 1243113.

Lần audit trực tiếp ban đầu trong sandbox trả rỗng và wrapper bị EPERM; kết quả đó không được dùng làm bằng chứng pass. Các kết quả trước/sau bên dưới dùng registry/subprocess thật ngoài sandbox.

## Bản vá tối thiểu

| Repo | Package | Trước → sau | Lý do |
| --- | --- | --- | --- |
| BE + Web | zod | 4.6.5 → 4.6.7 | Nằm ngoài affected range `<4.6.6` của [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). |
| BE | multer | 2.4.0 → 2.5.0 | Bản vá [GHSA-q7qp-rjg7-q26m](https://github.com/advisories/GHSA-q7qp-rjg7-q26m). |
| BE | body-parser (qua Express) | 2.3.0 → 2.4.0 | Bản vá [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828); vẫn thỏa Express `^2.2.1`. |
| BE | qs (transitive) | 6.16.0 → 6.16.1 | body-parser 2.4.0 yêu cầu `^6.16.1`. |
| Web | undici (dev, qua jsdom) | 7.30.0 → 7.30.1 | Bản vá [GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c); vẫn thỏa jsdom `^7.25.0`. Không diễn giải thành đã vá HTTP runtime tích hợp của Node. |

Mỗi repo chỉ sửa `package.json`, `package-lock.json`; report này là evidence bổ sung của BE. Không sửa business/UI/API flow, không đổi workflow, không tắt audit, không nới policy hay thêm exception, không dùng `npm audit fix --force`, không nâng major. Các dependency và platform entries khác được giữ nguyên.

Lockfile được tạo bằng đúng npm 11.19.0 của `packageManager`; Node bundled 24.19.0 nằm trong engines. Thử chuẩn bị với npm 11.6.2 tạo metadata churn, nên bản đó đã bỏ; bản áp vào source dùng 11.19.0 chỉ thay đúng các entries trong bảng. `npm install --ignore-scripts --no-audit --no-fund` đồng bộ local node_modules: BE changed 4 packages, Web changed 2 packages. Không chạy lifecycle scripts.

## Kiểm tra

| Kiểm tra | BE | Web |
| --- | --- | --- |
| `npm run audit:ci` | PASS exit 0, không còn high/critical | PASS exit 0, 0 critical/high/moderate/low |
| TypeScript | PASS exit 0 | PASS exit 0 |
| ESLint, `--max-warnings 0` | PASS exit 0, không warning | PASS exit 0, không warning |
| `npm ci --dry-run --ignore-scripts --no-audit --no-fund --os=linux --cpu=x64 --libc=glibc` trong Temp riêng | PASS exit 0 | PASS exit 0 |

Dry-run kiểm tra resolution/manifest-lock compatibility với cấu hình Linux x64, không phải cài/chạy runtime trên máy Linux. npm dry-run in text trước JSON; lỗi parse JSON của wrapper PowerShell ban đầu không phải lỗi npm ci (npm exit 0). Log đầy đủ đã giữ trong Temp, không đưa vào source.

TypeScript chạy BE `tsc --project tsconfig.json --noEmit`; Web thêm `--incremental false`, không chạy Next typegen. ESLint chạy toàn repo. Không chạy test/coverage, build hoặc format. Không claim runtime regression đã được test. Gate BE chỉ kiểm high/critical; không diễn giải PASS thành mọi advisory mức thấp hơn đều đã được xử lý.

## Trạng thái phát hành

Chưa commit/push thay đổi này. Chưa có CI mới trên bản vá; hai run fail cũ không tự chuyển success vì source local thay đổi. Cần phát hành manifest và lockfile cùng nhau rồi xem run mới. Không tự deployment hoặc đổi branch protection.
