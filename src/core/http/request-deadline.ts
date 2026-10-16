import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import { RequestTimeoutError } from '../errors/app-error.js';

export interface RequestDeadline {
  readonly expiresAt: number;
  readonly signal: AbortSignal;
}
const deadlines = new AsyncLocalStorage<RequestDeadline>();
export const withRequestDeadline = <T>(deadline: RequestDeadline, work: () => T): T =>
  deadlines.run(deadline, work);
export const currentRequestDeadline = (): RequestDeadline | undefined => deadlines.getStore();
export function remainingReadTime(deadline: RequestDeadline): number {
  const remaining = Math.floor(deadline.expiresAt - performance.now());
  if (deadline.signal.aborted || remaining < 1) throw new RequestTimeoutError();
  return remaining;
}
