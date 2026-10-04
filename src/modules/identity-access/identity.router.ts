import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';

import { AppError, CorsOriginDeniedError, RateLimitError } from '../../core/errors/app-error.js';
import { validateRequest, validatedRequest } from '../../core/http/validate.js';
import { InvalidCredentialsError, InvalidEmailError } from './account/account.service.js';
import { PasswordPolicyError } from './crypto/password.js';
import type { AuthenticatedActor } from './authorization/authenticated-actor.middleware.js';
import { AuthenticationRequiredError } from './authorization/authenticated-actor.middleware.js';
import {
  androidRefreshBodySchema,
  currentUserResponseSchema,
  emptyWriteBodySchema,
  identityLoginBodySchema,
  invitationAcceptanceBodySchema,
  issuedSessionResponseSchema,
  passwordResetCompletionBodySchema,
  passwordResetCompletionResponseSchema,
  passwordResetRequestBodySchema,
  passwordResetRequestResponseSchema,
  refreshedSessionResponseSchema,
  sessionIdParamsSchema,
  sessionInventoryQuerySchema,
  sessionInventoryResponseSchema,
} from './identity.schemas.js';
import { InvalidOrExpiredResetTokenError } from './password-reset/password-reset.service.js';
import type { IssuedSession, RefreshedSession } from './session/session.service.js';
import {
  InvalidRefreshTokenError,
  LoginRateLimitedError,
  OwnedSessionNotFoundError,
  RefreshRateLimitedError,
  RefreshReplayError,
} from './session/session.service.js';
import type { SessionPage } from './session/session.repository.js';
import { InvalidOrExpiredInvitationError } from './workspace-invitation/workspace-invitation.acceptance.js';

export interface IdentityHttpServices {
  resolveActor(accessToken: string): Promise<AuthenticatedActor>;
  login(
    input: Readonly<{
      email: string;
      password: string;
      clientKind: 'WEB' | 'ANDROID';
      clientIp: string;
      requestId: string;
    }>,
  ): Promise<IssuedSession>;
  refresh(
    input: Readonly<{
      refreshToken: string;
      clientIp: string;
      requestId: string;
    }>,
  ): Promise<RefreshedSession>;
  logout(
    input: Readonly<{ accountId: string; sessionId: string; requestId: string }>,
  ): Promise<void>;
  listSessions(
    accountId: string,
    input?: Readonly<{ limit?: number; cursor?: string }>,
  ): Promise<SessionPage>;
  revokeOwnedSession(
    input: Readonly<{
      accountId: string;
      sessionId: string;
      requestId: string;
    }>,
  ): Promise<void>;
  requestPasswordReset(
    input: Readonly<{ email: string; clientIp: string; requestId: string }>,
  ): Promise<Readonly<{ accepted: true }>>;
  completePasswordReset(
    input: Readonly<{
      resetToken: string;
      newPassword: string;
      clientIp: string;
      requestId: string;
    }>,
  ): Promise<Readonly<{ completed: true }>>;
  acceptInvitation(
    input: Readonly<{
      invitationToken: string;
      password: string;
      clientIp: string;
      requestId: string;
    }>,
  ): Promise<IssuedSession>;
}

