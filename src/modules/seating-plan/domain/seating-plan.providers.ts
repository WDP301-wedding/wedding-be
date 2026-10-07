import { NotFoundError } from '../../../core/errors/app-error.js';

// ─── Provider interfaces ──────────────────────────────────────────────────────

export interface BookingContext {
  readonly bookingId: string;
  readonly consultationId: string;
  readonly hallId: string;
  readonly planningHeadcount: number;
  readonly bookingRevision: number;
}

export interface GuestGroup {
  readonly guestGroupId: string;
  readonly name: string;
  readonly color: string;
}

export interface LayoutEligibility {
  readonly layoutTemplateVersionId: string;
  readonly layoutTemplateId: string;
  readonly hallId: string;
  readonly minGuests: number;
  readonly maxGuests: number;
  readonly totalSeatCapacity: number;
  readonly tableIds: readonly string[];
  readonly isRetired: boolean;
}

export interface CompatibleLayoutOption {
  readonly layoutTemplateVersionId: string;
  readonly name: string;
  readonly minGuests: number;
  readonly maxGuests: number;
  readonly totalSeatCapacity: number;
  readonly isCompatible: boolean;
}

export interface ValidityProof {
  readonly minGuests: number;
  readonly maxGuests: number;
  readonly totalSeatCapacity: number;
  readonly hallMaxGuests: number;
  readonly bookingRevision: number;
  readonly planningHeadcount: number;
  readonly managerExceptionGranted: boolean;
}

export interface BookingPlanningReader {
  requireConfirmedBookingContext(bookingId: string): Promise<BookingContext>;
  requireBookingOwnedByAccount(bookingId: string, accountId: string): Promise<void>;
}

export interface GuestPlanningReader {
  listActiveGroups(bookingId: string): Promise<readonly GuestGroup[]>;
}

export interface VenueSelectionEligibilityReader {
  requireLayoutVersionEligible(layoutTemplateVersionId: string): Promise<LayoutEligibility>;
  listCompatibleVersionsForHall(
    hallId: string,
    planningHeadcount: number,
  ): Promise<readonly CompatibleLayoutOption[]>;
}

export interface PrintableSeatingContentRegistry {
  registerConfirmed(input: {
    readonly seatingRevisionId: string;
    readonly revisionNumber: number;
    readonly digest: string;
    readonly validityProof: ValidityProof;
  }): Promise<void>;
  markRequiresReview(seatingRevisionId: string): Promise<void>;
}

// ─── Fake implementations ─────────────────────────────────────────────────────

const FAKE_BOOKING: BookingContext = Object.freeze({
  bookingId: '00000000-0000-0000-0000-000000000001',
  consultationId: '00000000-0000-0000-0000-000000000002',
  hallId: '00000000-0000-0000-0000-000000000003',
  planningHeadcount: 100,
  bookingRevision: 1,
});

export class FakeBookingPlanningReader implements BookingPlanningReader {
  async requireConfirmedBookingContext(bookingId: string): Promise<BookingContext> {
    if (bookingId === FAKE_BOOKING.bookingId) {
      return { ...FAKE_BOOKING };
    }
    throw new NotFoundError();
  }

  async requireBookingOwnedByAccount(
    _bookingId: string,
    _accountId: string,
  ): Promise<void> {
    // Fake: always succeeds — in real impl would check consultation access
  }
}

const FAKE_GROUPS: readonly GuestGroup[] = Object.freeze([
  Object.freeze({
    guestGroupId: '00000000-0000-0000-0000-000000000010',
    name: 'Nhà trai',
    color: '#FF0000',
  }),
  Object.freeze({
    guestGroupId: '00000000-0000-0000-0000-000000000011',
    name: 'Nhà gái',
    color: '#0000FF',
  }),
]);

export class FakeGuestPlanningReader implements GuestPlanningReader {
  async listActiveGroups(_bookingId: string): Promise<readonly GuestGroup[]> {
    return FAKE_GROUPS;
  }
}

const FAKE_LAYOUT: LayoutEligibility = Object.freeze({
  layoutTemplateVersionId: '00000000-0000-0000-0000-000000000020',
  layoutTemplateId: '00000000-0000-0000-0000-000000000021',
  hallId: '00000000-0000-0000-0000-000000000003',
  minGuests: 50,
  maxGuests: 200,
  totalSeatCapacity: 200,
  tableIds: Object.freeze(['00000000-0000-0000-0000-000000000030']),
  isRetired: false,
});

export class FakeVenueSelectionEligibilityReader implements VenueSelectionEligibilityReader {
  async requireLayoutVersionEligible(layoutTemplateVersionId: string): Promise<LayoutEligibility> {
    if (layoutTemplateVersionId === FAKE_LAYOUT.layoutTemplateVersionId) {
      return { ...FAKE_LAYOUT, tableIds: [...FAKE_LAYOUT.tableIds] };
    }
    throw new NotFoundError();
  }

  async listCompatibleVersionsForHall(
    _hallId: string,
    _planningHeadcount: number,
  ): Promise<readonly CompatibleLayoutOption[]> {
    return Object.freeze([
      Object.freeze({
        layoutTemplateVersionId: FAKE_LAYOUT.layoutTemplateVersionId,
        name: 'Standard Layout',
        minGuests: FAKE_LAYOUT.minGuests,
        maxGuests: FAKE_LAYOUT.maxGuests,
        totalSeatCapacity: FAKE_LAYOUT.totalSeatCapacity,
        isCompatible: true,
      }),
    ]);
  }
}

export class FakePrintableSeatingContentRegistry implements PrintableSeatingContentRegistry {
  async registerConfirmed(
    _input: Parameters<PrintableSeatingContentRegistry['registerConfirmed']>[0],
  ): Promise<void> {
    // no-op in fake
  }

  async markRequiresReview(_seatingRevisionId: string): Promise<void> {
    // no-op in fake
  }
}
