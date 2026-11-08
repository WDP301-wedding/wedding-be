import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';

/** Historical storage/readers remain; these product operations are no longer offered. */
export const retiredGuestOperation: RequestHandler = (_req, res) => {
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  throw new AppError({
    status: 410,
    code: 'FEATURE_RETIRED',
    message: 'Danh sách khách mời và check-in đã ngừng sử dụng. Vui lòng cập nhật ứng dụng.',
  });
};

export function isRetiredGuestPath(path: string) {
  return (
    /^\/bookings\/[^/]+\/(?:guests(?:\/|$)|check-in-settings(?:\/|$))/u.test(path) ||
    /^\/staff\/events\/[^/]+\/guests(?:\/|$)/u.test(path)
  );
}
