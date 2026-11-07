# Tài liệu Bàn giao Kỹ thuật & Nghiệp vụ: Tasks 8, 9, 10
**Dự án:** Wedding Management System  
**Nhánh Git:** `feature/tasks-8-9-10`  
**Ngày hoàn thiện:** 07/11/2026  
**Phạm vi:** Cả 3 repository (`wedding-be`, `wedding-manage-web`, `wedding-web`)

---

## 1. Tổng quan các nhiệm vụ đã thực hiện

| Task | Tên nhiệm vụ | Phạm vi | Mô tả ngắn |
| :--- | :--- | :--- | :--- |
| **Task 8** | **Admin Dashboard Analytics & Debt Tracking** | BE + Manage FE | Thống kê doanh thu theo sảnh (`hallRevenues`), xếp hạng thực đơn đặt nhiều nhất (`menuPopularity`), phân loại công nợ tiệc (`paidVnd`, `outstandingVnd`, `paymentStatus`) kèm bộ lọc server-side (`ALL`, `PAID`, `DEBT`). |
| **Task 9** | **Market Pricing & Price Guarantee (+5%)** | BE + Couple FE + Manage FE | Chính sách thực đơn theo thời giá thị trường; tùy chọn mua gói phí bảo đảm giá (+5% chi phí thực đơn) để chốt cứng 100% đơn giá hợp đồng, kèm huy hiệu `[Đã bảo đảm giá]` trên web và PDF. |
| **Task 10** | **Configurable Deposit Rate (10% - 100%)** | BE + Manage FE + Couple FE | Chuẩn hóa catalog nhà hàng, cho phép Quản lý tùy chỉnh tỉ lệ cọc từ 10% đến 100% (mặc định 30%), tính toán cọc động `contractDeposit(total, depositRate)` không còn bị hardcode 30%. |

---

## 2. Chi tiết triển khai Task 8: Admin Dashboard

### 2.1. Doanh thu theo từng sảnh tiệc (`hallRevenues`)
- **Backend (`src/modules/analytics-dashboard`)**:
  - `analytics.service.ts`: Thu thập các tiệc có hợp đồng (`effectiveAgreedTotalVnd` hoặc `originalContractTotalVnd`), gom nhóm theo `hallId`, tính tổng doanh thu và sắp xếp giảm dần.
  - `analytics.schemas.ts`: Bổ sung `hallRevenueSchema` (`hallId`, `hallName`, `revenueVnd`, `bookingCount`) vào `analyticsOverviewSchema`.
- **Frontend Quản lý (`src/features/identity-access`)**:
  - `dashboard-analytics-extra.tsx`: Render bảng xếp hạng doanh thu từng sảnh kèm thanh tỷ trọng % trực quan, hiển thị doanh thu định dạng VND chuẩn.

### 2.2. Phân loại công nợ & Trạng thái thanh toán
- **Backend (`src/modules/booking-lifecycle/http/booking-navigation.router.ts`)**:
  - Đối soát sổ cái `billingLedgerEntry` (PAYMENT, REFUND, CHARGE) cùng giá trị hợp đồng.
  - Tính toán các trường:
    - `paidVnd`: Số tiền ròng khách đã trả.
    - `outstandingVnd`: Số tiền nợ còn lại (`contractTotal - paidVnd`).
    - `paymentStatus`: `PAID` (đã trả hết), `DEBT` (đang nợ), `AWAITING_DEPOSIT` (chờ cọc), `DRAFT` (chưa cọc).
  - Hỗ trợ query filter `q.paymentStatus` (`ALL`, `PAID`, `DEBT`) phân trang chuẩn qua `bounds()`.
- **Frontend Quản lý (`src/features/identity-access`)**:
  - `dashboard-bookings-table.tsx`: Hiển thị Badge trạng thái thanh toán + số tiền nợ đỏ nổi bật nếu có.
  - `dashboard-bookings-toolbar.tsx` & `use-dashboard-bookings.ts`: Bộ lọc dropdown lọc tiệc theo trạng thái thanh toán, kết nối trực tiếp với API backend.

### 2.3. Top thực đơn được đặt nhiều nhất (`menuPopularity`)
- **Backend**: `analytics.service.ts` thống kê số lượng tiệc và số lượng bàn chọn từng gói thực đơn.
- **Frontend**: Hiển thị thẻ vinh danh Top 1 thực đơn được yêu thích nhất kèm số tiệc và số bàn thực tế.

---

## 3. Chi tiết triển khai Task 9: Thời giá & Bảo đảm giá thực đơn (+5%)

