# Khảo sát độ trễ Thiệp & in — 20/10/2026

Phạm vi: tìm nguyên nhân và đề xuất cải thiện; chưa sửa runtime, tăng timeout hay
deploy. Đã đọc hướng dẫn hai repository, backend scope, runtime audit SPEC-01–05
và canonical plan/todo bên wedding-web. Giữ nguyên các thay đổi có sẵn trong workspace.
Không gọi AI thật, tạo đơn in, thanh toán hoặc sửa booking live.

## Kết quả chính

Có ba nhóm vấn đề độc lập: frontend tải dữ liệu phụ nối tiếp làm thời gian chờ
tích lũy; backend còn nhiều lượt đọc và N+1 ở danh sách đơn in Couple; luồng AI/ảnh
giữ transaction trong lúc truy vấn pool ngoài và chờ provider. AI còn bị chặn cứng
10 giây. Tăng timeout AI là cần thiết nhưng phải sửa vòng đời transaction trước.

Hai lỗi AI live gần nhất là **500 INTERNAL_ERROR**, chưa phải bằng chứng Gemini
timeout. Đã tái hiện được một nguyên nhân có thể gây đúng dạng lỗi này trên local:
pool một kết nối khiến generation chờ chính kết nối transaction đang giữ và thất
bại trước khi gọi AI. Chưa xác định chính xác stack của hai request live.

## Bằng chứng live và giới hạn

Railway serving deployment `e66cbbb0-0e0b-40ba-aa0b-f1fa455e38a3`, commit
`e82c269c7f04c5b9e364ceb39847581b98f9bc3f`, region `sfo`. Local HEAD
`d1b963023f77c41b992bafae5bca9d1256d4d041`; diff các thư mục Invitation Studio,
AI, Storage và booking-boundary với serving commit rỗng. Không suy rằng toàn bộ
workspace bằng deployment. Frontend dưới đây là kiểm tra source local, có đối
chiếu audit browser ngày 19/10; không phải xác nhận lại frontend serving source.

[Receipt đã lược dữ liệu riêng tư](../tasks/evidence/invitation-print-latency-audit-2026-10-20.json)
giữ request IDs và route templates. Thời gian bảng dưới là HTTP proxy Railway,
không phải thời gian click đến khi UI dùng được. Mẫu gần đây có giới hạn 500 mỗi
stream, công cụ trả 501; không dùng làm tổng số request hay p95.

| API                                   | Kết quả quan sát                       |
| ------------------------------------- | -------------------------------------- |
| GET invitations                       | 3 lượt 200: 4.925 / 4.834 / 4.385 giây |
| GET print-orders, Couple              | 3 lượt 200: 3.313 / 3.208 / 2.647 giây |
| POST invitation-image-generations     | 2 lượt 500: 15.334 / 16.351 giây       |
| GET contracts, lượt mở thiệp mới nhất | Handler 3.699 giây                     |
| GET contract-appendices, cùng lượt    | Handler 4.880 giây                     |

Hai lỗi AI có request IDs `e28d54c7-cc00-4bfb-ad8d-7891029847ad` và
`824f5091-0733-4fda-943e-feff71f70931`. Log unexpected error chỉ ghi `errorName=Error`;
không có message/stack hay phase để kết luận provider đã được gọi hay chưa.

Railway connector chỉ cho đọc **tên** biến môi trường, giá trị bị che. Pool/deadline
đang chạy chưa được xác minh về số. Bằng chứng PERF-07 ngày 18/10 từng ghi pool
mặc định 1 và acquisition timeout 10 giây, nhưng đó là cấu hình lịch sử. Không
khẳng định cấu hình này còn nguyên ở deployment hiện tại.

Audit browser ngày 19/10 từng đo trang thiệp có API window 12.71–16.10 giây và
invitations handler 4.85 giây. Đây là bằng chứng lịch sử riêng, không cộng vào
các số đo mới hoặc coi là p95 hiện tại.

## Nguyên nhân trong source

### Frontend: nhiều tầng chờ và tải sai thời điểm

- `invitations-page.tsx`: restore phiên, authorize rồi `Promise.all` designs/orders;
  chỉ mount Studio khi cả hai xong. Đơn in chậm/lỗi chặn cả tab thiết kế.
- `session.ts`: restore chỉ chia sẻ thao tác đang chạy, không tái sử dụng snapshot
  authenticated sau khi restore hoàn tất; lời gọi restore từ trang thiệp có thể
  thêm refresh/me. Cần dùng session/workspace chung và giữ xử lý hết hạn/revocation.
- `invitation-studio-view.tsx`: effect tải nguồn in hợp đồng ngay khi mount, không
  phụ thuộc tab print. Gateway tải cả contracts/appendices sau tầng designs/orders.
