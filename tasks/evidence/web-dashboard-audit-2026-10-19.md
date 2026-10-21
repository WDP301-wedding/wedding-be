# Kiểm tra dashboard wedding-web — 19/10/2026

## Kết luận

**Có nguyên nhân ở cả backend và frontend.** Backend xử lý nhiều request mất vài
giây ngay trong ứng dụng; frontend cộng thêm refresh phiên, truy vấn trùng và các
đợt tải nối tiếp. Không có căn cứ quy toàn bộ độ chậm cho render frontend hoặc
Vercel. Trong phiên đăng nhập kiểm tra này, **99/99 request API được đối chiếu đúng
request ID với log Railway, tất cả thành công; không tái hiện HTTP 500**. Có một
lỗi hiển thị ở trang Khách mặc dù request tương ứng trả 200, và một lỗi diễn giải
422 ở màn hình đăng nhập.

Đây là báo cáo điều tra và đề xuất, chưa phải bản sửa hoặc kiểm chứng sau sửa.
[Receipt JSON](web-dashboard-audit-2026-10-19.json) chứa số đo, request ID và log
đã lọc theo đúng phiên kiểm tra; không chứa mật khẩu, token hoặc nội dung hợp đồng.

## Môi trường và phạm vi

- Thời gian đo: khoảng 11:13–11:22 ngày 19/10/2026, Asia/Saigon; đăng xuất sau đo.
- Web: <https://wedding-web-silk.vercel.app>; Chrome 155 trên Windows.
- Backend Railway: deployment `6ec27e24-359b-40c7-b67f-6e712a56617f`, source
  `6626a3a44b306300fee78a6509e8fb4cfb2099e0`, region `sfo`, theo Railway API.
- Dùng tài khoản do chủ dự án cung cấp, chọn mặc định tiệc Orchid Hall hiện có.
  Không kiểm thử toàn bộ từng tiệc, vai trò Manager/Staff hay luồng ghi dữ liệu.
- Mã frontend đối chiếu tại local: `5ac528ac8096e296a3ae07678c3ab1b798602fa4`.
  Chưa xác minh độc lập commit frontend đang deploy; mô tả mã local được phân biệt
  với các request trực tiếp quan sát trên web.
- Chỉ điều hướng/xem và bấm Thử lại. Không thanh toán, tạo ảnh AI, gửi thư, xuất
  bản thiệp, thay đổi check-in, tên, số khách, sơ đồ hoặc chứng từ. Login, refresh
  và logout có các bản ghi bảo mật bình thường. Logout trả 204, request ID
  `fc89d518-9c5a-48f2-9199-385ecf83e829`.
- Không sửa frontend, backend runtime, migration, cấu hình hoặc deployment.
  Không đóng lại checklist SPEC/RV/PERF dựa trên đợt đọc này.

## Thời gian chờ theo trang

Để tránh kết luận sai từ bộ tự động hóa, bảng dùng **khoảng từ lúc trang bắt đầu
request API đầu tiên đến lúc API cuối cùng của lượt đó trả xong**, bao gồm các
đợt gọi nối tiếp. Đây là thời gian chờ dữ liệu, không phải LCP/INP, không bao gồm
toàn bộ thời gian điều hướng và render. Không cộng các request chạy song song.
Mỗi trang có hai lượt, trừ Tổng quan quay lại và Sơ đồ có một lượt; Khách có thêm
một retry thành công. Không tính p95 từ mẫu ít như vậy.

| Trang | Chờ chuỗi API, giây | Quan sát |
| --- | ---: | --- |
| Tổng quan, quay lại từ Hồ sơ | 7,76 | Refresh → me → bookings → proposal → inbox/unread |
| Thoả thuận / Kịch bản | 7,22–7,49 | Refresh, me; bookings/proposal bị gọi hai lượt trong một lần mở |
| Tên cô dâu chú rể | 3,24–3,31 | Luôn tải cả contracts và profile dù chỉ xem tên |
| Hợp đồng | 3,23–3,24 | Tải lại contracts và profile khi chuyển từ trang Tên |
| Thanh toán | 10,57–10,58 | Refresh/me → proposal + contracts → billing |
| Chuẩn bị / Khách, các lượt thành công | 9,48–12,85 | Groups trước, sau đó plan/guests/settings/attendance; chờ đủ cả nhóm |
| Chuẩn bị / Sơ đồ bàn | 4,23 | Guest groups + seating-layout-options; chưa chọn/tạo sơ đồ |
| Chuẩn bị / Thiệp & in | 12,71–16,10 | Refresh/me → invitations + print-orders → contracts + appendices |
| Chuẩn bị / Phụ lục | 4,75–4,76 | Contracts + appendices, tải lại khi quay lại |
| Quyết toán | 5,77–6,74 | Expenses + final-invoices + billing; billing hoàn tất sau cùng |
| Thông báo | 4,11–4,18 | Refresh/me trước inbox + preferences |
| Hồ sơ | 2,88–2,91 | Profile chạy cùng refresh, sau đó me |

