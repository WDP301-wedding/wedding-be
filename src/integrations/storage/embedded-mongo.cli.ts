import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  embeddedMongoSettings,
  embeddedApplicationEnvironment,
  initializeEmbeddedMongo,
} from './embedded-mongo.js';
import { ProcessSupervisor, processExit } from './process-supervisor.js';

const supervisor = new ProcessSupervisor();
const removeSignalHandlers = supervisor.installSignalHandlers();
try {
  const settings = embeddedMongoSettings(process.env);
  if (!settings) throw new Error('Embedded MongoDB is not enabled.');
  await mkdir(settings.databasePath, { recursive: true, mode: 0o700 });
  supervisor.start(
    'database',
    'mongod',
    [
      '--dbpath',
      settings.databasePath,
      '--bind_ip',
      '127.0.0.1',
      '--port',
      '27017',
      '--auth',
      '--wiredTigerCacheSizeGB',
      '0.25',
      '--quiet',
      '--setParameter',
      'diagnosticDataCollectionDirectorySizeMB=20',
    ],
    {},
  );
  await initializeEmbeddedMongo(settings, supervisor.abortController.signal);
  if (supervisor.isStopping) throw new Error('Embedded startup interrupted.');
  const environment = embeddedApplicationEnvironment(process.env, settings);
  const migration = supervisor.start(
    'migration',
    process.execPath,
    [
      fileURLToPath(new URL('./food-media-migration.cli.js', import.meta.url)),
      'reconcile-to-mongo',
      '--apply',
    ],
    environment,
  );
  if ((await processExit(migration)) !== 0 || supervisor.isStopping)
    throw new Error('Food media reconciliation failed.');
  console.info(JSON.stringify({ event: 'embedded-mongo-ready', database: settings.database }));
  supervisor.start(
    'application',
    process.execPath,
    [
      '--enable-source-maps',
      '--import',
      fileURLToPath(new URL('../../instrumentation.js', import.meta.url)),
      fileURLToPath(new URL('../../server.js', import.meta.url)),
    ],
    environment,
  );
  process.exitCode = await supervisor.completion;
} catch {
  if (!supervisor.isStopping)
    console.error('Embedded MongoDB startup failed; source images were retained.');
  process.exitCode = await supervisor.stop(1);
} finally {
  removeSignalHandlers();
}
