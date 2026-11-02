# Thiệp tương tác — 2026-11-03

## Phạm vi

Wedding-web dùng Motion for React 14.9.0 để mở thiệp, lật trang và vuốt ngang.
Ba bố cục: phong bì, hai cánh, album; sáu bảng màu được kiểm soát. Chữ là DOM
thật, không bị đốt vào ảnh; nội dung, ảnh, lịch trình và sơ đồ bàn đều xem được.
Khách chỉ xem, không có RSVP. Có nút đọc toàn bộ và hỗ trợ reduced motion.

`presentation: {version: 1, theme, layout}` là phần tùy chọn của content revision.
Lưu, xuất bản và capture bản in giữ cấu hình đó. Bản công khai cũ không có
presentation tiếp tục dùng renderer cũ. Không cần migration DB cho tính năng này.
Bản in mới dùng renderer `invitation-a5-v3-presentation`, khổ A5 hai mặt tĩnh;
hoạt ảnh không phải quy cách in. Phải kiểm tra PDF trước khi xác nhận chi phí.
Không viết lại revision, PDF, phụ lục, giá hoặc chứng từ đã có.

## Cấu hình BE

- `GEMINI_DESIGN_API_KEY`: khóa Gemini phía máy chủ, không đưa vào NEXT_PUBLIC.
- `GEMINI_DESIGN_MODEL`: tên model có structured JSON output được tài khoản hỗ trợ.
  Hai biến cần có cùng nhau. Không mặc định đoán model, không phụ thuộc model tạo ảnh.
- `PUBLIC_INVITATION_WEB_ORIGIN`: origin web khách, ví dụ
  `https://wedding-web-silk.vercel.app`; local có thể là `http://localhost:3000`.
  Dùng để chuyển link QR render sang `/t/:slug` cho thiệp có presentation mới.
  BE vẫn kiểm tra publication trước redirect. Không cấu hình thì giữ HTML tĩnh
  hiện có trên link render; link chia sẻ của web vẫn dùng renderer tương tác.
- Giữ nguyên `PUBLIC_INVITATION_ORIGIN` và cấu hình tạo ảnh hiện tại.

Không có khóa/model thì chọn mẫu và tương tác vẫn hoạt động, API AI trả 503
AI_DESIGN_DISABLED và giao diện giải thích rõ. Không giả kết quả AI.

## API và an toàn

POST `/bookings/:bookingId/invitation-design-suggestions`, bearer session Couple
và Idempotency-Key; body `{prompt}` dài 10–2000 ký tự.
Kết quả gồm presentation, title, greeting, message, footer. Không sinh tên hai bạn,
ngày, sảnh hoặc giá. UI chỉ áp dụng khi khách bấm Áp dụng; khách vẫn kiểm tra/sửa
và Lưu thiết kế trước khi xuất bản. Không tự xuất bản hoặc đặt in.

Schema chỉ cho phép enum bố cục/màu, không HTML/CSS/JS/URL do AI sinh. SDK không
tự retry; timeout 25 giây. Nhật ký dispatch và kết quả hợp lệ dùng các receipt append-only có namespace riêng, không dùng trạng thái generation ảnh. Dispatch được ghi trước provider call, kết quả được giữ trước acceptance để retry cùng key có thể khôi phục mà không trả phí lần nữa. IO ngoài DB
transaction; receipt và tái kiểm tra quyền được commit sau kết quả hợp lệ.
Cùng key/body replay, khác body bị chặn. Kết quả không rõ bị giữ để tránh gọi trả
phí lần hai; không tự dispatch lại sau hết lease. Tối đa 10 lần dispatch thiết kế trong 24 giờ trên booking; giới hạn tạo ảnh giữ nguyên. Trình duyệt giữ key theo
hash prompt trong sessionStorage, không lưu prompt hay thông tin đăng nhập.
Không phải hàng đợi nền; API có budget hữu hạn và client đợi tối đa 35 giây.

OpenAPI BE ghi nhận endpoint/schema mới. Adapter có kiểu presentation riêng ở FE
để không giả thay commit/hash artifact đã pin; khi phát hành BE cần cập nhật pin
thực tế theo quy trình của dự án.

