export type RealtimeEventType =
  | 'booking.updated'
  | 'proposal.updated'
  | 'timeline.updated'
  | 'contract.updated'
  | 'deposit.received'
  | 'billing.updated'
  | 'guest.updated'
  | 'seating.updated'
  | 'print_order.updated'
  | 'catalog.updated'
  | 'notification.received'
  | 'session.revoked';

export type RealtimeScope = Readonly<{
  entityType: 'booking' | 'catalog' | 'account' | 'print_order' | 'session';
  entityId?: string;
  bookingId?: string;
  revision?: number;
}>;

export type RealtimeEvent<T = Record<string, unknown>> = Readonly<{
  eventId: string;
  schemaVersion: 1;
  type: RealtimeEventType;
  scope: RealtimeScope;
  resources: readonly string[];
  occurredAt: string;
  payload?: T;
}>;

export type RealtimeActor = Readonly<{
  accountId: string;
  displayEmail: string;
  roles: readonly ('COUPLE' | 'STAFF' | 'MANAGER' | 'ADMIN')[];
  sessionId: string;
  access?: 'restricted' | 'full';
}>;

export interface ServerToClientEvents {
  'realtime:event': (event: RealtimeEvent) => void;
  'subscription:denied': (data: { reason: string; bookingId?: string }) => void;
  'subscription:confirmed': (data: { room: string }) => void;
}

export interface ClientToServerEvents {
  'subscribe:booking': (data: { bookingId: string }) => void;
  'unsubscribe:booking': (data: { bookingId: string }) => void;
}

export interface SocketData {
  actor: RealtimeActor;
  tokenHash: string;
  tokenExpiresAt: number;
  lastSessionValidatedAt: number;
  messageCount: number;
  lastMessageReset: number;
  subscriptions: Set<string>;
}
