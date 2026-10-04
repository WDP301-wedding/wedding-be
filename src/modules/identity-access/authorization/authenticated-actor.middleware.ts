import type { RequestHandler } from 'express';

import { AppError } from '../../../core/errors/app-error.js';
import { hashOpaqueToken } from '../crypto/token.js';
import type { AccountRole } from '../account/account.repository.js';
import type { SessionRepository } from '../session/session.repository.js';

export type AuthenticatedActor = Readonly<{
  accountId: string;
  sessionId: string;
  displayEmail: string;
  roles: readonly AccountRole[];
}>;

export type AuthenticatedActorResolver = Readonly<{
  resolve(accessToken: string): Promise<AuthenticatedActor>;
}>;

export class AuthenticationRequiredError extends AppError {
  constructor() {
    super({
      status: 401,
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Authentication is required.',
    });
  }
}

export class SessionRevokedError extends AppError {
  constructor() {
    super({
      status: 401,
      code: 'SESSION_REVOKED',
      message: 'The session is no longer active.',
    });
  }
}

export function createAuthenticatedActorResolver(
  repository: Pick<SessionRepository, 'findActorByAccessTokenHash'>,
  now: () => Date = () => new Date(),
): AuthenticatedActorResolver {
  return Object.freeze({
    async resolve(accessToken) {
      if (!/^wia_[A-Za-z0-9_-]{43}$/u.test(accessToken)) {
        throw new AuthenticationRequiredError();
      }
      const currentTime = now();
      if (!Number.isFinite(currentTime.getTime())) {
        throw new AuthenticationRequiredError();
      }
      const state = await repository.findActorByAccessTokenHash(
        hashOpaqueToken(accessToken, 'access'),
      );
      if (state === null || state.credentialStatus !== 'ACTIVE') {
        throw new AuthenticationRequiredError();
      }
      if (state.sessionStatus !== 'ACTIVE') {
        throw new SessionRevokedError();
      }
      if (
        !isFutureDate(state.credentialExpiresAt, currentTime) ||
        !isFutureDate(state.idleExpiresAt, currentTime) ||
        !isFutureDate(state.absoluteExpiresAt, currentTime) ||
        state.accountStatus !== 'ACTIVE'
      ) {
        throw new AuthenticationRequiredError();
      }
      return Object.freeze({
        accountId: state.accountId,
        sessionId: state.sessionId,
        displayEmail: state.displayEmail,
        roles: Object.freeze([...state.roles]),
      });
    },
  });
}

function isFutureDate(candidate: Date, now: Date): boolean {
  const milliseconds = candidate.getTime();
  return Number.isFinite(milliseconds) && milliseconds > now.getTime();
}

export function createAuthenticatedActorMiddleware(
  resolver: AuthenticatedActorResolver,
): RequestHandler {
  return (request, response, next) => {
    const accessToken = bearerToken(request.get('authorization'));
    if (accessToken === null) {
      next(new AuthenticationRequiredError());
      return;
    }
    void resolver
      .resolve(accessToken)
      .then((actor) => {
        response.locals.actor = actor;
        next();
      })
      .catch(next);
  };
}

function bearerToken(header: string | undefined): string | null {
  if (header === undefined) {
    return null;
  }
  const match = /^Bearer ([^\s]+)$/u.exec(header);
  return match?.[1] ?? null;
}
