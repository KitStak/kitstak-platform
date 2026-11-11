/**
 * Return Process parameters (M14). The eight Logiwa Return Parameters live on the company row
 * (`company_settings.defaults.returnRules`, JSON) and share its `version`. Every change writes a
 * field-level `change_log` row on entity "company" ("Expiry date match: On → Off").
 *
 * M04 return receiving reads them with `getReturnRules(db)` and enforces them with the pure
 * `checkReturnLine()` from `@/lib/grid-defs/admin/return-rules`.
 */
import { eq, sql } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import type { AuthContext } from "@/server/auth/context";
import * as s from "@/server/db/schema";
import { normalizeReturnRules, RETURN_RULE_KEYS, returnRulesView, type ReturnRules, type ReturnRulesInput } from "@/lib/grid-defs/admin/return-rules";
import { COMPANY_ENTITY, getCompany } from "./company";
import { assertVersion, domainCtxOf, logUpdate, type Actor } from "./users-shared";

const c = s.companySettings;
const ID = "company";

export interface ReturnRulesState {
  readonly rules: ReturnRules;
  readonly version: number;
  readonly updatedAt: string;
}

async function readDefaults(db: AppDb): Promise<Record<string, unknown>> {
  await getCompany(db); // ensures the row exists
  const row = (await db.select({ defaults: c.defaults }).from(c).where(eq(c.id, ID)).limit(1))[0];
  return (row?.defaults ?? {}) as unknown as Record<string, unknown>;
}

/** Current return rules (all on until an admin changes them). */
export async function getReturnRules(db: AppDb): Promise<ReturnRules> {
  return normalizeReturnRules((await readDefaults(db)).returnRules);
}

export async function getReturnRulesState(db: AppDb): Promise<ReturnRulesState> {
  const rules = await getReturnRules(db);
  const company = await getCompany(db);
  return { rules, version: company.version, updatedAt: company.updatedAt };
}

export async function updateReturnRules(tx: AppDb, auth: AuthContext, actor: Actor, input: ReturnRulesInput): Promise<ReturnRulesState> {
  const company = await getCompany(tx);
  assertVersion(company.version, input.version);
  const defaults = await readDefaults(tx);
  const before = normalizeReturnRules(defaults.returnRules);
  const next = Object.fromEntries(RETURN_RULE_KEYS.map((k) => [k, input[k]])) as ReturnRules;
  // Keep the other account defaults untouched; only `returnRules` changes.
  await tx.update(c).set({
    defaults: { ...defaults, returnRules: next } as unknown as typeof c.$inferInsert.defaults,
    updatedBy: actor.userId, updatedAt: new Date().toISOString(), version: sql`${c.version} + 1`,
  }).where(eq(c.id, ID));
  await logUpdate(tx, domainCtxOf(actor, auth), { entityType: COMPANY_ENTITY, entityId: ID, entityCode: "Return process" }, returnRulesView(before), returnRulesView(next));
  return await getReturnRulesState(tx);
}