Lượt Khách đầu có API window **29,51 giây**, xuất hiện lỗi UI và các khoảng nghẽn
main thread dài; giữ riêng, không trộn vào khoảng của các lượt thành công.
Các con số thao tác tới khi bộ dò kết thúc trong commentary chỉ là số đo sơ bộ.
Một bộ dò cũ nhận nhầm chữ tĩnh “Đang mở” ở trang Hồ sơ là trạng thái loading,
nên mốc 30 giây của bộ dò này **bị loại**, không phải lỗi treo trang Hồ sơ.
Bộ dò khác có thể kết thúc sớm trong trạng thái giao diện chuyển tiếp; bảng trên
được tính lại bằng timestamp request, không lấy trực tiếp `mark.ms`.

## Backend: phần chậm được xác nhận trực tiếp

Mỗi dòng dưới ghép đúng một request của trình duyệt với `durationMs` trong log
deployment đang phục vụ. Backend time bao gồm mọi chờ bên trong handler, như DB,
pool, lock hoặc provider; chưa có trace mới để phân chia các thành phần đó.

| Request | Trình duyệt, giây | Backend, giây | Request ID |
| --- | ---: | ---: | --- |
| attendance-summary, lượt retry Khách | 9,82 | 9,35 | `a90822bf-9552-4e16-9b72-3bb79e7b34a9` |
| check-in-settings, cùng lượt | 7,46 | 7,00 | `597f06b9-2981-4558-82e4-ec00431a603f` |
| billing, Quyết toán lượt 1 | 6,73 | 6,26 | `efb3079b-abaa-41a1-9d77-4ddc4beb6792` |
| invitations, Thiệp lượt 1 | 5,32 | 4,85 | `56563220-465c-4de3-850b-2b2a0b5ef0a9` |
| appendices, Thiệp lượt 1 | 5,75 | 4,80 | `8e01c8a5-0230-4a80-843c-870956ff84d5` |
| billing, Thanh toán lượt 1 | 3,55 | 3,08 | `1dff64d7-6fd5-4f28-84ea-bffcf7af3df9` |

Riêng attendance, khoảng 95% thời gian request nằm trong backend; billing ở Quyết
toán khoảng 93%. Đây là tỷ lệ của hai request cụ thể, không phải tỷ lệ chung của
mọi trang. Chênh lệch client/backend của 99 request có median khoảng **471 ms**.
Phần này gồm đường mạng, edge/proxy và xử lý phía client ngoài handler; không thể
gán toàn bộ cho Vercel hoặc JavaScript render.

Nguồn backend đúng commit serving có các read qua owner/boundary/transaction và
kiểm tra authority. Billing đã có logic dùng shared read scope; vì vậy không đề
xuất đơn giản “đổi mọi GET sang shared lock” như thể chưa có cải tiến đó. Cần trace
đúng request chậm để tìm các round-trip/queue còn lại.

[Attribution cũ ngày 17/10](../../docs/backend-performance-03-attribution-2026-10-17.md)
có bằng chứng nhiều round-trip DB và độ trễ địa lý, nhưng **không dùng số query hay
RTT của deployment cũ làm số đo hiện tại**. Cũng không kết luận lỗi pool cũ còn
tồn tại chỉ vì backend hiện tại chậm. Có lưu lượng khác trên deployment trong
thời gian kiểm tra; báo cáo chỉ lấy request ID của phiên này.

## Frontend: nguyên nhân và lỗi quan sát được

### 1. Refresh phiên thừa và tải lại dữ liệu chung — xác nhận

