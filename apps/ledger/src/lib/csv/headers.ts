/**
 * Header mapping: match the header row of someone's file to the columns of a stream. Headers
 * match by exact name or alias, ignoring case, spaces, underscores and punctuation, and then by
 * a fuzzy match for near misses and words in another order (`Good units` is `units_good`).
 * Anything left over is shown with suggestions so a person can map it by hand or ignore it.
 */

/** What header mapping needs to know about a column. */
export interface MappableColumn {
  readonly key: string;
  readonly label?: string;
  readonly aliases?: readonly string[];
  readonly required?: boolean;
}

export interface HeaderMatch {
  /** Position of the header in the file. */
  readonly index: number;
  readonly header: string;
  readonly column: string;
  /** `exact`: the column name or its label. `alias`: a known other name. `fuzzy`: a close match. `preset`: a saved or hand made mapping. */
  readonly how: 'exact' | 'alias' | 'fuzzy' | 'preset';
  /** 1 for exact, alias and preset matches. Between 0 and 1 for fuzzy ones. */
  readonly score: number;
}

export interface UnmatchedHeader {
  readonly index: number;
  readonly header: string;
  /** The closest columns that are still free, best first. */
  readonly suggestions: { readonly column: string; readonly score: number }[];
}

export interface HeaderMapping {
  /** For each header position: the column it feeds, or `null` when it is ignored. */
  readonly columns: (string | null)[];
  readonly matches: HeaderMatch[];
  readonly unmatched: UnmatchedHeader[];
  /** Needed columns that no header feeds. */
  readonly missingRequired: string[];
}

/** Lower case letters and digits only: `Units Good`, `units_good` and `UNITS-GOOD` all become `unitsgood`. */
export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function singular(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

const FILLER = new Set(['of', 'the', 'a', 'an', 'per', 'for', 'in', 'no', 'num', 'number']);

/** Words of a header: split on punctuation and camel case, lower cased, singular, small filler words dropped. */
export function headerWords(header: string): string[] {
  const words = header
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/#/g, ' number ')
    .replace(/%/g, ' pct ')
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '')
    .map(singular);
  const kept = words.filter((word) => !FILLER.has(word));
  return kept.length > 0 ? kept : words;
}

/** Edit distance between two short strings. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min((previous[j] as number) + 1, (current[j - 1] as number) + 1, (previous[j - 1] as number) + cost);
    }
    previous = current;
  }
  return previous[b.length] as number;
}

/**
 * How alike two header texts are, from 0 to 1. Same letters: 1. Same words in another order:
 * 0.95. Otherwise the better of spelling closeness and shared words.
 */
export function headerSimilarity(a: string, b: string): number {
  const na = normalizeHeader(a);
  const nb = normalizeHeader(b);
  if (na === '' || nb === '') return 0;
  if (na === nb) return 1;
  const wa = headerWords(a);
  const wb = headerWords(b);
  const sa = [...new Set(wa)].sort().join(' ');
  const sb = [...new Set(wb)].sort().join(' ');
  if (sa !== '' && sa === sb) return 0.95;
  const spelling = 1 - editDistance(na, nb) / Math.max(na.length, nb.length);
  const setA = new Set(wa);
  const setB = new Set(wb);
  let shared = 0;
  for (const word of setA) if (setB.has(word)) shared += 1;
  const union = new Set([...setA, ...setB]).size;
  const words = union === 0 ? 0 : shared / union;
  return Math.max(spelling, words * 0.9);
}

/** Fuzzy matches at or above this score are mapped on their own. Lower ones are only suggested. */
export const FUZZY_ACCEPT = 0.84;
const FUZZY_SUGGEST = 0.5;
/** A fuzzy match must beat the next best column by this much, or a person decides. */
const FUZZY_MARGIN = 0.05;

function names(column: MappableColumn): string[] {
  return [column.key, ...(column.label ? [column.label] : []), ...(column.aliases ?? [])];
}

function bestScore(header: string, column: MappableColumn): number {
  let best = 0;
  for (const name of names(column)) best = Math.max(best, headerSimilarity(header, name));
  return best;
}

export interface MapHeadersOptions {
  /**
   * A saved or hand made mapping, keyed by normalized header (see `normalizeHeader`). A column
   * key maps the header to that column. `null` means "ignore this header". It wins over auto mapping.
   */
  readonly preset?: Readonly<Record<string, string | null>>;
  /** Turn fuzzy matching off (exact names and aliases only). Default on. */
  readonly fuzzy?: boolean;
}

/**
 * Maps the headers of a file to stream columns. Each column is fed by one header at most: the
 * first exact match wins, then aliases, then fuzzy matches from the best score down.
 */
