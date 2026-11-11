/**
 * One dedicated LISTEN connection per process, fanned out to in-memory subscribers (SSE
 * streams). Reconnects with exponential backoff; subscribers are notified of resyncs so they
 * can tell clients to refetch anything they may have missed.
 */
import pg from 'pg';
import { env } from '@/server/env';
import { logger } from '@/server/logger';
import { REALTIME_CHANNEL, realtimeEventSchema, type RealtimeEvent } from './events';

export type Subscriber = {
  readonly orgId: string;
  readonly onEvent: (event: RealtimeEvent) => void;
  /** Called after the listener reconnected (events may have been missed). */
  readonly onResync?: () => void;
};

const MAX_BACKOFF_MS = 30_000;

class RealtimeListener {
  private client: pg.Client | null = null;
  private connecting: Promise<void> | null = null;
  private readonly subscribers = new Set<Subscriber>();
  private backoffMs = 500;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private hadConnection = false;

  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);
    void this.ensureConnected();
    return () => {
      this.subscribers.delete(subscriber);
      if (this.subscribers.size === 0) this.scheduleIdleClose();
    };
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  private scheduleIdleClose(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.subscribers.size === 0) void this.close();
    }, 60_000);
    this.idleTimer.unref?.();
  }

  private async ensureConnected(): Promise<void> {
    if (this.client) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.connect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async connect(): Promise<void> {
    const client = new pg.Client({
      connectionString: env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL,
      application_name: 'kitstak-realtime',
      keepAlive: true,
    });
    client.on('notification', (message) => this.dispatch(message.payload));
    client.on('error', (error) => {
      logger.warn('realtime.listener_error', { error });
      this.handleDisconnect(client);
    });
    client.on('end', () => this.handleDisconnect(client));
    try {
      await client.connect();
      await client.query(`LISTEN ${REALTIME_CHANNEL}`);
      this.client = client;
      this.backoffMs = 500;
      if (this.hadConnection) for (const subscriber of this.subscribers) subscriber.onResync?.();
      this.hadConnection = true;
    } catch (error) {
      logger.warn('realtime.listener_connect_failed', { error });
      void client.end().catch(() => undefined);
      this.scheduleReconnect();
    }
  }

  private handleDisconnect(client: pg.Client): void {
    if (this.client !== client) return;
    this.client = null;
    void client.end().catch(() => undefined);
    if (this.subscribers.size > 0) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.subscribers.size > 0) void this.ensureConnected();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private dispatch(payload: string | undefined): void {
    if (!payload) return;
    let event: RealtimeEvent;
    try {
      const parsed = realtimeEventSchema.safeParse(JSON.parse(payload));
      if (!parsed.success) return;
      event = parsed.data;
    } catch {
      return;
    }
    for (const subscriber of this.subscribers) {
      if (subscriber.orgId !== event.orgId) continue;
      try {
        subscriber.onEvent(event);
      } catch (error) {
        logger.warn('realtime.subscriber_failed', { error });
      }
    }
  }

  private async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client) await client.end().catch(() => undefined);
  }
}

interface ListenerGlobal {
  __kitstakRealtime?: RealtimeListener;
}
const slot = globalThis as typeof globalThis & ListenerGlobal;

export function getRealtimeListener(): RealtimeListener {
  slot.__kitstakRealtime ??= new RealtimeListener();
  return slot.__kitstakRealtime;
}