Trong khoảng chín phút đo, có **12 refresh và 13 `/auth/me`**, dù không ghi nhận
401 trong phiên đã đăng nhập. Refresh mất 1,99–3,04 giây ở trình duyệt, me khoảng
0,59–1,08 giây. Mã local `src/features/identity-access/session.ts:108` chỉ chia sẻ
refresh đang chạy; khi hoàn tất thì xoá `restoreOperation`, lần `restore()` sau
lại refresh kể cả đang có trạng thái authenticated. Các trang Kịch bản, Thanh
toán, Thiệp, Thông báo gọi restore riêng.

Kịch bản còn giữ loader riêng trong `booking-lifecycle/collaboration-page.tsx`,
trong khi layout đã có workspace provider. Waterfall ghi nhận hai bookings và hai
proposal trong mỗi lượt mở Kịch bản; đây là request live, không suy ra từ React
StrictMode ở dev. Names và Contract dùng cùng loader tại
`commercial-contract/contract-page.tsx:85`, luôn chờ cả profile và contracts.

### 2. Các tầng tải nối tiếp và chặn cả trang — xác nhận

- Thanh toán: `payments-billing/billing-page.tsx:196` chờ loadContext, rồi mới load
  billing. Kết hợp refresh/me khiến API window khoảng 10,6 giây ở cả hai lượt.
- Khách: `guest-management/guests-page.tsx:76` chờ groups rồi Promise.all bốn read;
  attendance chậm khiến cả phần số khách/nhóm/danh sách chưa hiện. Không tự bỏ
  dependency khởi tạo groups cho booking chưa có workspace.
- Thiệp: `invitation-studio/invitations-page.tsx` restore, tải designs/orders rồi
  mới mount Studio. Waterfall thấy đợt contracts/appendices chỉ bắt đầu sau đó;
  do vậy API chậm vài giây tích luỹ thành 12,7–16,1 giây chờ dữ liệu.
- Quyết toán chờ đủ expenses/invoices/billing trong khi chưa có hoá đơn cuối.

### 3. Lỗi đăng nhập được báo sai — xác nhận

Email ban đầu người dùng gửi thiếu đuôi tên miền. API trả **422 VALIDATION_ERROR**,
detail `email / invalid_format / Invalid email address`, request ID
`49183679-ad38-4780-a3a9-2c46f428bb7d`. UI lại báo “Không thể kết nối máy chủ”.
`identity-access/identity-page.tsx:424` chỉ xử lý riêng 401/403/404/429, còn lại
fallback thành lỗi kết nối. Backend từ chối email sai là đúng; lỗi nằm ở cách UI
diễn giải. Sau khi người dùng xác nhận lại tài khoản và mật khẩu, login trả 201.
Hai refresh 401 trước login là trạng thái anonymous, không tính là sự cố auth.

### 4. Trang Khách báo lỗi dù HTTP 200 — xác nhận hiện tượng, nguyên nhân hẹp chưa chốt

- Một lần mở Khách hiện “Máy chủ từ chối yêu cầu”, mã hỗ trợ
  `4c8356c1-206a-418a-a5a1-dd7255bf1ec5`.
- Request guests đúng ID này trả **200**, JSON content type hợp lệ; body có
  `data.items`, `sourceSequence`, `nextCursor`, danh sách đang rỗng. Log backend
  cùng ID là 2xx, duration 3646,891 ms. Không có bằng chứng server từ chối request.
- Thử lại và quay lại sau đều tải được; không có pageerror hoặc lỗi HTTP API mới
  trong các lượt đã đăng nhập. Lỗi chưa tái hiện ổn định trên yêu cầu độc lập.
- Cần ghi `ApiClientError.kind/code/status`, giai đoạn đọc body và thời điểm abort
  tại client. Mã local `lib/api/client.ts` dùng timeout 10 giây, clone/read JSON
  trong validateResponse; lỗi đọc body bị đổi thành malformed response. Với các
  main-thread stall quan sát được và API sát 10 giây, race timeout/body-read là
  **giả thuyết hợp lý**, chưa có thrown stack để xác nhận chính xác.

PerformanceObserver thấy long task tới 2,78 giây trong phiên này, đặc biệt quanh
lượt Khách lỗi. Máy/automation không được cô lập tải CPU, observer cũng có overhead;
chưa được quy các stall đó cho một component React hay đưa ra điểm INP/LCP/CLS.

## Giải pháp theo thứ tự ưu tiên

