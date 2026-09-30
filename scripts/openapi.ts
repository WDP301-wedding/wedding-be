import { checkOpenApiArtifact, generateOpenApiArtifact } from '../src/core/openapi/generate.js';

async function main(arguments_: readonly string[]): Promise<void> {
  if (arguments_.length === 0) {
    await generateOpenApiArtifact();
    return;
  }

  if (arguments_.length === 1 && arguments_[0] === '--check') {
    await checkOpenApiArtifact();
    return;
  }

  throw new Error('Usage: openapi.ts [--check]');
}

try {
  await main(process.argv.slice(2));
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : 'OpenAPI generation failed.');
  process.exitCode = 1;
}
