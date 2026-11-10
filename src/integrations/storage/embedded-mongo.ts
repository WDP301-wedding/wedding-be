import { mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { MongoClient, MongoServerError } from 'mongodb';

export interface EmbeddedMongoSettings {
  readonly databasePath: string;
  readonly database: 'wedding_catalog';
  readonly localhostUri: string;
  readonly rootPassword: string;
  readonly appPassword: string;
  readonly adminUri: string;
  readonly appUri: string;
}

export function embeddedMongoSettings(
  environment: NodeJS.ProcessEnv,
): EmbeddedMongoSettings | null {
  const enabled = environment.CATALOG_MONGO_EMBEDDED_ENABLED;
  if (enabled === undefined || enabled === '' || enabled === 'false') return null;
  if (
    enabled !== 'true' ||
    environment.CATALOG_MONGO_URI ||
    (environment.CATALOG_MONGO_DATABASE && environment.CATALOG_MONGO_DATABASE !== 'wedding_catalog')
  )
    throw new Error('Invalid embedded MongoDB configuration.');
  const rootPassword = environment.CATALOG_MONGO_ROOT_PASSWORD;
  const appPassword = environment.CATALOG_MONGO_APP_PASSWORD;
  if (
    !rootPassword ||
    !appPassword ||
    [rootPassword, appPassword].some((secret) => secret.length < 32 || secret.length > 256)
  )
    throw new Error('Complete embedded MongoDB credentials are required.');
  return Object.freeze({
    databasePath: '/var/data/mongodb',
    database: 'wedding_catalog',
    localhostUri: 'mongodb://127.0.0.1:27017',
    rootPassword,
    appPassword,
    adminUri: `mongodb://wedding_catalog_admin:${encodeURIComponent(rootPassword)}@127.0.0.1:27017/admin?authSource=admin`,
    appUri: `mongodb://wedding_catalog_app:${encodeURIComponent(appPassword)}@127.0.0.1:27017/wedding_catalog?authSource=wedding_catalog`,
  });
}

export function embeddedApplicationEnvironment(
  environment: NodeJS.ProcessEnv,
  settings: EmbeddedMongoSettings,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {
    ...environment,
    CATALOG_MONGO_URI: settings.appUri,
    CATALOG_MONGO_DATABASE: settings.database,
  };
  delete result.CATALOG_MONGO_ROOT_PASSWORD;
  delete result.CATALOG_MONGO_APP_PASSWORD;
  return result;
}

/** Localhost exception creates the administrator only on a fresh MongoDB disk. */
export async function initializeEmbeddedMongo(
  settings: EmbeddedMongoSettings,
  signal: AbortSignal,
): Promise<void> {
  await mkdir(settings.databasePath, { recursive: true, mode: 0o700 });
  const deadline = Date.now() + 25_000;
  while (true) {
    signal.throwIfAborted();
    const probe = new MongoClient(settings.localhostUri, {
      serverSelectionTimeoutMS: 500,
      socketTimeoutMS: 1000,
      connectTimeoutMS: 1000,
    });
    try {
      await probe.db('admin').command({ ping: 1 });
      break;
    } catch {
      if (Date.now() >= deadline) throw new Error('Embedded MongoDB did not become ready.');
    } finally {
      await probe.close();
    }
    await delay(250, undefined, { signal });
  }
  signal.throwIfAborted();
  let admin = new MongoClient(settings.adminUri, {
    serverSelectionTimeoutMS: 2000,
    socketTimeoutMS: 3000,
    connectTimeoutMS: 2000,
  });
  try {
    try {
      await admin.connect();
    } catch (error) {
      await admin.close();
      if (!(error instanceof MongoServerError && error.code === 18)) throw error;
      const bootstrap = new MongoClient(settings.localhostUri, {
        serverSelectionTimeoutMS: 2000,
        socketTimeoutMS: 3000,
        connectTimeoutMS: 2000,
      });
      try {
        await bootstrap.db('admin').command({
          createUser: 'wedding_catalog_admin',
          pwd: settings.rootPassword,
          roles: [{ role: 'root', db: 'admin' }],
        });
      } finally {
        await bootstrap.close();
      }
      admin = new MongoClient(settings.adminUri, {
        serverSelectionTimeoutMS: 2000,
        socketTimeoutMS: 3000,
        connectTimeoutMS: 2000,
      });
      await admin.connect();
    }
    signal.throwIfAborted();
    const result = await admin.db(settings.database).command({ usersInfo: 'wedding_catalog_app' });
    const users: unknown = result.users;
    if (!Array.isArray(users)) throw new Error('Invalid MongoDB user response.');
    if (users.length === 0)
      await admin.db(settings.database).command({
        createUser: 'wedding_catalog_app',
        pwd: settings.appPassword,
        roles: [{ role: 'readWrite', db: settings.database }],
      });
    const application = new MongoClient(settings.appUri, {
      serverSelectionTimeoutMS: 2000,
      socketTimeoutMS: 3000,
      connectTimeoutMS: 2000,
    });
    try {
      await application.connect();
      await application.db(settings.database).command({ ping: 1 });
    } finally {
      await application.close();
    }
  } finally {
    await admin.close();
  }
}
