import { AppError } from '../../../core/errors/app-error.js';

export const GUESTS_PER_TABLE = 10;
export type TableCapacityIssue =
  | 'BOOKING_TABLES_INSUFFICIENT'
  | 'BOOKING_LAYOUT_TABLE_LIMIT'
  | 'BOOKING_LAYOUT_UNAVAILABLE'
  | 'BOOKING_HALL_CAPACITY_EXCEEDED';

export function tableCapacityIssue(
  headcount: number,
  tableCount: number,
  maximumTables: number,
  hallMaxGuests: number,
): TableCapacityIssue | null {
  if (headcount > hallMaxGuests) return 'BOOKING_HALL_CAPACITY_EXCEEDED';
  if (headcount > tableCount * GUESTS_PER_TABLE) return 'BOOKING_TABLES_INSUFFICIENT';
  if (maximumTables === 0) return 'BOOKING_LAYOUT_UNAVAILABLE';
  if (tableCount > maximumTables) return 'BOOKING_LAYOUT_TABLE_LIMIT';
  return null;
}

export function requireTableCapacity(
  headcount: number,
  tableCount: number,
  maximumTables: number,
  hallMaxGuests: number,
) {
  const code = tableCapacityIssue(headcount, tableCount, maximumTables, hallMaxGuests);
  if (code === null) return;
  const messages: Record<TableCapacityIssue, string> = {
    BOOKING_TABLES_INSUFFICIENT: `${headcount} khách cần tối thiểu ${Math.ceil(headcount / GUESTS_PER_TABLE)} bàn (tối đa 10 người/bàn). Hiện có ${tableCount} bàn.`,
    BOOKING_LAYOUT_TABLE_LIMIT: `Đang chọn ${tableCount} bàn, nhưng sơ đồ hiện có của sảnh chỉ bố trí tối đa ${maximumTables} bàn.`,
    BOOKING_LAYOUT_UNAVAILABLE:
      'Sảnh chưa có sơ đồ đã xuất bản để bố trí bàn. Hãy bổ sung sơ đồ trước khi chốt.',
    BOOKING_HALL_CAPACITY_EXCEEDED: `Số khách dự kiến vượt sức chứa tối đa ${hallMaxGuests} khách của sảnh.`,
  };
  throw new AppError({ status: 409, code, message: messages[code] });
}
