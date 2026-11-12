/**
 * M14 round 5 (parity loop): server-seeded permissions (no /api/me gate), password meter never
 * presents defaults as the policy, forced password change reasons and allowed routes, and the
 * zero-allocation notification severity.
 */
import { describe, expect, it } from "vitest";
import { resolvePagePerms } from "@/components/admin/admin-shared";
import { resolvePolicyHints } from "@/components/admin/password-meter";
import { allowedDuringPasswordChange } from "@/components/layout/password-change-gate";
import { displaySeverity } from "@/components/layout/notification-item";
import { passwordChangeReason } from "@/server/shell/shell-props";

const ACTIONS = ["view", "create", "edit"] as const;

describe("resolvePagePerms", () => {
  const seed = new Set(["settings.users.view", "settings.users.create"]);

  it("uses the server seed while /api/me is still loading", () => {
    const p = resolvePagePerms("settings.users", ACTIONS, { permissions: new Set(), isLoading: true }, seed);
    expect(p).toEqual({ view: true, create: true, edit: false, loading: false });
  });

  it("prefers the live /api/me set once loaded (a revoked grant disappears)", () => {
    const p = resolvePagePerms("settings.users", ACTIONS, { permissions: new Set(["settings.users.view"]), isLoading: false }, seed);
    expect(p).toEqual({ view: true, create: false, edit: false, loading: false });
  });

  it("reports loading only when neither source exists", () => {
    const p = resolvePagePerms("settings.users", ACTIONS, { permissions: new Set(), isLoading: true }, null);
    expect(p.loading).toBe(true);
    expect(p.create).toBe(false);
  });
});

describe("resolvePolicyHints", () => {
  const seed = { minLength: 12, requireUpper: true, requireNumber: true, requireSymbol: true };

  it("returns null (loading) without a response or seed — never a hard-coded default", () => {
    expect(resolvePolicyHints(undefined, null)).toBeNull();
  });

  it("uses the server seed until the API answers, then the API value", () => {
    expect(resolvePolicyHints(undefined, seed)).toEqual(seed);
    expect(resolvePolicyHints({ minLength: 14, requireUpper: false, requireNumber: true, requireSymbol: false, maxAgeDays: 90 }, seed))
      .toEqual({ minLength: 14, requireUpper: false, requireNumber: true, requireSymbol: false });
  });

  it("ignores a malformed response", () => {
    expect(resolvePolicyHints({ minLength: "12" }, seed)).toEqual(seed);
  });
});

describe("passwordChangeReason", () => {
  const now = new Date("2026-11-10T12:00:00.000Z");

  it("flags an admin reset (no passwordChangedAt) as reset", () => {
    expect(passwordChangeReason({ passwordChangedAt: null, isApiUser: false }, 180, now)).toBe("reset");
  });

  it("flags a password older than the company max age", () => {
    expect(passwordChangeReason({ passwordChangedAt: "2026-01-01T00:00:00.000Z", isApiUser: false }, 180, now)).toBe("expired");
    expect(passwordChangeReason({ passwordChangedAt: "2026-10-01T00:00:00.000Z", isApiUser: false }, 180, now)).toBeNull();
  });

  it("never expires without a max age, and never gates API users", () => {
    expect(passwordChangeReason({ passwordChangedAt: "2020-01-01T00:00:00.000Z", isApiUser: false }, undefined, now)).toBeNull();
    expect(passwordChangeReason({ passwordChangedAt: null, isApiUser: true }, 180, now)).toBeNull();
    expect(passwordChangeReason(undefined, 180, now)).toBeNull();
  });
});

describe("allowedDuringPasswordChange", () => {
  it("allows only Change Password", () => {
    expect(allowedDuringPasswordChange("/account/password")).toBe(true);
    expect(allowedDuringPasswordChange("/account/profile")).toBe(false);
    expect(allowedDuringPasswordChange("/settings/users")).toBe(false);
    expect(allowedDuringPasswordChange("/account/passwordx")).toBe(false);
    expect(allowedDuringPasswordChange(null)).toBe(false);
  });
});

describe("displaySeverity", () => {
  it("shows a zero-allocation wave as a warning", () => {
    expect(displaySeverity({ severity: "success", title: "Wave 106-1 completed", body: "Wave 106-1 completed: 0 met · 0 allocated · 0 jobs" })).toBe("warning");
  });

  it("keeps real successes and other severities", () => {
    expect(displaySeverity({ severity: "success", title: "Wave 7 completed", body: "12 met · 10 allocated · 3 jobs" })).toBe("success");
    expect(displaySeverity({ severity: "error", title: "Failed", body: "0 allocated" })).toBe("error");
  });
});

