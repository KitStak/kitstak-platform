/**
 * "Did you mean gmail.com?" for a mistyped email address (review round 3). PURE.
 *
 * A wrong letter in the part after the "@" is the most common reason a signup code never arrives:
 * `dana@gmial.com` is a valid address, so nothing else catches it. This looks only at well known
 * mail hosts and at a mistyped ".com". It never changes the address by itself: the form offers the
 * fix and the person presses it, or ignores it. A company domain it does not know is left alone.
 */

/** Mail hosts enough people use that a near miss is almost always a typo. */
const KNOWN_HOSTS: readonly string[] = [
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'outlook.com',
  'hotmail.com',
  'hotmail.co.uk',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'comcast.net',
  'verizon.net',
  'att.net',
];

/** Endings typed by a finger that slipped on ".com". ".co" is a real ending and is left alone. */
const COM_SLIPS: readonly string[] = ['con', 'cmo', 'ocm', 'vom', 'xom', 'comm', 'coom', 'cim', 'cpm', 'cm', 'om'];

/** Steps between two words: one wrong, missing or extra letter is 1, two swapped neighbors is 1. */
function distance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table: number[][] = Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) => (row === 0 ? col : col === 0 ? row : 0)));
  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = a[row - 1] === b[col - 1] ? 0 : 1;
      let best = Math.min(table[row - 1]![col]! + 1, table[row]![col - 1]! + 1, table[row - 1]![col - 1]! + cost);
      if (row > 1 && col > 1 && a[row - 1] === b[col - 2] && a[row - 2] === b[col - 1]) best = Math.min(best, table[row - 2]![col - 2]! + 1);
      table[row]![col] = best;
    }
  }
  return table[rows - 1]![cols - 1]!;
}

export interface EmailHint {
  /** The part after the "@" as it should be: "gmail.com". */
  readonly domain: string;
  /** The whole address with the fix: "dana@gmail.com". */
  readonly email: string;
}

/** The likely fix for a mistyped address, or null when the address looks fine or is not complete yet. */
export function emailHint(value: string): EmailHint | null {
  const email = value.trim();
  const at = email.lastIndexOf('@');
  if (at <= 0 || /\s/.test(email)) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase();
  // Not complete yet: wait for a dot and at least two characters after it.
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(domain)) return null;
  if (KNOWN_HOSTS.includes(domain)) return null;

  // 1. A known mail host with one slip (two for the long names): gmial.com, hotmial.com, outlok.com.
  let best: { host: string; steps: number } | null = null;
  for (const host of KNOWN_HOSTS) {
    const steps = distance(domain, host);
    const allowed = host.length >= 10 ? 2 : 1;
    if (steps > 0 && steps <= allowed && (best === null || steps < best.steps)) best = { host, steps };
  }
  if (best) return { domain: best.host, email: `${local}@${best.host}` };

  // 2. Any domain whose ending is a slip on ".com": northwind.con.
  const dot = domain.lastIndexOf('.');
  const ending = domain.slice(dot + 1);
  if (COM_SLIPS.includes(ending)) {
    const fixed = `${domain.slice(0, dot)}.com`;
    return { domain: fixed, email: `${local}@${fixed}` };
  }
  return null;
}