export function createIdentityRouter(
  options: Readonly<{
    services: IdentityHttpServices;
    allowedWebOrigins: readonly string[];
    refreshCookieName: '__Host-wedding-refresh';
  }>,
): Router {
  const router = Router();
  const allowedOrigins = new Set(options.allowedWebOrigins);
  const authenticate = createActorMiddleware(options.services);
  router.use((request, response, next) => {
    if (request.path.startsWith('/auth') || request.path === '/workspace-invitation-acceptances') {
      response.set('Cache-Control', 'no-store');
    }
    next();
  });

  router.post(
    '/auth/password-reset-requests',
    validateRequest({ body: passwordResetRequestBodySchema }),
    asyncHandler(async (request, response) => {
      const { body } = validatedRequest(response, { body: passwordResetRequestBodySchema });
      const result = await mapIdentityErrors(() =>
        options.services.requestPasswordReset({
          email: body.email,
          clientIp: readClientIp(request),
          requestId: request.requestId,
        }),
      );
      response.status(202).json(passwordResetRequestResponseSchema.parse({ data: result }));
    }),
  );

  router.post(
    '/auth/password-reset-completions',
    validateRequest({ body: passwordResetCompletionBodySchema }),
    asyncHandler(async (request, response) => {
      const { body } = validatedRequest(response, { body: passwordResetCompletionBodySchema });
      const result = await mapIdentityErrors(() =>
        options.services.completePasswordReset({
          ...body,
          clientIp: readClientIp(request),
          requestId: request.requestId,
        }),
      );
      response.json(passwordResetCompletionResponseSchema.parse({ data: result }));
    }),
  );

  router.post(
    '/workspace-invitation-acceptances',
    validateRequest({ body: invitationAcceptanceBodySchema }),
    asyncHandler(async (request, response) => {
      const { body } = validatedRequest(response, { body: invitationAcceptanceBodySchema });
      const issued = await mapIdentityErrors(() =>
        options.services.acceptInvitation({
          ...body,
          clientIp: readClientIp(request),
          requestId: request.requestId,
        }),
      );
      setRefreshCookie(
        response,
        options.refreshCookieName,
        issued.refreshToken,
        issued.refreshExpiresAt,
      );
      response
        .status(201)
        .json(issuedSessionResponseSchema.parse({ data: serializeIssuedSession(issued, false) }));
    }),
  );

  router.post(
    '/auth/web-sessions',
    validateRequest({ body: identityLoginBodySchema }),
    asyncHandler(async (request, response) => {
      const { body } = validatedRequest(response, { body: identityLoginBodySchema });
      const issued = await mapIdentityErrors(() =>
        options.services.login({
          ...body,
          clientKind: 'WEB',
          clientIp: readClientIp(request),
          requestId: request.requestId,
        }),
      );
      setRefreshCookie(
        response,
        options.refreshCookieName,
        issued.refreshToken,
        issued.refreshExpiresAt,
      );
      response.status(201).json(
        issuedSessionResponseSchema.parse({
          data: serializeIssuedSession(issued, false),
        }),
      );
    }),
  );

  router.post(
    '/auth/android-sessions',
    validateRequest({ body: identityLoginBodySchema }),
    asyncHandler(async (request, response) => {
      const { body } = validatedRequest(response, { body: identityLoginBodySchema });
      const issued = await mapIdentityErrors(() =>
        options.services.login({
          ...body,
          clientKind: 'ANDROID',
          clientIp: readClientIp(request),
          requestId: request.requestId,
        }),
      );
      response.status(201).json(
        issuedSessionResponseSchema.parse({
          data: serializeIssuedSession(issued, true),
        }),
      );
    }),
  );

  router.post(
    '/auth/web-session-refreshes',
    requireAllowedOrigin(allowedOrigins),
    validateRequest({ body: emptyWriteBodySchema }),
    asyncHandler(async (request, response) => {
      const refreshToken = readCookie(request.get('cookie'), options.refreshCookieName);
      if (refreshToken === null) {
        throw new InvalidTokenHttpError();
      }
      const refreshed = await mapIdentityErrors(() =>
        options.services.refresh({
          refreshToken,
          clientIp: readClientIp(request),
          requestId: request.requestId,
        }),
      );
      setRefreshCookie(
        response,
        options.refreshCookieName,
        refreshed.refreshToken,
        refreshed.refreshExpiresAt,
      );
      response.json(
        refreshedSessionResponseSchema.parse({ data: serializeRefreshedSession(refreshed, false) }),
      );
    }),
  );

  router.post(
    '/auth/android-session-refreshes',
    validateRequest({ body: androidRefreshBodySchema }),
    asyncHandler(async (request, response) => {
      const { body } = validatedRequest(response, { body: androidRefreshBodySchema });
      const refreshed = await mapIdentityErrors(() =>
        options.services.refresh({
          refreshToken: body.refreshToken,
          clientIp: readClientIp(request),
          requestId: request.requestId,
        }),
      );
      response.json(
        refreshedSessionResponseSchema.parse({ data: serializeRefreshedSession(refreshed, true) }),
      );
    }),
  );

  router.delete(
    '/auth/sessions/current',
    authenticate,
    asyncHandler(async (request, response) => {
      const actor = response.locals.actor as AuthenticatedActor;
      await options.services.logout({
        accountId: actor.accountId,
        sessionId: actor.sessionId,
        requestId: request.requestId,
      });
      clearRefreshCookie(response, options.refreshCookieName);
      response.sendStatus(204);
    }),
  );

  router.get('/auth/me', authenticate, (_request, response) => {
    const actor = response.locals.actor as AuthenticatedActor;
    response.json(currentUserResponseSchema.parse({ data: actor }));
  });

  router.get(
    '/auth/sessions',
    authenticate,
    validateRequest({ query: sessionInventoryQuerySchema }),
    asyncHandler(async (_request, response) => {
      const actor = response.locals.actor as AuthenticatedActor;
      const { query } = validatedRequest(response, { query: sessionInventoryQuerySchema });
      const page = await options.services.listSessions(actor.accountId, {
        limit: query.limit,
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      });
      response.json(
        sessionInventoryResponseSchema.parse({
          data: {
            sessions: page.sessions.map(serializeSessionSummary),
            nextCursor: page.nextCursor,
          },
        }),
      );
    }),
  );

  router.delete(
    '/auth/sessions/:sessionId',
    authenticate,
    validateRequest({ params: sessionIdParamsSchema }),
    asyncHandler(async (request, response) => {
      const actor = response.locals.actor as AuthenticatedActor;
      const { params } = validatedRequest(response, { params: sessionIdParamsSchema });
      await mapIdentityErrors(() =>
        options.services.revokeOwnedSession({
          accountId: actor.accountId,
          sessionId: params.sessionId,
          requestId: request.requestId,
        }),
      );
      response.sendStatus(204);
    }),
  );

  return router;
}

