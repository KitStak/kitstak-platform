/**
 * Pure words and rules for Settings, API tokens. Safe on the client: no Node imports.
 */
export const TOKEN_APPS = ['crm', 'projects', 'pulse'] as const;
export type TokenApp = (typeof TOKEN_APPS)[number];
export type TokenAccess = 'read' | 'write';

export const TOKEN_APP_LABELS: Readonly<Record<TokenApp, string>> = { crm: 'CRM', projects: 'Projects', pulse: 'Pulse' };

/** How long a new token lasts. 30 days is the default; 90 is the most the database allows. */
export const TOKEN_DAY_CHOICES: readonly number[] = [7, 30, 60, 90];
export const DEFAULT_TOKEN_DAYS = 30;

const MANAGER_ROLES = new Set(['owner', 'admin']);

/** Org owners and admins see and can revoke every member's tokens. */
export function isTokenManager(role: string): boolean {
  return role
    .split(',')
    .map((part) => part.trim())
    .some((part) => MANAGER_ROLES.has(part));
}

/** The scopes for the picked apps: `app:read`, plus `app:write` for "Read and change". */
export function scopesFor(apps: readonly TokenApp[], access: TokenAccess): string[] {
  return TOKEN_APPS.filter((app) => apps.includes(app)).flatMap((app) => (access === 'write' ? [`${app}:read`, `${app}:write`] : [`${app}:read`]));
}

/** "CRM: read and change · Pulse: read" for a token's scopes, in catalog order. */
export function describeScopes(scopes: readonly string[]): string {
  const parts = TOKEN_APPS.flatMap((app) => {
    if (scopes.includes(`${app}:write`)) return [`${TOKEN_APP_LABELS[app]}: read and change`];
    if (scopes.includes(`${app}:read`)) return [`${TOKEN_APP_LABELS[app]}: read`];
    return [];
  });
  return parts.join(' · ');
}

const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** "Dec 27, 2026" from an ISO time, or the fallback for an empty value. */
export function tokenDate(iso: string | null, fallback = 'Never'): string {
  if (!iso) return fallback;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? fallback : DATE.format(time);
}