- `invitation-api.ts`: AI là ba request nối tiếp: generate -> derive -> preview.
  Khi generate thành công nhưng derive/preview lỗi, cần giữ kết quả đã có để retry
  đúng bước; không diễn giải toàn bộ thao tác thành generation thất bại.

### Backend đọc: chưa hết round-trip và N+1

- `design.service.ts:list`: đã batch heads/revisions; **không còn N+1 theo design**.
  Tuy nhiên kiểm tra quyền booking trước/sau mỗi lần đi qua resolver, booking access,
  confirmed event, settlement/timeline. Đây là ứng viên nhiều round-trip; cần trace
  phase/query hiện tại trước khi gán số giây cho từng thành phần. Không bỏ kiểm tra
  quyền cuối response để lấy số đo nhanh.
- `print-order.service.ts:listPrintOrders` (Couple): vòng lặp tuần tự đọc lines,
  current commercial revision và pending proposal cho từng order. Số query tăng
  theo số đơn. `listManagementPrintOrders` đã batch; PERF-07/test quản lý không chứng
  minh route Couple đã được tối ưu. Dùng lại nguyên tắc batch và ownership checks,
  kiểm chứng riêng route Couple và cursor.

### AI và ảnh: vòng đời transaction là điểm phải sửa trước

`StudioRepository.command` mở `boundary.run`, giữ transaction và exclusive advisory
lock theo booking. Trong callback, `GenerationService.generate` dùng root Prisma
để đọc/ghi durable intent rồi gọi Gemini và upload ảnh. Root Prisma không dùng
connection `tx`; pool chỉ có một connection sẽ không cấp được connection thứ hai.
Các durable journal này có mục đích bảo vệ unknown provider effect qua rollback,
không được đổi hết sang `tx` vì sẽ mất bằng chứng khi rollback.

