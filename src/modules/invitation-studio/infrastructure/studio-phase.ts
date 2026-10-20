import { AppError, ServiceUnavailableError } from '../../../core/errors/app-error.js';
import { currentRequestDeadline, remainingReadTime } from '../../../core/http/request-deadline.js';
import type { MediaRequestContext } from '../application/media.contracts.js';
import { databaseDiagnosticsSnapshot } from '../../../core/database/diagnostics.js';

type Operation = 'ai.generate' | 'asset.derive' | 'design.list' | 'print.list';
type Phase =
  | 'authorization'
  | 'claim'
  | 'read'
  | 'page'
  | 'revisions'
  | 'provider'
  | 'decode'
  | 'journal'
  | 'upload'
  | 'acceptance'
  | 'release';

export function requireActiveStudioRequest(): void {
  const deadline = currentRequestDeadline();
  if (deadline) remainingReadTime(deadline);
}

export function studioErrorKind(error: unknown): string {
  if (error instanceof AppError) return error.code;
  const e = error as { code?: unknown; message?: unknown } | null;
  if (
    e?.code === 'P2024' ||
    (typeof e?.message === 'string' &&
      /timeout exceeded when trying to connect|Connection terminated due to connection timeout/u.test(
        e.message,
      ))
  )
    return 'database_acquisition';
  if (e?.code === 'P2028') return 'database_transaction';
  return 'unexpected';
}

export async function studioPhase<T>(
  context: MediaRequestContext,
  operation: Operation,
  phase: Phase,
  work: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  const before = databaseDiagnosticsSnapshot();
  let errorKind: string | undefined;
  try {
    return await work();
  } catch (error) {
    errorKind = studioErrorKind(error);
    if (errorKind === 'database_acquisition' || errorKind === 'database_transaction')
      throw new ServiceUnavailableError();
    throw error;
  } finally {
    const after = databaseDiagnosticsSnapshot();
    const database =
      before && after
        ? {
            queries: after.queries - before.queries,
            acquires: after.acquires - before.acquires,
            acquireMs: after.acquireMs - before.acquireMs,
            queryRoundTripMs: after.queryRoundTripMs - before.queryRoundTripMs,
            lockRoundTripMs: after.lockRoundTripMs - before.lockRoundTripMs,
            errors: after.errors - before.errors,
          }
        : undefined;
    const fields = {
      event: 'invitation_studio_phase',
      module: 'invitation-studio',
      entryPoint: 'http',
      requestId: context.requestId,
      operation,
      phase,
      durationMs: Math.round((performance.now() - started) * 1000) / 1000,
      outcome: errorKind ? 'error' : 'success',
      ...(errorKind ? { errorKind } : {}),
      ...(database ? { database } : {}),
    };
    // Allowlist only: no prompt, bytes, bearer, actor/booking ID or provider exception text.
    if (errorKind) context.logger?.warn(fields, 'Invitation phase completed');
    else context.logger?.info(fields, 'Invitation phase completed');
  }
}
