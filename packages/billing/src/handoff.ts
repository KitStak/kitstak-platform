/**
 * Marketing site to signup handoff (docs/billing/CONTRACTS.md section 6). PURE, used by `apps/web`
 * and the portal. The link is validated, not signed: it holds no price and no identity in the query,
 * so there is nothing to forge. Name, email and company ride after the '#', where no server sees them.
 */
import {
  type BillingInterval,
  MAX_SEATS,
  MAX_WAREHOUSES,
  normalizeSelection,
  parseStack,
  type PlanSelection,
  stackParam,
} from './catalog';

export type BusinessType = '3pl' | 'brand' | 'distributor' | 'other';
export type TeamSize = 'solo' | 'small' | 'medium' | 'large';
export type StartMode = 'fresh' | 'sample' | 'import';
export type HandoffSource = 'wizard' | 'pricing' | 'product' | 'app' | 'direct';

export const BUSINESS_TYPES: readonly BusinessType[] = ['3pl', 'brand', 'distributor', 'other'];
export const TEAM_SIZES: readonly TeamSize[] = ['solo', 'small', 'medium', 'large'];
export const START_MODES: readonly StartMode[] = ['fresh', 'sample', 'import'];
export const HANDOFF_SOURCES: readonly HandoffSource[] = ['wizard', 'pricing', 'product', 'app', 'direct'];

export interface SignupHandoff {
  /** null when the link carried no valid product. */
  readonly selection: PlanSelection | null;
  readonly profile: {
    readonly businessType?: BusinessType;
    readonly teamSize?: TeamSize;
    readonly startMode?: StartMode;
    readonly guided?: boolean;
  };
  readonly source: HandoffSource;
}

export interface HandoffIdentity {
  readonly name?: string;
  readonly email?: string;
  readonly company?: string;
}

const IDENTITY_MAX = 120;

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return value !== undefined && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

type ParamSource = URLSearchParams | Readonly<Record<string, string | string[] | undefined>>;

function reader(params: ParamSource): (name: string) => string | undefined {
  if (params instanceof URLSearchParams) {
    return (name) => params.get(name)?.trim() || undefined;
  }
  return (name) => {
    const raw = params[name];
    const first = Array.isArray(raw) ? raw[0] : raw;
    return typeof first === 'string' && first.trim() !== '' ? first.trim() : undefined;
  };
}

/** Whole number in range, or undefined for junk (so the default applies). */
function wholeInRange(value: string | undefined, max: number): number | undefined {
  if (value === undefined || !/^\d{1,6}$/.test(value)) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return undefined;
  return Math.min(parsed, max);
}

export function encodeHandoff(handoff: SignupHandoff): URLSearchParams {
  const params = new URLSearchParams();
  if (handoff.selection && handoff.selection.products.length > 0) {
    const selection = normalizeSelection(handoff.selection);
    params.set('products', stackParam(selection.products));
    params.set('seats', String(selection.seats));
    params.set('warehouses', String(selection.warehouses));
    params.set('billing', selection.interval);
  }
  const { businessType, teamSize, startMode, guided } = handoff.profile;
  if (businessType) params.set('businessType', businessType);
  if (teamSize) params.set('teamSize', teamSize);
  if (startMode) params.set('startMode', startMode);
  if (guided !== undefined) params.set('guided', guided ? '1' : '0');
  params.set('src', handoff.source);
  return params;
}

export function parseHandoff(params: ParamSource): SignupHandoff {
  const read = reader(params);

  const productsParam = read('products');
  // Legacy links carried `focus` (crm, wms, both). Read it only when `products` is missing.
  const stack = parseStack(productsParam ?? read('focus'));
  const billing = read('billing');
  const interval: BillingInterval = billing === 'yearly' || billing === 'annual' ? 'yearly' : 'monthly';
  const selection: PlanSelection | null =
    stack.length === 0
      ? null
      : normalizeSelection({
          products: stack,
          seats: wholeInRange(read('seats'), MAX_SEATS) ?? 1,
          warehouses: wholeInRange(read('warehouses'), MAX_WAREHOUSES) ?? 1,
          interval,
        });

  const businessType = oneOf(read('businessType'), BUSINESS_TYPES);
  const teamSize = oneOf(read('teamSize'), TEAM_SIZES);
  const startMode = oneOf(read('startMode'), START_MODES);
  const guidedRaw = read('guided');
  const guided = guidedRaw === '1' || guidedRaw === 'true' ? true : guidedRaw === '0' ? false : undefined;

  return {
    selection,
    profile: {
      ...(businessType ? { businessType } : {}),
      ...(teamSize ? { teamSize } : {}),
      ...(startMode ? { startMode } : {}),
      ...(guided !== undefined ? { guided } : {}),
    },
    source: oneOf(read('src'), HANDOFF_SOURCES) ?? 'direct',
  };
}

function cleanIdentityValue(value: string | undefined | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  // Control characters never belong in a name, an email or a company.
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, IDENTITY_MAX).trim();
  return cleaned === '' ? undefined : cleaned;
}

/** Goes after '#'. Never sent to a server, never in logs. Values are trimmed to 120 characters. */
export function encodeHandoffIdentity(identity: HandoffIdentity): string {
  const params = new URLSearchParams();
  const name = cleanIdentityValue(identity.name);
  const email = cleanIdentityValue(identity.email);
  const company = cleanIdentityValue(identity.company);
  if (name) params.set('name', name);
  if (email) params.set('email', email);
  if (company) params.set('company', company);
  return params.toString();
}

export function parseHandoffIdentity(hash: string): HandoffIdentity {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (raw === '') return {};
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return {};
  }
  const name = cleanIdentityValue(params.get('name'));
  const email = cleanIdentityValue(params.get('email'));
  const company = cleanIdentityValue(params.get('company'));
  return {
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
    ...(company ? { company } : {}),
  };
}

/** `${portalOrigin}/signup?<query>#<identity>` */
export function signupUrl(portalOrigin: string, handoff: SignupHandoff, identity?: HandoffIdentity): string {
  const base = portalOrigin.replace(/\/+$/, '');
  const query = encodeHandoff(handoff).toString();
  const fragment = identity ? encodeHandoffIdentity(identity) : '';
  return `${base}/signup${query ? `?${query}` : ''}${fragment ? `#${fragment}` : ''}`;
}