### 3.1. Bài toán nghiệp vụ & Cơ chế hoạt động
- **Vấn đề:** Tiệc cưới thường đặt trước từ 6–11 tháng. Nguyên liệu thực phẩm (hải sản tươi sống, thịt, v.v.) biến động mạnh theo thị trường.
- **Giải pháp:**
  - *Mặc định:* Thực đơn áp dụng theo thời giá thị trường tại ngày tổ chức tiệc.
  - *Gói bảo đảm giá:* Khách hàng có thể chọn đăng ký **Gói phí bảo đảm giá thực đơn (+5% chi phí menu)**. Đổi lại, đơn giá thực đơn trong hợp đồng gốc được **khóa cố định 100% (locked)**, không thay đổi bất kể biến động giá.

### 3.2. Xử lý các tình huống biên (Edge Cases)
1. **Khách đặt 30 bàn (có bảo đảm giá), sau đó phát sinh thêm 5 bàn:**
   - *Nếu báo trước ngày cưới (qua Phụ lục hợp đồng):*
     - Nếu giá thị trường giảm: Khách chọn mua 5 bàn phát sinh theo giá giảm mới (không bị ép mua giá cũ cao hơn ➔ **khách không bao giờ bị lỗ**).
     - Nếu giá thị trường tăng: Khách có thể mua thêm 5% phí bảo đảm giá cho 5 bàn phát sinh để được giữ đơn giá cũ của hợp đồng gốc.
   - *Nếu phát sinh đột xuất tại tiệc cưới:*
     - 02 bàn đầu tiên mở từ chính sách **Bàn dự phòng (Reserve Table)** theo Điều 4 của Hợp đồng chuẩn.
     - 03 bàn còn lại tính theo thời giá thực tế tại ngày cưới, quản lý thỏa thuận trước với khách và đối soát ở **Hóa đơn quyết toán cuối (Final Invoice)**.

### 3.3. Kỹ thuật triển khai trong Source Code
- **Backend (`wedding-be`)**:
  - `commercial-contract.ts`: Thêm `priceGuarantee: z.boolean().optional()` vào `contractLineSchema` và `priceGuaranteed: boolean` vào `contractDocumentSchema`.
  - `commercial-selection-workflow.ts` & `commercial-contract.service.ts`: Nhận diện dòng phí bảo đảm giá, tự động bật cờ `priceGuarantee: true` cho tất cả line item thuộc `MENU`.
  - `contract-pdf.renderer.ts`: Render huy hiệu `[Đã bảo đảm giá]` vào file PDF hợp đồng in ấn.
- **Frontend Cặp đôi (`wedding-web`)**:
  - `customer-selections.tsx`: Thẻ `PriceGuaranteeCard` tự động tính 5% dựa trên số bàn thực đơn được chọn; `useEffect` tự động sync số lượng hoặc hủy chọn nếu khách xóa thực đơn.
  - `contract-lines-table.tsx`: Hiển thị huy hiệu `Đã bảo đảm giá` (xanh) hoặc cảnh báo `Theo thời giá` (cam kèm tooltip giải thích).
- **Frontend Quản lý (`wedding-manage-web`)**:
  - `contract-lines-table.tsx`: Hiển thị badge tổng và badge từng món để thu ngân / quản lý nắm rõ tình trạng khóa giá khi phục vụ tiệc.

---

## 4. Chi tiết triển khai Task 10: Tỉ lệ đặt cọc linh hoạt (10% - 100%)

### 4.1. Nghiệp vụ & Yêu cầu
- Cho phép Quản lý nhà hàng cấu hình tỉ lệ cọc linh hoạt từ 10% đến 100% thay vì gán cứng 30%.
- Toàn bộ công thức tính cọc, hiển thị hợp đồng, xác thực tài chính và render PDF phải tuân thủ tỉ lệ động này.

### 4.2. Kỹ thuật triển khai trong Source Code
- **Backend (`wedding-be`)**:
  - `venue-catalog.schemas.ts`: Thêm `depositPercentage: z.number().int().min(10).max(100).optional()` vào `updateRestaurantBodySchema`.
  - `venue.service.ts`: Lưu trữ tỉ lệ cọc vào tag `<!--DEPOSIT_RATE:XX-->` trong mô tả hồ sơ nhà hàng; hàm `toRestaurantView` bóc tách ra trường `depositPercentage`.
  - `commercial-contract.service.ts`: Đọc tỉ lệ cọc của nhà hàng (mặc định 30% nếu chưa đặt), tính `contractDeposit(total, depositRate)`, ghi nhận `depositRate` vào hợp đồng.
  - `contract-financial.reader.ts`: Sửa lỗi từ chối duyệt hợp đồng cũ bằng cách truyền `document.depositRate ?? 30` vào hàm kiểm tra cọc.
  - `contract-pdf.renderer.ts`: Thay thế toàn bộ chữ `(30%)` hardcode ở Điều 5.1 và phần cam kết cọc thành dynamic: `Tiền đặt cọc cam kết (${depositPct}%): ...`.
