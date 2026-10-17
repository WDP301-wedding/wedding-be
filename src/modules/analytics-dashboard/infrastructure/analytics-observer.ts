import type { DestinationStream } from 'pino';
import type { Config } from '../../../config/config.js';
import { createLogger } from '../../../core/logging/logger.js';
import type { AnalyticsObserver } from '../application/analytics-observation.js';

export function createAnalyticsObserver(
  config: Pick<Config, 'runtime'>,
  source: Readonly<Record<string, string | undefined>> = process.env,
  destination?: DestinationStream,
): AnalyticsObserver | undefined {
  const enabled = source.ANALYTICS_DIAGNOSTICS_ENABLED ?? 'false';
  if (enabled !== 'true' && enabled !== 'false')
    throw Error('ANALYTICS_DIAGNOSTICS_ENABLED must be true or false.');
  if (enabled === 'false') return undefined;
  const logger = createLogger({
    level: config.runtime.logLevel,
    runtimeEnvironment: config.runtime.environment,
    ...(destination === undefined ? {} : { destination }),
  });
  return (observation) => logger.info(observation);
}
