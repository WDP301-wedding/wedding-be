# Tài liệu Bàn giao Kỹ thuật & Nghiệp vụ: Tasks 8, 9, 10
**Dự án:** Wedding Management System  
**Nhánh Git:** `feature/tasks-8-9-10`  
**Ngày cập nhật:** 07/11/2026  
**Phạm vi:** Cả 3 repository (`wedding-be`, `wedding-manage-web`, `wedding-web`)

---

## 1. Tổng quan các nhiệm vụ đã thực hiện

| Task | Tên nhiệm vụ | Phạm vi | Mô tả ngắn & Trạng thái |
| :--- | :--- | :--- | :--- |
| **Task 8** | **Admin Dashboard Analytics & Debt Tracking** | BE + Manage FE | **[HOÀN THÀNH - ACTIVE]** Thống kê doanh thu theo sảnh (`hallRevenues`), xếp hạng thực đơn đặt nhiều nhất (`menuPopularity`), phân loại công nợ tiệc (`paidVnd`, `outstandingVnd`, `paymentStatus`) kèm bộ lọc server-side (`ALL`, `PAID`, `DEBT`). |
| **Task 9** | **Price Guarantee Fee** | BE + Couple FE + Manage FE | **[ĐÃ GỠ BỎ THEO THỐNG NHẤT NHÓM]** Đã dọn dẹp sạch toàn bộ logic tính phí bảo đảm giá 5%, không áp dụng huy hiệu thừa trên hợp đồng/PDF, giữ luồng chọn thực đơn và báo giá tiêu chuẩn. |
| **Task 10** | **Configurable Deposit Rate (10% - 100%)** | BE + Manage FE + Couple FE | **[HOÀN THÀNH - ACTIVE]** Chuẩn hóa catalog nhà hàng, cho phép Quản lý tùy chỉnh tỉ lệ cọc từ 10% đến 100% (mặc định 30%), tính toán cọc động `contractDeposit(total, depositRate)` không còn bị hardcode 30%. |

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
  - Xử lý chặn số âm (`Math.max(0, bill.paid)`) tránh lỗi schema validation khi có hoàn tiền giả lập.
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

## 3. Quyết định Task 9: Đã loại bỏ hoàn toàn tính năng Bảo đảm giá
- Theo quyết định thống nhất của nhóm dự án, tính năng phụ phí bảo đảm giá 5% không cần thiết cho quy trình kinh doanh của hệ thống.
- **Dọn dẹp mã nguồn:**
  - Backend: Loại bỏ `priceGuarantee` khỏi `contractLineSchema`, `contractDocumentSchema`, `commercial-contract.service.ts`, `commercial-selection-workflow.ts`, và `contract-pdf.renderer.ts`.
  - Frontend: Gỡ bỏ `PriceGuaranteeCard` và các badge/cảnh báo trên giao diện web cặp đôi và quản lý.
  - Đã cập nhật lại `openapi.json` và `openapi.sha256` đạt chuẩn 0 drift.

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
  - `contract-financial.reader.ts`: Sửa lỗi từ chối duyệt hợp đồng bằng cách truyền `document.depositRate ?? 30` vào hàm kiểm tra cọc.
  - `contract-pdf.renderer.ts`: Thay thế toàn bộ chữ `(30%)` hardcode ở Điều 5.1 và phần cam kết cọc thành dynamic: `const depositPct = document.depositRate ?? 30; text('5.1. Đặt cọc ' + depositPct + '%: ' + money(document.depositAmountVnd), true, 11);`.
- **Frontend Quản lý (`wedding-manage-web`)**:
  - `catalog-forms.tsx`: Bổ sung ô nhập "Tỉ lệ đặt cọc yêu cầu (%)" (min 10, max 100, default 30).
  - `catalog-api.ts`: Truyền trường `depositPercentage` trong body cập nhật hồ sơ nhà hàng.
  - `contract-panel.tsx`: Hiển thị tỉ lệ phần trăm cọc tính theo `(depositAmountVnd / contractTotalVnd) * 100%`.
- **Frontend Cặp đôi (`wedding-web`)**:
  - `contract-details-view.tsx`: Hiển thị tỉ lệ cọc động: `Tiền cọc (${depositRate}%, làm tròn lên)`.

---

## 5. Trạng thái Kiểm thử & Pull Request

- **Typecheck (TypeScript):** Pass 100% không có bất kỳ lỗi nào trên cả 3 repository (`tsc --noEmit`).
- **OpenAPI Drift:** 0 drift (`npm run api:check`).
- **Unit Tests liên quan:** 100% pass (295 tests booking lifecycle, 3/3 dashboard manage, 3/3 contract lines web).
- **Nhánh:** `feature/tasks-8-9-10` trên cả 3 repo đã được push lên origin.
