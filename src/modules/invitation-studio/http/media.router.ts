import { Router, type RequestHandler, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';

import {
  AuthenticationRequiredError,
  type AuthenticatedActorResolver,
} from '../../identity-access/authorization/authenticated-actor.middleware.js';
import {
  IdempotencyKeyRequiredError,
  PayloadTooLargeError,
  RateLimitError,
  ValidationError,
} from '../../../core/errors/app-error.js';
import { idempotencyKeySchema } from '../../../core/idempotency/idempotency.schemas.js';
import { parseStorageInput } from '../../../integrations/storage/storage.schemas.js';
import type { MediaAsset, MediaRequestContext } from '../application/media.contracts.js';
import type { MediaService } from '../application/media.service.js';
import { MEDIA_LIMITS } from '../domain/media-policy.js';
import {
  mediaParamsSchema as paramsSchema,
  mediaUploadFieldsSchema as fieldsSchema,
  mediaMetadataBodySchema as metadataSchema,
  mediaDetachBodySchema as deleteSchema,
  mediaCutoffBodySchema as cutoffSchema,
  mediaAssetResponseSchema,
  mediaPreviewResponseSchema,
  mediaPolicyResponseSchema,
} from './media.schemas.js';

const bodyLimit = MEDIA_LIMITS.fileBytes + 64 * 1024;

/** Mounted by InvitationStudioRuntime with native owner readers. createApp
 * supplies requestId, JSON/security/rate/deadline policy. */
export function createMediaRouter(
  service: MediaService,
  resolver: AuthenticatedActorResolver,
  maxConcurrentUploads = 2,
): Router {
  if (!Number.isInteger(maxConcurrentUploads) || maxConcurrentUploads < 1)
    throw new RangeError('Invalid upload concurrency.');
  const router = Router();
  let active = 0;
  const authorize: RequestHandler = (req, res, next) => {
    const match = /^Bearer ([^\s]+)$/u.exec(req.get('authorization') ?? '');
    const token = match?.[1];
    if (token === undefined) {
      next(new AuthenticationRequiredError());
      return;
    }
    void resolver
      .resolve(token)
      .then((actor) => {
        res.locals.mediaContext = {
          actorId: actor.accountId,
          requestId: req.requestId,
          accessToken: token,
        } satisfies MediaRequestContext;
        res.set('Cache-Control', 'no-store');
        next();
      })
      .catch(next);
  };
  router.use(
    ['/bookings/:bookingId/media', '/management/bookings/:bookingId/media-policy'],
    authorize,
    (req, _res, next) => {
      try {
        parseStorageInput(z.strictObject({}), req.query);
        next();
      } catch (error) {
        next(error);
      }
    },
  );
  const uploadMiddleware = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MEDIA_LIMITS.fileBytes,
      files: 1,
      fields: 2,
      parts: 3,
      fieldNameSize: 32,
      fieldSize: 1000,
      headerPairs: 32,
    },
  }).single('file');
  const multipart: RequestHandler = (req, res, next) => {
    const length = req.get('content-length');
    if (length !== undefined && (!/^\d+$/u.test(length) || Number(length) > bodyLimit)) {
      next(new PayloadTooLargeError());
      return;
    }
    if (active >= maxConcurrentUploads) {
      next(new RateLimitError(1));
      return;
    }
    active++;
    let released = false,
      total = 0,
      exceeded = false,
      processing = false;
    const count = (chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > bodyLimit && !exceeded) {
        exceeded = true;
        // Multer2.4 handles request errors: unpipe/destroy parser, clean partial
        // buffers and drain. Outer request deadline remains in effect while draining.
        req.emit('error', new PayloadTooLargeError());
      }
    };
    const release = () => {
      if (!released) {
        released = true;
        active--;
        req.off('data', count);
      }
    };
    res.locals.mediaRelease = release;
    res.once('close', () => {
      if (!processing) release();
    });
    req.on('data', count);
    uploadMiddleware(req, res, (error) => {
      req.off('data', count);
      if (error instanceof multer.MulterError) {
        release();
        next(new ValidationError());
        return;
      }
      if (error) {
        release();
        next(error instanceof PayloadTooLargeError ? error : new ValidationError());
        return;
      }
      processing = true;
      next();
      // Keep the concurrency slot through decoding/storage/response, not only parsing.
    });
  };
  const ownBooking: RequestHandler = (req, res, next) => {
    try {
      const params = parseStorageInput(paramsSchema, req.params);
      void service
        .authorizeUpload(params.bookingId, context(res))
        .then(() => next())
        .catch(next);
    } catch (error) {
      next(error);
    }
  };
  const write: RequestHandler = (req, res, next) => {
    const key = req.get('idempotency-key');
    if (key === undefined) {
      next(new IdempotencyKeyRequiredError());
      return;
    }
    try {
      res.locals.mediaKey = parseStorageInput(idempotencyKeySchema, key);
      next();
    } catch (e) {
      next(e);
    }
  };
  const upload: RequestHandler = (req, res, next) => {
    void (async () => {
      const params = parseStorageInput(paramsSchema, req.params),
        fields = parseStorageInput(fieldsSchema, req.body);
      if (req.file === undefined) throw new ValidationError();
      const result = await service.upload(
        {
          ...params,
          ...fields,
          bytes: req.file.buffer,
          contentType: req.file.mimetype,
          idempotencyKey: commandKey(res),
        },
        context(res),
      );
      res
        .status(params.assetId === undefined ? 201 : 200)
        .json(mediaAssetResponseSchema.parse({ data: assetView(params.bookingId, result) }));
    })()
      .catch(next)
      .finally(() => releaseUpload(res));
  };
  router.post('/bookings/:bookingId/media', write, ownBooking, multipart, upload);
  router.patch('/bookings/:bookingId/media/:assetId', write, ownBooking, (req, res, next) => {
    if (req.is('multipart/form-data')) {
      multipart(req, res, (error: unknown) => {
        if (error) next(error);
        else upload(req, res, next);
      });
      return;
    }
    void (async () => {
      const params = parseStorageInput(paramsSchema, req.params),
        body = parseStorageInput(metadataSchema, req.body);
      const asset = await service.updateMetadata(
        { ...params, ...body, idempotencyKey: commandKey(res) },
        context(res),
      );
      res.json(mediaAssetResponseSchema.parse({ data: assetView(params.bookingId, asset) }));
    })().catch(next);
  });
  router.delete('/bookings/:bookingId/media/:assetId', write, (req, res, next) => {
    void (async () => {
      const params = parseStorageInput(paramsSchema, req.params),
        body = parseStorageInput(deleteSchema, req.body);
      const asset = await service.detach(
        { ...params, ...body, idempotencyKey: commandKey(res) },
        context(res),
      );
      res.json(mediaAssetResponseSchema.parse({ data: assetView(params.bookingId, asset) }));
    })().catch(next);
  });
  router.get('/bookings/:bookingId/media/:assetId', (req, res, next) => {
    void (async () => {
      const params = parseStorageInput(paramsSchema, req.params);
      const data = await service.preview(params, context(res));
      res.json(
        mediaPreviewResponseSchema.parse({
          data: { ...data, asset: assetView(params.bookingId, data.asset) },
        }),
      );
    })().catch(next);
  });
  router.patch('/management/bookings/:bookingId/media-policy', write, (req, res, next) => {
    void (async () => {
      const params = parseStorageInput(paramsSchema, req.params),
        body = parseStorageInput(cutoffSchema, req.body);
      res.json(
        mediaPolicyResponseSchema.parse({
          data: await service.changeCutoff(
            { ...params, ...body, idempotencyKey: commandKey(res) },
            context(res),
          ),
        }),
      );
    })().catch(next);
  });
  return router;
}

function assetView(bookingId: string, asset: MediaAsset) {
  return {
    mediaAssetId: asset.id,
    revision: asset.revision,
    detachedAt: asset.detachedAt,
    previewPath: `/api/v1/bookings/${bookingId.toLowerCase()}/media/${asset.id}`,
  };
}

function context(res: Response): MediaRequestContext {
  return res.locals.mediaContext as MediaRequestContext;
}
function commandKey(res: Response): string {
  return res.locals.mediaKey as string;
}
function releaseUpload(res: Response): void {
  const release = res.locals.mediaRelease as (() => void) | undefined;
  release?.();
  delete res.locals.mediaRelease;
}
