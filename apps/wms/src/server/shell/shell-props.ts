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
import { entitlementsAllowAll } from '@/server/auth/entitlements';
import { getPlanView, warehouseLimitNotice, wmsPlanLink, type WarehouseLimitNotice } from '@/server/auth/plan';
import { hasModule, type EntitlementsDb } from '@kitstak/entitlements';
import { accessibleWmsOrgs } from '@/server/auth/session-store';
import { getPasswordPolicy, isPasswordExpired } from '@/server/auth/password-policy';
import { users } from '@/server/db/schema';
import { getSessionIdleMinutes } from '@/server/repositories/company';
import { brandAccentCss, getBranding } from '@/server/repositories/apps-branding';
import { listActiveAppKeys } from './active-apps';
import { loadInitialShellContext } from './initial-context';
import type { AppPlanView } from '@kitstak/billing/server';

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
  readonly entitledApps?: { readonly crm: boolean; readonly wms: boolean; readonly projects: boolean; readonly pulse?: boolean };
  /** The organization whose warehouse is open, and every org warehouse the user can switch to. */
  readonly org?: { readonly id: string; readonly name: string };
  readonly orgs?: readonly { readonly id: string; readonly name: string }[];
  /** The organization's plan as the shell needs it (docs/billing/CONTRACTS.md section 18). */
  readonly plan?: ShellPlan;
}

type ProductId = 'crm' | 'wms' | 'projects' | 'pulse';

export interface ShellPlan {
  /** `read_only` = view only: everything opens and reads, every change is refused by the server. */
  readonly access: 'full' | 'read_only';
  /** The plan banner under the top bar, or null. Words and link come from `@kitstak/billing`. */
  readonly notice: AppPlanView['notice'];
  /** Plan state per app for the app switcher. */
  readonly badges: AppPlanView['badges'];
  /** Where a row that is not in the plan goes: the Portal plan picker with that app turned on. */
  readonly addHrefs: Readonly<Record<ProductId, string>>;
  /** Set when the plan has no room for one more warehouse: the sentence with the price, and the link. */
  readonly warehouseLimit: WarehouseLimitNotice | null;
}

/** Sibling modules the org holds (allow-all outside production, like the WMS gate). */
async function loadEntitledApps(db: AppDb, orgId: string): Promise<NonNullable<ShellProps['entitledApps']>> {
  if (entitlementsAllowAll()) return { crm: true, wms: true, projects: true, pulse: true };
  try {
    const check = (module: 'crm' | 'projects' | 'pulse') => hasModule(db as unknown as EntitlementsDb, orgId, module).catch(() => false);
    const [crm, projects, pulse] = await Promise.all([check('crm'), check('projects'), check('pulse')]);
    return { crm, wms: true, projects, pulse };
  } catch {
    return { crm: false, wms: true, projects: false, pulse: false };
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
  // Plan gate (docs/billing/CONTRACTS.md section 18): when WMS is not in the org's plan,
  // signed-in users land on the lock screen instead of the shell. A view only org (trial over,
  // payment late, paused, plan ended) still opens the shell, with the banner on top; the API
  // refuses every change. Dev/test default to allow-all.
  const planView = await getPlanView(platformDb, { orgId: auth.user.orgId, userId: auth.user.id });
  if (planView.access === 'locked') redirect('/locked');
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
    plan: {
      access: planView.access === 'read_only' ? 'read_only' : 'full',
      notice: planView.notice,
      badges: planView.badges,
      addHrefs: {
        crm: wmsPlanLink({ to: 'add', product: 'crm' }),
        wms: wmsPlanLink({ to: 'add', product: 'wms' }),
        projects: wmsPlanLink({ to: 'add', product: 'projects' }),
        pulse: wmsPlanLink({ to: 'add', product: 'pulse' }),
      },
      warehouseLimit: planView.access === 'read_only' ? null : await warehouseLimitNotice(platformDb, auth.user.orgId),
    },
  };
}
