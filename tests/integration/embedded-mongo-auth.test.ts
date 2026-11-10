import { MongoClient } from 'mongodb';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  embeddedMongoSettings,
  initializeEmbeddedMongo,
} from '../../src/integrations/storage/embedded-mongo.js';

// Dedicated empty, auth-enabled loopback instance only; never use an application DB.
const uri = process.env.TEST_EMBEDDED_MONGO_URI;
describe.skipIf(!uri)('embedded MongoDB localhost bootstrap and privilege boundary', () => {
  const base = embeddedMongoSettings({
    CATALOG_MONGO_EMBEDDED_ENABLED: 'true',
    CATALOG_MONGO_ROOT_PASSWORD: 'root-test-secret-'.repeat(3),
    CATALOG_MONGO_APP_PASSWORD: 'application-test-secret-'.repeat(3),
  })!;
  const parsed = new URL(uri ?? 'mongodb://127.0.0.1:27129');
  if (parsed.hostname !== '127.0.0.1' || parsed.port !== '27129')
    throw new Error('Dedicated disposable MongoDB on 127.0.0.1:27129 required.');
  const settings = {
    ...base,
    databasePath: process.env.TEST_EMBEDDED_MONGO_PATH!,
    localhostUri: parsed.origin === 'null' ? uri! : parsed.origin,
    adminUri: base.adminUri.replace('127.0.0.1:27017', '127.0.0.1:27129'),
    appUri: base.appUri.replace('127.0.0.1:27017', '127.0.0.1:27129'),
  };
  beforeAll(async () => {
    await initializeEmbeddedMongo(settings, new AbortController().signal);
  }, 30_000);
  it('creates persistent administrator/application users and reuses them on restart', async () => {
    await initializeEmbeddedMongo(settings, new AbortController().signal);
    const app = new MongoClient(settings.appUri);
    try {
      await app
        .db('wedding_catalog')
        .collection('bootstrap_verification')
        .insertOne({ marker: 'owned-test' });
      expect(
        await app.db('wedding_catalog').collection('bootstrap_verification').countDocuments(),
      ).toBe(1);
      await expect(app.db('admin').command({ serverStatus: 1 })).rejects.toMatchObject({
        code: 13,
      });
      await app
        .db('wedding_catalog')
        .collection('bootstrap_verification')
        .deleteMany({ marker: 'owned-test' });
    } finally {
      await app.close();
    }
  });
  it('does not reset existing users when a configured root password is wrong', async () => {
    await expect(
      initializeEmbeddedMongo(
        {
          ...settings,
          adminUri: settings.adminUri.replace(
            encodeURIComponent(settings.rootPassword),
            'incorrect',
          ),
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 13 });
    const admin = new MongoClient(settings.adminUri);
    try {
      expect((await admin.db('admin').command({ ping: 1 })).ok).toBe(1);
    } finally {
      await admin.close();
    }
  });
});
