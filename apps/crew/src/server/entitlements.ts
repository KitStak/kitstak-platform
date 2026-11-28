/**
 * Crew access before launch (docs/crew/SPEC.md section 3.4). Crew is a preview app: it is not in
 * PRODUCT_IDS, MODULES or the core.entitlements CHECK, so there is no entitlement row to read.
 * `orgCrewAccess` is the ONLY caller of `previewAccess` in this app; every gate (the (app) layout,
 * `assertPlanAllows`, route handlers, actions, device links) goes through it.
 *
 * At launch this one function becomes `getModuleAccess(db, orgId, 'crew')` with Pulse's allow all
 * rule, and nothing else in the app changes.
 */
import 'server-only';
import { getEntitlements, isDevAllowAll, isEntitled, previewAccess, type EntitlementsDb, type ModuleAccess } from '@kitstak/entitlements';
import { db } from '@/server/db';
import { asSystem } from '@/server/db/scope';

export interface AccessOrg {
  readonly id: string;
  readonly slug: string;
}

/** Preview access: `full` or `locked` (a preview has no view only state). */
export async function orgCrewAccess(org: AccessOrg, env: NodeJS.ProcessEnv = process.env): Promise<ModuleAccess> {
  return previewAccess('crew', org.slug, env);
}

/** The allow all switch, the same rule every app reads (billing org options use it for seat limits). */
export function entitlementsAllowAll(env: NodeJS.ProcessEnv = process.env): boolean {
  const explicit = env.ENTITLEMENTS_DEV_ALLOW_ALL?.trim();
  if (explicit) return isDevAllowAll(env);
  return env.NODE_ENV !== 'production';
}

export interface SiblingFlags {
  readonly crm: boolean;
  readonly wms: boolean;
  readonly projects: boolean;
  readonly pulse: boolean;
}

const entitlementsDb = (): EntitlementsDb => db as unknown as EntitlementsDb;

/** Which billed sibling apps the org may open (app switcher locks). Fails soft to all locked. */
export async function orgSiblingFlags(orgId: string): Promise<SiblingFlags> {
  if (entitlementsAllowAll()) return { crm: true, wms: true, projects: true, pulse: true };
  try {
    const snapshot = await asSystem('entitlement check (core.entitlements)', () => getEntitlements(entitlementsDb(), orgId));
    return { crm: isEntitled(snapshot.crm), wms: isEntitled(snapshot.wms), projects: isEntitled(snapshot.projects), pulse: isEntitled(snapshot.pulse) };
  } catch {
    return { crm: false, wms: false, projects: false, pulse: false };
  }
}
