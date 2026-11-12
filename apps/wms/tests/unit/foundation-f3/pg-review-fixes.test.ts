/**
 * Regressions from the Postgres migration review (docs/progress/POSTGRES_MIGRATION_REPORT.md):
 * SQLite semantics the app relied on (NULL sort placement, json/boolean filter values,
 * literal backslashes in LIKE) and read-then-write sequences that were atomic on the
 * synchronous SQLite driver but can interleave on Postgres.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { pgTable, text, jsonb } from "drizzle-orm/pg-core";
import { companySettings, printoutTemplates, users } from "@/server/db/schema";
import { asc, desc } from "@/server/db/order";
import { dbAll } from "@/server/db/sql";
import { compileFilters, type FilterFieldDef } from "@/server/query/filters";
import { likePattern } from "@/server/repositories/shared";
import { authenticate } from "@/server/auth/login";
import { DEFAULT_PASSWORD_POLICY } from "@/server/auth/password-policy";
import { devLogMailAdapter, requestPasswordReset, resetPassword, setMailAdapter, type MailMessage } from "@/server/auth/password-reset";
import { getCompany } from "@/server/repositories/company";
import { ensureDefaultPrintouts } from "@/server/repositories/printouts";
import { seededDb, type SeededDb } from "./fixtures";
import { createTestDb, type TestDb } from "../../setup/test-db";

const probe = pgTable("zz_probe", { id: text("id").primaryKey(), d: text("d"), cf: jsonb("cf") });

describe("SQLite semantics kept on Postgres", () => {
  let t: TestDb | undefined;
  afterEach(async () => {
    await t?.close();
    t = undefined;
  });

  const withProbe = async (): Promise<TestDb> => {
    t = await createTestDb();
    await t.pg.exec(`CREATE TABLE zz_probe (id text PRIMARY KEY, d text, cf jsonb)`);
    await t.db.insert(probe).values([
      { id: "dated", d: "2027-01-01", cf: { toggle1: true } },
      { id: "undated", d: null, cf: {} },
      { id: "off", d: "2026-01-01", cf: { toggle1: false } },
    ]);
    return t;
  };

  it("asc() puts NULLs first and desc() last, as SQLite did (FEFO undated stock first)", async () => {
    const db = (await withProbe()).db;
    expect((await db.select({ id: probe.id }).from(probe).orderBy(asc(probe.d))).map((r) => r.id)).toEqual(["undated", "off", "dated"]);
    expect((await db.select({ id: probe.id }).from(probe).orderBy(desc(probe.d))).map((r) => r.id)).toEqual(["dated", "off", "undated"]);
    expect((await db.select({ id: probe.id }).from(probe).orderBy(asc(sql`${probe.d}`))).map((r) => r.id)).toEqual(["undated", "off", "dated"]);
  });

  it("the boolean grid filter works on jsonb custom-field toggles", async () => {
    const db = (await withProbe()).db;
    const def: FilterFieldDef = { key: "cfToggle1", label: "Toggle 1", type: "boolean", sql: sql`(${probe.cf} ->> 'toggle1')` };
    const on = compileFilters([def], [{ field: "cfToggle1", op: "bool", value: true }]);
    const off = compileFilters([def], [{ field: "cfToggle1", op: "bool", value: false }]);
    expect((await db.select({ id: probe.id }).from(probe).where(on)).map((r) => r.id)).toEqual(["dated"]);
    expect((await db.select({ id: probe.id }).from(probe).where(off)).map((r) => r.id)).toEqual(["off"]);
  });

  it("likePattern matches a backslash literally (SQLite LIKE had no escape character)", async () => {
    t = await createTestDb();
    const rows = await dbAll<{ ok: boolean }>(t.db, sql`SELECT ${"PART\\A-1"} ILIKE ${likePattern("PART\\A")} AS ok`);
    expect(rows[0]?.ok).toBe(true);
    const tail = await dbAll<{ ok: boolean }>(t.db, sql`SELECT ${"CABLE\\"} ILIKE ${likePattern("CABLE\\")} AS ok`);
    expect(tail[0]?.ok).toBe(true);
  });
});

describe("read-then-write paths are race-safe without the synchronous driver", () => {
  let s: SeededDb | undefined;
  let e: TestDb | undefined;
  afterEach(async () => {
    setMailAdapter(devLogMailAdapter);
    await s?.close();
    await e?.close();
    s = undefined;
    e = undefined;
  });

  it("concurrent failed logins all count, so the lockout threshold is reached", async () => {
    s = await seededDb();
    await s.db.insert(companySettings).values({ displayName: "K", fullName: "K", passwordPolicy: { ...DEFAULT_PASSWORD_POLICY, lockoutThreshold: 3 } });
    const now = new Date("2026-11-05T10:00:00.000Z");
    const a = (ip: string) => ({ email: "admin@kitstak.io", password: "wrong", ip, userAgent: "vitest" });
    await Promise.all([authenticate(s.db, a("ip1"), now), authenticate(s.db, a("ip2"), now), authenticate(s.db, a("ip3"), now)]);
    const row = (await s.db.select().from(users).where(eq(users.id, s.ids.admin)).limit(1))[0];
    expect(row?.lockedUntil).not.toBeNull();
  });

  it("a reset token can be redeemed only once, even concurrently", async () => {
    s = await seededDb();
    const sent: MailMessage[] = [];
    setMailAdapter({ send: vi.fn(async (m: MailMessage) => void sent.push(m)) });
    await requestPasswordReset(s.db, { email: "admin@kitstak.io", baseUrl: "http://localhost:3000/" });
    const token = decodeURIComponent(/token=([^\s]+)/.exec(sent[0]?.text ?? "")?.[1] ?? "");
    const out = await Promise.allSettled([
      resetPassword(s.db, { token, password: "BrandNew!Pass42" }),
      resetPassword(s.db, { token, password: "Other!Pass4242" }),
    ]);
    expect(out.filter((o) => o.status === "fulfilled")).toHaveLength(1);
  });

  it("concurrent first reads create the company row once and both succeed", async () => {
    e = await createTestDb();
    const out = await Promise.allSettled([getCompany(e.db), getCompany(e.db)]);
    expect(out.every((o) => o.status === "fulfilled")).toBe(true);
  });

  it("concurrent first visits create each default printout once", async () => {
    e = await createTestDb();
    await Promise.all([ensureDefaultPrintouts(e.db), ensureDefaultPrintouts(e.db)]);
    const keys = (await e.db.select({ k: printoutTemplates.typeKey }).from(printoutTemplates).where(eq(printoutTemplates.isDefault, true))).map((r) => r.k);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.length).toBe(new Set(keys).size);
  });
});
