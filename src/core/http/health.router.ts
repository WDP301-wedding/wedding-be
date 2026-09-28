import { Router } from 'express';

import { ServiceUnavailableError } from '../errors/app-error.js';
import { type HealthLiveResponse, type HealthReadyResponse } from './health.schemas.js';
import {
  createReadinessCheck,
  DEFAULT_READINESS_TIMEOUT_MS,
  type ReadinessProbe,
} from './readiness.js';

export interface HealthRouterOptions {
  readonly readinessProbe?: ReadinessProbe;
  readonly readinessTimeoutMs?: number;
}

const readyByDefault: ReadinessProbe = () => Promise.resolve();

export function createHealthRouter(options: HealthRouterOptions = {}): Router {
  const router = Router();
  const checkReadiness = createReadinessCheck(
    options.readinessProbe ?? readyByDefault,
    options.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS,
  );

  router.get('/live', (request, response) => {
    const body: HealthLiveResponse = {
      data: { status: 'live', requestId: request.requestId },
    };
    response.json(body);
  });

  router.get('/ready', async (request, response, next) => {
    if (!(await checkReadiness())) {
      next(new ServiceUnavailableError());
      return;
    }

    const body: HealthReadyResponse = {
      data: { status: 'ready', requestId: request.requestId },
    };
    response.json(body);
  });

  return router;
}
