'use client';
/**
 * One shared org-level SSE connection (`/orgs/:orgId/stream`, no board) per org per tab.
 * Consumers subscribe with listeners; the EventSource opens on the first subscriber and closes
 * after the last one leaves, so shell, notifications and others never stack connections.
 */
import type { RealtimeEvent } from '@/server/realtime/events';
import { buildApiUrl } from './api';

export interface OrgStreamListener {
  readonly onChange?: (event: RealtimeEvent) => void;
  /** The server could not deliver every event (reconnect / burst): refetch what you show. */
  readonly onResync?: () => void;
}

interface Connection {
  source: EventSource | null;
  retryTimer: number | null;
  attempts: number;
  readonly listeners: Set<OrgStreamListener>;
}

const connections = new Map<string, Connection>();
const RETRY_BASE_MS = 3_000;
const RETRY_MAX_MS = 60_000;

/** Backoff for reconnecting after the server refused the stream (EventSource gives up on HTTP errors). */
export function streamRetryDelay(attempt: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempt));
}

function connect(orgId: string, connection: Connection): void {
  const source = new EventSource(buildApiUrl(`/orgs/${orgId}/stream`), { withCredentials: true });
  connection.source = source;
  source.addEventListener('open', () => {
    // After a reconnect, events may have been missed: let consumers refetch.
    if (connection.attempts > 0) for (const listener of connection.listeners) listener.onResync?.();
    connection.attempts = 0;
  });
  source.addEventListener('change', (message) => {
    let event: RealtimeEvent;
    try {
      event = JSON.parse((message as MessageEvent<string>).data) as RealtimeEvent;
    } catch {
      return; // malformed frame: the next event or a resync refreshes
    }
    for (const listener of connection.listeners) listener.onChange?.(event);
  });
  source.addEventListener('resync', () => {
    for (const listener of connection.listeners) listener.onResync?.();
  });
  source.addEventListener('error', () => {
    // Network blips reconnect on their own; an HTTP error closes the source for good.
    if (source.readyState !== EventSource.CLOSED || connection.listeners.size === 0) return;
    source.close();
    connection.source = null;
    const delay = streamRetryDelay(connection.attempts);
    connection.attempts += 1;
    connection.retryTimer = window.setTimeout(() => {
      connection.retryTimer = null;
      if (connection.listeners.size > 0 && connections.get(orgId) === connection) connect(orgId, connection);
    }, delay);
  });
}

/** Subscribe to the org event stream; returns the unsubscribe function. */
export function subscribeOrgStream(orgId: string, listener: OrgStreamListener): () => void {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') return () => undefined;
  let connection = connections.get(orgId);
  if (!connection) {
    connection = { source: null, retryTimer: null, attempts: 0, listeners: new Set() };
    connections.set(orgId, connection);
    connect(orgId, connection);
  }
  connection.listeners.add(listener);
  return () => {
    const current = connections.get(orgId);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size === 0) {
      current.source?.close();
      if (current.retryTimer !== null) window.clearTimeout(current.retryTimer);
      connections.delete(orgId);
    }
  };
}
