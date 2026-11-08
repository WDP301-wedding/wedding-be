import { describe, expect, it } from 'vitest';
import { createOpenApiDocument } from '../../src/core/openapi/generate.js';
import { guestOpenApiPaths } from '../../src/modules/guest-management/http/guest.openapi.js';
import {
  guestWriteSchema,
  groupWriteSchema,
  importPreviewSchema,
  planWriteSchema,
} from '../../src/modules/guest-management/domain/guest-policy.js';
import { GUEST_PROVIDER_VERSION } from '../../src/modules/guest-management/application/guest.contracts.js';
describe('GM-W4 exact published API boundaries', () => {
  it('retires owner metadata discovery while preserving prior invitation capability views', () => {
    const doc = createOpenApiDocument();
    const get = doc.paths?.['/bookings/{bookingId}/guests/{guestId}/personalized-invitations']?.get;
    expect(get?.operationId).toBe('readGuestInvitationMetadata');
    expect(get?.security).toEqual([{ bearerAuth: [] }]);
    expect(get?.requestBody).toBeUndefined();
    expect(get?.deprecated).toBe(true);
    expect(get?.responses).not.toHaveProperty('200');
    expect(JSON.stringify(get?.responses?.['410'])).toContain('FEATURE_RETIRED');
    expect(doc.paths?.['/guest/invitation']?.get?.responses).toHaveProperty('200');
  });
  it('publishes all runtime routes without Household, attendance or response endpoints', () => {
    const doc = createOpenApiDocument();
    expect(GUEST_PROVIDER_VERSION).toBe('guest-management@1.0.0');
    expect(Object.keys(guestOpenApiPaths)).toHaveLength(10);
    for (const path of Object.keys(guestOpenApiPaths)) expect(doc.paths?.[path]).toBeDefined();
    expect(doc.components?.securitySchemes?.guestInvitationCapability).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
    const text = JSON.stringify(Object.keys(guestOpenApiPaths));
    expect(text).not.toContain('/responses');
    expect(text).not.toContain('/check-in');
    expect(text).not.toContain('/households');
  });
  it('keeps a named person independent of explicit planning and unknown fields strict', () => {
    expect(
      guestWriteSchema.safeParse({
        name: 'An',
        guestGroupId: '10000000-0000-4000-8000-000000000001',
      }).success,
    ).toBe(true);
    expect(
      guestWriteSchema.safeParse({
        name: 'An',
        guestGroupId: '10000000-0000-4000-8000-000000000001',
        plannedCompanions: 1,
      }).success,
    ).toBe(false);
    expect(
      groupWriteSchema.safeParse({ name: 'Group without names', color: '#FFFFFF' }).success,
    ).toBe(true);
    expect(planWriteSchema.safeParse({ expectedRevision: 1, planningHeadcount: 300 }).success).toBe(
      true,
    );
    expect(importPreviewSchema.safeParse({ rows: [], planningHeadcount: 0 }).success).toBe(false);
  });
});
