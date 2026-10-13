import { describe, expect, it } from 'vitest';
import { createPersonalizedDeliveryAdapter } from './guest-delivery.adapter.js';
import { NotificationRepository } from '../infrastructure/notification.repository.js';
import { NotificationCrypto } from '../infrastructure/notification-crypto.js';
import { createPrismaClient } from '../../../core/database/prisma.js';

describe('personalized invitation origin boundary', () => {
  const repository = new NotificationRepository(
    createPrismaClient('postgresql://unused@localhost/unused'),
  );
  const crypto = new NotificationCrypto(null, new Map());
  it.each(['https://example.test', 'http://localhost:3000', 'http://127.0.0.1:3000'])(
    'accepts a secure or loopback origin: %s',
    (origin) => {
      expect(createPersonalizedDeliveryAdapter(repository, crypto, origin)).toHaveProperty(
        'enqueue',
      );
    },
  );
  it.each([
    'http://example.test',
    'ftp://localhost',
    'https://user@example.test',
    'https://:secret@example.test',
    'https://example.test?token=secret',
    'https://example.test#secret',
  ])('rejects an unsafe origin before enqueue: %s', (origin) => {
    expect(() => createPersonalizedDeliveryAdapter(repository, crypto, origin)).toThrow(
      'Invalid Guest delivery origin.',
    );
  });
});
