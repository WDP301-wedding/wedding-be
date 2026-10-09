import { z } from 'zod';
import { ServiceUnavailableError, ValidationError } from '../../../core/errors/app-error.js';
import type { MediaEventStartReader } from './media-access.guard.js';

/** Consumer projection of baseline21.1/21.2. The provider owns the complete port
 * and must resolve this immutable revision inside its current transaction scope. */
export interface MediaTimelineReader {
  resolveApprovedRevision(
    input: Readonly<{ bookingId: string; timelineRevisionId: string }>,
    context: Readonly<{
      requestId: string;
      causationId: string;
      actorAccountId: string | null;
      authority: 'AUTHENTICATED' | 'SYSTEM';
      transactionScopeId?: string;
    }>,
  ): Promise<
    Readonly<{
      bookingId: string;
      timelineRevisionId: string;
      eventDate: string;
      shiftCode: 'LUNCH' | 'DINNER';
      shiftStartTime: string;
      approvedByManagerAt: string;
      approvedByCoupleAt: string;
      isEffective: boolean;
    }>
  >;
}

const timelineSchema = z.object({
  bookingId: z.uuid(),
  timelineRevisionId: z.uuid(),
  eventDate: z.iso.date(),
  shiftCode: z.enum(['LUNCH', 'DINNER']),
  shiftStartTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u),
  approvedByManagerAt: z.iso.datetime(),
  approvedByCoupleAt: z.iso.datetime(),
  isEffective: z.literal(true),
});

/** Restaurant-local approved start, never today's mutable Venue shift or a guessed
 * LUNCH/DINNER time. UTC+07 is checked against the required IANA restaurant zone. */
export function createMediaEventStartReader(
  reader: MediaTimelineReader | undefined,
): MediaEventStartReader {
  return async (confirmed, request) => {
    if (reader === undefined) throw new ServiceUnavailableError();
    const result = timelineSchema.safeParse(
      await reader.resolveApprovedRevision(
        {
          bookingId: confirmed.bookingId,
          timelineRevisionId: confirmed.effectiveTimelineRevisionId,
        },
        {
          requestId: request.requestId,
          causationId: request.causationId ?? request.requestId,
          actorAccountId: request.actorId,
          authority: 'AUTHENTICATED',
          ...(request.transactionScopeId === undefined
            ? {}
            : { transactionScopeId: request.transactionScopeId }),
        },
      ),
    );
    if (!result.success) throw new ValidationError();
    const snapshot = result.data;
    if (
      snapshot.bookingId !== confirmed.bookingId ||
      snapshot.timelineRevisionId !== confirmed.effectiveTimelineRevisionId ||
      snapshot.eventDate !== confirmed.eventDate ||
      snapshot.shiftCode !== confirmed.shiftCode
    )
      throw new ValidationError();
    const start = new Date(`${snapshot.eventDate}T${snapshot.shiftStartTime}:00+07:00`);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(start);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
    if (
      `${part('year')}-${part('month')}-${part('day')}` !== snapshot.eventDate ||
      `${part('hour')}:${part('minute')}` !== snapshot.shiftStartTime
    )
      throw new ValidationError();
    return start;
  };
}