- **Frontend Quản lý (`wedding-manage-web`)**:
  - `catalog-forms.tsx`: Bổ sung ô nhập "Tỉ lệ đặt cọc yêu cầu (%)" (min 10, max 100, default 30).
  - `catalog-api.ts`: Truyền trường `depositPercentage` trong body cập nhật hồ sơ nhà hàng.
  - `contract-panel.tsx`: Hiển thị tỉ lệ phần trăm cọc tính theo `(depositAmountVnd / contractTotalVnd) * 100%`.
- **Frontend Cặp đôi (`wedding-web`)**:
  - `contract-details-view.tsx`: Hiển thị tỉ lệ cọc động: `Tiền cọc (${depositRate}%, làm tròn lên)`.

---

## 5. Danh sách File thay đổi (Git Diff Summary)

### Repository: `wedding-be` (Nhánh: `feature/tasks-8-9-10`)
1. `openapi/openapi.json` & `openapi/openapi.sha256`: Đồng bộ API schema chuẩn hóa.
2. `src/modules/analytics-dashboard/application/analytics.service.ts`: Thêm tính toán `hallRevenues`.
3. `src/modules/analytics-dashboard/http/analytics.schemas.ts`: Schema `hallRevenueSchema`.
4. `src/modules/booking-lifecycle/application/commercial-contract.service.ts`: Dynamic deposit & cờ price guarantee.
5. `src/modules/booking-lifecycle/application/commercial-selection-workflow.ts`: Gắn `priceGuarantee: true` vào MENU.
6. `src/modules/booking-lifecycle/domain/commercial-contract.ts`: Mở rộng schema hợp đồng.
7. `src/modules/booking-lifecycle/http/booking-navigation.router.ts`: Trả về `paidVnd`, `outstandingVnd`, lọc `paymentStatus`.
8. `src/modules/booking-lifecycle/http/booking-navigation.schemas.ts`: Định nghĩa schema cho payment tracking.
9. `src/modules/booking-lifecycle/infrastructure/contract-financial.reader.ts`: Sửa xác thực cọc động.
10. `src/modules/booking-lifecycle/infrastructure/contract-pdf.renderer.ts`: Dynamic deposit % và huy hiệu PDF.
11. `src/modules/venue-catalog/application/venue.service.ts`: Lưu trữ & trích xuất `depositPercentage`.
12. `src/modules/venue-catalog/http/venue-catalog.openapi.ts` & `venue-catalog.schemas.ts`: Bổ sung trường deposit vào schema.

### Repository: `wedding-manage-web` (Nhánh: `feature/tasks-8-9-10`)
1. `src/features/identity-access/dashboard-analytics-extra.tsx` *(New)*: Khối thống kê doanh thu sảnh & top thực đơn.
2. `src/features/identity-access/dashboard-live.tsx`: Nhúng khối thống kê analytics mở rộng.
3. `src/features/identity-access/dashboard-bookings-table.tsx`: Badge công nợ & số tiền còn nợ.
4. `src/features/identity-access/dashboard-bookings-toolbar.tsx`: Bộ lọc trạng thái thanh toán.
5. `src/features/identity-access/use-dashboard-bookings.ts`: Query param `paymentStatus`.
6. `src/features/venue-catalog/catalog-forms.tsx`: Form cấu hình tỉ lệ tiền cọc (10%-100%).
7. `src/features/venue-catalog/catalog-api.ts` & `catalog-types.ts`: Kết nối API cấu hình cọc.
8. `src/features/booking-lifecycle/contract-lines-table.tsx` & `contract-panel.tsx`: Hiển thị badge bảo đảm giá và tỉ lệ cọc động.

### Repository: `wedding-web` (Nhánh: `feature/tasks-8-9-10`)
1. `src/features/commercial-contract/customer-selections.tsx`: Thẻ `PriceGuaranteeCard` tự tính 5% và auto-sync.
2. `src/features/commercial-contract/contract-lines-table.tsx`: Badge `Đã bảo đảm giá` / `Theo thời giá`.
3. `src/features/commercial-contract/contract-details-view.tsx`: Hiển thị % tiền cọc động.

---

## 6. Trạng thái Kiểm thử & Pull Request

- **Typecheck (TypeScript):** Pass 100% không có bất kỳ lỗi nào (`tsc --noEmit`).
- **OpenAPI Drift:** 0 drift (`npm run api:check`).
- **Unit Tests liên quan:** 100% pass (44/44 backend, 8/8 manage, 3/3 web).
- **Pull Request Links:**
  - Backend: [https://github.com/WDP301-wedding/wedding-be/pull/new/feature/tasks-8-9-10](https://github.com/WDP301-wedding/wedding-be/pull/new/feature/tasks-8-9-10)
  - Manage Web: [https://github.com/WDP301-wedding/wedding-manage-web/pull/new/feature/tasks-8-9-10](https://github.com/WDP301-wedding/wedding-manage-web/pull/new/feature/tasks-8-9-10)
  - Web: [https://github.com/WDP301-wedding/wedding-web/pull/new/feature/tasks-8-9-10](https://github.com/WDP301-wedding/wedding-web/pull/new/feature/tasks-8-9-10)
