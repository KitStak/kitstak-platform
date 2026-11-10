/**
 * Status pill color maps (BUILD_PLAN 0.5). Logiwa semantics in the KitStaks palette.
 * Every status in the product renders through `<StatusPill domain=… status=…>` using
 * these tones. Lookups are case-insensitive; unknown statuses fall back to the
 * generic map and finally to neutral grey.
 */

export interface StatusTone {
  readonly bg: string;
  readonly fg: string;
}

export const TONES = {
  // fg darkened from #17874D (3.76:1) to meet AA 4.5:1 on the pill background.
  green: { bg: "#D3F0E3", fg: "#0E6B3B" },
  blue: { bg: "#D5E5F2", fg: "#0D36A3" },
  /** "Ready …" queue states (Ready To Pick / Pack / Sort). */
  readyBlue: { bg: "rgba(46,92,230,.10)", fg: "#2E5CE6" },
  /** "… Started" in-progress states (Picking / Packing / Sorting Started). */
  indigo: { bg: "rgba(79,70,229,.10)", fg: "#4F46E5" },
  purple: { bg: "#DFCEF5", fg: "#621DB8" },
  shortage: { bg: "#F7E9E4", fg: "#A13406" },
  hold: { bg: "#D7D9DD", fg: "#394357" },
  red: { bg: "#FBDBDE", fg: "#B20B1C" },
  grey: { bg: "#E3E6E8", fg: "#50575C" },
  amber: { bg: "rgba(235,172,0,.16)", fg: "#B07F00" },
  teal: { bg: "#D0F3EE", fg: "#0F8C7A" },
  priorityHigh: { bg: "rgba(229,97,86,.24)", fg: "#C7403B" },
  exportDone: { bg: "#28B5733D", fg: "#1B8A55" },
  negativeDiff: { bg: "#ED634A3D", fg: "#C2412A" },
} as const satisfies Readonly<Record<string, StatusTone>>;

export type ToneName = keyof typeof TONES;

/*
 * Note on contrast: a few spec foregrounds (#EBAC00, #16C2AA, #E55B56, #28B573, #ED634A)
 * fail WCAG AA at 11px on their tints, so the text uses a darker shade of the same hue.
 * The spec's original value is kept below as `accent` for icons and dots.
 */
export const TONE_ACCENTS: Readonly<Partial<Record<ToneName, string>>> = {
  amber: "#EBAC00",
  teal: "#16C2AA",
  priorityHigh: "#E55B56",
  exportDone: "#28B573",
  negativeDiff: "#ED634A",
};

type StatusMap = Readonly<Record<string, ToneName>>;

const SHIPMENT_ORDER: StatusMap = {
  open: "green",
  // Queue states vs in-progress states vs loading are told apart at a glance.
  "ready to pick": "readyBlue",
  "picking started": "indigo",
  "ready to pack": "readyBlue",
  "packing started": "indigo",
  "ready to sort": "readyBlue",
  "sorting started": "indigo",
  "loading started": "teal",
  "ready to ship": "purple",
  "ready to load": "purple",
  shipped: "green",
  "partially shipped": "green",
  delivered: "green",
  shortage: "shortage",
  "on hold": "hold",
  cancelled: "red",
};

const PURCHASE_ORDER: StatusMap = { pending: "grey", started: "blue", receiving: "blue", completed: "green", cancelled: "red" };
const JOB: StatusMap = { pending: "grey", started: "blue", "in progress": "blue", completed: "green", cancelled: "red" };
const COUNT: StatusMap = {
  pending: "grey",
  "ready to count": "blue",
  "count started": "blue",
  "count completed": "green",
  "inventory updated": "green",
  "recount created": "green",
  cancelled: "red",
};
// "Started" is blue everywhere (PO, job, wave, return) so one word means one colour.
const RETURN: StatusMap = { pending: "grey", started: "blue", "in transit": "blue", completed: "green", cancelled: "red" };
const SHIPMENT_PLAN: StatusMap = {
  open: "teal",
  "in progress": "blue",
  "loading started": "blue",
  "loading completed": "green",
  shipped: "green",
  cancelled: "red",
};
const EOD: StatusMap = { open: "teal", closed: "green" };
const LABEL_TYPE: StatusMap = { shipping: "blue", return: "purple" };
const EXPORT: StatusMap = { queued: "grey", started: "blue", processing: "blue", completed: "exportDone", error: "red", failed: "red" };
const WORK_ORDER: StatusMap = { open: "green", "in process": "blue", completed: "green", shortage: "shortage", cancelled: "red" };
const WAVE: StatusMap = {
  pending: "grey",
  "preparing for optimization": "blue",
  optimizing: "blue",
  "optimization completed": "blue",
  started: "blue",
  "in progress": "blue",
  completed: "green",
  failed: "red",
};
const INTEGRATION: StatusMap = {
  successful: "green",
  "no data": "red",
  error: "red",
  "partially successful": "amber",
  failed: "red",
  processing: "blue",
  test: "purple",
  active: "green",
  passive: "grey",
  inactive: "grey",
};
const YES_NO: StatusMap = { yes: "green", no: "grey", true: "green", false: "grey" };
const PRIORITY: StatusMap = { urgent: "priorityHigh", high: "priorityHigh", medium: "amber", low: "grey", none: "grey" };
const ACTIVE: StatusMap = { active: "green", passive: "grey", inactive: "grey" };

/** Fallback used when no domain is given or the domain has no entry for the status. */
const GENERIC: StatusMap = {
  ...WAVE,
  ...JOB,
  ...COUNT,
  ...SHIPMENT_ORDER,
  ...ACTIVE,
  draft: "grey",
  closed: "grey",
  received: "green",
  allocated: "blue",
  backorder: "shortage",
  error: "red",
  successful: "green",
  "partially successful": "amber",
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

export function statusToneName(status: string | null | undefined, domain: StatusDomain = "generic"): ToneName {
  // Tolerates a missing status (renders grey) instead of crashing the page.
  const key = (status ?? "").trim().toLowerCase();
  const map: StatusMap = STATUS_DOMAINS[domain];
  return map[key] ?? GENERIC[key] ?? "grey";
}

export function statusTone(status: string | null | undefined, domain: StatusDomain = "generic"): StatusTone {
  return TONES[statusToneName(status, domain)];
}

/** Receiving difference pill: negative red-orange, positive green, zero grey. */
export function differenceTone(diff: number): StatusTone {
  if (diff < 0) return TONES.negativeDiff;
  if (diff > 0) return TONES.green;
  return TONES.grey;
}

/** Statuses that get the small "P" mini-pill (partial). */
export function isPartialStatus(status: string | null | undefined): boolean {
  return (status ?? "").trim().toLowerCase().startsWith("partially");
}

/** Short words kept lowercase inside a status label ("Ready to Pick", "Count of Lines"). */
const MINOR_WORDS: ReadonlySet<string> = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "or", "the", "to", "via"]);

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
    .join(" ");
}
