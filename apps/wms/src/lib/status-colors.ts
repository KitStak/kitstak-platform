import type { PillTone } from '@kitstak/ui/dashboard';

export type { PillTone };

/**
 * Status pill tone maps (BUILD_PLAN 0.5, docs/design/UI-CLEANUP.md "Pills"). Every status in the
 * product renders through `<StatusPill domain=… status=…>`, drawn with the shared Pill in one of
 * five tones. Lookups are case-insensitive; unknown statuses fall back to the generic map and
 * finally to neutral.
 */

export interface StatusTone {
  /** Which of the five shared pill tones this status uses (`@kitstak/ui/dashboard` Pill). */
  readonly pill: PillTone;
  /** Tinted background (`--{tone}-subtle`), for the rare status mark drawn outside a Pill. */
  readonly bg: string;
  /** Text colour on that tint (`--{tone}-text`). */
  readonly fg: string;
  /** Solid dot colour (`--{tone}`). */
  readonly dot: string;
}

/** Token family behind each pill tone (same tokens as the shared Pill in dashboard.css). */
const PILL_TOKENS: Readonly<Record<PillTone, Omit<StatusTone, 'pill'>>> = {
  neutral: { bg: 'var(--surface-muted)', fg: 'var(--text-secondary)', dot: 'var(--text-muted)' },
  positive: { bg: 'var(--success-subtle)', fg: 'var(--success-text)', dot: 'var(--success)' },
  caution: { bg: 'var(--warning-subtle)', fg: 'var(--warning-text)', dot: 'var(--warning)' },
  critical: { bg: 'var(--danger-subtle)', fg: 'var(--danger-text)', dot: 'var(--danger)' },
  info: { bg: 'var(--info-subtle)', fg: 'var(--info-text)', dot: 'var(--info)' },
};

/** The colours of one pill tone, for a dot or mark that sits outside a Pill. */
export function pillToneColors(pill: PillTone): StatusTone {
  return { pill, ...PILL_TOKENS[pill] };
}

/**
 * Status tone names (kept so call sites and maps keep their words) mapped onto the five pill
 * tones the UI contract allows (docs/design/UI-CLEANUP.md, "Pills"). Several names share a tone
 * on purpose: the pill's words say which in-process step it is, the colour only says
 * "done", "in motion", "needs a look", "broken" or "nothing to do".
 */
export const TONE_PILL = {
  green: 'positive',
  blue: 'info',
  /** "Ready …" queue states (Ready to pick / pack / sort). */
  readyBlue: 'info',
  /** "… started" in-progress states (Picking / Packing / Sorting started). */
  indigo: 'info',
  purple: 'info',
  shortage: 'caution',
  hold: 'neutral',
  red: 'critical',
  grey: 'neutral',
  amber: 'caution',
  teal: 'info',
  priorityHigh: 'caution',
  exportDone: 'positive',
  negativeDiff: 'critical',
} as const satisfies Readonly<Record<string, PillTone>>;

export type ToneName = keyof typeof TONE_PILL;

/** Every tone name as its pill tone plus the matching colours. */
export const TONES = Object.fromEntries(
  Object.entries(TONE_PILL).map(([name, pill]) => [name, pillToneColors(pill)]),
) as Readonly<Record<ToneName, StatusTone>>;

/** Solid accent per tone, for icons and dots drawn outside a pill. */
export const TONE_ACCENTS: Readonly<Partial<Record<ToneName, string>>> = {
  amber: TONES.amber.dot,
  teal: TONES.teal.dot,
  priorityHigh: TONES.priorityHigh.dot,
  exportDone: TONES.exportDone.dot,
  negativeDiff: TONES.negativeDiff.dot,
};

type StatusMap = Readonly<Record<string, ToneName>>;

