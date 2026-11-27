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

/**
 * One word in the form two names are compared by: a plural becomes one ("Supplies" is "supply",
 * "Pets" is "pet", "Boxes" is "box"). Short words and words that end in "ss", "us" or "is" are
 * kept, so "Glass", "Bus" and "Gas" stay as they are. Both names go through the same step, so a
 * word that is not a real plural ("Series") still compares fairly.
 */
export function clientWordStem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(ches|shes|sses|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

/**
 * Edits to turn `a` into `b`: add, drop or change one letter, or swap two letters side by side
 * ("Trial" and "Trail" are one edit). Stops early once past `max`.
 */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let before: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, (before[j - 2] ?? 0) + 1);
      current.push(value);
      if (value < best) best = value;
    }
    if (best > max) return max + 1;
    before = previous;
    previous = current;
  }
  return previous[b.length] ?? max + 1;
}

/**
 * Slips allowed in one word, by the longer of the two: none under 5 letters ("Bolt" and "Belt"
 * stay apart), one from 5 letters, two from 9 letters ("Electornics" for "Electronics").
 */
function wordSlips(a: string, b: string): number {
  const longer = Math.max(a.length, b.length);
  return longer >= 9 ? 2 : longer >= 5 ? 1 : 0;
}

/** Slips allowed in a whole name, by the length of the shorter one with no spaces. Grows with the name. */
function nameSlips(length: number): number {
  return length >= 16 ? 3 : length >= 9 ? 2 : length >= 5 ? 1 : 0;
}

interface NameWord {
  readonly raw: string;
  readonly stem: string;
}

/** Slips between two words, or null when they are too far apart: plurals aside, then letter by letter. */
function wordGap(word: NameWord, other: NameWord): number | null {
  if (word.stem === other.stem) return 0;
  const slips = wordSlips(word.raw, other.raw);
  if (slips === 0 || Math.min(word.raw.length, other.raw.length) < 4) return null;
  const gap = Math.min(editDistance(word.raw, other.raw, slips), editDistance(word.stem, other.stem, slips));
  return gap <= slips ? gap : null;
}

/**
 * True when every word of `few` is a word of `many`, the start (3 letters or more) of one, or a
 * slip off one ("Harbr" for "Harbor").
 */
function wordsInside(few: readonly NameWord[], many: readonly NameWord[]): boolean {
  return few.every((word) => many.some((other) => wordGap(word, other) !== null || (word.stem.length >= 3 && other.stem.startsWith(word.stem))));
}

/**
 * True when two different names could be the same client: the same words once case, marks,
 * plurals and "Inc" are gone ("Orchard Pet Supplies LLC" and "Orchard Pet Supply"), one name made
 * of the other's words ("Harbor" and "Harbor Roast Collective"), or a few slips. Slips are
 * counted word by word, so a slip in each of two words is caught ("Sumit Trial Gear" for "Summit
 * Trail Gear"), while one whole word that differs is not ("Acme Foods" and "Acme Tools").
 */
export function clientNamesLookAlike(a: string, b: string): boolean {
  const first = clientNameWords(a).map((raw) => ({ raw, stem: clientWordStem(raw) }));
  const second = clientNameWords(b).map((raw) => ({ raw, stem: clientWordStem(raw) }));
  if (first.length === 0 || second.length === 0) return false;
  const keyA = first.map((word) => word.stem).join('');
  const keyB = second.map((word) => word.stem).join('');
  if (keyA === keyB) return true;
  const [few, many] = first.length <= second.length ? [first, second] : [second, first];
  if (wordsInside(few, many)) return true;
  const budget = nameSlips(Math.min(keyA.length, keyB.length));
  if (budget === 0) return false;
  if (first.length === second.length) {
    // Word by word, in order: each word within its own slips, and the name within its budget.
    let total = 0;
    for (let index = 0; index < first.length; index += 1) {
      const gap = wordGap(first[index]!, second[index]!);
      if (gap === null) return false;
      total += gap;
    }
    return total <= budget;
  }
  // A different count of words is a space put in or left out ("Nova Forge" and "NovaForge"):
  // compare the names with no spaces, with one slip at most, so "Silver Lake Apparel" and
  // "Silverline Apparel" stay two clients.
  return editDistance(keyA, keyB, 1) <= 1;
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

/**
 * The words every client box and the server use, so the same slip reads the same on quick add,
 * the Log work "Add a job" dialog, the new job wizard and the calculator.
 */
export const CLIENT_NEEDED = 'Pick a client, or type a new client name.';

/** A typed name close to clients that exist: pick one, or say that this is a new client. */
export function clientLookAlikeMessage(typed: string, names: readonly string[]): string {
  return `${typed} looks like ${nameList(names)}, a client you already have. Pick it from the list, or choose Create "${typed}" to add a new client.`;
}

/** Loose text that names no client: a client is only made from the Create row. */
export function clientNotPickedMessage(typed: string): string {
  return `${typed} is not a client yet. Choose Create "${typed}" in the list to add it.`;
}

/** The message for the text in a client box, or null when it names a client or a confirmed new one. */
export function clientBoxProblem<T extends ClientNameRef>(choice: { readonly text: string; readonly clientId: string | null; readonly createNew: boolean }, clients: readonly T[]): string | null {
  const typed = choice.text.trim();
  if (!typed) return CLIENT_NEEDED;
  if (choice.clientId || choice.createNew) return null;
  const found = matchClientName(typed, clients);
  if (found.exact) return null;
  return found.lookAlikes.length > 0 ? clientLookAlikeMessage(typed, found.lookAlikes.map((item) => item.name)) : clientNotPickedMessage(typed);
}

/** "A", "A or B", "A, B or C": the look-alikes as words for a message. At most three are named. */
export function nameList(names: readonly string[]): string {
  const shown = names.slice(0, 3);
  if (shown.length <= 1) return shown[0] ?? '';
  return `${shown.slice(0, -1).join(', ')} or ${shown[shown.length - 1]}`;
}
