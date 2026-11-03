import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it, vi } from 'vitest';

import { createRealtimeServer } from '../../src/core/realtime/realtime-server.js';
import { createRedisManager } from '../../src/core/redis/redis-client.js';
import type { AccessCredentialState } from '../../src/modules/identity-access/session/session.repository.js';
import { parseEnvironment } from '../../src/config/env.js';

it('bounds pending database authentication on a single realtime transport', async () => {
  // Engine.IO counts this as one connection. Socket.IO can receive multiple
  // namespace CONNECT packets before its asynchronous authentication completes.
  // None may bypass admission and enqueue another database lookup.
  const http = createServer((_request, response) => response.end());
  let finishLookup!: () => void;
  const pendingLookup = new Promise<null>((resolve) => {
    finishLookup = () => resolve(null);
  });
  const lookup = vi.fn(() => pendingLookup);
  const realtime = createRealtimeServer({
    httpServer: http,
    config: parseEnvironment({ NODE_ENV: 'test' }),
    sessionRepository: { findActorByAccessTokenHash: lookup },
    prisma: {} as Parameters<typeof createRealtimeServer>[0]['prisma'],
    redisManager: createRedisManager({ environment: 'test' }),
  });
  let socket: WebSocket | undefined;
  try {
    http.listen(0, '127.0.0.1');
    await once(http, 'listening');
    const address = http.address();
    if (!address || typeof address === 'string') throw new Error('Missing local server address.');
    socket = new WebSocket(`ws://127.0.0.1:${address.port}/realtime/?EIO=4&transport=websocket`);
    await new Promise<void>((resolve, reject) => {
      socket!.addEventListener('message', () => resolve(), { once: true });
      socket!.addEventListener('error', () => reject(new Error('Local websocket failed.')), {
        once: true,
      });
    });
    const connectPacket = `40${JSON.stringify({ token: `wia_${'a'.repeat(43)}` })}`;
    for (let n = 0; n < 60; n++) socket.send(connectPacket);
    await vi.waitFor(() => expect(lookup).toHaveBeenCalled());
    await delay(50);
    expect(realtime.io.engine.clientsCount).toBeLessThanOrEqual(1);
    expect(lookup.mock.calls.length).toBeLessThanOrEqual(1);
  } finally {
    finishLookup();
    socket?.close();
    await realtime.close();
    if (http.listening) await new Promise<void>((resolve) => http.close(() => resolve()));
  }
});

it('bounds pending authentication across separate transports and releases admission after failure', async () => {
  const fixture = await admissionFixture();
  try {
    const sockets = await Promise.all(Array.from({ length: 40 }, () => fixture.connect()));
    for (const socket of sockets) socket.send(connectPacket);
    await vi.waitFor(() => expect(fixture.lookup.mock.calls.length).toBeGreaterThanOrEqual(32));
    await delay(50);
    expect(fixture.lookup.mock.calls.length).toBe(32);
    // Closing a transport cannot release its admission while the database work
    // is still unresolved, or rapid open/close cycles could bypass the bound.
    for (const socket of sockets) socket.close();
    await vi.waitFor(() => expect(fixture.realtime.io.engine.clientsCount).toBe(0));
    const whilePending = await fixture.connect();
    whilePending.send(connectPacket);
    await delay(30);
    expect(fixture.lookup).toHaveBeenCalledTimes(32);
    fixture.finish(null);
    await vi.waitFor(() =>
      expect(sockets.some((socket) => socket.readyState === WebSocket.CLOSED)).toBe(true),
    );
    await delay(30);
    const retry = await fixture.connect();
    retry.send(connectPacket);
    await vi.waitFor(() => expect(fixture.lookup).toHaveBeenCalledTimes(33));
  } finally {
    await fixture.close();
  }
});

it('still connects a valid client after checking its current session', async () => {
  const fixture = await admissionFixture();
  try {
    const socket = await fixture.connect();
    const connected = new Promise<void>((resolve) => {
      socket.addEventListener('message', (event) => {
        if (String(event.data).startsWith('40')) resolve();
      });
    });
    socket.send(connectPacket);
    fixture.finish(activeCredential());
    await connected;
    expect(fixture.lookup).toHaveBeenCalledTimes(2);
    expect(fixture.realtime.io.sockets.sockets.size).toBe(1);
  } finally {
    await fixture.close();
  }
});

it('does not continue authentication after the pending transport closes', async () => {
  const fixture = await admissionFixture();
  try {
    const socket = await fixture.connect();
    socket.send(connectPacket);
    await vi.waitFor(() => expect(fixture.lookup).toHaveBeenCalledTimes(1));
    socket.close();
    await vi.waitFor(() => expect(fixture.realtime.io.engine.clientsCount).toBe(0));
    fixture.finish(activeCredential());
    await delay(30);
    expect(fixture.lookup).toHaveBeenCalledTimes(1);
  } finally {
    await fixture.close();
  }
});

const connectPacket = `40${JSON.stringify({ token: `wia_${'a'.repeat(43)}` })}`;

function activeCredential(): AccessCredentialState {
  return {
    accountId: '00000000-0000-4000-8000-000000000001',
    sessionId: '00000000-0000-4000-8000-000000000002',
    displayEmail: 'manager@example.test',
    credentialStatus: 'ACTIVE',
    credentialExpiresAt: new Date(Date.now() + 60_000),
    sessionStatus: 'ACTIVE',
    idleExpiresAt: new Date(Date.now() + 60_000),
    absoluteExpiresAt: new Date(Date.now() + 60_000),
    accountStatus: 'ACTIVE',
    roles: ['MANAGER'],
  };
}

async function admissionFixture() {
  const http = createServer((_request, response) => response.end());
  let finish!: (value: AccessCredentialState | null) => void;
  const pending = new Promise<AccessCredentialState | null>((resolve) => {
    finish = resolve;
  });
  const lookup = vi.fn(() => pending);
  const realtime = createRealtimeServer({
    httpServer: http,
    config: parseEnvironment({ NODE_ENV: 'test' }),
    sessionRepository: { findActorByAccessTokenHash: lookup },
    prisma: {} as Parameters<typeof createRealtimeServer>[0]['prisma'],
    redisManager: createRedisManager({ environment: 'test' }),
  });
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('Missing local server address.');
  const sockets: WebSocket[] = [];
  return {
    realtime,
    lookup,
    finish,
    async connect() {
      const socket = new WebSocket(
        `ws://127.0.0.1:${address.port}/realtime/?EIO=4&transport=websocket`,
      );
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener('message', () => resolve(), { once: true });
        socket.addEventListener('error', () => reject(new Error('Local websocket failed.')), {
          once: true,
        });
      });
      return socket;
    },
    async close() {
      finish(null);
      for (const socket of sockets) socket.close();
      await realtime.close();
      if (http.listening) await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
