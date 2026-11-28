/**
 * Ledger's access gate (docs/ledger/SPEC.md 3.1). Before launch Ledger is not a billed module: one
 * function, `orgLedgerAccess`, decides whether an org may open Ledger at all, by the shared preview
 * rule `previewAccess('ledger', org.slug, env)` in `@kitstak/entitlements`. It answers `full` or
 * `locked`, never view only. Every (app) layout, route handler, server action and cron fan out
 * calls it.
 *
 * At launch (Phase 12) this becomes a copy of Pulse's `orgPulseAccess` (`getModuleAccess(db,
 * orgId, 'ledger')`) with the plan gate.
 *
 * Also exposes sibling module flags for the app switcher.
 */
import 'server-only';
import { getEntitlements, isDevAllowAll, isEntitled, previewAccess, type EntitlementsDb, type ModuleAccess } from '@kitstak/entitlements';
import { LEDGER_PREVIEW_LOCKED } from '@kitstak/ledger-bridge/types';
import { db } from '@/server/db';
import { asSystem } from '@/server/db/scope';
import { DomainError } from '@/server/errors';

export function entitlementsAllowAll(env: NodeJS.ProcessEnv = process.env): boolean {
  const explicit = env.ENTITLEMENTS_DEV_ALLOW_ALL?.trim();
  if (explicit) return isDevAllowAll(env);
  return env.NODE_ENV !== 'production';
}

export type LedgerGate = Extract<ModuleAccess, 'full' | 'locked'>;

/** `full` or `locked` for the org (SPEC 3.1). Pure over the env, so it is cheap to call everywhere. */
export function orgLedgerAccess(org: { readonly slug: string | null | undefined }, env: NodeJS.ProcessEnv = process.env): LedgerGate {
  return previewAccess('ledger', org.slug, env) === 'full' ? 'full' : 'locked';
}

/** The sentence a locked org sees, on screen and in the API's 402 answer. */
export const LOCKED_SENTENCE = LEDGER_PREVIEW_LOCKED;

/** Route handlers and server actions: refuse a locked org with 402 NOT_ENTITLED. */
export function assertLedgerOpen(org: { readonly slug: string | null | undefined }): void {
  if (orgLedgerAccess(org) !== 'full') throw new DomainError('NOT_ENTITLED', LOCKED_SENTENCE);
}

const entitlementsDb = (): EntitlementsDb => db as unknown as EntitlementsDb;

export interface ModuleFlags {
  readonly crm: boolean;
  readonly wms: boolean;
  readonly projects: boolean;
  readonly pulse: boolean;
}

/** Every billed module's entitlement for the org (app switcher). Fails soft to locked rows. */
export async function orgModuleFlags(orgId: string): Promise<ModuleFlags> {
  if (entitlementsAllowAll()) return { crm: true, wms: true, projects: true, pulse: true };
  try {
    const snapshot = await asSystem('entitlement check (core.entitlements)', () => getEntitlements(entitlementsDb(), orgId));
    return {
      crm: isEntitled(snapshot.crm),
      wms: isEntitled(snapshot.wms),
      projects: isEntitled(snapshot.projects),
      pulse: isEntitled(snapshot.pulse),
    };
  } catch (error) {
    console.error('[ledger] module flags read failed', error instanceof Error ? error.message : error);
    return { crm: false, wms: false, projects: false, pulse: false };
  }
}