function createActorMiddleware(
  services: Pick<IdentityHttpServices, 'resolveActor'>,
): RequestHandler {
  return (request, response, next) => {
    const match = /^Bearer ([^\s]+)$/u.exec(request.get('authorization') ?? '');
    if (match?.[1] === undefined) {
      next(new AuthenticationRequiredError());
      return;
    }
    void services.resolveActor(match[1]).then((actor) => {
      response.locals.actor = actor;
      next();
    }, next);
  };
}

function requireAllowedOrigin(allowedOrigins: ReadonlySet<string>): RequestHandler {
  return (request, _response, next) => {
    const origin = request.get('origin');
    next(
      origin !== undefined && allowedOrigins.has(origin) ? undefined : new CorsOriginDeniedError(),
    );
  };
}

type AsyncRoute = (request: Request, response: Response, next: NextFunction) => Promise<unknown>;

function asyncHandler(handler: AsyncRoute): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

async function mapIdentityErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    if (error instanceof InvalidCredentialsError || error instanceof InvalidEmailError) {
      throw new InvalidCredentialsHttpError();
    }
    if (error instanceof LoginRateLimitedError || error instanceof RefreshRateLimitedError) {
      throw new RateLimitError(error.retryAfterSeconds);
    }
    if (error instanceof InvalidRefreshTokenError || error instanceof RefreshReplayError) {
      throw new InvalidTokenHttpError();
    }
    if (
      error instanceof InvalidOrExpiredResetTokenError ||
      error instanceof InvalidOrExpiredInvitationError
    ) {
      throw new InvalidTokenHttpError();
    }
    if (error instanceof PasswordPolicyError) {
      throw new AppError({
        status: 422,
        code: 'VALIDATION_ERROR',
        message: 'The request is invalid.',
      });
    }
    if (error instanceof OwnedSessionNotFoundError) {
      throw new AppError({
        status: 404,
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
      });
    }
    throw error;
  }
}

class InvalidCredentialsHttpError extends AppError {
  constructor() {
    super({
      status: 401,
      code: 'INVALID_CREDENTIALS',
      message: 'The supplied credentials are invalid.',
    });
  }
}

class InvalidTokenHttpError extends AppError {
  constructor() {
    super({
      status: 401,
      code: 'INVALID_OR_EXPIRED_TOKEN',
      message: 'The credential is invalid or expired.',
    });
  }
}

function serializeIssuedSession(session: IssuedSession, includeRefreshToken: boolean) {
  return {
    account: session.account,
    sessionId: session.sessionId,
    clientKind: session.clientKind,
    accessToken: session.accessToken,
    accessExpiresAt: session.accessExpiresAt.toISOString(),
    ...(includeRefreshToken ? { refreshToken: session.refreshToken } : {}),
    refreshExpiresAt: session.refreshExpiresAt.toISOString(),
    absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
  };
}

function serializeRefreshedSession(session: RefreshedSession, includeRefreshToken: boolean) {
  return {
    sessionId: session.sessionId,
    clientKind: session.clientKind,
    accessToken: session.accessToken,
    accessExpiresAt: session.accessExpiresAt.toISOString(),
    ...(includeRefreshToken ? { refreshToken: session.refreshToken } : {}),
    refreshExpiresAt: session.refreshExpiresAt.toISOString(),
  };
}

function serializeSessionSummary(session: SessionPage['sessions'][number]) {
  return {
    ...session,
    createdAt: session.createdAt.toISOString(),
    lastSeenAt: session.lastSeenAt.toISOString(),
    idleExpiresAt: session.idleExpiresAt.toISOString(),
    absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
  };
}

function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator > 0 && part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

function readClientIp(request: Request): string {
  return request.ip ?? request.socket.remoteAddress ?? '';
}

function setRefreshCookie(response: Response, name: string, token: string, expiresAt: Date): void {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1_000));
  response.setHeader(
    'Set-Cookie',
    `${name}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}; Expires=${expiresAt.toUTCString()}`,
  );
}

function clearRefreshCookie(response: Response, name: string): void {
  response.setHeader(
    'Set-Cookie',
    `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
  );
}
