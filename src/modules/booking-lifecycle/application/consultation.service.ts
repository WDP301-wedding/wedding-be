import { randomUUID } from 'node:crypto';
import { coupleNameSchema } from '../domain/couple-profile.js';
import { AppError } from '../../../core/errors/app-error.js';

import type { RestaurantShiftCode } from '../../venue-catalog/application/venue.service.js';
import type { ProposalMenuInput, ProposalSnapshot } from '../domain/booking-policy.js';

export type ConsultationRecord = Readonly<{
  consultationId: string;
  bookingId: string;
  intendedEmail: string;
  displayName: string;
  brideName?: string | undefined;
  groomName?: string | undefined;
  note: string | null;
  managerAccountId: string;
  revision: number;
  phase: 'DRAFT';
  proposal: ProposalSnapshot;
  requestId: string;
}>;

export type InvitationIntent = Readonly<{
  consultationId: string;
  invitationIntentId: string;
  intendedEmail: string;
  managerAccountId: string;
  expectedRevision: number;
  requestId: string;
  status: 'PENDING' | 'ISSUED';
  invitationId: string | null;
}>;

export interface ConsultationRepository {
  create(record: ConsultationRecord): Promise<ConsultationRecord>;
  getInvitationRecipient(
    consultationId: string,
    managerAccountId: string,
  ): Promise<Readonly<{ intendedEmail: string }>>;
  getOrCreateInvitationIntent(input: InvitationIntent): Promise<InvitationIntent>;
  markInvitationIssued(consultationId: string, invitationId: string): Promise<InvitationIntent>;
}

export interface ProposalCatalogPort {
  resolveProposal(
    input: ProposalMenuInput &
      Readonly<{
        hallId: string;
        eventDate: string;
        shiftCode: RestaurantShiftCode;
        planningHeadcount: number;
      }>,
  ): Promise<ProposalSnapshot>;
}

export interface BookingIdentityPort {
  issueRestrictedWorkspace(
    input: Readonly<{
      invitationIntentId: string;
      consultationId: string;
      recipientEmail: string;
      issuedByAccountId: string;
      requestId: string;
    }>,
  ): Promise<Readonly<{ invitationId: string }>>;
}

export type CreateConsultationInput = ProposalMenuInput &
  Readonly<{
    intendedEmail: string;
    displayName: string;
    brideName?: string | undefined;
    groomName?: string | undefined;
    note: string | null;
    hallId: string;
    eventDate: string;
    shiftCode: RestaurantShiftCode;
    planningHeadcount: number;
    managerAccountId: string;
    requestId: string;
  }>;

export type RequestWorkspaceInvitationInput = Readonly<{
  consultationId: string;
  expectedRevision: number;
  managerAccountId: string;
  requestId: string;
}>;

export interface ConsultationService {
  create(input: CreateConsultationInput): Promise<ConsultationRecord>;
  requestWorkspaceInvitation(
    input: RequestWorkspaceInvitationInput,
  ): Promise<Readonly<{ invitationId: string; replayed: boolean }>>;
}

export function createConsultationService(
  options: Readonly<{
    repository: ConsultationRepository;
    catalog: ProposalCatalogPort;
    identity: BookingIdentityPort;
    createId?: () => string;
  }>,
): ConsultationService {
  const createId = options.createId ?? randomUUID;
  return Object.freeze({
    async create(input: CreateConsultationInput) {
      const proposal = await options.catalog.resolveProposal({
        hallId: input.hallId,
        eventDate: input.eventDate,
        shiftCode: input.shiftCode,
        menuPackageVersionId: input.menuPackageVersionId,
        tableCount: input.tableCount,
        menus: input.menus,
        planningHeadcount: input.planningHeadcount,
      });
      return immutable(
        await options.repository.create({
          consultationId: createId(),
          bookingId: createId(),
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
          phase: 'DRAFT',
          proposal,
          requestId: input.requestId,
        }),
      );
    },

    async requestWorkspaceInvitation(input: RequestWorkspaceInvitationInput) {
      const recipient = await options.repository.getInvitationRecipient(
        input.consultationId,
        input.managerAccountId,
      );
      const intent = await options.repository.getOrCreateInvitationIntent({
        consultationId: input.consultationId,
        invitationIntentId: createId(),
        intendedEmail: recipient.intendedEmail,
        managerAccountId: input.managerAccountId,
        expectedRevision: input.expectedRevision,
        requestId: input.requestId,
        status: 'PENDING',
        invitationId: null,
      });
      if (intent.status === 'ISSUED' && intent.invitationId !== null) {
        return Object.freeze({ invitationId: intent.invitationId, replayed: true });
      }
      const issued = await options.identity
        .issueRestrictedWorkspace({
          invitationIntentId: intent.invitationIntentId,
          consultationId: intent.consultationId,
          recipientEmail: intent.intendedEmail,
          issuedByAccountId: intent.managerAccountId,
          requestId: intent.requestId,
        })
        .catch((cause: unknown) => {
          throw new AppError({
            status: 503,
            code: 'PROVIDER_UNAVAILABLE',
            message: 'Invitation delivery is unavailable; retry this consultation intent.',
            cause,
          });
        });
      await options.repository.markInvitationIssued(intent.consultationId, issued.invitationId);
      return Object.freeze({ invitationId: issued.invitationId, replayed: false });
    },
  });
}

function immutable<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
