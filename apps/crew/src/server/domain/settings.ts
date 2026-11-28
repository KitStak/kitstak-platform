/**
 * Crew settings and the default site (docs/crew/SPEC.md 5.1). `crew.settings` is made lazily on
 * first use; one default site "Main site" is made with it, so every person has a home site from
 * the first day. Both steps are idempotent (ON CONFLICT DO NOTHING on the unique keys).
 */
import 'server-only';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db, type Executor } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { settings, sites } from '@/server/db/schema';
import { isValidTimezone } from './_shared';

export type CrewSettings = typeof settings.$inferSelect;
export type CrewSite = typeof sites.$inferSelect;

export const DEFAULT_SITE = { code: 'MAIN', name: 'Main site' } as const;

/** Reads the org's settings row, making it with the defaults when it is not there yet. */
export const loadSettings = scoped(async function loadSettings(orgId: string, executor: Executor = db): Promise<CrewSettings> {
  const [found] = await executor.select().from(settings).where(eq(settings.orgId, orgId));
  if (found) return found;
  await executor.insert(settings).values({ orgId }).onConflictDoNothing();
  const [made] = await executor.select().from(settings).where(eq(settings.orgId, orgId));
  if (!made) throw new Error('Crew settings could not be made.');
  return made;
});

/** Live sites, the default first. */
export const listSites = scoped(async function listSites(orgId: string, executor: Executor = db): Promise<CrewSite[]> {
  return executor
    .select()
    .from(sites)
    .where(and(eq(sites.orgId, orgId), isNull(sites.deletedAt), isNull(sites.archivedAt)))
    .orderBy(sql`${sites.isDefault} desc`, asc(sites.name));
});

/**
 * Makes the settings row and the default site when they are missing. `timezone` (from the
 * browser on the welcome screen, or the seed) is used only for a new site; a bad zone falls back
 * to the settings default.
 */
export const ensureSetup = scoped(async function ensureSetup(orgId: string, options: { readonly timezone?: string } = {}, executor: Executor = db): Promise<{ settings: CrewSettings; defaultSite: CrewSite }> {
  const current = await loadSettings(orgId, executor);
  const [existing] = await executor
    .select()
    .from(sites)
    .where(and(eq(sites.orgId, orgId), eq(sites.isDefault, true), isNull(sites.deletedAt)));
  if (existing) return { settings: current, defaultSite: existing };
  const timezone = options.timezone && isValidTimezone(options.timezone) ? options.timezone : current.defaultTimezone;
  await executor
    .insert(sites)
    .values({ orgId, code: DEFAULT_SITE.code, name: DEFAULT_SITE.name, timezone, isDefault: true, weekStart: current.weekStart })
    .onConflictDoNothing();
  const [made] = await executor
    .select()
    .from(sites)
    .where(and(eq(sites.orgId, orgId), eq(sites.isDefault, true), isNull(sites.deletedAt)));
  if (!made) throw new Error('The default site could not be made.');
  return { settings: current, defaultSite: made };
});
