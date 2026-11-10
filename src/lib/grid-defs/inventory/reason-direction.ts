/**
 * Adjustment reason direction (M06). A reason can say which way it moves stock:
 *   increase  only for Add / Adjust up      ("Inventory found", "Surplus")
 *   decrease  only for Remove / Adjust down  ("Inventory is missing", "Damaged", "Expired")
 *   both      any change (default)
 *
 * The value lives in `lookup_values.meta.direction` (set in Settings > Adjustment Reasons).
 * Until a reason has one, a name-based default applies, so "Inventory is missing" is never
 * offered for an increase. The drawer filters by the sign of the change, and the server
 * refuses a mismatch with the same message.
 */
export const REASON_DIRECTIONS = ["increase", "decrease", "both"] as const;
export type ReasonDirection = (typeof REASON_DIRECTIONS)[number];

const DECREASE_RE = /\b(missing|lost|loss|damaged?|broken|stolen|theft|expired?|scrap(ped)?|shrink(age)?|destroy(ed)?|write[- ]?off|disposed?|spoil(ed|age)?|sample[sd]? (out|used)|consumed)\b/i;
const INCREASE_RE = /\b(found|surplus|extra|overage|excess|returned to stock)\b/i;

/** Direction from an explicit meta value, else from the name, else "both". */
export function reasonDirection(name: string, meta?: Readonly<Record<string, unknown>> | null): ReasonDirection {
  const explicit = meta?.direction;
  if (typeof explicit === "string" && (REASON_DIRECTIONS as readonly string[]).includes(explicit)) return explicit as ReasonDirection;
  if (DECREASE_RE.test(name)) return "decrease";
  if (INCREASE_RE.test(name)) return "increase";
  return "both";
}

/** True when a reason may be used for a change of `delta` units (0 / unknown → any reason). */
export function reasonAllows(direction: ReasonDirection, delta: number | null | undefined): boolean {
  if (direction === "both" || delta === null || delta === undefined || delta === 0 || Number.isNaN(delta)) return true;
  return direction === "increase" ? delta > 0 : delta < 0;
}

/** Message for a reason used the wrong way. */
export function reasonDirectionMessage(name: string, direction: ReasonDirection): string {
  return direction === "decrease"
    ? `"${name}" is a decrease reason. Use it to remove or adjust stock down.`
    : `"${name}" is an increase reason. Use it to add or adjust stock up.`;
}
