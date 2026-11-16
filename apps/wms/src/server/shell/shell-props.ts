/**
 * Props for the authenticated AppShell, resolved from the session cookie. Shared by the
 * (app) layout (which redirects when signed out) and the root 404 (which falls back to
 * a branded frame), so both render the identical shell.
 */
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import type { InitialShellContext } from '@/lib/context-label';
import { getAppDb, getPlatformDb, type AppDb } from '@/server/api/db';
import { getAuthContext } from '@/server/auth/context';
import { entitlementsAllowAll, wmsModuleEntitledForOrg } from '@/server/auth/entitlements';
import { hasModule, type EntitlementsDb } from '@kitstak/entitlements';
import { accessibleWmsOrgs } from '@/server/auth/session-store';
import { getPasswordPolicy, isPasswordExpired } from '@/server/auth/password-policy';
import { users } from '@/server/db/schema';
import { getSessionIdleMinutes } from '@/server/repositories/company';
import { brandAccentCss, getBranding } from '@/server/repositories/apps-branding';
import { listActiveAppKeys } from './active-apps';
import { loadInitialShellContext } from './initial-context';

/** Why the signed-in user must choose a new password before using the app (null = not required). */
export type PasswordChangeReason = 'reset' | 'expired' | null;

export interface ShellProps {
  readonly user: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly role: string;
  };
  readonly permissions: readonly string[];
  readonly initialContext: InitialShellContext | null;
  /** Active add-on app keys; nav items tagged with an inactive app are hidden. */
  readonly activeApps: readonly string[];
  /** Set after an admin reset (no `passwordChangedAt`) or when the company max age has passed. */
  readonly passwordChange: PasswordChangeReason;
  /** Company web idle sign-out in minutes (null = off). */
  readonly idleMinutes: number | null;
  /** Custom Branding: CSS re-pointing the primary tokens at the brand accent (null = default theme). */
  readonly brandCss?: string | null;
  /** KitStak module unlock state for the request's org (shared app switcher). */
  readonly entitledApps?: { readonly crm: boolean; readonly wms: boolean; readonly projects: boolean };
  /** The organization whose warehouse is open, and every org warehouse the user can switch to. */
  readonly org?: { readonly id: string; readonly name: string };
  readonly orgs?: readonly { readonly id: string; readonly name: string }[];
}

/** Sibling modules the org holds (allow-all outside production, like the WMS gate). */
async function loadEntitledApps(db: AppDb, orgId: string): Promise<NonNullable<ShellProps['entitledApps']>> {
  if (entitlementsAllowAll()) return { crm: true, wms: true, projects: true };
  try {
    const check = (module: 'crm' | 'projects') => hasModule(db as unknown as EntitlementsDb, orgId, module).catch(() => false);
    const [crm, projects] = await Promise.all([check('crm'), check('projects')]);
    return { crm, wms: true, projects };
  } catch {
    return { crm: false, wms: true, projects: false };
  }
}

async function loadBrandCss(db: AppDb): Promise<string | null> {
  const b = await getBranding(db);
  return b?.applyToApp ? brandAccentCss(b.accentColor) || null : null;
}

/** Pure: reset (never changed) wins over expiry; API users never get the interactive gate. */
export function passwordChangeReason(
  row: { readonly passwordChangedAt: string | null; readonly isApiUser: boolean } | undefined,
  maxAgeDays: number | undefined,
  now: Date = new Date(),
): PasswordChangeReason {
  if (!row || row.isApiUser) return null;
  if (!row.passwordChangedAt) return 'reset';
  return isPasswordExpired(
    row.passwordChangedAt,
    { maxAgeDays } as Parameters<typeof isPasswordExpired>[1],
    now,
  )
    ? 'expired'
    : null;
}

async function loadPasswordChange(db: AppDb, userId: string): Promise<PasswordChangeReason> {
  const row = (
    await db
      .select({ passwordChangedAt: users.passwordChangedAt, isApiUser: users.isApiUser })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
  )[0];
  return passwordChangeReason(row, (await getPasswordPolicy(db)).maxAgeDays);
}

/** Null when there is no valid session. */
export async function loadShellProps(): Promise<ShellProps | null> {
  const auth = await getAuthContext();
  if (!auth) return null;
  const user = { id: auth.user.id, name: auth.user.name, email: auth.user.email, role: auth.user.role };
  const db = await getAppDb();
  const platformDb = await getPlatformDb();
  // Module entitlement gate (BLUEPRINT.md §3.3): signed-in users of an unentitled org land
  // on the branded /locked page instead of the shell (dev/test default to allow-all).
  if (!(await wmsModuleEntitledForOrg(platformDb, auth.user.orgId))) redirect('/locked');
  const orgs = (await accessibleWmsOrgs(platformDb, auth.user.id)).map((o) => ({ id: o.orgId, name: o.name }));
  const initialContext = await loadInitialShellContext(db, auth);
  return {
    user,
    permissions: [...auth.permissions].sort(),
    initialContext,
    activeApps: await listActiveAppKeys(db),
    passwordChange: await loadPasswordChange(db, auth.user.id),
    idleMinutes: await getSessionIdleMinutes(db),
    brandCss: await loadBrandCss(db),
    entitledApps: await loadEntitledApps(platformDb, auth.user.orgId),
    org: { id: auth.user.orgId, name: auth.user.orgName },
    orgs,
  };
}
