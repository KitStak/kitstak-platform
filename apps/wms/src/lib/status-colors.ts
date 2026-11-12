import type { CSSProperties } from 'react';

/**
 * Status pill color maps (BUILD_PLAN 0.5). Status semantics on the shared label palette.
 * Every status in the product renders through `<StatusPill domain=… status=…>` using
 * these tones. Lookups are case-insensitive; unknown statuses fall back to the
 * generic map and finally to neutral grey.
 */

export interface StatusTone {
  /** Tinted pill background (`--label-*-subtle`). */
  readonly bg: string;
  /** Pill text colour: `--label-*-text` with ink mixed in (see `pillText`), AA on the tint. */
  readonly fg: string;
  /** Solid dot colour (`--label-*`). */
  readonly dot: string;
}

/**
 * Pill text colour: the label's text colour with a share of ink mixed in (`--pill-text-mix`, set
 * per theme in the shared tokens) so it stays AA on its own tint for every label colour.
 */
export function pillText(name: string): string {
  return `color-mix(in srgb, var(--label-${name}-text), var(--text-primary) var(--pill-text-mix))`;
}

/** A tone from the shared label palette (src/styles/tokens.css, same tokens as KitStak CRM). */
function label(name: string): StatusTone {
  return { bg: `var(--label-${name}-subtle)`, fg: pillText(name), dot: `var(--label-${name})` };
}

/**
 * Status tones. Every tone is a label-palette token trio, so pills follow the light and dark
 * themes without per-theme overrides and match the CRM status pill exactly.
 */
export const TONES = {
  green: label('green'),
  blue: label('blue'),
  /** "Ready …" queue states (Ready To Pick / Pack / Sort). */
  readyBlue: label('sky'),
  /** "… Started" in-progress states (Picking / Packing / Sorting Started). */
  indigo: label('indigo'),
  purple: label('purple'),
  shortage: label('brown'),
  hold: label('gray'),
  red: label('red'),
  grey: label('gray'),
  amber: label('orange'),
  teal: label('teal'),
  priorityHigh: label('peach'),
  exportDone: label('green'),
  negativeDiff: label('red'),
} as const satisfies Readonly<Record<string, StatusTone>>;

export type ToneName = keyof typeof TONES;

/** Solid accent per tone, for icons and dots drawn outside a pill. */
export const TONE_ACCENTS: Readonly<Partial<Record<ToneName, string>>> = {
  amber: TONES.amber.dot,
  teal: TONES.teal.dot,
  priorityHigh: TONES.priorityHigh.dot,
  exportDone: TONES.exportDone.dot,
  negativeDiff: TONES.negativeDiff.dot,
};

type StatusMap = Readonly<Record<string, ToneName>>;

// Logiwa shipment-order palette: Open green, every in-process status blue (#0D36A3 on
// #D5E5F2), Ready to Ship purple, Shortage rust, On Hold slate, Cancelled red.
const SHIPMENT_ORDER: StatusMap = {
  open: 'green',
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
  'recount created': 'purple',
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

/** Inline style for a pill: tinted background and text colour, both theme-aware tokens. */
export function pillStyle(tone: StatusTone): CSSProperties {
  return { backgroundColor: tone.bg, color: tone.fg };
}

/**
 * The one status pill shape, shared with KitStak CRM: tinted background, text colour and a
 * solid 6px dot, 22px tall (18px at `sm`), 12px medium text.
 */
export function pillClass(size: 'sm' | 'md' = 'md'): string {
  return `inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full font-medium ${size === 'sm' ? 'h-[18px] px-1.5 text-2xs' : 'h-[22px] px-2 text-xs'}`;
}

/** Receiving difference pill: negative red-orange, positive green, zero grey. */
export function differenceTone(diff: number): StatusTone {
  if (diff < 0) return TONES.negativeDiff;
  if (diff > 0) return TONES.green;
  return TONES.grey;
}

/** Statuses that get the small "P" mini-pill (partial). */
export function isPartialStatus(status: string | null | undefined): boolean {
  return (status ?? '').trim().toLowerCase().startsWith('partially');
}

/** Short words kept lowercase inside a status label ("Ready to Pick", "Count of Lines"). */
const MINOR_WORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'by',
  'for',
  'in',
  'of',
  'or',
  'the',
  'to',
  'via',
]);

/**
 * The ONE display casing for every status label (pills, rails, mini-tables, filters):
 * Title Case with minor words lowercase, so "ready to pick", "Ready To Pick" and
 * "Ready to Pick" all render "Ready to Pick". Acronyms ("EOD", "LP") are kept.
 */
export function statusLabel(status: string): string {
  return status
    .trim()
    .split(/\s+/)
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && MINOR_WORDS.has(lower)) return lower;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}
