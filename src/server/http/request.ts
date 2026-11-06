/** Request parsing helpers for `withApi`: JSON body (size/type checked), query, params, client IP. */
import type { z } from 'zod';
import {
  BadRequestError,
  type FieldIssue,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  ValidationError,
} from './errors';

export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

export function zodIssues(error: z.ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
    code: issue.code,
  }));
}

export function validate<S extends z.ZodType>(schema: S, input: unknown, where: string): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(
      zodIssues(result.error).map((issue) => ({
        ...issue,
        path: issue.path ? `${where}.${issue.path}` : where,
      })),
    );
  }
  return result.data;
}

/** Reads and JSON-parses the body, enforcing content type and size. Empty body → undefined. */
export async function readJsonBody(
  request: Request,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): Promise<unknown> {
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new PayloadTooLargeError(maxBytes);

  const text = await request.text();
  if (text.length === 0) return undefined;
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new PayloadTooLargeError(maxBytes);

  const contentType = request.headers.get('content-type') ?? '';
  if (!/^application\/(.+\+)?json\b/i.test(contentType)) throw new UnsupportedMediaTypeError();

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BadRequestError('Request body is not valid JSON');
  }
}

/** URLSearchParams → plain object; repeated keys become arrays. */
export function searchParamsToObject(params: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    out[key] = values.length > 1 ? values : (values[0] ?? '');
  }
  return out;
}

/** Number of trusted reverse proxies in front of the app (`TRUSTED_PROXY_HOPS`, default 1). */
export function trustedProxyHops(source: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number.parseInt(source.TRUSTED_PROXY_HOPS ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 10 ? parsed : 1;
}

/**
 * Client IP resolved against the trusted-proxy chain. Each trusted proxy appends the address it
 * received the connection from to `x-forwarded-for`, so only the right-most `hops` entries are
 * trustworthy and the client is the entry just left of them (`list[length - hops]`). Leftmost
 * entries are client-controlled and are never used on their own, which defeats spoofing an
 * allowed address with `X-Forwarded-For: <allowed ip>` behind a proxy. `hops = 0` means no proxy
 * is trusted: forwarding headers are ignored and the IP is unknown (null).
 */
export function clientIp(headers: Headers, hops: number = trustedProxyHops()): string | null {
  if (hops <= 0) return null;
  const forwarded = headers.get('x-forwarded-for');
  if (!forwarded) return null;
  const chain = forwarded
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (chain.length === 0) return null;
  const candidate = chain[Math.max(0, chain.length - hops)];
  return candidate ? candidate.slice(0, 64) : null;
}
