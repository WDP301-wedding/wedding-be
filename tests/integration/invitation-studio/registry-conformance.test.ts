import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrintableSeatingContentRegistry } from '../../../src/modules/invitation-studio/application/studio.contracts.js';
import {
  digest,
  parseStudio,
  registerSeatingSchema,
  invalidateSeatingSchema,
  studioConflict,
} from '../../../src/modules/invitation-studio/domain/studio-policy.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';
import { studioFixture } from './studio-fixture.js';
import { NotFoundError, ProviderError } from '../../../src/core/errors/app-error.js';

type Registration = Parameters<PrintableSeatingContentRegistry['registerConfirmed']>[0];
type Invalidation = Parameters<PrintableSeatingContentRegistry['markRequiresReview']>[0];
type Harness = {
  fault: (value: 'DENIED' | 'UNAVAILABLE' | 'UNKNOWN' | null) => void;
  input: Registration;
  register: (
    input: Registration,
  ) => ReturnType<PrintableSeatingContentRegistry['registerConfirmed']>;
  invalidate: (
    input: Invalidation,
  ) => ReturnType<PrintableSeatingContentRegistry['markRequiresReview']>;
  head: () => Promise<{ revisionNumber: number; status: string } | null>;
};
/** Consumer double models retained history and invalidation high-water semantics.
 * The exact same cases execute on the native application port below. */
function memoryHarness(): Harness {
  const renderSnapshot = [
    {
      layoutTableId: randomUUID(),
      tableLabel: 'T1',
      shape: 'ROUND' as const,
      x: 0,
      y: 0,
      width: 500,
      height: 500,
      rotationDegrees: 0,
      guestGroupId: null,
      guestGroupName: null,
      color: null,
    },
  ];
  const input: Registration = {
    bookingId: randomUUID(),
    seatingPlanRevisionId: randomUUID(),
    seatingPlanRevisionNumber: 1,
    layoutTemplateVersionId: randomUUID(),
    contentDigest: digest(renderSnapshot),
    renderSnapshot,
    validityProof: {
      bookingRevision: 1,
      expectedAttendees: 20,
      minGuests: 10,
      maxGuests: 30,
      totalSeatCapacity: 40,
      managerException: null,
    },
  };
  const records = new Map<string, Registration>(),
    removed = new Map<number, string>();
  let state: { revisionNumber: number; status: string } | null = null;
  let fault: 'DENIED' | 'UNAVAILABLE' | 'UNKNOWN' | null = null;
  return {
    fault: (value) => {
      fault = value;
    },
    input,
    head: () => Promise.resolve(state),
    register: (value) => {
      if (fault !== null)
        return Promise.reject(
          fault === 'DENIED'
            ? new NotFoundError()
            : new ProviderError(fault === 'UNKNOWN' ? 'timeout' : 'unavailable'),
        );
      const row = parseStudio(registerSeatingSchema, value),
        prior = records.get(row.seatingPlanRevisionId);
      if (row.validityProof === undefined)
        return Promise.reject(studioConflict('PRINTABLE_SEATING_REQUIRES_REVIEW'));
      if (
        digest(row.renderSnapshot) !== row.contentDigest ||
        (prior !== undefined && digest(prior) !== digest(row))
      )
        return Promise.reject(studioConflict('PRINTABLE_SEATING_DIGEST_CONFLICT'));
      if (prior !== undefined) return Promise.resolve({ registered: true, replayed: true });
      if (
        [...records.values()].some(
          (record) => record.seatingPlanRevisionNumber === row.seatingPlanRevisionNumber,
        ) ||
        (removed.has(row.seatingPlanRevisionNumber) &&
          removed.get(row.seatingPlanRevisionNumber) !== row.seatingPlanRevisionId)
      )
        return Promise.reject(studioConflict('PRINTABLE_SEATING_DIGEST_CONFLICT'));
      records.set(row.seatingPlanRevisionId, row);
      if (
        !removed.has(row.seatingPlanRevisionNumber) &&
        (state === null || row.seatingPlanRevisionNumber > state.revisionNumber)
      )
        state = { revisionNumber: row.seatingPlanRevisionNumber, status: 'ELIGIBLE' };
      return Promise.resolve({ registered: true, replayed: false });
    },
    invalidate: (value) => {
      const row = parseStudio(invalidateSeatingSchema, value),
        prior = removed.get(row.seatingPlanRevisionNumber);
      if (prior !== undefined)
        return prior === row.seatingPlanRevisionId
          ? Promise.resolve({ invalidated: true, replayed: true })
          : Promise.reject(studioConflict('PRINTABLE_SEATING_DIGEST_CONFLICT'));
      removed.set(row.seatingPlanRevisionNumber, row.seatingPlanRevisionId);
      if (state === null || row.seatingPlanRevisionNumber >= state.revisionNumber)
        state = { revisionNumber: row.seatingPlanRevisionNumber, status: 'REQUIRES_REVIEW' };
      return Promise.resolve({ invalidated: true, replayed: false });
    },
  };
}
function conformance(factory: () => Promise<Harness>) {
  let h: Harness;
  beforeEach(async () => {
    h = await factory();
  });
  const invalidation = () => ({
    bookingId: h.input.bookingId,
    seatingPlanRevisionId: h.input.seatingPlanRevisionId,
    seatingPlanRevisionNumber: h.input.seatingPlanRevisionNumber,
    reasonCode: 'HEADCOUNT_OUTSIDE_LAYOUT_RANGE' as const,
  });
  it('accepts the frozen readonly render snapshot required by the provider contract', async () => {
    const renderSnapshot = Object.freeze(
      h.input.renderSnapshot.map((table) => Object.freeze({ ...table })),
    );
    expect(await h.register({ ...h.input, renderSnapshot })).toEqual({
      registered: true,
      replayed: false,
    });
  });
  it.each([
    ['DENIED', 404],
    ['UNAVAILABLE', 503],
    ['UNKNOWN', 504],
  ] as const)(
    'dependency %s cannot create an eligible head and same intent can resume safely',
    async (mode, status) => {
      h.fault(mode);
      await expect(h.register(h.input)).rejects.toMatchObject({ status });
      expect(await h.head()).toBeNull();
      h.fault(null);
      expect(await h.register(h.input)).toEqual({ registered: true, replayed: false });
      expect(await h.register(h.input)).toEqual({ registered: true, replayed: true });
    },
  );
  it('exact immutable replay and digest conflict', async () => {
    expect(await h.register(h.input)).toEqual({ registered: true, replayed: false });
    expect(await h.register(h.input)).toEqual({ registered: true, replayed: true });
    await expect(h.register({ ...h.input, contentDigest: 'f'.repeat(64) })).rejects.toMatchObject({
      status: 409,
      code: 'PRINTABLE_SEATING_DIGEST_CONFLICT',
    });
  });
  it.each(['REGISTER_FIRST', 'INVALIDATE_FIRST'])(
    'equal revision removal wins %s',
    async (order) => {
      if (order === 'REGISTER_FIRST') await h.register(h.input);
      await h.invalidate(invalidation());
      await h.register(h.input);
      expect(await h.head()).toEqual({ revisionNumber: 1, status: 'REQUIRES_REVIEW' });
      expect(await h.invalidate(invalidation())).toEqual({ invalidated: true, replayed: true });
      await h.register({
        ...h.input,
        seatingPlanRevisionId: randomUUID(),
        seatingPlanRevisionNumber: 3,
      });
      await h.invalidate({
        ...invalidation(),
        seatingPlanRevisionNumber: 2,
        seatingPlanRevisionId: randomUUID(),
      });
      expect(await h.head()).toEqual({ revisionNumber: 3, status: 'ELIGIBLE' });
    },
  );
  it('delayed lower registration cannot replace a higher eligible head', async () => {
    await h.register({
      ...h.input,
      seatingPlanRevisionId: randomUUID(),
      seatingPlanRevisionNumber: 2,
    });
    await h.register(h.input);
    expect(await h.head()).toEqual({ revisionNumber: 2, status: 'ELIGIBLE' });
  });
  it('compatibility field omission cannot become newly eligible integrated content', async () => {
    const { validityProof, ...historic } = h.input;
    expect(validityProof).toBeDefined();
    await expect(h.register(historic)).rejects.toMatchObject({
      status: 409,
      code: 'PRINTABLE_SEATING_REQUIRES_REVIEW',
    });
    expect(await h.head()).toBeNull();
  });
}
describe('SPEC-05 printable registry consumer-double conformance', () =>
  conformance(() => Promise.resolve(memoryHarness())));
