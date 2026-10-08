import { NotFoundError } from '../../../core/errors/app-error.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';

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
  requireConfirmedBookingContext(bookingId: string): Promise<BookingContext> {
    if (bookingId === FAKE_BOOKING.bookingId) {
      return Promise.resolve({ ...FAKE_BOOKING });
    }
    return Promise.reject(new NotFoundError());
  }

  requireBookingOwnedByAccount(
    bookingId: string,
    accountId: string,
  ): Promise<void> {
    void bookingId;
    void accountId;
    return Promise.resolve();
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
  listActiveGroups(bookingId: string): Promise<readonly GuestGroup[]> {
    void bookingId;
    return Promise.resolve(FAKE_GROUPS);
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
  requireLayoutVersionEligible(layoutTemplateVersionId: string): Promise<LayoutEligibility> {
    if (layoutTemplateVersionId === FAKE_LAYOUT.layoutTemplateVersionId) {
      return Promise.resolve({ ...FAKE_LAYOUT, tableIds: [...FAKE_LAYOUT.tableIds] });
    }
    return Promise.reject(new NotFoundError());
  }

  listCompatibleVersionsForHall(
    hallId: string,
    planningHeadcount: number,
  ): Promise<readonly CompatibleLayoutOption[]> {
    void hallId;
    void planningHeadcount;
    return Promise.resolve(
      Object.freeze([
        Object.freeze({
          layoutTemplateVersionId: FAKE_LAYOUT.layoutTemplateVersionId,
          name: 'Standard Layout',
          minGuests: FAKE_LAYOUT.minGuests,
          maxGuests: FAKE_LAYOUT.maxGuests,
          totalSeatCapacity: FAKE_LAYOUT.totalSeatCapacity,
          isCompatible: true,
        }),
      ]),
    );
  }
}

export class FakePrintableSeatingContentRegistry implements PrintableSeatingContentRegistry {
  registerConfirmed(
    input: Parameters<PrintableSeatingContentRegistry['registerConfirmed']>[0],
  ): Promise<void> {
    void input;
    return Promise.resolve();
  }

  markRequiresReview(seatingRevisionId: string): Promise<void> {
    void seatingRevisionId;
    return Promise.resolve();
  }
}

export class PrismaVenueSelectionEligibilityReader implements VenueSelectionEligibilityReader {
  constructor(private readonly prisma: PrismaClient) {}

  async requireLayoutVersionEligible(layoutTemplateVersionId: string): Promise<LayoutEligibility> {
    const version = await this.prisma.layoutTemplateVersion.findUnique({
      where: { id: layoutTemplateVersionId },
      include: {
        layoutTemplate: {
          include: {
            hall: true,
          },
        },
        geometry: true,
      },
    });

    if (version === null) {
      throw new NotFoundError();
    }

    const isRetired =
      version.layoutTemplate.lifecycle === 'RETIRED' ||
      version.layoutTemplate.hall.lifecycle === 'RETIRED';

    const totalSeatCapacity = version.geometry.reduce((sum, g) => sum + g.seatCapacity, 0);

    return Object.freeze({
      layoutTemplateVersionId: version.id,
      layoutTemplateId: version.layoutTemplateId,
      hallId: version.layoutTemplate.hallId,
      minGuests: version.minGuests,
      maxGuests: version.maxGuests,
      totalSeatCapacity,
      tableIds: Object.freeze(version.geometry.map((t) => t.tableId)),
      isRetired,
    });
  }

  async listCompatibleVersionsForHall(
    hallId: string,
    planningHeadcount: number,
  ): Promise<readonly CompatibleLayoutOption[]> {
    const versions = await this.prisma.layoutTemplateVersion.findMany({
      where: {
        state: 'PUBLISHED',
        layoutTemplate: {
          hallId,
          lifecycle: 'ACTIVE',
        },
      },
      include: {
        geometry: true,
      },
    });

    return Object.freeze(
      versions.map((v) => {
        const totalSeatCapacity = v.geometry.reduce((sum, g) => sum + g.seatCapacity, 0);
        return Object.freeze({
          layoutTemplateVersionId: v.id,
          name: v.name,
          minGuests: v.minGuests,
          maxGuests: v.maxGuests,
          totalSeatCapacity,
          isCompatible:
            planningHeadcount >= v.minGuests &&
            planningHeadcount <= v.maxGuests,
        });
      }),
    );
  }
}

export class PrismaPrintableSeatingContentRegistry implements PrintableSeatingContentRegistry {
  constructor(private readonly prisma: PrismaClient) {}

  registerConfirmed(input: Parameters<PrintableSeatingContentRegistry['registerConfirmed']>[0]): Promise<void> {
    void input;
    // Handled in transaction via seatingRevisionRegistration
    return Promise.resolve();
  }

  async markRequiresReview(seatingRevisionId: string): Promise<void> {
    await this.prisma.seatingRevisionRegistration.updateMany({
      where: {
        revisionId: seatingRevisionId,
        invalidatedAt: null,
      },
      data: {
        invalidatedAt: new Date(),
      },
    });
  }
}

