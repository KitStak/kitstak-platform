import { hashString } from "./orders-priority";
import type { OrderRow } from "./orders-types";

/**
 * Deterministic customer-name de-duplication for the Shipment Orders list.
 *
 * The server-side mock seed (read-only shared code) draws customer names from
 * a small pool, so one viewport showed two Nathans, two Priyas, and two Smiths
 * — an instant "generated data" tell. We adapt locally: within a fetched page,
 * the first occurrence of a first or last name keeps it; later collisions are
 * remapped to an alternate from the pools below, chosen by a stable hash of
 * the order code, so the same order always renders the same name across
 * refetches, pagination, and refreshes.
 *
 * Only two-word person names are touched; company-style customers such as
 * "Cobalt Supply Co." or "Harbor North Retail Group" pass through untouched.
 * Rows are never mutated — replacements are returned as new objects.
 */
const FIRST_NAMES: readonly string[] = [
  "Elena", "Marcus", "Dana", "Theo", "Camille", "Victor", "Imani", "Russell",
  "Sofia", "Grant", "Noor", "Felix", "Harper", "Dmitri", "Alana", "Wade",
  "Celeste", "Omar", "Bridget", "Lionel", "Maren", "Silas", "Yvette", "Cole",
];

const LAST_NAMES: readonly string[] = [
  "Alvarez", "Trent", "Okafor", "Lindqvist", "Marsh", "Delgado", "Whitfield",
  "Nakamura", "Boone", "Castellanos", "Pruitt", "Hale", "Iverson", "McAllister",
  "Reyes", "Thorpe", "Vance", "Kowalski", "Ferris", "Odom", "Sutton", "Barrera",
];

function pickUnseen(
  pool: readonly string[],
  seen: ReadonlySet<string>,
  seed: number
): string | null {
  const offset = seed % pool.length;
  for (let i = 0; i < pool.length; i += 1) {
    const candidate = pool[(offset + i) % pool.length];
    if (candidate && !seen.has(candidate.toLowerCase())) return candidate;
  }
  return null;
}

/** Splits "First Last" person names; returns null for company-style names. */
function splitPersonName(name: string): [string, string] | null {
  const parts = name.trim().split(/\s+/);
  if (parts.length !== 2) return null;
  const [first, last] = parts;
  if (!first || !last) return null;
  return [first, last];
}

/** Returns new rows where repeated first/last names are deterministically remapped. */
export function withDistinctCustomerNames(rows: readonly OrderRow[]): OrderRow[] {
  const seenFirst = new Set<string>();
  const seenLast = new Set<string>();

  return rows.map((row) => {
    const parts = splitPersonName(row.customerName);
    if (!parts) return row;

    const [originalFirst, originalLast] = parts;
    const seed = hashString(row.code);

    let first = originalFirst;
    if (seenFirst.has(first.toLowerCase())) {
      first = pickUnseen(FIRST_NAMES, seenFirst, seed) ?? first;
    }
    seenFirst.add(first.toLowerCase());

    let last = originalLast;
    if (seenLast.has(last.toLowerCase())) {
      last = pickUnseen(LAST_NAMES, seenLast, seed >>> 3) ?? last;
    }
    seenLast.add(last.toLowerCase());

    if (first === originalFirst && last === originalLast) return row;
    return { ...row, customerName: `${first} ${last}` };
  });
}
