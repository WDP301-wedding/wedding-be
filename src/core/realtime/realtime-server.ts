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
const MAX_SOCKETS_PER_IP = 50;
const MAX_SOCKETS_PER_ACCOUNT = 10;
const MAX_SUBSCRIPTIONS_PER_SOCKET = 20;

export function createRealtimeServer(options: RealtimeServerOptions): RealtimeServerInstance {
  const { httpServer, config, sessionRepository, prisma, redisManager, logger } = options;

  const socketsByIp = new Map<string, Set<string>>();
  const socketsByAccount = new Map<string, Set<string>>();
  const socketsBySession = new Map<string, Set<string>>();

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
      io.adapter(createAdapter(pubSub.pub, pubSub.sub));
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

  async function validateSocketSession(socket: ConnectedSocket): Promise<boolean> {
    const now = Date.now();
    // Cache positive session validation for 2 seconds to avoid DB N+1 per message
    if (now - socket.data.lastSessionValidatedAt < 2000) {
      return true;
    }
    if (now > socket.data.tokenExpiresAt) {
      logger?.info(
        { socketId: socket.id, sessionId: socket.data.actor.sessionId },
        'Socket evicted: access token expired.',
      );
      socket.disconnect(true);
      return false;
    }
    try {
      const actor = await sessionRepository.findActorByAccessTokenHash(socket.data.tokenHash);
      if (!actor || actor.sessionStatus !== 'ACTIVE' || actor.accountStatus !== 'ACTIVE') {
        logger?.info(
          {
            socketId: socket.id,
            sessionId: socket.data.actor.sessionId,
            status: actor?.sessionStatus,
          },
          'Socket evicted: session or account is no longer active.',
        );
        socket.disconnect(true);
        return false;
      }
      socket.data.lastSessionValidatedAt = now;
      return true;
    } catch (err) {
      logger?.warn({ err, socketId: socket.id }, 'Session validation lookup failed.');
      return true;
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

      // 3. IP connection limit check
      const clientIp =
        socket.handshake.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
        socket.handshake.address ||
        'unknown';
      const ipSockets = socketsByIp.get(clientIp);
      if (ipSockets && ipSockets.size >= MAX_SOCKETS_PER_IP) {
        logger?.warn({ clientIp }, 'Handshake rejected: IP socket connection limit reached.');
        return next(new Error('IP_CONNECTION_LIMIT_EXCEEDED'));
      }

      try {
        const actor = await actorResolver.resolve(token);

        // Account connection limit check
        const accountSockets = socketsByAccount.get(actor.accountId);
        if (accountSockets && accountSockets.size >= MAX_SOCKETS_PER_ACCOUNT) {
          logger?.warn(
            { accountId: actor.accountId },
            'Handshake rejected: account socket connection limit reached.',
          );
          return next(new Error('ACCOUNT_CONNECTION_LIMIT_EXCEEDED'));
        }

        // Check couple access level if role is COUPLE
        let accessLevel: 'restricted' | 'full' | undefined;
        if (actor.roles.includes('COUPLE')) {
          const grants = await prisma.consultationAccess.findMany({
            where: { accountId: actor.accountId },
            select: { level: true },
          });
          accessLevel = grants.some((g) => g.level === 'FULL') ? 'full' : 'restricted';
        }

        const tokenHash = hashOpaqueToken(token, 'access');
        socket.data = {
          actor: {
            accountId: actor.accountId,
            displayEmail: actor.displayEmail,
            roles: actor.roles,
            sessionId: actor.sessionId,
            ...(accessLevel ? { access: accessLevel } : {}),
          },
          tokenHash,
          tokenExpiresAt: Date.now() + 15 * 60 * 1000,
          lastSessionValidatedAt: Date.now(),
          messageCount: 0,
          lastMessageReset: Date.now(),
          subscriptions: new Set(),
        };

        next();
      } catch (err) {
        logger?.debug({ err }, 'Realtime socket authentication failed.');
        next(new Error('AUTHENTICATION_FAILED'));
      }
    })();
  });

  // Broker with pre-dispatch verification hook: validates sockets in target rooms before delivery
  const broker = createRealtimeBroker(io, logger, async (rooms) => {
    for (const room of rooms) {
      const socketIds = io.sockets.adapter.rooms.get(room);
      if (socketIds) {
        for (const socketId of Array.from(socketIds)) {
          const targetSocket = io.sockets.sockets.get(socketId);
          if (targetSocket) {
            await validateSocketSession(targetSocket);
          }
        }
      }
    }
  });

  // Periodic session audit to evict expired or revoked sockets even during low traffic
  const sweepTimer = setInterval(() => {
    for (const socket of io.sockets.sockets.values()) {
      void validateSocketSession(socket);
    }
  }, 5_000);

  // Connection Lifecycle
  io.on('connection', async (socket) => {
    const actor = socket.data.actor;
    const clientIp =
      socket.handshake.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
      socket.handshake.address ||
      'unknown';

    // Track active socket connections by IP, account, and session
    if (!socketsByIp.has(clientIp)) socketsByIp.set(clientIp, new Set());
    socketsByIp.get(clientIp)!.add(socket.id);

    if (!socketsByAccount.has(actor.accountId)) socketsByAccount.set(actor.accountId, new Set());
    socketsByAccount.get(actor.accountId)!.add(socket.id);

    if (!socketsBySession.has(actor.sessionId)) socketsBySession.set(actor.sessionId, new Set());
    socketsBySession.get(actor.sessionId)!.add(socket.id);

    logger?.debug(
      { accountId: actor.accountId, roles: actor.roles, socketId: socket.id },
      'Realtime socket connected.',
    );

    // 1. Automatically join personal and session rooms
    await socket.join(`account:${actor.accountId}`);
    await socket.join(`session:${actor.sessionId}`);
    await socket.join('public:catalog');

    // 2. Automatically join role rooms
    if (actor.roles.includes('MANAGER')) {
      await socket.join('role:manager');
    }
    if (actor.roles.includes('STAFF')) {
      await socket.join('role:staff');
    }

    // 3. Message Rate Limiting Middleware per socket
    socket.use(([event], next) => {
      const now = Date.now();
      if (now - socket.data.lastMessageReset > 10_000) {
        socket.data.messageCount = 0;
        socket.data.lastMessageReset = now;
      }
      socket.data.messageCount += 1;
      if (socket.data.messageCount > 30) {
        logger?.warn({ accountId: actor.accountId, event }, 'Socket message rate limit exceeded.');
        socket.disconnect(true);
        return next(new Error('RATE_LIMIT_EXCEEDED'));
      }
      next();
    });

    // 4. Booking subscription handler with shape validation and authorization
    socket.on('subscribe:booking', async (data) => {
      try {
        const bookingId = data?.bookingId;
        if (typeof bookingId !== 'string' || !UUID_REGEX.test(bookingId)) {
          socket.emit('subscription:denied', { reason: 'INVALID_BOOKING_ID', bookingId });
          return;
        }

        if (socket.data.subscriptions.size >= MAX_SUBSCRIPTIONS_PER_SOCKET) {
          socket.emit('subscription:denied', {
            reason: 'SUBSCRIPTION_LIMIT_EXCEEDED',
            bookingId,
          });
          return;
        }

        // Validate session is still active before granting new room subscriptions
        const active = await validateSocketSession(socket);
        if (!active) return;

        // Authorization check
        if (actor.roles.includes('MANAGER')) {
          await socket.join(`booking:${bookingId}`);
          socket.data.subscriptions.add(bookingId);
          socket.emit('subscription:confirmed', { room: `booking:${bookingId}` });
          return;
        }

        if (actor.roles.includes('COUPLE')) {
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
              accountId: actor.accountId,
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

        if (actor.roles.includes('STAFF')) {
          const assignment = await prisma.staffAssignment.findFirst({
            where: {
              bookingId,
              staffAccountId: actor.accountId,
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
      socketsByIp.get(clientIp)?.delete(socket.id);
      if (socketsByIp.get(clientIp)?.size === 0) socketsByIp.delete(clientIp);

      socketsByAccount.get(actor.accountId)?.delete(socket.id);
      if (socketsByAccount.get(actor.accountId)?.size === 0) socketsByAccount.delete(actor.accountId);

      socketsBySession.get(actor.sessionId)?.delete(socket.id);
      if (socketsBySession.get(actor.sessionId)?.size === 0) socketsBySession.delete(actor.sessionId);

      logger?.debug(
        { accountId: actor.accountId, socketId: socket.id, reason },
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
