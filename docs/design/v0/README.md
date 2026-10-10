# Bộ brief dựng giao diện Wedding bằng v0

Ngày chuẩn bị: 2026-10-10, Asia/Bangkok.

**Trạng thái: đã chuẩn bị brief và danh mục màn hình; chưa gửi vào v0, chưa có bản render hoặc QA giao diện.** Trình duyệt từ chối truy cập `https://v0.dev` vì không xác minh được saved browser permissions. Không coi tài liệu này là bằng chứng hoàn thành UI, tích hợp API hoặc nghiệm thu SPEC-05.

Phạm vi tạm thời: toàn bộ bề mặt sản phẩm được tài liệu mô tả. Người dùng chưa trả lời câu hỏi lựa chọn phạm vi tại thời điểm lập brief. Đây là thiết kế/prototype cho việc triển khai sau này, không mở rộng nhiệm vụ sửa code hay duyệt các module chưa nghiệm thu.

## Sản phẩm phục vụ ai

| Source             | Vai trò và mục đích                                                                                                          | Đặc điểm thiết kế                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| wedding-web        | Couple và khách truy cập; workspace hạn chế trước cọc; Couple đầy đủ sau cọc; website công khai và Guest RSVP qua link riêng | Editorial, ảnh ấm, khoảng thở; editor đầy đủ trên Web                                |
| wedding-manage-web | Manager quản trị nhà hàng/nghiệp vụ; Staff tác nghiệp tiệc được phân công                                                    | Điều hướng và bảng dữ liệu rõ; mật độ cao nhưng dễ đọc; tách quyền Manager/Staff     |
| wedding-app        | Expo/React Native Android, Couple đã có FULL access và booking xác nhận                                                      | Native, tác vụ nhanh; preview/chỉnh văn bản/chia sẻ; không thu nhỏ nguyên Web editor |

Các README xác nhận Web còn có bề mặt public/Guest và Manage Web còn có Staff. Chúng là các khu vực khác quyền, không đồng nhất với trang Couple hay quyền Manager.

## Căn cứ và thứ tự sử dụng

1. `PRODUCT-REQUIREMENTS.md`, `CAPABILITY-MAP.md`: vai trò, journey, ACC/TML/MED/GST/SEA/CHK/PRN/QRC/OPS và ranh giới phạm vi.
2. Các `SPEC-*.md` theo module: trường dữ liệu, quyền, trạng thái, giới hạn, luồng ngoại lệ.
3. `CONTRACT-BASELINE.md`: contract liên module; API/OpenAPI là nguồn shape khi tích hợp. Prototype không tự tạo endpoint hay dữ liệu nghiệp vụ.
4. `docs/spec-05-06-implementation-guide.md` mục 14, `tasks/todo.md`, `tasks/plan.md`, tài liệu hand-off: truy vết triển khai; dấu tích không thay thế SPEC hoặc bằng chứng runtime.
5. README, CONTRIBUTING, AGENTS/CLAUDE của client; cấu trúc routes, theme và component thực tế: ràng buộc stack/architecture.
6. `.codex/skills/wedding-design-system/references/foundation.md` là visual authority; `product-patterns.md` quy định mỗi bề mặt; `taste-audit.md` kiểm tra chất lượng; `delivery-workflow.md` kiểm chứng khi triển khai.

Một số câu trong product-patterns/taste-audit còn nhắc serif tiếng Việt, navy hoặc powder blue; foundation và delivery-workflow chỉ rõ ưu tiên foundation. Dùng Be Vietnam Pro tiếng Việt và palette forest/ivory hiện hành. Không dùng palette cũ `#1E3A2F/#879883/#FDFBF7/#D4AF37` từ báo cáo triển khai làm authority.

## Các file dùng với v0

- [Danh mục màn hình và nguồn yêu cầu](screen-matrix.md).
- [Foundation và ràng buộc chung](00-shared-foundation.md).
- [Prompt Couple Web](01-couple-web.md).
- [Prompt Manage Web](02-manage-web.md).
- [Prompt Android](03-android.md).

Mỗi project v0 nhận `00-shared-foundation.md` + prompt của đúng sản phẩm. Dựng một shell và lát cắt chính trước, sau đó mở rộng theo ID ở screen-matrix; không yêu cầu một lần sinh toàn bộ app bằng một dashboard chung.

## Lát cắt ưu tiên khi tiếp tục

- Couple Web: tổng quan booking → thư viện media → editor → preview/publication → đơn in/báo giá/thay thế; thêm household/RSVP ở đợt SPEC-06.
- Manager: danh sách đơn in → báo giá chi tiết → replacement → production/ready/handover; thư viện template và download media.
- Android: tổng quan → thiệp → chỉnh văn bản → preview/share → theo dõi đơn in.

## Điều kiện bàn giao

1. Có URL project/chat v0 và ảnh render thật cho từng sản phẩm.
2. Điều hướng, form, drawer/sheet và các trạng thái trong prototype hoạt động; mọi dữ liệu mẫu ghi rõ là minh họa.
3. Kiểm tra Web 1440px/768px/390px; Android prototype 360px/412px với safe areas, keyboard và dark mode. Đây là kiểm tra prototype, chưa phải kiểm chứng device/native build.
4. Đối chiếu ma trận requirements; không thêm public album, QR check-in, tên người nhận trên bản in, sửa hình học bàn cho Couple hoặc automatic refund.
5. Tiếng Việt không bị uppercase/tracking/serif; contrast, focus, keyboard, target ≥44px và lỗi/empty/loading được kiểm tra.
6. Bản xuất v0 được review trước khi nhập vào source. Android HTML preview không được tuyên bố là React Native implementation; tích hợp thật phải dùng Expo và theme hiện có.

Chưa thực hiện các bước bàn giao này do quyền truy cập v0 đang bị chặn. Không thay đổi code của ba client, API lock, backend business logic hay checklist nghiệm thu trong lượt chuẩn bị này.