`DerivedAssetsService.derive` cũng giữ transaction khi download, Sharp resize,
upload và truy cập durable attempt qua root Prisma. Tăng thời gian provider sẽ kéo
dài thời gian giữ connection/booking lock và có thể làm các request khác chậm hơn.
Prisma cũng khuyến nghị tránh network request trong interactive transaction:
[Prisma 7 transactions](https://docs.prisma.io/docs/orm/v7/prisma-client/queries/transactions).

Repro trên PostgreSQL local, database mới có tên ngẫu nhiên và được xóa sau test,
AI/Storage đều controlled, acquisition timeout cố định 1000 ms:

| Pool | Kết quả                                                | Provider calls |
| ---- | ------------------------------------------------------ | -------------: |
| 1    | Lỗi `timeout exceeded when trying to connect`, 1245 ms |              0 |
| 2    | Thành công, 368 ms                                     |              1 |

Script và receipt: `output/invitation-latency-audit-20261020/pool-repro.test.ts` và
`pool-repro.json`. Một test pass. Đây là chứng minh cơ chế lỗi trong code hiện tại,
không phải benchmark live, bằng chứng provider thật, hay đề xuất tăng pool production.

### PDF: ứng viên tối ưu riêng, chưa có mẫu live mới

`PrintFileService.read` tải tối đa 8 asset tuần tự, render lại PDF mỗi lần, rồi chạy
lại load/authorization. Tám lượt Storage chậm có thể vượt ngân sách toàn request.
Storage I/O đã nằm ngoài transaction; không gán vấn đề giữ transaction của AI cho
toàn bộ luồng PDF. Hai lần load snapshot vẫn dùng exclusive boundary; cần xem xét
read scope phù hợp và giữ kiểm tra quyền sau I/O.

## Timeout hiện tại trong source

| Tầng                         | Giá trị / phạm vi                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------- |
| wedding-web API client       | Mặc định 10 giây mỗi request; Studio chưa chọn client riêng cho AI                |
| Invitation runtime -> Gemini | Override cứng 10 giây                                                             |
| Gemini adapter               | Default 30 giây nhưng runtime override; validator tối đa 60 giây                  |
| Backend HTTP                 | Default 30 giây, biến cấu hình cho phép tối đa 120 giây; live value chưa đọc được |
| Booking boundary transaction | 30 giây; maxWait 10 giây                                                          |
| Storage adapter              | Default 10 giây mỗi operation, không phải toàn bộ generate/derive/PDF             |

SDK Gemini tính timeout theo milliseconds:
[Google GenAI HttpOptions](https://googleapis.github.io/js-genai/release_docs/interfaces/types.HttpOptions.html).
Một browser request bị hủy không chứng minh effect AI phía provider bị hủy.

## Phương án triển khai theo thứ tự

Giữ canonical tasks ở `wedding-web/tasks/plan.md` và `tasks/todo.md`;
báo cáo này không mở checklist hoàn thành song song.

1. **Frontend — WEB-FE-12/13:** reuse session, mount design theo dữ liệu cần thiết;
   chỉ tải orders và commercial sources khi mở tab print. Loading/error/retry riêng
   từng tab; coalesce read theo actor/session + booking + params, hủy hoặc loại
   response cũ khi đổi booking. Không cache authority bằng dữ liệu UI.
   Lỗi tải nguồn hợp đồng phải hiện trạng thái chưa xác định và cho retry, không
   coi lỗi/timeout là không có hợp đồng rồi fallback đơn tính phí riêng.
2. **Backend — WEB-BE-06/09:** trước tiên thêm phase timing đã redaction cho
   auth/booking, pool acquisition, intent, provider, decode, upload và acceptance;
   chuẩn hóa lỗi pool/transaction/provider để log phân biệt được với INTERNAL_ERROR.
   Batch route Couple lines/current revisions/proposals, giữ cursor, source revision,
   ownership và integer VND. Trace rồi gộp projection quyền/booking/timeline nếu
   giảm round-trip mà vẫn đảm bảo authority/revocation/consistency.
3. **AI/derive:** tách thành claim + validate + persist durable intent trong
   transaction ngắn; thả connection/lock; chạy provider/Storage/Sharp ngoài transaction;
   acceptance transaction ngắn reauthorize, kiểm tra revision/cutoff/quota rồi commit.
   Quota cần reservation để hai generation đồng thời không vượt giới hạn. Dùng claim
   token/fencing và recovery để worker cũ không commit sau worker mới. UNKNOWN không
   tự retry mua ảnh mới. Durable intent không được rollback cùng acceptance.
4. **Timeout AI riêng:** sau bước 3, có thể khởi đầu provider **60 giây**, endpoint
   AI **90 giây**, client AI **100 giây**; kiểm tra giới hạn proxy/deployment trước
   khi áp dụng. Đây là ngân sách đề xuất, chưa phải giá trị đã rollout hoặc đủ cho
   mọi model. Deadline endpoint phải được chọn tại middleware trước route, không
   chỉ sửa handler vì deadline toàn cục đã được cài trước. Không tăng timeout chung
   cho API đọc và không tăng transaction lên 90 giây. Derive/preview có trạng thái
   và ngân sách riêng; 100 giây không phải giới hạn tổng của ba bước.
5. **Nếu generation thường vượt 60 giây:** dùng durable job, trả `202 + jobId`,
   endpoint status có quyền cho owning Couple và polling có backoff. Worker có timeout
   riêng theo model/p95 đo được; HTTP submit/status giữ ngắn. Đây là thay đổi contract
   mới cần schema/OpenAPI/tests; GET generation hiện tại chỉ là danh sách pending của
   Manager, không được tái dùng tùy tiện làm status API cho Couple.
6. **PDF nếu trace xác nhận chậm:** fetch asset với concurrency giới hạn 2–3, giữ
   tổng byte/checksum caps; cache file bất biến theo printable content digest + asset
   checksums + renderer/font version, single-flight theo key. Mỗi lần download vẫn
   kiểm tra quyền hiện tại; không public-cache private draft hoặc bỏ unpublication.

## Kiểm chứng trước khi kết luận đã cải thiện

- Test pool 1, concurrency, transaction rollback, unknown provider effect và replay
  cùng key không mua ảnh hai lần; revoke/cutoff/quota thay đổi trong lúc AI chờ.
- Route Couple với 0/1/3/20 đơn, current/pending revisions và cursor; chứng minh query
  count không tăng theo page size. Giữ contract-linked fulfillment không thu tiền lại.
- Controlled AI delay 15/45/60 giây, lỗi Storage, browser disconnect/reload và refresh
  token; UI tiếp tục đúng bước, không gửi lại paid generation khi outcome chưa biết.
- Đo trước/sau cùng cohort và serving versions: số request/tầng tải, click -> design
  usable, route p50/p95, pool/lock/provider phases. Mục tiêu ban đầu đề xuất cho list
  reads là p95 dưới 2 giây và design usable dưới 3 giây với phiên còn hạn trên cùng
  môi trường đo; đây là mục tiêu cần xác nhận bằng cohort, không phải SLA đã đạt.
- Thứ tự nghiệm thu theo owner: frontend -> backend -> direct deployed browser E2E.
  Không coi khảo sát log và test local hiện tại là E2E đã qua. Live paid generation
  cần fixture/provider scope được cấp quyền riêng; audit này không thực hiện.

## Kiểm tra tài liệu và repro

Runtime source, schema, migrations và cấu hình live không thay đổi. Repro chạy bằng
Node 24.21.0/Vitest trong cấu hình riêng dưới output để không đổi suite chính.
Lần chạy đầu không tìm được test vì suite chính chỉ include src/tests; sau đó dùng
config output riêng, kết quả 1/1 pass. Driver có deprecation warning client.query
concurrency từ luồng hiện tại; không giấu hoặc coi warning là nguyên nhân live.
Chỉ format/check tài liệu, receipt và diagnostic files của khảo sát; không chạy
full acceptance suite vì chưa có bản sửa runtime.
