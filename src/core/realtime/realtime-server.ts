import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { Logger } from 'pino';
import type { BackendConfig } from '../../config/env.js';
import type { SessionRepository } from '../../modules/identity-access/session/session.repository.js';
import { createAuthenticatedActorResolver } from '../../modules/identity-access/authorization/authenticated-actor.middleware.js';
import { hashOpaqueToken } from '../../modules/identity-access/crypto/token.js';
import type { RedisManager } from '../redis/redis-client.js';
import {
  type ClientToServerEvents,
  type ServerToClientEvents,
  type SocketData,
} from './realtime-types.js';
import { createRealtimeBroker, type RealtimeBroker } from './realtime-broker.js';
import { createRealtimeAudience } from './realtime-audience.js';
import { createRealtimeLimits } from './realtime-limits.js';

export interface RealtimeServerOptions {
  readonly httpServer: HttpServer;
  readonly config: BackendConfig;
  readonly sessionRepository: Pick<SessionRepository, 'findActorByAccessTokenHash'>;
  readonly prisma: PrismaClient;
  readonly redisManager: RedisManager;
  readonly logger?: Logger;
}

export interface RealtimeServerInstance {
  readonly io: SocketIOServer<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
  >;
  readonly broker: RealtimeBroker;
  close(): Promise<void>;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SUBSCRIPTIONS_PER_SOCKET = 20;

export function createRealtimeServer(options: RealtimeServerOptions): RealtimeServerInstance {
  const { httpServer, config, sessionRepository, prisma, redisManager, logger } = options;

  const authorizeAudience = createRealtimeAudience(prisma);
  const limits = createRealtimeLimits(redisManager.getClient(), config.runtime.environment);

  const io = new SocketIOServer<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
  >(httpServer, {
    path: '/realtime',
    transports: ['websocket'],
    maxHttpBufferSize: 16 * 1024, // 16 KB max message payload
    cors: {
      origin: [...config.cors.allowedOrigins],
      credentials: true,
    },
    allowRequest: (req, callback) => {
      // Validate Origin explicitly during WebSocket upgrade handshake
      const origin = req.headers.origin;
      if (origin && !config.cors.allowedOrigins.includes(origin)) {
        logger?.warn({ origin }, 'Realtime handshake rejected: origin not in allowlist.');
        return callback(null, false);
      }
      callback(null, true);
    },
  });

  // Attach Redis adapter for multi-instance fanout if Redis is configured
  if (redisManager.isConfigured) {
    const pubSub = redisManager.createPubSubPair();
    if (pubSub) {
      io.adapter(createAdapter(pubSub.pub, pubSub.sub, { key: `wedding:${config.runtime.environment}:socket.io` }));
      logger?.info('Socket.IO Redis multi-instance fanout adapter enabled.');
    }
  }

  const actorResolver = createAuthenticatedActorResolver(sessionRepository);

  type ConnectedSocket = Socket<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
  >;

  function extractClientIp(socket: Socket): string {
    const trustedHops = config.identityAccess?.trustedProxyHops ?? 0;
    if (trustedHops === 1) {
      const forwarded = socket.handshake.headers['x-forwarded-for'];
      if (typeof forwarded === 'string' && forwarded.trim()) {
        const parts = forwarded.split(',').map((p) => p.trim()).filter(Boolean);
        if (parts.length > 0) {
          return parts[parts.length - 1]!;
        }
      }
    }
    return socket.handshake.address || 'unknown';
  }

  async function validateSocketSession(socket: ConnectedSocket): Promise<boolean> {
    const now = Date.now();
    // 1. Expiry check MUST happen before positive cache check
    if (now > socket.data.tokenExpiresAt) {
      logger?.info(
        { socketId: socket.id, sessionId: socket.data.actor.sessionId },
        'Socket evicted: access token expired.',
      );
      socket.disconnect(true);
      return false;
    }

    try {
      const state = await sessionRepository.findActorByAccessTokenHash(socket.data.tokenHash);
      if (
        !state ||
        state.credentialStatus !== 'ACTIVE' ||
        state.sessionStatus !== 'ACTIVE' ||
        state.accountStatus !== 'ACTIVE' ||
        state.credentialExpiresAt.getTime() <= now ||
        state.idleExpiresAt.getTime() <= now ||
        state.absoluteExpiresAt.getTime() <= now
      ) {
        logger?.info(
          {
            socketId: socket.id,
            sessionId: socket.data.actor.sessionId,
            status: state?.sessionStatus,
          },
          'Socket evicted: credential/session is no longer active or expired.',
        );
        socket.disconnect(true);
        return false;
      }
      socket.data.tokenExpiresAt = Math.min(
        state.credentialExpiresAt.getTime(),
        state.idleExpiresAt.getTime(),
        state.absoluteExpiresAt.getTime(),
      );
      socket.data.actor = {
        ...socket.data.actor,
        roles: state.roles,
      };
      socket.data.lastSessionValidatedAt = now;
      return true;
    } catch (err) {
      logger?.warn({ err, socketId: socket.id }, 'Session validation lookup failed.');
      // FAIL-CLOSED: disconnect socket on authority lookup failure
      socket.disconnect(true);
      return false;
    }
  }

  // Authentication Handshake Middleware
  io.use((socket, next) => {
    void (async () => {
      // 1. Prohibit token passing in query strings (security rule: no tokens in URLs/logs)
      if (socket.handshake.query.token) {
        return next(new Error('TOKEN_IN_QUERY_PROHIBITED'));
      }

      // 2. Extract token from auth payload
      const auth = socket.handshake.auth as Record<string, unknown> | undefined;
      const token = auth?.token;
      if (typeof token !== 'string' || !token) {
        return next(new Error('AUTHENTICATION_REQUIRED'));
      }

      // 3. IP connection limit check with trusted proxy policy
      const clientIp = extractClientIp(socket);
      try {
        const actor = await actorResolver.resolve(token);
        const tokenHash = hashOpaqueToken(token, 'access');
        const state = await sessionRepository.findActorByAccessTokenHash(tokenHash);
        if (!state) {
          return next(new Error('AUTHENTICATION_REQUIRED'));
        }

        const now = Date.now();
        if (
          state.credentialStatus !== 'ACTIVE' ||
          state.sessionStatus !== 'ACTIVE' ||
          state.accountStatus !== 'ACTIVE' ||
          state.credentialExpiresAt.getTime() <= now ||
          state.idleExpiresAt.getTime() <= now ||
          state.absoluteExpiresAt.getTime() <= now
        ) {
          return next(new Error('TOKEN_EXPIRED'));
        }

        const actualTokenExpiry = Math.min(
          state.credentialExpiresAt.getTime(),
          state.idleExpiresAt.getTime(),
          state.absoluteExpiresAt.getTime(),
        );

        // Reserve IP/account slots atomically across nodes; failures are fail-closed.
        if (!await limits.reserve(clientIp, actor.accountId, socket.id)) {
          return next(new Error('CONNECTION_LIMIT_EXCEEDED'));
        }
        const release = () => { void limits.release(clientIp, actor.accountId, socket.id)
          .catch(err => logger?.warn({ err }, 'Socket reservation release failed; TTL will expire it.')); };
        socket.once('disconnect', release);
        socket.conn.once('close', release);

        // Check couple access level if role is COUPLE
        let accessLevel: 'restricted' | 'full' | undefined;
        if (actor.roles.includes('COUPLE')) {
          if (prisma.consultationAccess?.findMany) {
            const grants = await prisma.consultationAccess.findMany({
              where: { accountId: actor.accountId },
              select: { level: true },
            });
            accessLevel = grants.some((g) => g.level === 'FULL') ? 'full' : 'restricted';
          } else {
            accessLevel = 'restricted';
          }
        }

        socket.data = {
          actor: {
            accountId: actor.accountId,
            displayEmail: actor.displayEmail,
            roles: actor.roles,
            sessionId: actor.sessionId,
            ...(accessLevel ? { access: accessLevel } : {}),
          },
          tokenHash,
          tokenExpiresAt: actualTokenExpiry,
          lastSessionValidatedAt: now,
          messageCount: 0,
          lastMessageReset: now,
          subscriptions: new Set(),
        };

        next();
      } catch (err) {
        logger?.debug({ err }, 'Realtime socket authentication failed.');
        next(new Error('AUTHENTICATION_FAILED'));
      }
    })();
  });

  // fetchSockets reaches every Redis adapter node. Check authority in batches,
  // then dispatch only to authorized socket IDs, never to unchecked room members.
  const broker = createRealtimeBroker(io, logger, undefined, async (rooms, event) => {
    const sockets = await io.in([...rooms]).fetchSockets();
    const ids = await authorizeAudience(sockets, rooms, event);
    for (let offset = 0; offset < ids.length; offset += 200) {
      io.to(ids.slice(offset, offset + 200)).emit('realtime:event', event);
    }
  });

  let auditing = false;
  const sweepTimer = setInterval(() => {
    if (auditing) return;
    auditing = true;
    const sockets = [...io.sockets.sockets.values()];
    void (async () => {
      await authorizeAudience(sockets, []);
      for (const socket of sockets) {
        if (socket.connected && !await limits.reserve(extractClientIp(socket), socket.data.actor.accountId, socket.id)) {
          socket.disconnect(true);
        }
      }
    })().catch(err => {
      logger?.warn({ err }, 'Realtime authorization audit failed closed.');
      for (const socket of sockets) socket.disconnect(true);
    }).finally(() => { auditing = false; });
  }, 5_000);

  // Connection Lifecycle
  io.on('connection', async (socket) => {
    // Do NOT capture actor into a closure-level const here.
    // validateSocketSession() refreshes socket.data.actor.roles on each check;
    // if handlers captured actor at connect-time they would see stale roles after
    // a role change.  Each handler must read socket.data.actor at call time.
    logger?.debug(
      { accountId: socket.data.actor.accountId, roles: socket.data.actor.roles, socketId: socket.id },
      'Realtime socket connected.',
    );

    // 1. Automatically join personal and session rooms
    await socket.join(`account:${socket.data.actor.accountId}`);
    await socket.join(`session:${socket.data.actor.sessionId}`);
    await socket.join('public:catalog');

    // 2. Automatically join role rooms
    if (socket.data.actor.roles.includes('MANAGER')) {
      await socket.join('role:manager');
    }
    if (socket.data.actor.roles.includes('STAFF')) {
      await socket.join('role:staff');
    }

    // Preserve the per-socket policy, with Redis as the shared counter authority.
    socket.use((_packet, next) => {
      void limits.acceptMessage(socket.data.actor.accountId, socket.id).then(accepted => {
        if (accepted) { next(); return; }
        socket.disconnect(true);
        next(new Error('RATE_LIMIT_EXCEEDED'));
      }).catch(err => {
        logger?.warn({ err }, 'Realtime rate limiter failed closed.');
        socket.disconnect(true);
        next(new Error('RATE_LIMIT_UNAVAILABLE'));
      });
    });

    // 4. Booking subscription handler with shape validation and authorization
    socket.on('subscribe:booking', async (data) => {
      try {
        const bookingId = data?.bookingId;
        if (typeof bookingId !== 'string' || !UUID_REGEX.test(bookingId)) {
          socket.emit('subscription:denied', { reason: 'INVALID_BOOKING_ID', bookingId });
          return;
        }

        if (!socket.data.subscriptions.has(bookingId) && socket.data.subscriptions.size >= MAX_SUBSCRIPTIONS_PER_SOCKET) {
          socket.emit('subscription:denied', {
            reason: 'SUBSCRIPTION_LIMIT_EXCEEDED',
            bookingId,
          });
          return;
        }

        // Validate session is still active before granting new room subscriptions
        const active = await validateSocketSession(socket);
        if (!active) return;

        // Read roles from socket.data.actor AFTER the session validation refresh
        const currentActor = socket.data.actor;

        // Authorization check
        if (currentActor.roles.includes('MANAGER')) {
          await socket.join(`booking:${bookingId}`);
          socket.data.subscriptions.add(bookingId);
          socket.emit('subscription:confirmed', { room: `booking:${bookingId}` });
          return;
        }

        if (currentActor.roles.includes('COUPLE')) {
          // Verify booking belongs to this couple account
          const booking = await prisma.booking.findUnique({
            where: { id: bookingId },
            select: { consultationId: true },
          });

          if (!booking) {
            socket.emit('subscription:denied', { reason: 'BOOKING_NOT_FOUND', bookingId });
            return;
          }

          const grant = await prisma.consultationAccess.findFirst({
            where: {
              consultationId: booking.consultationId,
              accountId: currentActor.accountId,
              level: { in: ['RESTRICTED', 'FULL'] },
            },
          });

          if (!grant) {
            socket.emit('subscription:denied', { reason: 'UNAUTHORIZED_BOOKING', bookingId });
            return;
          }

          await socket.join(`booking:${bookingId}`);
          socket.data.subscriptions.add(bookingId);
          socket.emit('subscription:confirmed', { room: `booking:${bookingId}` });
          return;
        }

        if (currentActor.roles.includes('STAFF')) {
          const assignment = await prisma.staffAssignment.findFirst({
            where: {
              bookingId,
              staffAccountId: currentActor.accountId,
              status: 'ACTIVE',
            },
          });

          if (!assignment) {
            socket.emit('subscription:denied', { reason: 'UNASSIGNED_STAFF', bookingId });
            return;
          }

          await socket.join(`booking:${bookingId}`);
          socket.data.subscriptions.add(bookingId);
          socket.emit('subscription:confirmed', { room: `booking:${bookingId}` });
          return;
        }

        socket.emit('subscription:denied', { reason: 'FORBIDDEN', bookingId });
      } catch (err) {
        logger?.error({ err }, 'Error handling subscribe:booking.');
      }
    });

    socket.on('unsubscribe:booking', (data) => {
      try {
        const bookingId = data?.bookingId;
        if (typeof bookingId === 'string' && UUID_REGEX.test(bookingId)) {
          void socket.leave(`booking:${bookingId}`);
          socket.data.subscriptions.delete(bookingId);
        }
      } catch (err) {
        logger?.error({ err }, 'Error handling unsubscribe:booking.');
      }
    });

    socket.on('disconnect', (reason) => {
      logger?.debug(
        { accountId: socket.data.actor.accountId, socketId: socket.id, reason },
        'Realtime socket disconnected.',
      );
    });
  });

  return {
    io,
    broker,
    async close() {
      clearInterval(sweepTimer);
      await io.close();
    },
  };
}
