/**
 * Client names that look alike. Two clients for one company split that client's profit in two,
 * so every place that can make a client from typed text asks first when the name is close to one
 * that already exists. Pure, so the quick add box and the server use the very same rule.
 */

/** Words that say what kind of company it is, not which one. They do not tell two clients apart. */
const FILLER = new Set(['the', 'inc', 'incorporated', 'llc', 'ltd', 'limited', 'co', 'corp', 'corporation', 'company', 'and']);

/** The words of a name, lower case, with no marks and no company filler: "Acme Foods, Inc." gives ["acme", "foods"]. */
export function clientNameWords(name: string): string[] {
  const words = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’.]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const kept = words.filter((word) => !FILLER.has(word));
  return kept.length > 0 ? kept : words;
}

/** One string to compare by: "Acme Foods, Inc." and "ACME foods" share the key "acme foods". */
export function clientNameKey(name: string): string {
  return clientNameWords(name).join(' ');
}

/** Edits (add, drop or swap one letter) to turn `a` into `b`, stopping early once past `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost);
      current.push(value);
      if (value < best) best = value;
    }
    if (best > max) return max + 1;
    previous = current;
  }
  return previous[b.length] ?? max + 1;
}

/**
 * True when every word of `few` is a word of `many`, the start (3 letters or more) of one, or one
 * letter off a word of 5 letters or more ("Harbr" for "Harbor").
 */
function wordsInside(few: readonly string[], many: readonly string[]): boolean {
  return few.every((word) =>
    many.some(
      (other) =>
        other === word ||
        (word.length >= 3 && other.startsWith(word)) ||
        (word.length >= 5 && other.length >= 5 && editDistance(word, other, 1) <= 1),
    ),
  );
}

/**
 * True when two different names could be the same client: the same words once case, marks and
 * "Inc" are gone, one name made of the other's words ("Harbor" and "Harbor Roast Collective"),
 * or a slip of one or two letters ("Northwind" and "Nortwind").
 */
export function clientNamesLookAlike(a: string, b: string): boolean {
  const first = clientNameWords(a);
  const second = clientNameWords(b);
  if (first.length === 0 || second.length === 0) return false;
  const keyA = first.join(' ');
  const keyB = second.join(' ');
  if (keyA === keyB) return true;
  if (keyA.replace(/ /g, '') === keyB.replace(/ /g, '')) return true;
  const [few, many] = first.length <= second.length ? [first, second] : [second, first];
  if (wordsInside(few, many)) return true;
  const shorter = Math.min(keyA.length, keyB.length);
  const slips = shorter >= 9 ? 2 : shorter >= 5 ? 1 : 0;
  return slips > 0 && editDistance(keyA, keyB, slips) <= slips;
}

export interface ClientNameRef {
  readonly id: string;
  readonly name: string;
  readonly code?: string | null;
}

export interface ClientNameMatch<T extends ClientNameRef> {
  /** The client the text names outright: same name or same code, case aside. */
  readonly exact: T | null;
  /** Clients the text could mean, closest first. Empty when there is an exact match. */
  readonly lookAlikes: readonly T[];
}

/** Sorts typed text against the client list: the exact client, or the ones it looks like. */
export function matchClientName<T extends ClientNameRef>(typed: string, clients: readonly T[]): ClientNameMatch<T> {
  const text = typed.trim().toLowerCase();
  if (!text) return { exact: null, lookAlikes: [] };
  const exact =
    clients.find((client) => client.name.trim().toLowerCase() === text) ??
    clients.find((client) => (client.code ?? '').trim().toLowerCase() === text) ??
    null;
  if (exact) return { exact, lookAlikes: [] };
  const key = clientNameKey(typed);
  const lookAlikes = clients
    .filter((client) => clientNamesLookAlike(typed, client.name))
    .sort((a, b) => {
      const startsA = clientNameKey(a.name).startsWith(key) ? 0 : 1;
      const startsB = clientNameKey(b.name).startsWith(key) ? 0 : 1;
      return startsA - startsB || a.name.length - b.name.length || a.name.localeCompare(b.name);
    });
  return { exact: null, lookAlikes };
}

/** "A", "A or B", "A, B or C": the look-alikes as words for a message. At most three are named. */
export function nameList(names: readonly string[]): string {
  const shown = names.slice(0, 3);
  if (shown.length <= 1) return shown[0] ?? '';
  return `${shown.slice(0, -1).join(', ')} or ${shown[shown.length - 1]}`;
}
