export interface PrintBookingSummary {
  readonly bookingCode: string;
  readonly brideName: string | null;
  readonly groomName: string | null;
  readonly eventDate: string;
  readonly hallName: string | null;
}

/** Minimal Booking-owned context for an already authorized Manager print page. */
export interface PrintBookingSummaryReader {
  readMany(bookingIds: readonly string[]): Promise<ReadonlyMap<string, PrintBookingSummary>>;
}
