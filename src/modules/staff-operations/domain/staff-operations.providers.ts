import { NotFoundError } from '../../../core/errors/app-error.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';

export interface StaffEventContext {
  readonly bookingId: string;
  readonly isConfirmed: boolean;
  readonly eventStartTime: Date;
  readonly eventEndTime: Date;
}

export interface HouseholdOperationsInfo {
  readonly invitationHouseholdId: string;
  readonly representativeName: string;
  readonly phoneLast4: string | null;
  readonly expectedAttendees: number;
  readonly guestGroupId: string;
  readonly guestGroupName: string;
  readonly guestGroupColor: string;
  readonly operationalNote: string | null;
}

export interface HouseholdSearchFilter {
  readonly name?: string | undefined;
  readonly phone?: string | undefined;
  readonly cursor?: string | undefined;
  readonly limit: number;
}

export interface SeatingGuidanceGroup {
  readonly guestGroupId: string;
  readonly groupName: string;
  readonly color: string;
  readonly tableLabels: readonly string[];
}

export interface SeatingGuidanceData {
  readonly seatingPlanRevisionId: string | null;
  readonly status: 'DRAFT' | 'CONFIRMED' | 'REQUIRES_REVIEW' | 'ABSENT';
  readonly groups: readonly SeatingGuidanceGroup[];
}

export interface BookingEventReader {
  requireConfirmedEventContext(bookingId: string): Promise<StaffEventContext>;
}

export interface GuestOperationsReader {
  requireHouseholdForOperations(
    bookingId: string,
    householdId: string,
  ): Promise<HouseholdOperationsInfo>;
  searchHouseholds(
    bookingId: string,
    filter: HouseholdSearchFilter,
  ): Promise<{
    readonly items: readonly HouseholdOperationsInfo[];
    readonly nextCursor: string | null;
  }>;
}

export interface SeatingGuidanceProvider {
  getGuidance(bookingId: string): Promise<SeatingGuidanceData>;
}

export interface StaffAccountProvisioner {
  provisionStaffAccount(input: {
    readonly email: string;
    readonly commandKey: string;
  }): Promise<{ readonly accountId: string; readonly setupRequired: boolean }>;
  setStaffOperationalAccess(input: {
    readonly accountId: string;
    readonly enabled: boolean;
    readonly reason: string;
  }): Promise<void>;
}

// ─── Conforming Fakes ────────────────────────────────────────────────────────

const DEFAULT_EVENT_START = new Date(Date.now() - 3600 * 1000);
const DEFAULT_EVENT_END = new Date(Date.now() + 3 * 3600 * 1000);

export class FakeBookingEventReader implements BookingEventReader {
  constructor(
    private readonly validBookingId = '00000000-0000-0000-0000-000000000001',
    private readonly startTime = DEFAULT_EVENT_START,
    private readonly endTime = DEFAULT_EVENT_END,
  ) {}

  requireConfirmedEventContext(bookingId: string): Promise<StaffEventContext> {
    if (bookingId === this.validBookingId) {
      return Promise.resolve({
        bookingId,
        isConfirmed: true,
        eventStartTime: this.startTime,
        eventEndTime: this.endTime,
      });
    }
    return Promise.reject(new NotFoundError());
  }
}

const FAKE_HOUSEHOLDS: readonly HouseholdOperationsInfo[] = Object.freeze([
  Object.freeze({
    invitationHouseholdId: '00000000-0000-0000-0000-000000000101',
    representativeName: 'Nguyễn Văn An',
    phoneLast4: '1234',
    expectedAttendees: 4,
    guestGroupId: '00000000-0000-0000-0000-000000000010',
    guestGroupName: 'Nhà trai',
    guestGroupColor: '#FF0000',
    operationalNote: 'Bàn gần sân khấu',
  }),
  Object.freeze({
    invitationHouseholdId: '00000000-0000-0000-0000-000000000102',
    representativeName: 'Trần Thị Bình',
    phoneLast4: '5678',
    expectedAttendees: 2,
    guestGroupId: '00000000-0000-0000-0000-000000000011',
    guestGroupName: 'Nhà gái',
    guestGroupColor: '#0000FF',
    operationalNote: null,
  }),
]);

export class FakeGuestOperationsReader implements GuestOperationsReader {
  requireHouseholdForOperations(
    bookingId: string,
    householdId: string,
  ): Promise<HouseholdOperationsInfo> {
    void bookingId;
    const found = FAKE_HOUSEHOLDS.find((h) => h.invitationHouseholdId === householdId);
    if (found !== undefined) {
      return Promise.resolve({ ...found });
    }
    return Promise.reject(new NotFoundError());
  }

  searchHouseholds(
    bookingId: string,
    filter: HouseholdSearchFilter,
  ): Promise<{
    readonly items: readonly HouseholdOperationsInfo[];
    readonly nextCursor: string | null;
  }> {
    void bookingId;
    let results = [...FAKE_HOUSEHOLDS];
    if (filter.name !== undefined && filter.name.trim() !== '') {
      const q = filter.name.toLowerCase();
      results = results.filter((h) => h.representativeName.toLowerCase().includes(q));
    }
    if (filter.phone !== undefined && filter.phone.trim() !== '') {
      results = results.filter((h) => h.phoneLast4 === filter.phone);
    }
    const sliced = results.slice(0, filter.limit);
    return Promise.resolve({
      items: sliced,
      nextCursor: results.length > filter.limit ? (sliced.at(-1)?.invitationHouseholdId ?? null) : null,
    });
  }
}

