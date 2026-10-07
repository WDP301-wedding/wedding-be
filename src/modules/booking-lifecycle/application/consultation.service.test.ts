import { describe, expect, it } from 'vitest';

import type { ProposalSnapshot } from '../domain/booking-policy.js';
import {
  createConsultationService,
  type BookingIdentityPort,
  type ConsultationRecord,
  type ConsultationRepository,
  type InvitationIntent,
  type ProposalCatalogPort,
} from './consultation.service.js';

class FakeConsultationRepository implements ConsultationRepository {
  readonly consultations = new Map<string, ConsultationRecord>();
  readonly intents = new Map<string, InvitationIntent>();

  create(record: ConsultationRecord): Promise<ConsultationRecord> {
    this.consultations.set(record.consultationId, structuredClone(record));
    return Promise.resolve(record);
  }

  getInvitationRecipient(): Promise<Readonly<{ intendedEmail: string }>> {
    return Promise.resolve({ intendedEmail: 'couple@example.com' });
  }

  getOrCreateInvitationIntent(input: InvitationIntent): Promise<InvitationIntent> {
    const current = this.intents.get(input.consultationId);
    if (current !== undefined) return Promise.resolve(current);
    this.intents.set(input.consultationId, structuredClone(input));
    return Promise.resolve(input);
  }

  markInvitationIssued(consultationId: string, invitationId: string): Promise<InvitationIntent> {
    const current = this.intents.get(consultationId);
    if (current === undefined) throw new Error('Missing intent.');
    const issued = { ...current, status: 'ISSUED' as const, invitationId };
    this.intents.set(consultationId, issued);
    return Promise.resolve(issued);
  }
}

const proposal: ProposalSnapshot = Object.freeze({
  hall: Object.freeze({
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Sảnh Ánh Dương',
    description: 'Sảnh tiệc hướng vườn',
    maxGuests: 500,
  }),
  shift: Object.freeze({ code: 'DINNER', startTime: '17:30', endTime: '22:00' }),
  menu: Object.freeze({
    versionId: '00000000-0000-4000-8000-000000000002',
    packageId: '00000000-0000-4000-8000-000000000003',
    versionNumber: 3,
    name: 'Thực đơn Vườn Thu',
    description: 'Thực đơn đã công bố',
    priceVndPerTable: 5_500_000,
  }),
  eventDate: '2026-11-15',
  tableCount: 10,
  planningHeadcount: 320,
  baseChargeVnd: 55_000_000,
  depositAmountVnd: 16_500_000,
});

function createCatalog(): ProposalCatalogPort {
  return {
    resolveProposal: () => Promise.resolve(proposal),
  };
}

describe('ConsultationService', () => {
  it('creates one consultation with a booking-owned immutable proposal snapshot', async () => {
    const repository = new FakeConsultationRepository();
    const ids = ['00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000011'];
    const service = createConsultationService({
      repository,
      catalog: createCatalog(),
      identity: { issueRestrictedWorkspace: () => Promise.reject(new Error('unused')) },
      createId: () => ids.shift() ?? 'unexpected',
    });

    const result = await service.create({
      intendedEmail: 'couple@example.com',
      displayName: 'Minh và An',
      note: null,
      hallId: proposal.hall.id,
      eventDate: proposal.eventDate,
      shiftCode: 'DINNER',
      menuPackageVersionId: proposal.menu.versionId,
      tableCount: 10,
      planningHeadcount: 320,
      managerAccountId: '00000000-0000-4000-8000-000000000012',
      requestId: '00000000-0000-4000-8000-000000000013',
    });

    expect(result.consultationId).toBe('00000000-0000-4000-8000-000000000010');
    expect(result.bookingId).toBe('00000000-0000-4000-8000-000000000011');
    expect(result.revision).toBe(1);
    expect(repository.consultations.get(result.consultationId)?.proposal).toEqual(proposal);
    expect(Object.isFrozen(result.proposal)).toBe(true);
  });

  it('keeps a durable invitation intent after failure and reuses it on retry', async () => {
    const repository = new FakeConsultationRepository();
    const seenIntentIds: string[] = [];
    let attempts = 0;
    const identity: BookingIdentityPort = {
      issueRestrictedWorkspace(input) {
        seenIntentIds.push(input.invitationIntentId);
        attempts += 1;
        if (attempts === 1) return Promise.reject(new Error('provider unavailable'));
        return Promise.resolve({ invitationId: '00000000-0000-4000-8000-000000000020' });
      },
    };
    const service = createConsultationService({
      repository,
      catalog: createCatalog(),
      identity,
      createId: () => '00000000-0000-4000-8000-000000000021',
    });

    const input = {
      consultationId: '00000000-0000-4000-8000-000000000010',
      expectedRevision: 1,
      managerAccountId: '00000000-0000-4000-8000-000000000012',
      requestId: '00000000-0000-4000-8000-000000000013',
    } as const;

    await expect(service.requestWorkspaceInvitation(input)).rejects.toThrow('provider unavailable');
    expect(repository.intents.get(input.consultationId)?.status).toBe('PENDING');

    const issued = await service.requestWorkspaceInvitation(input);
    expect(issued).toEqual({
      invitationId: '00000000-0000-4000-8000-000000000020',
      replayed: false,
    });
    expect(new Set(seenIntentIds)).toEqual(new Set(['00000000-0000-4000-8000-000000000021']));

    await expect(service.requestWorkspaceInvitation(input)).resolves.toEqual({
      invitationId: '00000000-0000-4000-8000-000000000020',
      replayed: true,
    });
    expect(attempts).toBe(2);
  });
});
