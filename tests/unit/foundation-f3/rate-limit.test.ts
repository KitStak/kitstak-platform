import { afterEach, describe, expect, it } from "vitest";
import { clientIp, hitRateLimit, resetRateLimit, type RateLimitPolicy } from "@/server/auth/rate-limit";
import { createTestDb, type TestDb } from "../../setup/test-db";

const POLICY: RateLimitPolicy = { name: "t", limit: 3, windowMs: 60_000 };
const T0 = new Date("2026-11-05T10:00:00.000Z");
const at = (ms: number): Date => new Date(T0.getTime() + ms);

describe("durable rate limiter", () => {
  let t: TestDb;
  afterEach(() => t.close());

  it("allows up to the limit, then blocks with Retry-After", () => {
    t = createTestDb();
    expect(hitRateLimit(t.db, POLICY, "u1", at(0))).toMatchObject({ allowed: true, count: 1, remaining: 2 });
    hitRateLimit(t.db, POLICY, "u1", at(1000));
    expect(hitRateLimit(t.db, POLICY, "u1", at(2000))).toMatchObject({ allowed: true, count: 3, remaining: 0 });
    const blocked = hitRateLimit(t.db, POLICY, "u1", at(10_000));
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(50);
  });

  it("starts a new window after it elapses and keys subjects separately", () => {
    t = createTestDb();
    for (let i = 0; i < 4; i += 1) hitRateLimit(t.db, POLICY, "u1", at(i));
    expect(hitRateLimit(t.db, POLICY, "u2", at(5)).allowed).toBe(true);
    expect(hitRateLimit(t.db, POLICY, "u1", at(60_000)).count).toBe(1);
  });

  it("persists counters in SQLite and can be reset", () => {
    t = createTestDb();
    for (let i = 0; i < 3; i += 1) hitRateLimit(t.db, POLICY, "u1", at(i));
    const row = t.sqlite.prepare("SELECT count FROM rate_limits WHERE key = ?").get("t:u1") as { count: number };
    expect(row.count).toBe(3);
    resetRateLimit(t.db, POLICY, "u1");
    expect(hitRateLimit(t.db, POLICY, "u1", at(10)).count).toBe(1);
  });

  it("trusts x-forwarded-for only with TRUST_PROXY=1", () => {
    const request = new Request("http://x/", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } });
    const previous = process.env.TRUST_PROXY;
    try {
      delete process.env.TRUST_PROXY;
      expect(clientIp(request)).toBe("direct");
      process.env.TRUST_PROXY = "1";
      expect(clientIp(request)).toBe("1.2.3.4");
    } finally {
      if (previous === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = previous;
    }
  });
});
