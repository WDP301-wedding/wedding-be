import { randomUUID } from 'node:crypto';

import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createErrorHandler } from '../../../core/errors/error-handler.js';
import type { AccessCredentialState, SessionRepository } from '../session/session.repository.js';
import {
  createAuthenticatedActorMiddleware,
  createAuthenticatedActorResolver,
} from './authenticated-actor.middleware.js';

class ActorRepository implements Pick<SessionRepository, 'findActorByAccessTokenHash'> {
  state: AccessCredentialState | null = null;

  findActorByAccessTokenHash(): Promise<AccessCredentialState | null> {
    return Promise.resolve(this.state);
  }
}

function activeState(): AccessCredentialState {
  return {
    accountId: randomUUID(),
    sessionId: randomUUID(),
    displayEmail: 'couple@example.com',
    credentialStatus: 'ACTIVE',
    credentialExpiresAt: new Date('2026-10-03T00:10:00.000Z'),
    sessionStatus: 'ACTIVE',
    idleExpiresAt: new Date('2026-11-02T00:00:00.000Z'),
    absoluteExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
    accountStatus: 'ACTIVE',
    roles: ['COUPLE'],
  };
}

describe('ACC-007 authenticated actor middleware', () => {
  it('ignores forged request claims and resolves the immutable actor from current state', async () => {
    const repository = new ActorRepository();
    repository.state = activeState();
    const resolver = createAuthenticatedActorResolver(
      repository,
      () => new Date('2026-10-03T00:00:00.000Z'),
    );
    const app = express();
    app.use(express.json());
    app.post('/protected', createAuthenticatedActorMiddleware(resolver), (_request, response) => {
      response.json(response.locals.actor);
    });
    app.use(createErrorHandler());

    const response = await request(app)
      .post('/protected?accountId=attacker&role=MANAGER')
      .set('authorization', `Bearer wia_${'a'.repeat(43)}`)
      .send({ accountId: 'attacker', sessionId: 'forged', roles: ['MANAGER'] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      accountId: repository.state.accountId,
      sessionId: repository.state.sessionId,
      displayEmail: 'couple@example.com',
      roles: ['COUPLE'],
    });
    await expect(resolver.resolve(`wia_${'a'.repeat(43)}`)).resolves.toSatisfy(Object.isFrozen);
  });

  it.each([
    ['revoked credential', { credentialStatus: 'REVOKED' as const }],
    ['expired credential', { credentialExpiresAt: new Date('2026-10-03T00:00:00.000Z') }],
    ['revoked session', { sessionStatus: 'REVOKED' as const }],
    ['idle session', { idleExpiresAt: new Date('2026-10-03T00:00:00.000Z') }],
    ['absolute expiry', { absoluteExpiresAt: new Date('2026-10-03T00:00:00.000Z') }],
    ['invalid credential expiry', { credentialExpiresAt: new Date(Number.NaN) }],
    ['disabled account', { accountStatus: 'DISABLED' as const }],
  ])('fails closed for %s', async (_name, override) => {
    const repository = new ActorRepository();
    repository.state = { ...activeState(), ...override };
    const resolver = createAuthenticatedActorResolver(
      repository,
      () => new Date('2026-10-03T00:00:00.000Z'),
    );

    await expect(resolver.resolve(`wia_${'b'.repeat(43)}`)).rejects.toMatchObject({ status: 401 });
  });

  it('fails closed when the clock source is invalid', async () => {
    const repository = new ActorRepository();
    repository.state = activeState();
    const resolver = createAuthenticatedActorResolver(repository, () => new Date(Number.NaN));

    await expect(resolver.resolve(`wia_${'b'.repeat(43)}`)).rejects.toMatchObject({ status: 401 });
  });

  it('rejects missing, malformed, and unknown bearer credentials', async () => {
    const repository = new ActorRepository();
    const resolver = createAuthenticatedActorResolver(repository);
    const app = express();
    app.use((request_, _response, next) => {
      request_.requestId = randomUUID();
      next();
    });
    app.get('/protected', createAuthenticatedActorMiddleware(resolver), (_request, response) => {
      response.sendStatus(204);
    });
    app.use(createErrorHandler());

    await expect(request(app).get('/protected')).resolves.toMatchObject({ status: 401 });
    await expect(
      request(app).get('/protected').set('authorization', 'Bearer malformed value'),
    ).resolves.toMatchObject({ status: 401 });
    await expect(resolver.resolve(`wia_${'c'.repeat(43)}`)).rejects.toMatchObject({ status: 401 });
  });
});
