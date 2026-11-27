/**
 * Browser fetch helper for the /api/v1 JSON envelope. Throws ApiClientError with the server's
 * plain-language message so callers can toast it directly.
 */
export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fields?: Readonly<Record<string, string>>;

  constructor(code: string, message: string, status: number, fields?: Record<string, string>) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  return apiRequest<T>(path, { ...init, method: 'GET' });
}

/** A list answer with its paging facts: `{ data, meta }`. `meta` is null for a route that sends none. */
export async function apiGetPage<T, M = Record<string, unknown>>(path: string, init?: RequestInit): Promise<{ data: T; meta: M | null }> {
  const payload = await apiEnvelope<T>(path, { ...init, method: 'GET' });
  return { data: payload.data as T, meta: (payload.meta as M | undefined) ?? null };
}

export async function apiPost<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
  return apiRequest<T>(path, {
    ...init,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    body: JSON.stringify(body),
  });
}

async function apiRequest<T>(path: string, init: RequestInit): Promise<T> {
  return (await apiEnvelope<T>(path, init)).data as T;
}

interface Envelope<T> {
  data?: T;
  meta?: unknown;
  error?: { code: string; message: string; fields?: Record<string, string> };
}

async function apiEnvelope<T>(path: string, init: RequestInit): Promise<Envelope<T>> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init });
  } catch {
    throw new ApiClientError('NETWORK_ERROR', 'We couldn’t reach KitStak. Check your connection and try again.', 0);
  }
  let payload: Envelope<T> | null = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok || !payload || payload.error) {
    const error = payload?.error;
    throw new ApiClientError(
      error?.code ?? 'INTERNAL',
      error?.message ?? 'Something went wrong. Please try again.',
      response.status,
      error?.fields,
    );
  }
  return payload;
}

/** Builds `/api/v1/...?a=1` skipping undefined/null params. */
export function apiPath(path: string, params?: Record<string, string | number | boolean | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null) continue;
    query.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
  }
  const qs = query.toString();
  return `/api/v1/${path.replace(/^\/+/, '')}${qs ? `?${qs}` : ''}`;
}