## Checklist kiểm tra tay (chưa chạy)

1. Couple đã cọc → Chuẩn bị → Thiệp & in → Nội dung thiệp.
2. Chọn từng mẫu/bố cục, điền tên thật; Mở thiệp, Trang trước/sau, vuốt ngang.
   Dùng bàn phím Tab/Enter, bật giảm chuyển động; kiểm tra mobile và desktop.
3. Nhập prompt → Đề xuất bằng AI → xem bản đề xuất → Áp dụng → chỉnh lời mời.
   Khi AI tắt/lỗi, thông báo tại chỗ; mẫu có sẵn vẫn dùng được.
4. Lưu thiết kế → tải lại: bố cục/màu/chữ còn nguyên. Đổi bố cục sau đó chưa lưu
   không thay thiệp đã xuất bản; xuất bản lại phải đúng revision hiện tại.
5. Xuất bản, mở link khách và QR: mở/lật được, ngày/sảnh/lịch trình chính thức,
   sơ đồ chỉ có thông tin nhóm được phép công khai; không thông tin khách riêng.
6. Bật đọc toàn bộ; kiểm tra lời mời dài, ảnh, sơ đồ, nét tiếng Việt, không cắt chữ.
7. Tạo báo giá in → kiểm tra PDF A5 tĩnh và giá server trước xác nhận; đối chiếu
   các bản in/QR đã tồn tại vẫn đọc được. Không dùng tiền thật để kiểm tra.
8. Nhấn gửi AI hai lần/reload sau timeout: dùng lại key; không tự gọi trả phí lại.

Không chạy automated test, không gọi Gemini trả phí, không deploy trong lượt này.
Kết quả kiểm tra mã nguồn sau chỉnh sửa (2026-11-03):

- BE `npm run typecheck`: exit 0.
- Wedding-web `npm run typecheck`: exit 0.
- ESLint các file TypeScript/TSX thay đổi ở cả hai repo, `--max-warnings=0`: exit 0.
- BE `npm run api:check`: exit 0, dùng cấu hình storage offline riêng cho process.
- `npm ls motion framer-motion motion-dom motion-utils --depth=2 --omit=dev`: exit 0.
- Đã định dạng các file thay đổi bằng Prettier; `git diff --check` không có lỗi.

Đây là kiểm tra tĩnh, không phải bằng chứng UI/browser, provider hoặc production.
Chưa push/deploy; cần triển khai hai source và cấu hình các biến ở trên trước khi
kiểm tra AI thực tế. Không cần migration DB mới cho riêng tính năng thiệp tương tác.

## Cấu hình bổ sung — 2026-11-03

- `render.yaml`: model thiết kế `gemini-3.8-flash`, web origin
  `https://wedding-web-silk.vercel.app`. Khóa thiết kế tham chiếu biến
  `GEMINI_API_KEY` của chính dịch vụ bằng `fromService.envVarKey`, không ghi giá trị
  khóa vào Git. Biến nguồn phải tồn tại trong dịch vụ Render.
- `.env` local: public BE origin `http://localhost:3001`, web origin
  `http://localhost:3000`; không thay URL proxy hay kết nối DB.
- Local chưa có khóa Gemini nên giữ cả hai biến thiết kế trống để không làm BE
  lỗi khởi động vì cấu hình thiếu một nửa. Khi có khóa thật, đặt đồng thời
  `GEMINI_DESIGN_API_KEY` và `GEMINI_DESIGN_MODEL=gemini-3.8-flash`.
- Đồng bộ Blueprint mới áp dụng cấu hình từ `render.yaml`. Chỉ push/redeploy
  source không chứng minh Blueprint đã được đồng bộ. Khi thay qua Dashboard,
  chọn Save only nếu bản code mới chưa được triển khai; deploy bản mới sau đó
  mới sử dụng cấu hình. Không chạy generation trả phí để kiểm tra cấu hình.

Nguồn: [Google model capabilities](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash),
[Render service variable references](https://render.com/docs/blueprint-spec),
[Render environment save options](https://render.com/docs/configure-environment-variables).
