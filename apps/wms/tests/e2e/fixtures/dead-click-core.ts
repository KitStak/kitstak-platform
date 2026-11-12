/**
 * Pure logic for the dead-click audit (no Playwright imports, unit-tested in
 * tests/unit/foundation/dead-click-core.test.ts).
 *
 * A click is "alive" when it produces at least one observable effect:
 * navigation, a network request, a new dialog/drawer/popover/menu, a download
 * or popup, or a DOM mutation.
 */

export interface ClickSignals {
  readonly navigated: boolean;
  readonly requests: number;
  readonly overlaysBefore: number;
  readonly overlaysAfter: number;
  readonly mutations: number;
  readonly downloads: number;
  readonly popups: number;
}

export type ClickEffect = 'navigation' | 'request' | 'overlay' | 'download' | 'popup' | 'mutation';

export function clickEffects(signals: ClickSignals): readonly ClickEffect[] {
  const effects: ClickEffect[] = [];
  if (signals.navigated) effects.push('navigation');
  if (signals.requests > 0) effects.push('request');
  if (signals.overlaysAfter > signals.overlaysBefore) effects.push('overlay');
  if (signals.downloads > 0) effects.push('download');
  if (signals.popups > 0) effects.push('popup');
  if (signals.mutations > 0) effects.push('mutation');
  return effects;
}

export function isDeadClick(signals: ClickSignals): boolean {
  return clickEffects(signals).length === 0;
}

/** Requests that are dev-server noise, not app behavior. */
const NOISE_PATTERNS: readonly RegExp[] = [
  /\/_next\/webpack-hmr/,
  /\/__nextjs_/,
  /\.hot-update\./,
  /\/_next\/static\/.*\.(?:js|css|map)(?:\?|$)/,
  /\/favicon\.ico$/,
];

export function isNoiseRequest(url: string): boolean {
  return NOISE_PATTERNS.some((pattern) => pattern.test(url));
}

const EXCLUDED_ROUTE_PREFIXES: readonly string[] = ['/api/', '/login', '/logout', '/_next/'];

/**
 * Normalizes an href found in the app shell to an auditable same-origin route
 * (path + query, no hash), or null when it must not be crawled.
 */
export function toAuditRoute(href: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  if (!/^https?:$/.test(url.protocol)) return null;
  const route = `${url.pathname}${url.search}`;
  if (EXCLUDED_ROUTE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return null;
  return route;
}

export function uniqueRoutes(hrefs: readonly string[], origin: string): readonly string[] {
  const routes = hrefs
    .map((href) => toAuditRoute(href, origin))
    .filter((route): route is string => route !== null);
  return [...new Set(routes)].sort();
}

const MAX_WALK_DEPTH = 12;

/** Collects every string `href` property from an arbitrary nav-config export tree. */
export function extractHrefs(value: unknown, depth = 0): readonly string[] {
  if (depth > MAX_WALK_DEPTH || value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((item) => extractHrefs(item, depth + 1));
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    key === 'href' && typeof child === 'string' ? [child] : extractHrefs(child, depth + 1),
  );
}

/** Controls never clicked by the audit (they end the session or are explicitly opted out). */
const SKIP_LABEL = /\b(?:log ?out|sign ?out)\b/i;

export interface ControlDescriptor {
  readonly auditId: number;
  readonly tag: string;
  readonly role: string | null;
  readonly label: string;
  readonly href: string | null;
  /** True when the control lives in the shared app shell (header / nav / aside). */
  readonly inShell: boolean;
  /**
   * True for a non-link control that already represents the current state
   * (`aria-selected="true"` tab, `aria-pressed="true"` toggle): re-selecting it is a
   * legitimate no-op, not a dead click.
   */
  readonly isCurrent?: boolean;
}

export function shouldSkipControl(control: ControlDescriptor): boolean {
  if (control.isCurrent === true) return true;
  return SKIP_LABEL.test(control.label) || (control.href !== null && /\/logout\b/.test(control.href));
}

/** Shell controls repeat on every route; they are audited once, on the first route. */
export function controlSignature(control: ControlDescriptor): string {
  return [control.tag, control.role ?? '', control.label, control.href ?? ''].join('|');
}

export interface Offender {
  readonly route: string;
  readonly control: ControlDescriptor;
}

export function describeControl(control: ControlDescriptor): string {
  const role = control.role ? `[role=${control.role}]` : '';
  const label = control.label ? `"${control.label}"` : '(no accessible label)';
  const href = control.href ? ` -> ${control.href}` : '';
  return `<${control.tag}${role}> ${label}${href}`;
}

export function formatOffenders(offenders: readonly Offender[]): string {
  if (offenders.length === 0) return 'No dead clicks found.';
  const byRoute = new Map<string, Offender[]>();
  for (const offender of offenders) {
    byRoute.set(offender.route, [...(byRoute.get(offender.route) ?? []), offender]);
  }
  const lines = [...byRoute.entries()].flatMap(([route, list]) => [
    `${route} (${list.length})`,
    ...list.map((o) => `  - ${describeControl(o.control)}`),
  ]);
  return [`${offenders.length} dead click(s):`, ...lines].join('\n');
}

/** Parses AUDIT_ROUTES="/orders,/products" into a route filter (empty = all). */
export function parseRouteFilter(value: string | undefined): readonly string[] {
  if (!value || value.trim() === '') return [];
  const routes = value
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r.startsWith('/'));
  if (routes.length === 0) {
    // e.g. Git Bash rewrote "/orders" into "C:/Program Files/Git/orders" (set MSYS_NO_PATHCONV=1).
    throw new Error(`AUDIT_ROUTES="${value}" contains no routes starting with "/"`);
  }
  return routes;
}

export function applyRouteFilter(routes: readonly string[], filter: readonly string[]): readonly string[] {
  if (filter.length === 0) return routes;
  return routes.filter((route) =>
    filter.some((f) => route === f || route.startsWith(`${f}?`) || route.startsWith(`${f}/`)),
  );
}