/* ---------------- TOTP core (RFC 6238 vectors) ---------------- */
import { base32Decode, base32Encode, generateTotpSecret, hotp, otpauthUri, totp, verifyTotp } from "@/server/repositories/users-mfa";
import { idlePhase } from "@/components/layout/idle-sign-out";
import { companySecuritySchema, idleMinutesFrom } from "@/lib/grid-defs/admin/company";
import { getCompany, getSessionIdleMinutes, updateCompanyDefaults, updateCompanySecurity } from "@/server/repositories/company";
import type { AuthContext } from "@/server/auth/context";
import { createWorld } from "../foundation/domain/fixtures";

describe("TOTP", () => {
  const rfcSecret = base32Encode(Buffer.from("12345678901234567890"));

  it("matches the RFC 4226 HOTP test vectors", () => {
    const key = Buffer.from("12345678901234567890");
    expect([0, 1, 2, 3, 9].map((c) => hotp(key, c))).toEqual(["755224", "287082", "359152", "969429", "520489"]);
  });

  it("matches the RFC 6238 SHA-1 vectors (8 digits)", () => {
    expect(totp(rfcSecret, new Date(59_000), 8)).toBe("94287082");
    expect(totp(rfcSecret, new Date(1_111_111_109_000), 8)).toBe("07081804");
    expect(totp(rfcSecret, new Date(20_000_000_000_000), 8)).toBe("65353130");
  });

  it("verifies within one step of drift and rejects malformed codes", () => {
    const at = new Date("2026-11-10T12:00:00Z");
    const prev = totp(rfcSecret, new Date(at.getTime() - 30_000));
    expect(verifyTotp(rfcSecret, prev, at)).not.toBeNull();
    expect(verifyTotp(rfcSecret, totp(rfcSecret, new Date(at.getTime() - 120_000)), at)).toBeNull();
    expect(verifyTotp(rfcSecret, "12345", at)).toBeNull();
    expect(verifyTotp(rfcSecret, "abcdef", at)).toBeNull();
  });

  it("round-trips base32 and builds an otpauth URI", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(secret))).toBe(secret);
    expect(otpauthUri("KitStaks", "a@b.io", secret)).toBe(`otpauth://totp/KitStaks%3Aa%40b.io?secret=${secret}&issuer=KitStaks&algorithm=SHA1&digits=6&period=30`);
  });
});

/* ---------------- idle sign-out ---------------- */

describe("idlePhase", () => {
  it("is active, then warns in the last minute, then expires", () => {
    const start = 1_000_000;
    expect(idlePhase(start, start + 28 * 60_000, 30).phase).toBe("active");
    const warn = idlePhase(start, start + 29 * 60_000 + 30_000, 30);
    expect(warn).toEqual({ phase: "warning", remainingMs: 30_000 });
    expect(idlePhase(start, start + 30 * 60_000, 30)).toEqual({ phase: "expired", remainingMs: 0 });
  });

  it("normalises stored minutes", () => {
    expect(idleMinutesFrom(30)).toBe(30);
    expect(idleMinutesFrom(2)).toBeNull();
    expect(idleMinutesFrom("30")).toBeNull();
    expect(idleMinutesFrom(null)).toBeNull();
  });
});

describe("company idle sign-out persistence", () => {
  it("saves with Security, keeps account defaults and survives a defaults save", async () => {
    const w = await createWorld();
    try {
      const auth = { scope: { warehouseIds: [w.warehouseId], clientIds: "all" }, permissions: new Set<string>(), restrictions: [], roleKeys: ["admin"], user: { id: w.userId, name: "Admin", email: "admin@test.io", role: "admin" }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
      const actor = { userId: w.userId, source: "Web" } as const;
      const c0 = await getCompany(w.db);
      expect(c0.sessionIdleMinutes).toBeNull();
      const p = c0.passwordPolicy;
      const input = companySecuritySchema.parse({ minLength: p.minLength, requireUpper: p.requireUpper, requireNumber: p.requireNumber, requireSymbol: p.requireSymbol, expires: false, maxAgeDays: 90, lockoutThreshold: p.lockoutThreshold, lockoutMinutes: p.lockoutMinutes, idleTimeout: true, idleMinutes: 20, version: c0.version });
      const c1 = await updateCompanySecurity(w.db, auth, actor, input);
      expect(c1.sessionIdleMinutes).toBe(20);
      expect(await getSessionIdleMinutes(w.db)).toBe(20);
      const c2 = await updateCompanyDefaults(w.db, auth, actor, { currency: c1.defaults.currency, weightUnit: c1.defaults.weightUnit, dimensionUnit: c1.defaults.dimensionUnit, dateFormat: c1.defaults.dateFormat, version: c1.version } as never);
      expect(c2.sessionIdleMinutes).toBe(20);
      const off = await updateCompanySecurity(w.db, auth, actor, { ...input, idleTimeout: false, version: c2.version });
      expect(off.sessionIdleMinutes).toBeNull();
      expect(companySecuritySchema.safeParse({ ...input, idleMinutes: 3 }).success).toBe(false);
    } finally {
      await w.close();
    }
  });
});
