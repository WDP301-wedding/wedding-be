import { NotFoundError } from '../../../core/errors/app-error.js';

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

  async requireConfirmedEventContext(bookingId: string): Promise<StaffEventContext> {
    if (bookingId === this.validBookingId) {
      return {
        bookingId,
        isConfirmed: true,
        eventStartTime: this.startTime,
        eventEndTime: this.endTime,
      };
    }
    throw new NotFoundError();
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
  async requireHouseholdForOperations(
    _bookingId: string,
    householdId: string,
  ): Promise<HouseholdOperationsInfo> {
    const found = FAKE_HOUSEHOLDS.find((h) => h.invitationHouseholdId === householdId);
    if (found !== undefined) {
      return { ...found };
    }
    throw new NotFoundError();
  }

  async searchHouseholds(
    _bookingId: string,
    filter: HouseholdSearchFilter,
  ): Promise<{
    readonly items: readonly HouseholdOperationsInfo[];
    readonly nextCursor: string | null;
  }> {
    let results = [...FAKE_HOUSEHOLDS];
    if (filter.name !== undefined && filter.name.trim() !== '') {
      const q = filter.name.toLowerCase();
      results = results.filter((h) => h.representativeName.toLowerCase().includes(q));
    }
    if (filter.phone !== undefined && filter.phone.trim() !== '') {
      results = results.filter((h) => h.phoneLast4 === filter.phone);
    }
    const sliced = results.slice(0, filter.limit);
    return {
      items: sliced,
      nextCursor: results.length > filter.limit ? (sliced.at(-1)?.invitationHouseholdId ?? null) : null,
    };
  }
}

export class FakeSeatingGuidanceProvider implements SeatingGuidanceProvider {
  async getGuidance(_bookingId: string): Promise<SeatingGuidanceData> {
    return Object.freeze({
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
    });
  }
}

export class FakeStaffAccountProvisioner implements StaffAccountProvisioner {
  async provisionStaffAccount(input: {
    readonly email: string;
    readonly commandKey: string;
  }): Promise<{ readonly accountId: string; readonly setupRequired: boolean }> {
    return {
      accountId: '00000000-0000-0000-0000-000000000099',
      setupRequired: true,
    };
  }

  async setStaffOperationalAccess(_input: {
    readonly accountId: string;
    readonly enabled: boolean;
    readonly reason: string;
  }): Promise<void> {
    // no-op in fake
  }
}
