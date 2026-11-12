/**
 * Server-Sent Events stream for a board page. Forwards org events for the board (and
 * notification events addressed to the user), sends a heartbeat comment every 25s so
 * proxies keep the connection open, and cleans up on client disconnect.
 *
 * Wire format:
 *   event: ready    data: {"boardId": ...}
 *   event: change   data: <RealtimeEvent>
 *   event: resync   data: {}           (listener reconnected — refetch everything)
 *   : heartbeat
 */
import type { RealtimeEvent } from './events';
import { getRealtimeListener } from './listener';

export const HEARTBEAT_MS = 25_000;
/** Max events forwarded per second per stream; bursts beyond collapse into a resync. */
const MAX_EVENTS_PER_SECOND = 50;

export interface StreamOptions {
  readonly orgId: string;
  readonly userId: string;
  readonly boardId: string | null;
  readonly signal: AbortSignal;
  /** Custom delivery filter (replaces the board filter), e.g. a dashboard's source boards. */
  readonly deliver?: (event: RealtimeEvent) => boolean;
}

/** Whether a subscriber for `options` should receive `event`. */
export function shouldDeliver(
  event: RealtimeEvent,
  options: Pick<StreamOptions, 'orgId' | 'userId' | 'boardId'>,
): boolean {
  if (event.orgId !== options.orgId) return false;
  if (event.type === 'notifications.changed') return event.userIds.includes(options.userId);
  if (event.type === 'workspace.changed') return true;
  if (options.boardId === null) return false;
  return event.boardId === options.boardId;
}

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function createBoardEventStream(options: StreamOptions): Response {
  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let windowStart = Date.now();
      let windowCount = 0;
      let throttled = false;

      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          close();
        }
      };

      const unsubscribe = getRealtimeListener().subscribe({
        orgId: options.orgId,
        onEvent: (event) => {
          if (!(options.deliver ? options.deliver(event) : shouldDeliver(event, options))) return;
          const now = Date.now();
          if (now - windowStart >= 1_000) {
            if (throttled) send(frame('resync', {}));
            windowStart = now;
            windowCount = 0;
            throttled = false;
          }
          windowCount += 1;
          if (windowCount > MAX_EVENTS_PER_SECOND) {
            throttled = true;
            return;
          }
          send(frame('change', event));
        },
        onResync: () => send(frame('resync', {})),
      });

      const heartbeat = setInterval(() => send(': heartbeat\n\n'), HEARTBEAT_MS);

      function close() {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        options.signal.removeEventListener('abort', close);
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
      cleanup = close;
      options.signal.addEventListener('abort', close);
      send('retry: 3000\n\n');
      send(frame('ready', { boardId: options.boardId }));
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
