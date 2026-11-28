/**
 * The preview gate for apps that are built but not sold yet: Crew and Ledger (docs/crew/SPEC.md,
 * docs/ledger/SPEC.md). They are not billed modules, so `core.entitlements` has no row for them and
 * cannot. Until an app launches, it lets in:
 *  - every org outside production (local dev, tests), unless ENTITLEMENTS_DEV_ALLOW_ALL says false;
 *  - every org when ENTITLEMENTS_DEV_ALLOW_ALL is true, the same switch the other apps honor;
 *  - in production, only orgs whose slug is in KITSTAK_PREVIEW_ORGS (comma separated).
 * At launch the app joins MODULES and its gate moves to `getModuleAccess`, like Pulse.
 */
import type { ModuleAccess } from './read';

export const PREVIEW_APPS = ['crew', 'ledger'] as const;
export type PreviewApp = (typeof PREVIEW_APPS)[number];

export function isPreviewApp(value: string): value is PreviewApp {
  return (PREVIEW_APPS as readonly string[]).includes(value);
}

/** The org slugs let in to the preview apps in production. */
export function previewOrgSlugs(env: NodeJS.ProcessEnv = process.env): ReadonlySet<string> {
  return new Set(
    (env.KITSTAK_PREVIEW_ORGS ?? '')
      .split(',')
      .map((slug) => slug.trim().toLowerCase())
      .filter((slug) => slug.length > 0),
  );
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const FALSY = new Set(['0', 'false', 'no', 'off']);

/**
 * `full` or `locked` for one org. There is no view only state: a preview has no plan to lapse.
 * `app` is unused today (both apps share one list) and kept so each app can get its own list later
 * without changing a caller.
 */
export function previewAccess(
  _app: PreviewApp,
  orgSlug: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ModuleAccess {
  const allowAll = env.ENTITLEMENTS_DEV_ALLOW_ALL?.trim().toLowerCase() ?? '';
  if (TRUTHY.has(allowAll)) return 'full';
  if (env.NODE_ENV !== 'production' && !FALSY.has(allowAll)) return 'full';
  if (!orgSlug) return 'locked';
  return previewOrgSlugs(env).has(orgSlug.trim().toLowerCase()) ? 'full' : 'locked';
}
