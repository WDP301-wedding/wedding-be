import { describe, expect, it } from 'vitest';
import { embeddedMongoSettings, embeddedApplicationEnvironment } from './embedded-mongo.js';

describe('embedded MongoDB deployment configuration', () => {
  const configured = {
    CATALOG_MONGO_EMBEDDED_ENABLED: 'true',
    CATALOG_MONGO_ROOT_PASSWORD: 'r'.repeat(48),
    CATALOG_MONGO_APP_PASSWORD: 'a'.repeat(48),
  };
  it('is explicitly opt-in and fails closed for incomplete secrets or external MongoDB conflicts', () => {
    expect(embeddedMongoSettings({})).toBeNull();
    expect(() => embeddedMongoSettings({ CATALOG_MONGO_EMBEDDED_ENABLED: 'typo' })).toThrow();
    expect(() => embeddedMongoSettings({ CATALOG_MONGO_EMBEDDED_ENABLED: 'true' })).toThrow();
    expect(() =>
      embeddedMongoSettings({ ...configured, CATALOG_MONGO_URI: 'mongodb://external' }),
    ).toThrow();
    expect(() =>
      embeddedMongoSettings({ ...configured, CATALOG_MONGO_DATABASE: 'other' }),
    ).toThrow();
  });
  it('uses the existing disk, loopback-only connection and strips administrator credentials from the API environment', () => {
    const settings = embeddedMongoSettings(configured)!;
    expect(settings.databasePath).toBe('/var/data/mongodb');
    expect(settings.appUri).toContain('@127.0.0.1:27017/wedding_catalog');
    const environment = embeddedApplicationEnvironment(
      { ...configured, DATABASE_URL: 'preserved' },
      settings,
    );
    expect(environment.CATALOG_MONGO_ROOT_PASSWORD).toBeUndefined();
    expect(environment.CATALOG_MONGO_APP_PASSWORD).toBeUndefined();
    expect(environment.CATALOG_MONGO_URI).toBe(settings.appUri);
    expect(environment.DATABASE_URL).toBe('preserved');
  });
});
