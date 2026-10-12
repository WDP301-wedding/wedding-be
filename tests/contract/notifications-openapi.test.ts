import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createOpenApiDocument } from '../../src/core/openapi/generate.js';
import { notificationOpenApiPaths } from '../../src/modules/notifications-automation/http/notification.openapi.js';
import {
  installationBody,
  preferencesBody,
  guestDeliveryBody,
  requeueBody,
  managementQuery,
  statusDto,
} from '../../src/modules/notifications-automation/http/notification.schemas.js';

describe('SPEC-09 published notification boundaries', () => {
  it('publishes the mounted private routes, required mutation keys and explicit downstream limits', () => {
    const document = createOpenApiDocument();
    let operations = 0;
    for (const [path, item] of Object.entries(notificationOpenApiPaths)) {
      const actual = document.paths?.[path];
      expect(actual).toBeDefined();
      for (const method of ['get', 'post', 'patch', 'delete'] as const) {
        if (!item[method]) continue;
        operations++;
        expect(actual?.[method]?.security).toEqual([{ bearerAuth: [] }]);
        expect(actual?.[method]?.responses?.['401']).toBeDefined();
        if (method !== 'get')
          expect(JSON.stringify(actual?.[method]?.parameters)).toContain('IdempotencyKey');
      }
    }
    expect(operations).toBe(14);
    expect(document.paths?.['/notifications/android-installations']?.post?.description).toContain(
      'provider acceptance does not prove device display',
    );
    const status = JSON.stringify(
      document.paths?.['/management/notifications']?.get?.responses?.['200'],
    );
    expect(status).not.toMatch(/deliveryEmail|pushToken|ciphertext|providerMessageId/u);
    expect(Object.keys(notificationOpenApiPaths).join(' ')).not.toMatch(
      /webhook|worker|responses|attendance/u,
    );
  });
  it('rejects authority overrides, malformed tokens and missing explicit Guest destination', () => {
    const installationId = randomUUID();
    for (const token of ['', 'contains space', 'bad\u0000token', 'bad\ntoken']) {
      expect(
        installationBody.safeParse({ installationId, expectedRevision: 0, pushToken: token })
          .success,
      ).toBe(false);
    }
    expect(
      installationBody.safeParse({
        installationId,
        expectedRevision: 0,
        pushToken: 'valid-opaque-token',
      }).success,
    ).toBe(true);
    expect(preferencesBody.safeParse({ expectedRevision: 0 }).success).toBe(false);
    expect(preferencesBody.safeParse({ expectedRevision: 0, reminderPush: false }).success).toBe(
      true,
    );
    expect(
      preferencesBody.safeParse({
        expectedRevision: 0,
        reminderEmail: false,
        accountId: randomUUID(),
      }).success,
    ).toBe(false);
    expect(guestDeliveryBody.safeParse({ expectedRevision: 0 }).success).toBe(false);
    expect(
      guestDeliveryBody.safeParse({
        expectedRevision: 0,
        intendedEmail: 'explicit@example.invalid',
      }).success,
    ).toBe(true);
    expect(requeueBody.safeParse({ expectedRevision: 1, reason: ' ' }).success).toBe(false);
    expect(managementQuery.safeParse({ limit: 51 }).success).toBe(false);
    expect(
      managementQuery.safeParse({ state: 'UNKNOWN', purpose: 'PAYMENT', limit: '50' }).success,
    ).toBe(true);
    expect(statusDto.safeParse({ credential: 'forbidden' }).success).toBe(false);
  });
});