| Ưu tiên / đội | Việc cần làm | Cách chứng minh hoàn tất |
| --- | --- | --- |
| P1 Frontend | Dùng một auth/workspace provider. Restore tái sử dụng phiên còn hạn trong bộ nhớ, single-flight; refresh khi bootstrap/hết hạn/401; giữ xử lý revoke/logout và không lưu token vào localStorage. Kịch bản dùng context có sẵn. | Điều hướng giữa các trang với phiên còn hạn không tự sinh refresh/me hoặc duplicate bookings/proposal; test hết hạn/401/thu hồi vẫn đúng. |
| P1 Backend | Trace theo request ID trên attendance/settings/guests, billing, invitations và appendices. Tách pool acquisition, transaction admission/execution, SQL count/RTT, lock waits và owner/provider reads; tìm bước giữ kết nối lâu. Giảm các lần đọc authority/booking/commercial lặp, batch dữ liệu cần thiết trong snapshot phù hợp. | Cùng cohort request hiện có, đúng serving source: lưu trước/sau, log correlation và mẫu lặp; chứng minh quyền, nhất quán tiền và race không suy giảm. Không tăng pool hay timeout theo phỏng đoán. |
| P1 Frontend | Sửa thông báo 422 và phân biệt timeout/network/parse/HTTP 5xx. Với 200 không được hiện “máy chủ từ chối”. Giữ request ID, ghi mã lỗi và thời gian xử lý đã loại PII. | Email sai có lỗi đúng trường; test abort lúc đọc body và JSON lỗi; không quy 200 thành backend rejection. Kiểm tra lại lỗi Khách trong browser. |
| P2 Frontend | Chia loading/error theo khu vực. Names tải dữ liệu cần cho Names; Contract tải theo section. Thiệp hoãn dữ liệu in/phụ lục tới tab cần dùng; cho hiện vùng thiết kế khi sẵn sàng. | Network waterfall bỏ được tầng tải không cần thiết; vùng có dữ liệu vẫn đọc được khi vùng phụ chậm/lỗi. |
| P2 Cả hai | Cache/deduplicate read theo actor + booking + tham số; invalidate khi đổi tiệc, logout và mutation. Với endpoint tổng hợp mới, review strict schema, quyền và snapshot trước. Groups initialization giữ semantics; không chạy bốn bản sao authorization/init nếu có thể dùng chung an toàn. | Không rò dữ liệu giữa tài khoản/tiệc; dữ liệu tiền không dùng cache làm authority khi tạo thanh toán; headcount không suy từ Guest count. |
| P2 Hạ tầng | Sau khi có trace hiện tại, đo có kiểm soát đường browser → Vercel → Railway → DB và so sánh trực tiếp origin bằng môi trường test được cấp quyền. | So sánh cùng request/data, không coi residual 471 ms là toàn bộ chi phí Vercel. Chỉ đổi region/pool sau review ngân sách kết nối và thử nghiệm trước/sau. |
| P2 Cả hai | Bổ sung RUM thời gian click → vùng nội dung dùng được và error-kind, cùng backend latency theo route; đặt ngân sách dựa trên mẫu rộng hơn. | Synthetic lặp + RUM p75/p95 theo thiết bị/mạng; không dùng vài lượt audit làm SLA hay tuyên bố hết lỗi gián đoạn. |

Không tăng timeout frontend hoặc DB đơn thuần để gọi là tối ưu. Attendance 9,82
giây đã gần timeout frontend local 10 giây; cần làm request nhanh và giảm tầng chờ.
Nếu cần thay đổi timeout phải thống nhất deadline giữa các tầng và chứng minh retry
không lặp thao tác tiền. Giữ nguyên hợp đồng/invoice bất biến, idempotency,
authorization, check-in opt-in và Group + optional Guest.

## Giới hạn và kiểm tra artifact

Đây là kiểm tra live read-only, không phải stress/load test, không có DB diagnostic
trace mới, không kiểm chứng provider payment/AI/email hoặc readiness production.
Không thực hiện sửa lỗi nên chưa có kết quả before/after tối ưu. Các bằng chứng
500 cũ vẫn được giữ, nhưng deployment/source đã thay đổi; không kết luận 500 cũ
đã hết hoặc còn tồn tại chỉ từ những lượt 200 này.

Receipt chỉ giữ thông tin kỹ thuật và request/log của phiên kiểm tra. Raw response
auth, cookies và mật khẩu không được lưu trong báo cáo. Không dùng build/test
frontend làm backend acceptance gate. Kiểm tra tài liệu: Prettier và diff whitespace;
không chạy lại application suites vì không có thay đổi runtime/schema.