// Shipment orders: every in-process status is info, done is positive, Shortage caution,
// On hold neutral, Cancelled critical.
const SHIPMENT_ORDER: StatusMap = {
  // "Open" means new work, not done: teal (info) as on work orders and shipment plans.
  open: 'teal',
  'ready to pick': 'blue',
  'picking started': 'blue',
  'ready to pack': 'blue',
  'packing started': 'blue',
  'ready to sort': 'blue',
  'sorting started': 'blue',
  'ready to load': 'blue',
  'loading started': 'blue',
  'ready to ship': 'purple',
  shipped: 'green',
  'partially shipped': 'green',
  delivered: 'green',
  shortage: 'shortage',
  'on hold': 'hold',
  cancelled: 'red',
};

const PURCHASE_ORDER: StatusMap = {
  pending: 'grey',
  started: 'blue',
  receiving: 'blue',
  completed: 'green',
  cancelled: 'red',
};
const JOB: StatusMap = {
  pending: 'grey',
  started: 'blue',
  'in progress': 'blue',
  completed: 'green',
  cancelled: 'red',
};
const COUNT: StatusMap = {
  pending: 'grey',
  'ready to count': 'blue',
  'count started': 'blue',
  // Counted-but-not-posted, posted and superseded must read differently.
  'count completed': 'teal',
  'inventory updated': 'green',
  // Superseded by a recount: nothing left to do on this line.
  'recount created': 'grey',
  cancelled: 'red',
};
// "Started" is blue everywhere (PO, job, wave, return) so one word means one colour.
const RETURN: StatusMap = {
  pending: 'grey',
  started: 'blue',
  'in transit': 'blue',
  completed: 'green',
  cancelled: 'red',
};
const SHIPMENT_PLAN: StatusMap = {
  open: 'teal',
  'in progress': 'blue',
  'loading started': 'blue',
  'loading completed': 'green',
  shipped: 'green',
  cancelled: 'red',
};
const EOD: StatusMap = { open: 'teal', closed: 'green' };
const LABEL_TYPE: StatusMap = { shipping: 'blue', return: 'purple' };
const EXPORT: StatusMap = {
  queued: 'grey',
  started: 'blue',
  processing: 'blue',
  completed: 'exportDone',
  error: 'red',
  failed: 'red',
};
const WORK_ORDER: StatusMap = {
  open: 'teal',
  'in process': 'blue',
  completed: 'green',
  shortage: 'shortage',
  cancelled: 'red',
};
const WAVE: StatusMap = {
  pending: 'grey',
  'preparing for optimization': 'blue',
  optimizing: 'blue',
  'optimization completed': 'blue',
  started: 'blue',
  'in progress': 'blue',
  completed: 'green',
  failed: 'red',
};
const INTEGRATION: StatusMap = {
  successful: 'green',
  // A run that found nothing to download is not a failure.
  'no data': 'grey',
  unauthorized: 'red',
  'already processing': 'blue',
  error: 'red',
  'partially successful': 'amber',
  failed: 'red',
  processing: 'blue',
  test: 'purple',
  active: 'green',
  passive: 'grey',
  inactive: 'grey',
};
const YES_NO: StatusMap = { yes: 'green', no: 'grey', true: 'green', false: 'grey' };
const PRIORITY: StatusMap = {
  urgent: 'priorityHigh',
  high: 'priorityHigh',
  medium: 'amber',
  low: 'grey',
  none: 'grey',
};
const ACTIVE: StatusMap = { active: 'green', passive: 'grey', inactive: 'grey' };
// Channel payment status (store financial status, e.g. Shopify/eBay): paid green,
// anything part-way amber, not-yet-paid red-leaning amber, terminal non-payment grey/red.
const PAYMENT: StatusMap = {
  paid: 'green',
  'partially paid': 'amber',
  partial: 'amber',
  'partially refunded': 'amber',
  pending: 'amber',
  authorized: 'blue',
  unpaid: 'red',
  expired: 'red',
  voided: 'grey',
  refunded: 'grey',
};