(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'SPEC-05 same registry conformance on native PostgreSQL adapters',
  () => {
    const database = new CatalogTestDatabase('isw4_contract');
    beforeAll(() => database.connect(), 60000);
    afterAll(() => database.disconnect());
    conformance(async () => {
      const f = await studioFixture(database.prisma);
      let fault: 'DENIED' | 'UNAVAILABLE' | 'UNKNOWN' | null = null;
      const resolve = f.services.printable.editor.resolveContext.bind(f.services.printable.editor);
      f.services.printable.editor.resolveContext = async (context) => {
        const actor = await resolve(context);
        return fault === 'DENIED' ? { ...actor, roles: ['STAFF'] } : actor;
      };
      const eligibility = f.services.venue.getLayoutEligibility.bind(f.services.venue);
      f.services.venue.getLayoutEligibility = async (...args) => {
        if (fault === 'UNAVAILABLE' || fault === 'UNKNOWN')
          throw new ProviderError(fault === 'UNKNOWN' ? 'timeout' : 'unavailable');
        return eligibility(...args);
      };
      return {
        fault: (value) => {
          fault = value;
        },
        input: f.registry,
        register: (input) =>
          f.services.boundary.run({ bookingId: f.bookingId, context: f.contract }, (ctx) =>
            f.services.printable.registerConfirmed(input, ctx),
          ),
        invalidate: (input) =>
          f.services.printable.markRequiresReview(input, {
            requestId: randomUUID(),
            causationId: randomUUID(),
            actorAccountId: null,
            authority: 'SYSTEM',
          }),
        head: async () => {
          const row = await f.prisma.invitationSeatingState.findUnique({
            where: { bookingId: f.bookingId },
          });
          return row === null ? null : { revisionNumber: row.revisionNumber, status: row.status };
        },
      };
    });
  },
);
