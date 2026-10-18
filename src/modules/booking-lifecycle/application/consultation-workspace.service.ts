import { randomUUID } from 'node:crypto';
import { coupleNameSchema } from '../domain/couple-profile.js';

import type { RestaurantShiftCode } from '../../venue-catalog/application/venue.service.js';
import type { ProposalMenuInput, ProposalSnapshot } from '../domain/booking-policy.js';
import type { ProposalCatalogPort } from './consultation.service.js';

export type { ProposalCatalogPort } from './consultation.service.js';

export type ConsultationWorkspaceRecord = Readonly<{
  consultationId: string;
  intendedEmail: string;
  displayName: string;
  brideName?: string | undefined;
  groomName?: string | undefined;
  note: string | null;
  managerAccountId: string;
  revision: number;
  requestId: string;
}>;

export type BookingProposalRecord = Readonly<{
  bookingId: string;
  consultationId: string;
  expectedConsultationRevision: number;
  managerAccountId: string;
  proposal: ProposalSnapshot;
  requestId: string;
}>;

export interface ConsultationWorkspaceRepository {
  createConsultation(record: ConsultationWorkspaceRecord): Promise<ConsultationWorkspaceRecord>;
  createBooking(
    record: BookingProposalRecord,
  ): Promise<
    Readonly<BookingProposalRecord & { bookingRevision: number; consultationRevision: number }>
  >;
}

export function createConsultationWorkspaceService(
  options: Readonly<{
    repository: ConsultationWorkspaceRepository;
    catalog: ProposalCatalogPort;
    createId?: () => string;
  }>,
) {
  const createId = options.createId ?? randomUUID;
  return Object.freeze({
    createConsultation(
      input: Readonly<{
        intendedEmail: string;
        displayName: string;
        brideName?: string | undefined;
        groomName?: string | undefined;
        note: string | null;
        managerAccountId: string;
        requestId: string;
      }>,
    ) {
      return options.repository.createConsultation({
        consultationId: createId(),
        intendedEmail: input.intendedEmail,
        displayName: input.displayName,
        ...(input.brideName === undefined
          ? {}
          : { brideName: coupleNameSchema.parse(input.brideName) }),
        ...(input.groomName === undefined
          ? {}
          : { groomName: coupleNameSchema.parse(input.groomName) }),
        note: input.note,
        managerAccountId: input.managerAccountId,
        revision: 1,
        requestId: input.requestId,
      });
    },

    async createBooking(
      input: ProposalMenuInput &
        Readonly<{
          consultationId: string;
          hallId: string;
          eventDate: string;
          shiftCode: RestaurantShiftCode;
          planningHeadcount: number;
          expectedRevision: number;
          managerAccountId: string;
          requestId: string;
        }>,
    ) {
      const proposal = await options.catalog.resolveProposal({
        hallId: input.hallId,
        eventDate: input.eventDate,
        shiftCode: input.shiftCode,
        menuPackageVersionId: input.menuPackageVersionId,
        tableCount: input.tableCount,
        menus: input.menus,
        planningHeadcount: input.planningHeadcount,
      });
      return options.repository.createBooking({
        bookingId: createId(),
        consultationId: input.consultationId,
        expectedConsultationRevision: input.expectedRevision,
        managerAccountId: input.managerAccountId,
        proposal,
        requestId: input.requestId,
      });
    },
  });
}
