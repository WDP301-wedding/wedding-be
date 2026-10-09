import { Router } from 'express';

import { OPENAPI_ARTIFACT_PATH } from './artifact.js';

export interface OpenApiRouterOptions {
  readonly artifactPath?: string;
}

export function createOpenApiRouter(options: OpenApiRouterOptions = {}): Router {
  const router = Router();
  const artifactPath = options.artifactPath ?? OPENAPI_ARTIFACT_PATH;

  router.get('/openapi.json', (_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    // Managed worktrees can place this fixed artifact under a hidden parent directory.
    response.sendFile(artifactPath, { dotfiles: 'allow' }, (error) => {
      if (error !== undefined) {
        next(error);
      }
    });
  });

  return router;
}
