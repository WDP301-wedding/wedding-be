import { AppError } from '../../../core/errors/app-error.js';
import type { AttendanceSnapshot } from '../../staff-operations/application/attendance-readers.js';

export function sumVnd(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isSafeInteger(value) || !Number.isSafeInteger(total))
      throw new AppError({
        status: 422,
        code: 'ANALYTICS_AMOUNT_OVERFLOW',
        message: 'The aggregate exceeds supported integer VND.',
      });
  }
  return total;
}
export function cashWindow(dateFrom: string, dateTo: string) {
  const from = new Date(`${dateFrom}T00:00:00+07:00`).toISOString();
  const to = new Date(new Date(`${dateTo}T00:00:00+07:00`).getTime() + 86400000).toISOString();
  return { from, to };
}
export function attendanceResult(
  bookingId: string,
  planningHeadcount: number,
  listedGuestCount: number,
  source:
    | Pick<
        AttendanceSnapshot,
        'checkInMode' | 'measurementStatus' | 'checkedInGuestCount' | 'byGuestGroup'
      >
    | undefined,
) {
  return {
    bookingId,
    planningHeadcount,
    listedGuestCount,
    checkInMode: source?.checkInMode ?? 'NONE',
    measurementStatus: source?.measurementStatus ?? 'NOT_RECORDED',
    checkedInGuestCount:
      source?.checkedInGuestCount ?? (source?.checkInMode === 'BY_GUEST_NAME' ? 0 : null),
    byGuestGroup: source?.byGuestGroup ?? [],
  };
}