/** Fallback used when no domain is given or the domain has no entry for the status. */
const GENERIC: StatusMap = {
  ...WAVE,
  ...JOB,
  ...COUNT,
  ...SHIPMENT_ORDER,
  ...ACTIVE,
  draft: 'grey',
  closed: 'grey',
  received: 'green',
  allocated: 'blue',
  backorder: 'shortage',
  error: 'red',
  successful: 'green',
  'partially successful': 'amber',
};

export const STATUS_DOMAINS = {
  shipmentOrder: SHIPMENT_ORDER,
  purchaseOrder: PURCHASE_ORDER,
  job: JOB,
  task: JOB,
  count: COUNT,
  return: RETURN,
  shipmentPlan: SHIPMENT_PLAN,
  eod: EOD,
  labelType: LABEL_TYPE,
  export: EXPORT,
  workOrder: WORK_ORDER,
  wave: WAVE,
  integration: INTEGRATION,
  yesNo: YES_NO,
  priority: PRIORITY,
  active: ACTIVE,
  payment: PAYMENT,
  generic: GENERIC,
} as const satisfies Readonly<Record<string, StatusMap>>;

export type StatusDomain = keyof typeof STATUS_DOMAINS;

export function statusToneName(
  status: string | null | undefined,
  domain: StatusDomain = 'generic',
): ToneName {
  // Tolerates a missing status (renders grey) instead of crashing the page.
  const key = (status ?? '').trim().toLowerCase();
  const map: StatusMap = STATUS_DOMAINS[domain];
  return map[key] ?? GENERIC[key] ?? 'grey';
}

export function statusTone(status: string | null | undefined, domain: StatusDomain = 'generic'): StatusTone {
  return TONES[statusToneName(status, domain)];
}

/** Receiving difference tone: negative critical, positive positive, zero neutral. */
export function differenceTone(diff: number): StatusTone {
  if (diff < 0) return TONES.negativeDiff;
  if (diff > 0) return TONES.green;
  return TONES.grey;
}

/** Statuses that get the half-filled "partial" dot. */
export function isPartialStatus(status: string | null | undefined): boolean {
  return (status ?? '').trim().toLowerCase().startsWith('partially');
}

/** Warehouse acronyms that stay in capitals inside a sentence case label. */
const ACRONYMS: ReadonlySet<string> = new Set([
  'api',
  'asn',
  'bol',
  'csv',
  'eod',
  'fba',
  'ftl',
  'id',
  'lp',
  'lpn',
  'ltl',
  'pdf',
  'po',
  'qc',
  'rma',
  'sku',
  'so',
  'ups',
  'upc',
  'uom',
  'usps',
  'vas',
  'wms',
]);

function keepsItsCase(word: string, allCaps: boolean): boolean {
  const bare = word.replace(/[^A-Za-z]/g, '');
  if (bare.length === 0) return true;
  // A word typed in capitals inside a mixed-case label is an acronym ("LP", "3PL").
  if (!allCaps && bare.length > 1 && bare === bare.toUpperCase()) return true;
  // A brand written with an inner capital ("eBay", "TikTok") keeps it.
  return /[a-z]/.test(bare) && /[A-Z]/.test(bare.slice(1));
}

/**
 * The ONE display casing for every status label (pills, rails, mini-tables, filters):
 * sentence case, so "ready to pick", "Ready To Pick" and "READY TO PICK" all render
 * "Ready to pick". Acronyms ("EOD", "SKU", "LTL") and brands ("eBay") keep their capitals.
 * Lookups (`statusTone`) stay case-insensitive, so this only changes what people read.
 */
export function statusLabel(status: string): string {
  const words = status.trim().split(/\s+/).filter(Boolean);
  const allCaps = status === status.toUpperCase();
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower.replace(/[^a-z]/g, ''))) return word.toUpperCase();
      if (keepsItsCase(word, allCaps)) return word;
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');
}
