/**
 * Browser helpers for the floor tablet: calls to the kiosk endpoints and the retry queue kept in
 * the tablet's own storage. An entry gets its `clientRef` once, when it is typed, and every retry
 * sends that same id, so the server never logs it twice.
 */

export interface QueuedEntry {
  readonly clientRef: string;
  readonly jobId: string;
  readonly jobLabel: string;
  readonly workDate: string;
  readonly unitsGood: string;
  readonly unitsScrap: string;
  readonly headcount: string;
  readonly hoursEach: string;
  /** The kiosk session the entry was typed under. */
  readonly session: string;
  readonly personName: string;
  readonly savedAt: string;
  /** The session ran out before it could be sent: it goes out after the next unlock. */
  readonly needsUnlock?: boolean;
  /** The server refused it for good (closed month, job closed). Shown until a person clears it. */
  readonly failed?: string;
}

export type KioskResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly code: string; readonly message: string };

/** POST to `/api/v1/kiosk/<path>`. A dropped connection or a timeout comes back as `NETWORK_ERROR`. */
export async function kioskPost<T>(
  path: 'state' | 'unlock' | 'jobs' | 'production',
  body: Record<string, unknown>,
  timeoutMs = 12_000,
): Promise<KioskResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`/api/v1/kiosk/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    type Payload = { data?: T; error?: { code?: string; message?: string } };
    const payload: Payload | null = await response
      .json()
      .then((value) => value as Payload)
      .catch(() => null);
    if (response.ok && payload && 'data' in payload) return { ok: true, data: payload.data as T };
    // A gateway or proxy error with no JSON body is treated like a dropped connection: try again later.
    if (!payload?.error && response.status >= 500)
      return {
        ok: false,
        code: 'NETWORK_ERROR',
        message: 'The server did not answer. The tablet will try again.',
      };
    return {
      ok: false,
      code: payload?.error?.code ?? 'INTERNAL',
      message: payload?.error?.message ?? 'Something went wrong. Please try again.',
    };
  } catch {
    return { ok: false, code: 'NETWORK_ERROR', message: 'No connection. The tablet will try again.' };
  } finally {
    clearTimeout(timer);
  }
}

const storageKey = (token: string): string => `pulse-kiosk-queue:${token.slice(0, 10)}`;

function isEntry(value: unknown): value is QueuedEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.clientRef === 'string' &&
    typeof entry.jobId === 'string' &&
    typeof entry.unitsGood === 'string' &&
    typeof entry.session === 'string'
  );
}

export function loadQueue(token: string): QueuedEntry[] {
  try {
    const raw = window.localStorage.getItem(storageKey(token));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
}

export function storeQueue(token: string, queue: readonly QueuedEntry[]): void {
  try {
    if (queue.length === 0) window.localStorage.removeItem(storageKey(token));
    else window.localStorage.setItem(storageKey(token), JSON.stringify(queue));
  } catch {
    // Storage is full or blocked: the entry still lives in memory for this page.
  }
}

/** A random id for one save, safe for the server's `clientRef` rule (letters, digits, dash, underscore). */
export function newClientRef(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