export function mapHeaders(headers: readonly string[], columns: readonly MappableColumn[], options: MapHeadersOptions = {}): HeaderMapping {
  const result: (string | null)[] = headers.map(() => null);
  const matches: HeaderMatch[] = [];
  const taken = new Set<string>();
  const settled = new Set<number>();
  const byKey = new Map(columns.map((column) => [column.key, column]));
  const assign = (index: number, column: string, how: HeaderMatch['how'], score: number): void => {
    result[index] = column;
    taken.add(column);
    settled.add(index);
    matches.push({ index, header: headers[index] as string, column, how, score });
  };

  // 1. a saved or hand made mapping
  const preset = options.preset ?? {};
  headers.forEach((header, index) => {
    const key = normalizeHeader(header);
    if (key === '' || !(key in preset)) return;
    const column = preset[key];
    if (column === null || column === undefined) {
      settled.add(index);
      return;
    }
    if (byKey.has(column) && !taken.has(column)) assign(index, column, 'preset', 1);
  });

  // 2. exact column name or label, then 3. aliases
  const exact = new Map<string, string>();
  const alias = new Map<string, string>();
  for (const column of columns) {
    for (const name of [column.key, column.label ?? '']) {
      const key = normalizeHeader(name);
      if (key !== '' && !exact.has(key)) exact.set(key, column.key);
    }
  }
  for (const column of columns) {
    for (const name of column.aliases ?? []) {
      const key = normalizeHeader(name);
      if (key !== '' && !exact.has(key) && !alias.has(key)) alias.set(key, column.key);
    }
  }
  for (const [lookup, how] of [[exact, 'exact'], [alias, 'alias']] as const) {
    headers.forEach((header, index) => {
      if (settled.has(index)) return;
      const column = lookup.get(normalizeHeader(header));
      if (column !== undefined && !taken.has(column)) assign(index, column, how, 1);
    });
  }

  // 4. fuzzy, best score first
  if (options.fuzzy !== false) {
    const candidates: { index: number; column: string; score: number; second: number }[] = [];
    headers.forEach((header, index) => {
      if (settled.has(index) || normalizeHeader(header) === '') return;
      const scored = columns
        .filter((column) => !taken.has(column.key))
        .map((column) => ({ column: column.key, score: bestScore(header, column) }))
        .sort((a, b) => b.score - a.score);
      const top = scored[0];
      if (top && top.score >= FUZZY_ACCEPT) candidates.push({ index, column: top.column, score: top.score, second: scored[1]?.score ?? 0 });
    });
    candidates.sort((a, b) => b.score - a.score || a.index - b.index);
    for (const candidate of candidates) {
      if (taken.has(candidate.column) || settled.has(candidate.index)) continue;
      if (candidate.score - candidate.second < FUZZY_MARGIN) continue;
      assign(candidate.index, candidate.column, 'fuzzy', Math.round(candidate.score * 100) / 100);
    }
  }

  const presetKeys = new Set(Object.keys(preset));
  const unmatched: UnmatchedHeader[] = [];
  headers.forEach((header, index) => {
    if (result[index] !== null || header.trim() === '') return;
    if (presetKeys.has(normalizeHeader(header)) && preset[normalizeHeader(header)] === null) return;
    const suggestions = columns
      .filter((column) => !taken.has(column.key))
      .map((column) => ({ column: column.key, score: Math.round(bestScore(header, column) * 100) / 100 }))
      .filter((suggestion) => suggestion.score >= FUZZY_SUGGEST)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    unmatched.push({ index, header, suggestions });
  });
  matches.sort((a, b) => a.index - b.index);
  const missingRequired = columns.filter((column) => column.required && !taken.has(column.key)).map((column) => column.key);
  return { columns: result, matches, unmatched, missingRequired };
}

/**
 * A mapping as a preset, keyed by normalized header, so next month's file with the same headers
 * maps itself. Ignored headers are stored as `null`.
 */
export function mappingToPreset(headers: readonly string[], columns: readonly (string | null)[]): Record<string, string | null> {
  const preset: Record<string, string | null> = {};
  headers.forEach((header, index) => {
    const key = normalizeHeader(header);
    if (key !== '' && !(key in preset)) preset[key] = columns[index] ?? null;
  });
  return preset;
}

/**
 * A short, stable key for a set of headers, used to store mapping presets. The order of the
 * columns and the case and punctuation of the headers do not change it.
 */
export function headerSignature(headers: readonly string[]): string {
  const text = [...new Set(headers.map(normalizeHeader).filter((header) => header !== ''))].sort().join('|');
  // FNV-1a, 32 bit
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `h${(hash >>> 0).toString(16).padStart(8, '0')}n${headers.filter((header) => normalizeHeader(header) !== '').length}`;
}
