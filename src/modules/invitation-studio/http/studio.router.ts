import { createHash } from 'node:crypto';
import { Router, type RequestHandler, type Request, type Response } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import {
  AuthenticationRequiredError,
  type AuthenticatedActorResolver,
} from '../../identity-access/authorization/authenticated-actor.middleware.js';
import { IdempotencyKeyRequiredError } from '../../../core/errors/app-error.js';
import { idempotencyKeySchema } from '../../../core/idempotency/idempotency.schemas.js';
import { id, parseStudio } from '../domain/studio-policy.js';
import { renderPublicInvitation } from '../domain/public-invitation.js';
import type { createInvitationStudioServices } from '../infrastructure/studio.composition.js';
import type { MediaRequestContext } from '../application/media.contracts.js';
import { mediaAssetResponseSchema } from './media.schemas.js';
import * as schemas from './studio.schemas.js';
import { createPrintOrdersRouter } from './print-orders.router.js';

type Services = ReturnType<typeof createInvitationStudioServices>;
const empty = z.strictObject({});
const bookParams = z.strictObject({ bookingId: id });
const designParams = bookParams.extend({ designId: id });
const context = (res: Response) => res.locals.studioContext as MediaRequestContext;
const key = (req: Request) => {
  const value = req.get('idempotency-key');
  if (value === undefined) throw new IdempotencyKeyRequiredError();
  return parseStudio(idempotencyKeySchema, value);
};
/** Actor and client kind come from Identity sessions, never submitted editor fields. */
export function createStudioRouter(
  services: Services,
  resolver: AuthenticatedActorResolver,
): Router {
  const router = Router();
  const auth: RequestHandler = (req, res, next) => {
    const reject = (error: unknown) => {
      void services.studioRepository
        .recordUnauthenticatedAccess(req.requestId)
        .then(() => next(error))
        .catch(next);
    };
    const token = /^Bearer ([^\s]+)$/u.exec(req.get('authorization') ?? '')?.[1];
    if (token === undefined) {
      reject(new AuthenticationRequiredError());
      return;
    }
    void resolver
      .resolve(token)
      .then((actor) => {
        res.locals.studioContext = {
          actorId: actor.accountId,
          requestId: req.requestId,
          accessToken: token,
        } satisfies MediaRequestContext;
        res.set('Cache-Control', 'no-store');
        next();
      })
      .catch(reject);
  };
  router.use(
    [
      '/invitation-templates',
      '/management/invitation-templates',
      '/bookings/:bookingId/invitations',
      '/bookings/:bookingId/invitation-image-generations',
      '/bookings/:bookingId/invitation-derived-assets',
      '/bookings/:bookingId/printable-revisions',
    ],
    auth,
  );
  function route(
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    schema: z.ZodType,
    work: (req: Request, res: Response) => Promise<unknown>,
    status = 200,
  ) {
    router[method](path, (req, res, next) => {
      void work(req, res)
        .then((data) => res.status(status).json(schema.parse({ data })))
        .catch(next);
    });
  }
  const noQuery = (req: Request) => parseStudio(empty, req.query);
  router.get(
    '/bookings/:bookingId/printable-revisions/:printableRevisionId/file',
    (req, res, next) => {
      void (async () => {
        const p = parseStudio(
          z.strictObject({ bookingId: id, printableRevisionId: id }),
          req.params,
        );
        const q = parseStudio(
          z.strictObject({ disposition: z.enum(['inline', 'attachment']).default('inline') }),
          req.query,
        );
        const file = await services.printFiles.read(
          p.bookingId,
          p.printableRevisionId,
          context(res),
        );
        res
          .set('Cache-Control', 'private, no-store')
          .set('Access-Control-Expose-Headers', schemas.PRINT_FILE_EXPOSED_HEADERS)
          .set(
            'Content-Disposition',
            `${q.disposition}; filename="invitation-${p.printableRevisionId}.pdf"`,
          )
          .set('X-Content-SHA256', file.sha256)
          .set('X-Printable-Content-Digest', file.contentDigest)
            .set('X-Renderer-Version', file.rendererVersion)
          .type('application/pdf')
          .send(file.bytes);
      })().catch(next);
    },
  );
  route('get', '/invitation-templates', schemas.templateListResponse, (req, res) =>
    services.designs.listTemplates(parseStudio(schemas.templateQuery, req.query), context(res)),
  );
  route(
    'get',
    '/management/invitation-templates',
    schemas.templateListResponse,
    async (req, res) => {
      await services.designs.access.manager(context(res));
      return services.designs.listTemplates(
        parseStudio(schemas.templateQuery, req.query),
        context(res),
      );
    },
  );
  route(
    'post',
    '/management/invitation-templates',
    schemas.templateResponse,
    (req, res) => {
      noQuery(req);
      const body = parseStudio(schemas.templateBody, req.body),
        commandKey = key(req);
      // Server-owned stable reservation makes an unknown create retry reuse the same aggregate.
      const hex = createHash('sha256')
        .update(JSON.stringify(['invitation-template', context(res).actorId, commandKey]))
        .digest('hex');
      const templateId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
      return services.designs.saveTemplate(
        { ...body, templateId, idempotencyKey: commandKey },
        context(res),
      );
    },
    201,
  );
  route(
    'patch',
    '/management/invitation-templates/:templateId',
    schemas.templateResponse,
    (req, res) => {
      noQuery(req);
      const params = parseStudio(z.strictObject({ templateId: id }), req.params);
      return services.designs.saveTemplate(
        { ...parseStudio(schemas.templateBody, req.body), ...params, idempotencyKey: key(req) },
        context(res),
      );
    },
  );
  route(
    'get',
    '/management/invitation-templates/:templateId',
    schemas.templateResponse,
    (req, res) => {
      const params = parseStudio(z.strictObject({ templateId: id }), req.params),
        query = parseStudio(z.strictObject({ versionId: id.optional() }), req.query);
      return services.designs.getTemplate(params.templateId, context(res), query.versionId);
    },
  );
  route('get', '/bookings/:bookingId/invitations', schemas.designListResponse, (req, res) =>
    services.designs.list(
      parseStudio(bookParams, req.params).bookingId,
      parseStudio(schemas.pageQuery, req.query),
      context(res),
    ),
  );
  route('get', '/bookings/:bookingId/invitations/:designId', schemas.designResponse, (req, res) => {
    noQuery(req);
    const p = parseStudio(designParams, req.params);
    return services.designs.get(p.bookingId, p.designId, context(res));
  });
  route(
    'post',
    '/bookings/:bookingId/invitations',
    schemas.designResponse,
    (req, res) => {
      noQuery(req);
      return services.designs.create(
        {
          ...parseStudio(bookParams, req.params),
          ...parseStudio(schemas.createDesignBody, req.body),
          idempotencyKey: key(req),
        },
        context(res),
      );
    },
    201,
  );
  route(
    'post',
    '/bookings/:bookingId/invitations/:designId/revisions',
    schemas.designResponse,
    (req, res) => {
      noQuery(req);
      return services.designs.edit(
        {
          ...parseStudio(designParams, req.params),
          ...parseStudio(schemas.editDesignBody, req.body),
          idempotencyKey: key(req),
        },
        context(res),
      );
    },
    201,
  );
  route(
    'post',
    '/bookings/:bookingId/invitations/:designId/publication',
    schemas.publicationResponse,
    (req, res) => {
      noQuery(req);
      return services.publication.publish(
        {
          ...parseStudio(designParams, req.params),
          ...parseStudio(schemas.publishBody, req.body),
          idempotencyKey: key(req),
        },
        context(res),
      );
    },
  );
  route(
    'delete',
    '/bookings/:bookingId/invitations/:designId/publication',
    schemas.unpublicationResponse,
    (req, res) => {
      noQuery(req);
      return services.publication.unpublish(
        {
          ...parseStudio(designParams, req.params),
          ...parseStudio(schemas.unpublishBody, req.body),
          idempotencyKey: key(req),
        },
        context(res),
      );
    },
  );
  route(
    'post',
    '/bookings/:bookingId/invitation-image-generations',
    mediaAssetResponseSchema,
    (req, res) => {
      noQuery(req);
      return services.generation.generate(
        {
          ...parseStudio(bookParams, req.params),
          ...parseStudio(schemas.generationBody, req.body),
          idempotencyKey: key(req),
        },
        context(res),
      );
    },
    201,
  );
  route(
    'get',
    '/bookings/:bookingId/invitation-image-generations',
    schemas.generationPendingResponse,
    (req, res) =>
      services.generation.listPending(
        parseStudio(bookParams, req.params).bookingId,
        parseStudio(schemas.generationRecoveryQuery, req.query),
        context(res),
      ),
  );
  route(
    'post',
    '/bookings/:bookingId/invitation-image-generations/:intentDigest/reconciliation',
    schemas.generationReconcileResponse,
    (req, res) => {
      noQuery(req);
      return services.generation.reconcile(
        {
          ...parseStudio(
            bookParams.extend({ intentDigest: schemas.generationIntentDigest }),
            req.params,
          ),
          ...parseStudio(schemas.generationReconcileBody, req.body),
          idempotencyKey: key(req),
        },
        context(res),
      );
    },
  );
  route(
    'post',
    '/bookings/:bookingId/invitation-derived-assets',
    schemas.derivedResponse,
    (req, res) => {
      noQuery(req);
      return services.derivedAssets.derive(
        {
          ...parseStudio(bookParams, req.params),
          ...parseStudio(schemas.deriveBody, req.body),
          idempotencyKey: key(req),
        },
        context(res),
      );
    },
    201,
  );
  route('get', '/public/invitations/:slug', schemas.publicResponse, (req, res) => {
    noQuery(req);
    res.set('Cache-Control', 'no-store');
    return services.publication.readPublic(req.params.slug as string);
  });
  router.get('/public/invitations/:slug/render', (req, res, next) => {
    void (async () => {
      noQuery(req);
      const dto = await services.publication.readPublic(req.params.slug);
      res
        .set('Cache-Control', 'no-store')
        .set(
          'Content-Security-Policy',
          "default-src 'none'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'",
        )
        .type('html')
        .send(renderPublicInvitation(dto));
    })().catch(next);
  });
  router.get('/public/invitations/:slug/qr', (req, res, next) => {
    void (async () => {
      noQuery(req);
      const dto = await services.publication.readPublic(req.params.slug);
      const png = await QRCode.toBuffer(dto.genericQrPayload, {
        type: 'png',
        errorCorrectionLevel: 'M',
      });
      res.set('Cache-Control', 'no-store').type('png').send(png);
    })().catch(next);
  });
  router.get('/public/invitation-assets/:slug', (req, res, next) => {
    void (async () => {
      noQuery(req);
      const bytes = await services.derivedAssets.readPublic(req.params.slug);
      res.set('Cache-Control', 'no-store').type('png').send(Buffer.from(bytes));
    })().catch(next);
  });
  router.use(createPrintOrdersRouter(services, resolver));
  return router;
}
