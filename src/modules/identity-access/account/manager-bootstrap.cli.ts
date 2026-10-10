import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readBootstrapPassword } from './bootstrap-secret.js';
import { executeManagerBootstrap, runManagerBootstrap } from './manager-bootstrap.js';

export async function managerBootstrapMain(args = process.argv.slice(2)): Promise<void> {
  try {
    const { config } = await import('../../../config/config.js');
    await runManagerBootstrap(args, {
      config,
      readPassword: readBootstrapPassword,
      execute: (input) => executeManagerBootstrap(config, input),
      write: (record) => console.log(JSON.stringify(record)),
    });
  } catch {
    console.error(
      JSON.stringify({
        event: 'manager_bootstrap_failed',
        reason:
          'Check target/configuration, input policy and existing Manager. No success is assumed; inspect audit by request ID.',
      }),
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await managerBootstrapMain();
}
