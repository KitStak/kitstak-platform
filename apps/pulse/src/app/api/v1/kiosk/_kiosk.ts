/**
 * Plumbing for the floor tablet endpoints. They are public (no session cookie): the device link
 * secret in the body is the key, and after unlock a signed kiosk session scoped to one site.
 * Same origin only, JSON only, rate limited per link, never cached, and never any money.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { DomainError } from '@/server/errors';
import { errorResponse, readJson } from '@/server/http/api';

const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' } as const;

const windows = new Map<string, { start: number; count: number }>();

/** A small fixed window limiter kept in memory: enough to slow a guessing script on one server. */
function rateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const current = windows.get(key);
  if (!current || now - current.start > windowMs) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 5000) for (const [k, v] of windows) if (now - v.start > windowMs) windows.delete(k);
    return;
  }
  current.count += 1;
  if (current.count > limit) throw new DomainError('RATE_LIMITED', 'Too many tries. Wait a minute and try again.');
}

export const kioskToken = z.string().min(16).max(128);

export function kioskRoute<S extends z.ZodType<{ token: string }>, T>(schema: S, options: { limit: number }, handler: (data: z.output<S>) => Promise<T>) {
  return async (request: Request): Promise<NextResponse> => {
    try {
      const origin = request.headers.get('origin');
      if (origin && origin !== new URL(request.url).origin) throw new DomainError('FORBIDDEN', 'This request came from a site that is not allowed.');
      if (!origin && request.headers.get('sec-fetch-site') === 'cross-site') throw new DomainError('FORBIDDEN', 'This request came from a site that is not allowed.');
      if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) throw new DomainError('VALIDATION', 'Send JSON.');
      const parsed = schema.safeParse(await readJson(request));
      if (!parsed.success) {
        const fields: Record<string, string> = {};
        for (const issue of parsed.error.issues) fields[issue.path.join('.') || 'form'] ??= issue.message;
        throw new DomainError('VALIDATION', 'Some answers need another look.', fields);
      }
      const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
      rateLimit(`${new URL(request.url).pathname}:${parsed.data.token.slice(0, 12)}:${ip}`, options.limit, 60_000);
      return NextResponse.json({ data: (await handler(parsed.data)) ?? null }, { headers: HEADERS });
    } catch (error) {
      return errorResponse(error, HEADERS);
    }
  };
}
