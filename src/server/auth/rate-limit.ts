/**
 * Durable fixed-window rate limiter stored in SQLite (`rate_limits`), so limits survive
 * restarts and hot reloads and are shared by every worker using the same DB file.
 *
 * One atomic UPSERT per hit: a row whose window has elapsed restarts at count 1.
 *
 * Policies (BUILD_PLAN F3):
 *   login IP 5/min · login account 10/15 min · mutations 120/min/user · exports+imports 10/min/user.
 * `clientIp()` trusts `x-forwarded-for` only when TRUST_PROXY=1.
 */
import { lt, sql } from "drizzle-orm";
import { rateLimits } from "@/server/db/schema";
import type { AppDb } from "@/server/api/db";

export interface RateLimitPolicy {
  readonly name: string;
  readonly limit: number;
  readonly windowMs: number;
}

export const RATE_LIMITS = {
  loginIp: { name: "login-ip", limit: 5, windowMs: 60_000 },
  loginAccount: { name: "login-account", limit: 10, windowMs: 15 * 60_000 },
  passwordReset: { name: "password-reset", limit: 5, windowMs: 15 * 60_000 },
  mutation: { name: "mutation", limit: 120, windowMs: 60_000 },
  bulkIo: { name: "bulk-io", limit: 10, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitPolicy>;

export type RateLimitPolicyName = keyof typeof RATE_LIMITS;

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly count: number;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

/** Records one hit for `subject` under `policy` and reports whether it is within the limit. */
export function hitRateLimit(db: AppDb, policy: RateLimitPolicy, subject: string, now: Date = new Date()): RateLimitResult {
  const key = `${policy.name}:${subject}`;
  const nowIso = now.toISOString();
  const windowFloor = new Date(now.getTime() - policy.windowMs).toISOString();
  const row = db.get<{ count: number; window_start: string }>(sql`
    INSERT INTO rate_limits (key, count, window_start) VALUES (${key}, 1, ${nowIso})
    ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN rate_limits.window_start <= ${windowFloor} THEN 1 ELSE rate_limits.count + 1 END,
      window_start = CASE WHEN rate_limits.window_start <= ${windowFloor} THEN excluded.window_start ELSE rate_limits.window_start END
    RETURNING count, window_start
  `);
  const count = row?.count ?? 1;
  const windowStart = Date.parse(row?.window_start ?? nowIso);
  const allowed = count <= policy.limit;
  const retryAfterMs = windowStart + policy.windowMs - now.getTime();
  maybePurge(db, now);
  return {
    allowed,
    count,
    remaining: Math.max(0, policy.limit - count),
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil(retryAfterMs / 1000)),
  };
}

/** Clears a subject's counter (e.g. account counter after a successful login). */
export function resetRateLimit(db: AppDb, policy: RateLimitPolicy, subject: string): void {
  db.run(sql`DELETE FROM rate_limits WHERE key = ${`${policy.name}:${subject}`}`);
}

const PURGE_EVERY_MS = 10 * 60_000;
const MAX_WINDOW_MS = 24 * 60 * 60_000;
let lastPurgeAt = 0;

function maybePurge(db: AppDb, now: Date): void {
  if (now.getTime() - lastPurgeAt < PURGE_EVERY_MS) return;
  lastPurgeAt = now.getTime();
  db.delete(rateLimits).where(lt(rateLimits.windowStart, new Date(now.getTime() - MAX_WINDOW_MS).toISOString())).run();
}

/** Client IP for rate limiting. Without TRUST_PROXY all clients share the "direct" bucket. */
/**
 * IP recorded on audit and session rows (never "direct"). With TRUST_PROXY=1 the first
 * `x-forwarded-for` hop; otherwise the address Next's own router server forwards in
 * `x-forwarded-for` (dev and `next start`), then `x-real-ip`, falling back to 127.0.0.1.
 * The rate-limit bucket keeps using `clientIp` (spoof-resistant without a trusted proxy).
 */
export function auditIp(request: Request): string {
  const first = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (first) return first.replace(/^::ffff:/, "");
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real.replace(/^::ffff:/, "");
  return "127.0.0.1";
}

export function clientIp(request: Request): string {
  if (process.env.TRUST_PROXY === "1") {
    const first = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (first) return first;
    const real = request.headers.get("x-real-ip")?.trim();
    if (real) return real;
  }
  return "direct";
}

/**
 * Gives back one hit for `subject` (floor 0). Used after a successful login so the shared
 * per-IP login bucket only throttles failed attempts: a scanner fleet behind one NAT (or
 * every client in the "direct" bucket without TRUST_PROXY) can all sign in at shift start.
 */
export function refundRateLimit(db: AppDb, policy: RateLimitPolicy, subject: string): void {
  db.run(sql`UPDATE rate_limits SET count = MAX(0, count - 1) WHERE key = ${`${policy.name}:${subject}`}`);
}
