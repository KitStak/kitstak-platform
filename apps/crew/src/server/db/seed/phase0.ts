/**
 * Phase 0 seed (docs/crew/SPEC.md section 10): the setup rows only. Settings, the sites with their
 * Federal labor rules, and the areas. People, schedules and punches arrive with their phases.
 * Idempotent: every row is found by its natural key and updated, or made when missing, so a second
 * run changes nothing.
 */
import 'server-only';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { areas, siteRules, sites } from '@/server/db/schema';
import { inTx, type DomainContext } from '@/server/domain/_shared';
import { loadSettings } from '@/server/domain/settings';
import type { Transaction } from '@/server/db';

export interface SeedSite {
  readonly code: string;
  readonly name: string;
  readonly timezone: string;
  readonly isDefault: boolean;
  readonly areas: readonly { readonly code: string; readonly name: string }[];
}

export interface Phase0Plan {
  readonly sites: readonly SeedSite[];
  /** The week every site starts on (0 = Sunday). */
  readonly weekStart: number;
}

const KITSTAK_AREAS = [
  { code: 'KIT1', name: 'Kitting line 1' },
  { code: 'KIT2', name: 'Kitting line 2' },
  { code: 'RECV', name: 'Receiving' },
  { code: 'PICK', name: 'Pick and pack' },
  { code: 'SHIP', name: 'Shipping' },
] as const;

/** The `kitstak` org: MLT1 (default) and KS2, America/New_York, Federal preset (SPEC 10). */
export const KITSTAK_PLAN: Phase0Plan = {
  weekStart: 0,
  sites: [
    { code: 'MLT1', name: 'MLT1', timezone: 'America/New_York', isDefault: true, areas: KITSTAK_AREAS },
    { code: 'KS2', name: 'KS2', timezone: 'America/New_York', isDefault: false, areas: KITSTAK_AREAS },
  ],
};

/** The date Federal rules start from: far enough back to cover every seeded week. */
export const RULES_FROM = '2026-01-04';

export interface Phase0Summary {
  readonly sites: number;
  readonly areas: number;
  readonly rules: number;
}

async function upsertSite(tx: Transaction, orgId: string, site: SeedSite, weekStart: number): Promise<string> {
  const [found] = await tx
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.orgId, orgId), sql`lower(${sites.code}) = lower(${site.code})`, isNull(sites.deletedAt)));
  if (site.isDefault) {
    // One default site per org: the seeded one takes the flag from the "Main site" a claim may have made.
    await tx.update(sites).set({ isDefault: false }).where(and(eq(sites.orgId, orgId), eq(sites.isDefault, true), found ? ne(sites.id, found.id) : sql`true`));
  }
  if (found) {
    await tx.update(sites).set({ name: site.name, timezone: site.timezone, isDefault: site.isDefault, weekStart }).where(and(eq(sites.orgId, orgId), eq(sites.id, found.id)));
    return found.id;
  }
  const [made] = await tx.insert(sites).values({ orgId, code: site.code, name: site.name, timezone: site.timezone, isDefault: site.isDefault, weekStart }).returning({ id: sites.id });
  return made!.id;
}

export const seedPhase0 = scoped(async function seedPhase0(ctx: DomainContext, plan: Phase0Plan = KITSTAK_PLAN): Promise<Phase0Summary> {
  return inTx(async (tx) => {
    await loadSettings(ctx.orgId, tx);
    let areaCount = 0;
    for (const site of plan.sites) {
      const siteId = await upsertSite(tx, ctx.orgId, site, plan.weekStart);
      await tx
        .insert(siteRules)
        .values({ orgId: ctx.orgId, siteId, effectiveFrom: RULES_FROM, preset: 'federal', roundingMode: 'exact', otWeeklyMinutes: 2400 })
        .onConflictDoNothing({ target: [siteRules.orgId, siteRules.siteId, siteRules.effectiveFrom] });
      for (const [position, area] of site.areas.entries()) {
        const [found] = await tx
          .select({ id: areas.id })
          .from(areas)
          .where(and(eq(areas.orgId, ctx.orgId), eq(areas.siteId, siteId), sql`lower(${areas.code}) = lower(${area.code})`, isNull(areas.deletedAt)));
        if (found) await tx.update(areas).set({ name: area.name, position }).where(and(eq(areas.orgId, ctx.orgId), eq(areas.id, found.id)));
        else await tx.insert(areas).values({ orgId: ctx.orgId, siteId, code: area.code, name: area.name, position });
        areaCount += 1;
      }
    }
    return { sites: plan.sites.length, areas: areaCount, rules: plan.sites.length };
  }, db);
});