export class FakeSeatingGuidanceProvider implements SeatingGuidanceProvider {
  getGuidance(bookingId: string): Promise<SeatingGuidanceData> {
    void bookingId;
    return Promise.resolve(
      Object.freeze({
        seatingPlanRevisionId: '00000000-0000-0000-0000-000000000201',
        status: 'CONFIRMED' as const,
        groups: Object.freeze([
          Object.freeze({
            guestGroupId: '00000000-0000-0000-0000-000000000010',
            groupName: 'Nhà trai',
            color: '#FF0000',
            tableLabels: Object.freeze(['Bàn 1', 'Bàn 2']),
          }),
          Object.freeze({
            guestGroupId: '00000000-0000-0000-0000-000000000011',
            groupName: 'Nhà gái',
            color: '#0000FF',
            tableLabels: Object.freeze(['Bàn 3', 'Bàn 4']),
          }),
        ]),
      }),
    );
  }
}

export class FakeStaffAccountProvisioner implements StaffAccountProvisioner {
  provisionStaffAccount(input: {
    readonly email: string;
    readonly commandKey: string;
  }): Promise<{ readonly accountId: string; readonly setupRequired: boolean }> {
    void input;
    return Promise.resolve({
      accountId: '00000000-0000-0000-0000-000000000099',
      setupRequired: true,
    });
  }

  setStaffOperationalAccess(input: {
    readonly accountId: string;
    readonly enabled: boolean;
    readonly reason: string;
  }): Promise<void> {
    void input;
    return Promise.resolve();
  }
}

export class PrismaStaffAccountProvisioner implements StaffAccountProvisioner {
  constructor(private readonly prisma: PrismaClient) {}

  async provisionStaffAccount(input: {
    readonly email: string;
    readonly commandKey: string;
  }): Promise<{ readonly accountId: string; readonly setupRequired: boolean }> {
    const emailNormalized = input.email.trim().toLowerCase();
    const existing = await this.prisma.account.findUnique({
      where: { emailNormalized },
      include: {
        roles: true,
        passwordCredential: true,
      },
    });

    if (existing !== null) {
      const hasStaffRole = existing.roles.some((r) => r.role === 'STAFF');
      if (!hasStaffRole) {
        await this.prisma.accountRole.create({
          data: {
            accountId: existing.id,
            role: 'STAFF',
          },
        });
      }
      return {
        accountId: existing.id,
        setupRequired: existing.passwordCredential === null,
      };
    }

    const created = await this.prisma.account.create({
      data: {
        emailNormalized,
        displayEmail: input.email.trim(),
        status: 'ACTIVE',
        roles: {
          create: [{ role: 'STAFF' }],
        },
      },
    });

    return {
      accountId: created.id,
      setupRequired: true,
    };
  }

  async setStaffOperationalAccess(input: {
    readonly accountId: string;
    readonly enabled: boolean;
    readonly reason: string;
  }): Promise<void> {
    if (input.enabled) {
      const existingRole = await this.prisma.accountRole.findUnique({
        where: { accountId_role: { accountId: input.accountId, role: 'STAFF' } },
      });
      if (existingRole === null) {
        await this.prisma.accountRole.create({
          data: {
            accountId: input.accountId,
            role: 'STAFF',
          },
        });
      }
    } else {
      await this.prisma.accountRole.deleteMany({
        where: {
          accountId: input.accountId,
          role: 'STAFF',
        },
      });
      await this.prisma.session.updateMany({
        where: {
          accountId: input.accountId,
          status: 'ACTIVE',
        },
        data: {
          status: 'REVOKED',
          revocationReason: input.reason,
        },
      });
    }
  }
}

export class PrismaSeatingGuidanceProvider implements SeatingGuidanceProvider {
  constructor(private readonly prisma: PrismaClient) {}

  async getGuidance(bookingId: string): Promise<SeatingGuidanceData> {
    const plan = await this.prisma.seatingPlan.findUnique({
      where: { bookingId },
      include: {
        revisions: {
          orderBy: { revisionNumber: 'desc' },
          take: 1,
          include: {
            labels: true,
          },
        },
      },
    });

    if (plan === null || plan.currentRevisionId === null || plan.revisions.length === 0) {
      return Object.freeze({
        seatingPlanRevisionId: null,
        status: 'ABSENT' as const,
        groups: Object.freeze([]),
      });
    }

    const latestRevision = plan.revisions[0]!;
    const geometryRows = await this.prisma.layoutTableGeometry.findMany({
      where: { layoutTemplateVersionId: latestRevision.layoutTemplateVersionId },
      select: { tableId: true, label: true },
    });
    const labelLookup = new Map<string, string>(geometryRows.map((g) => [g.tableId, g.label]));

    const groupTableMap = new Map<string, string[]>();

    for (const label of latestRevision.labels) {
      const list = groupTableMap.get(label.guestGroupId) ?? [];
      const displayLabel = labelLookup.get(label.layoutTableId) ?? label.layoutTableId;
      list.push(displayLabel);
      groupTableMap.set(label.guestGroupId, list);
    }

    const groups = Array.from(groupTableMap.entries()).map(([guestGroupId, tableLabels]) => {
      const fallbackColor =
        latestRevision.labels.find((l) => l.guestGroupId === guestGroupId)?.colorSnapshot ?? '#888888';
      return Object.freeze({
        guestGroupId,
        groupName: '',
        color: fallbackColor,
        tableLabels: Object.freeze(tableLabels),
      });
    });

    return Object.freeze({
      seatingPlanRevisionId: latestRevision.id,
      status: plan.status,
      groups: Object.freeze(groups),
    });
  }
}


