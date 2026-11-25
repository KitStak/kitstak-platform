/**
 * Variants (docs/programs/SPEC.md 3.9, D7): the variant generator (attributes like Size x Color
 * make a matrix), name, key and SKU patterns, conflict checks, value codes, and reading a pasted
 * list of kits back into attributes. Pure functions.
 */
import { type ValueProblem, placeNote, valueMessage } from './messages';
import { RATE_TOO_LARGE_MESSAGE, rateTextMessage, readRateText } from './price';

/** An attribute axis with its values, in the order people set. */
export interface AttributeAxis {
  readonly id: string;
  readonly name: string;
  readonly values: readonly { readonly id: string; readonly label: string; readonly code: string }[];
}

export interface GeneratedVariant {
  /** Stable key of the combination: `<axisId>=<valueId>` pairs joined by `|`, in axis order. */
  readonly comboKey: string;
  /** Attribute id to value id. */
  readonly attributes: Readonly<Record<string, string>>;
  readonly name: string;
  readonly key: string;
  readonly sku: string | null;
}

/** The most variants the generator makes at once. */
export const MAX_VARIANTS = 200;
/** The most attribute axes. */
export const MAX_AXES = 4;

/** The default name pattern for the usual Size x Color matrix. Use `defaultPatterns` for any other axes. */
export const DEFAULT_NAME_PATTERN = '{Size} {Color}';
/** The default key pattern for the usual Size x Color matrix. Use `defaultPatterns` for any other axes. */
export const DEFAULT_KEY_PATTERN = '{Size.code}-{Color.code}';
/** The default SKU pattern for the usual Size x Color matrix. Use `defaultPatterns` for any other axes. */
export const DEFAULT_SKU_PATTERN = '{program}-{Size.code}-{Color.code}';

export interface VariantPatterns {
  readonly namePattern: string;
  readonly keyPattern: string;
  readonly skuPattern: string;
}

/**
 * The default name, key and SKU patterns built from the real axis names, in axis order (axes with
 * no name or no values are skipped). Size and Color give `{Size} {Color}`, `{Size.code}-{Color.code}`
 * and `{program}-{Size.code}-{Color.code}`; a single Flavor axis gives `{Flavor}`, `{Flavor.code}`
 * and `{program}-{Flavor.code}`. A repeated name (case aside) is used once. With no axes the name and key are empty and the SKU is `{program}`.
 */
export function defaultPatterns(axes: readonly AttributeAxis[]): VariantPatterns {
  const names: string[] = [];
  for (const axis of axes) {
    const name = axis.name.trim();
    if (axis.values.length === 0 || name === '' || /[{}]/.test(name)) continue;
    // A second axis with the same name (case aside) would fill from the first one; leave it out.
    if (names.some((taken) => taken.toLowerCase() === name.toLowerCase())) continue;
    names.push(name);
  }
  return {
    namePattern: names.map((name) => `{${name}}`).join(' '),
    keyPattern: names.map((name) => `{${name}.code}`).join('-'),
    skuPattern: ['{program}', ...names.map((name) => `{${name}.code}`)].join('-'),
  };
}

/**
 * What is wrong with the attribute names, as UI copy, or null when they are fine. Pattern tokens
 * match names without regard to case, so two attributes called Size and size would both fill
 * `{Size}` from the first one ("Small Small", key "S-S" twice): names must differ, case aside.
 * "Two attributes are called Size. Give each a different name." An attribute with values needs a
 * name, and a name cannot hold `{` or `}` (they mark pattern tokens).
 */
export function axisNameProblem(axes: readonly Pick<AttributeAxis, 'name' | 'values'>[]): string | null {
  const seen = new Map<string, string>();
  for (const axis of axes) {
    const name = axis.name.trim().replace(/\s+/g, ' ');
    if (name === '') {
      if (axis.values.length > 0) return 'Give every attribute a name.';
      continue;
    }
    if (/[{}]/.test(name)) return `The attribute name ${name} cannot use { or }.`;
    if (name.toLowerCase() === 'program') return 'An attribute cannot be called program. That word is kept for the program key.';
    const folded = name.toLowerCase();
    const first = seen.get(folded);
    if (first !== undefined) return `Two attributes are called ${first}. Give each a different name.`;
    seen.set(folded, name);
  }
  return null;
}

/** "That makes 240 variants. The limit is 200." */
export function variantLimitMessage(count: number): string {
  return `That makes ${count.toLocaleString('en-US')} variants. The limit is ${MAX_VARIANTS}.`;
}

/** How many combinations the axes make (axes with no values are skipped). */
export function combinationCount(axes: readonly AttributeAxis[]): number {
  return axes.filter((axis) => axis.values.length > 0).reduce((count, axis) => count * axis.values.length, 1);
}

/** Accented Latin letters to plain ones (`é` to `e`), so `Café` codes as `CAFE`, not `CAF`. */
function foldAccents(text: string): string {
  return text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Upper case, accents folded (`é` to `E`), spaces become `-`, characters outside `[A-Z0-9-]`
 * dropped, repeated `-` collapsed. Text in other scripts (`日本`) has no code text and gives `''`.
 */
export function toCodeText(text: string): string {
  return foldAccents(text)
    .toUpperCase()
    .replace(/\s+/g, '-')
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function comboKeyOf(axes: readonly AttributeAxis[], attributes: Readonly<Record<string, string>>): string {
  return axes.map((axis) => `${axis.id}=${attributes[axis.id] ?? ''}`).join('|');
}

/**
 * Every combination of the axes' values: the first axis is the outer loop and value order is
 * kept. Names are the value labels joined by a space, keys the codes joined by `-`, no SKU.
 * Axes with no values are skipped.
 */
export function cartesian(axes: readonly AttributeAxis[]): GeneratedVariant[] {
  const used = axes.filter((axis) => axis.values.length > 0);
  if (used.length === 0) return [];
  let combos: { attributes: Record<string, string>; labels: string[]; codes: string[] }[] = [{ attributes: {}, labels: [], codes: [] }];
  for (const axis of used) {
    const next: typeof combos = [];
    for (const combo of combos) {
      for (const value of axis.values) {
        next.push({ attributes: { ...combo.attributes, [axis.id]: value.id }, labels: [...combo.labels, value.label], codes: [...combo.codes, value.code] });
      }
    }
    combos = next;
  }
  return combos.map((combo) => ({
    comboKey: comboKeyOf(used, combo.attributes),
    attributes: combo.attributes,
    name: combo.labels.join(' ').trim(),
    key: toCodeText(combo.codes.join('-')),
    sku: null,
  }));
}

/**
 * Fills a pattern: `{AttrName}` is the value label, `{AttrName.code}` the value code and
 * `{program}` the program key. Attribute names match without regard to case. Unknown tokens are
 * left as typed so a typo shows. A token for an axis the variant has no value on is empty.
 */
export function applyPattern(pattern: string, axes: readonly AttributeAxis[], attributes: Readonly<Record<string, string>>, extra: { readonly program?: string } = {}): string {
  return pattern.replace(/\{([^{}]+)\}/g, (token, body: string) => {
    const inner = body.trim();
    if (inner.toLowerCase() === 'program') return extra.program ?? '';
    const dot = inner.lastIndexOf('.');
    const wantsCode = dot > 0 && inner.slice(dot + 1).trim().toLowerCase() === 'code';
    const name = (wantsCode ? inner.slice(0, dot) : inner).trim().toLowerCase();
    const axis = axes.find((row) => row.name.trim().toLowerCase() === name);
    if (!axis) return token;
    const value = axis.values.find((row) => row.id === attributes[axis.id]);
    if (!value) return '';
    return wantsCode ? value.code : value.label;
  });
}

function tokenBase(inner: string): string {
  const dot = inner.lastIndexOf('.');
  return (dot > 0 && inner.slice(dot + 1).trim().toLowerCase() === 'code' ? inner.slice(0, dot) : inner).trim();
}

/** The tokens of a pattern that no axis or the program can fill, as typed (`{Szie}`). */
export function unknownPatternTokens(pattern: string, axes: readonly AttributeAxis[]): string[] {
  const names = new Set(axes.map((axis) => axis.name.trim().toLowerCase()));
  const out: string[] = [];
  for (const match of pattern.matchAll(/\{([^{}]+)\}/g)) {
    const inner = (match[1] ?? '').trim();
    if (inner.toLowerCase() === 'program') continue;
    if (!names.has(tokenBase(inner).toLowerCase())) out.push(match[0]);
  }
  return out;
}

/**
 * What is wrong with a pattern, as UI copy, or null when every token can be filled:
 * "The pattern uses {Size}, but no attribute is called Size."
 */
export function patternProblem(pattern: string, axes: readonly AttributeAxis[]): string | null {
  const token = unknownPatternTokens(pattern, axes)[0];
  if (token === undefined) return null;
  return `The pattern uses ${token}, but no attribute is called ${tokenBase(token.slice(1, -1).trim())}.`;
}

/**
 * The axes with every value code usable in keys and SKUs: a code with no letters A to Z or
 * numbers (blank, or `日本`) is replaced by `suggestCode` of its label among the axis's other
 * codes, which falls back to `V`, `V2` and so on for labels in other scripts.
 */
export function withUsableCodes(axes: readonly AttributeAxis[]): AttributeAxis[] {
  return axes.map((axis) => {
    if (axis.values.every((value) => toCodeText(value.code) !== '')) return axis;
    const taken = new Set(axis.values.map((value) => toCodeText(value.code)).filter((code) => code !== ''));
    const values = axis.values.map((value) => {
      if (toCodeText(value.code) !== '') return value;
      const code = suggestCode(value.label, taken);
      taken.add(code);
      return { ...value, code };
    });
    return { ...axis, values };
  });
}

/** "Give each value a code with letters A to Z or numbers." with what came out empty. */
function emptyCodeMessage(what: 'key' | 'SKU', name: string): string {
  return what === 'key'
    ? `The key pattern makes an empty key for ${name}. Give each value a code with letters A to Z or numbers.`
    : `The SKU pattern makes only the program key for ${name}. Give each value a code with letters A to Z or numbers.`;
}

/** True when a pattern has a token for an attribute (not only `{program}`). */
function usesAttribute(pattern: string): boolean {
  return [...pattern.matchAll(/\{([^{}]+)\}/g)].some((match) => (match[1] ?? '').trim().toLowerCase() !== 'program');
}

/**
 * Makes the variants of a matrix with name, key and SKU patterns. Keys and SKUs are upper cased,
 * accents folded, spaces become `-`, other characters are dropped and repeated `-` collapse. A
 * value code with no letters A to Z or numbers is first replaced by a suggested one
 * (`withUsableCodes`: `V`, `V2`). An empty name or key pattern uses `defaultPatterns` for the
 * real axes. A key or SKU pattern with a token no axis can fill is refused with a RangeError
 * ("The pattern uses {Size}, but no attribute is called Size."), so token text never ends up
 * inside codes. A key that still comes out empty, or a SKU that comes out as only the program key
 * (or empty) though its pattern uses an attribute, is refused with a RangeError ("The key pattern
 * makes an empty key for 日本. Give each value a code with letters A to Z or numbers."). A name
 * pattern keeps an unknown token as typed so the typo shows. Attribute names must differ, case
 * aside (`axisNameProblem`, a RangeError otherwise). Throws above 200 combinations (the UI blocks
 * before that with `variantLimitMessage`).
 */
export function generateVariants(input: { readonly axes: readonly AttributeAxis[]; readonly namePattern: string; readonly keyPattern: string; readonly skuPattern: string | null; readonly programKey: string }): GeneratedVariant[] {
  const nameProblem = axisNameProblem(input.axes);
  if (nameProblem !== null) throw new RangeError(nameProblem);
  const count = combinationCount(input.axes);
  if (count > MAX_VARIANTS) throw new RangeError(variantLimitMessage(count));
  const axes = withUsableCodes(input.axes);
  const defaults = defaultPatterns(axes);
  const namePattern = input.namePattern.trim() === '' ? defaults.namePattern : input.namePattern;
  const keyPattern = input.keyPattern.trim() === '' ? defaults.keyPattern : input.keyPattern;
  const skuPattern = input.skuPattern === null || input.skuPattern.trim() === '' ? null : input.skuPattern;
  for (const pattern of [keyPattern, skuPattern]) {
    const problem = pattern === null ? null : patternProblem(pattern, axes);
    if (problem !== null) throw new RangeError(problem);
  }
  const extra = { program: input.programKey };
  const programCode = toCodeText(input.programKey);
  const skuUsesAttribute = skuPattern !== null && usesAttribute(skuPattern);
  return cartesian(axes).map((combo) => {
    const name = applyPattern(namePattern, axes, combo.attributes, extra).replace(/\s+/g, ' ').trim() || combo.name;
    const key = toCodeText(applyPattern(keyPattern, axes, combo.attributes, extra)) || combo.key;
    if (key === '') throw new RangeError(emptyCodeMessage('key', name));
    const skuText = skuPattern === null ? null : toCodeText(applyPattern(skuPattern, axes, combo.attributes, extra));
    if (skuText !== null && skuUsesAttribute && (skuText === '' || skuText === programCode)) throw new RangeError(emptyCodeMessage('SKU', name));
    return { ...combo, name, key, sku: skuText === '' ? null : skuText };
  });
}

export interface VariantConflict {
  readonly comboKey: string;
  /**
   * `key`, `name`, `sku` and `combo` clash with another variant. `key_length` and `name_length`
   * break the database rules on their own: a key is at most 16 characters
   * (`^[A-Z0-9][A-Z0-9-]{0,15}$`) and a name 1 to 80.
   */
  readonly field: 'key' | 'name' | 'sku' | 'combo' | 'key_length' | 'name_length';
  /** The name of the variant it clashes with; the variant's own name for a length problem. */
  readonly with: string;
  /** For `key_length` and `name_length`: how many characters the key or name has. */
  readonly length?: number;
}

/** The most characters a variant key can have (`pm.program_variants.key`). */
export const MAX_VARIANT_KEY_LENGTH = 16;
/** The most characters a variant name can have (`pm.program_variants.name`). */
export const MAX_VARIANT_NAME_LENGTH = 80;
/** The database rule for a variant key. */
export const VARIANT_KEY_RULE = /^[A-Z0-9][A-Z0-9-]{0,15}$/;

function sameAttributes(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean {
  const keys = Object.keys(a);
  if (keys.length === 0 || keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => b[key] === a[key]);
}

function fold(text: string | null): string {
  return (text ?? '').trim().toLowerCase();
}

/**
 * Clashes between generated variants and the program's existing ones (and among the generated
 * ones themselves): the same combination, key, name or SKU (case insensitive). Two empty keys
 * clash too, since every variant needs its own key. A generated key longer than 16 characters
 * (`key_length`) or name longer than 80 (`name_length`) is reported too, so the wizard shows it
 * while people edit instead of failing at save.
 */
export function findConflicts(
  generated: readonly GeneratedVariant[],
  existing: readonly { readonly key: string; readonly name: string; readonly sku: string | null; readonly attributes: Record<string, string> }[],
): readonly VariantConflict[] {
  const out: VariantConflict[] = [];
  const seen: { key: string; name: string; sku: string | null; attributes: Readonly<Record<string, string>> }[] = [...existing];
  for (const variant of generated) {
    // Characters are counted as people see them (an accented letter is one).
    const keyLength = [...variant.key].length;
    const nameLength = [...variant.name].length;
    if (keyLength > MAX_VARIANT_KEY_LENGTH) out.push({ comboKey: variant.comboKey, field: 'key_length', with: variant.name, length: keyLength });
    if (nameLength > MAX_VARIANT_NAME_LENGTH) out.push({ comboKey: variant.comboKey, field: 'name_length', with: variant.name, length: nameLength });
    for (const other of seen) {
      if (sameAttributes(variant.attributes, other.attributes)) out.push({ comboKey: variant.comboKey, field: 'combo', with: other.name });
      if (fold(variant.key) === fold(other.key)) out.push({ comboKey: variant.comboKey, field: 'key', with: other.name });
      if (fold(variant.name) !== '' && fold(variant.name) === fold(other.name)) out.push({ comboKey: variant.comboKey, field: 'name', with: other.name });
      if (variant.sku !== null && other.sku !== null && fold(variant.sku) !== '' && fold(variant.sku) === fold(other.sku)) out.push({ comboKey: variant.comboKey, field: 'sku', with: other.name });
    }
    seen.push(variant);
  }
  return out;
}

/** The words for a conflict (UI copy). */
export function conflictMessage(conflict: Pick<VariantConflict, 'field' | 'with' | 'length'>): string {
  switch (conflict.field) {
    case 'key_length':
      return `This key has ${conflict.length ?? MAX_VARIANT_KEY_LENGTH + 1} characters. The limit is ${MAX_VARIANT_KEY_LENGTH}. Use shorter codes or a shorter key pattern.`;
    case 'name_length':
      return `This name has ${conflict.length ?? MAX_VARIANT_NAME_LENGTH + 1} characters. The limit is ${MAX_VARIANT_NAME_LENGTH}.`;
    case 'combo':
      return `${conflict.with} already has these values.`;
    case 'key':
      return `${conflict.with} already uses this key.`;
    case 'name':
      return `${conflict.with} already uses this name.`;
    case 'sku':
      return `${conflict.with} already uses this SKU.`;
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Value codes                                                                                */
/* ------------------------------------------------------------------------------------------ */

/** Known words and their codes (forward table). */
const KNOWN_CODES: readonly (readonly [string, string])[] = [
  ['small', 'S'],
  ['medium', 'M'],
  ['large', 'L'],
  ['extra large', 'XL'],
  ['x large', 'XL'],
  ['xl', 'XL'],
  ['xxl', 'XXL'],
  ['black', 'BLK'],
  ['white', 'WHT'],
  ['brown', 'BRN'],
  ['yellow', 'YLW'],
  ['red', 'RED'],
  ['blue', 'BLU'],
  ['green', 'GRN'],
  ['gray', 'GRY'],
  ['grey', 'GRY'],
  ['navy', 'NVY'],
  ['pink', 'PNK'],
  ['orange', 'ORG'],
  ['purple', 'PRP'],
];

/** Codes back to labels (reverse table). */
const KNOWN_LABELS: Readonly<Record<string, string>> = {
  S: 'Small',
  M: 'Medium',
  L: 'Large',
  XL: 'XL',
  XXL: 'XXL',
  BLK: 'Black',
  WHT: 'White',
  BRN: 'Brown',
  YLW: 'Yellow',
  RED: 'Red',
  BLU: 'Blue',
  GRN: 'Green',
  GRY: 'Gray',
  NVY: 'Navy',
  PNK: 'Pink',
  ORG: 'Orange',
  PRP: 'Purple',
};

/** The label for a code from the known words table, else the code itself: `BRN` is Brown. */
export function labelForCode(code: string): string {
  return KNOWN_LABELS[code.trim().toUpperCase()] ?? code.trim();
}

/**
 * A short code for a value label: the known words table first (Small S, Brown BRN, Extra large
 * XL), labels of 3 or fewer letters as typed, else the first 3 letters (accents folded). Upper
 * case. A label with no letters A to Z or numbers (`日本`) gets `V`. A digit is added until the
 * code is not taken.
 */
export function suggestCode(label: string, taken: ReadonlySet<string>): string {
  const words = foldAccents(label).trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
  const known = KNOWN_CODES.find(([word]) => word === words)?.[1];
  const letters = foldAccents(label).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const base = known ?? (letters.length <= 3 ? letters : letters.slice(0, 3));
  const start = base === '' ? 'V' : base;
  const upperTaken = new Set([...taken].map((code) => code.toUpperCase()));
  if (!upperTaken.has(start)) return start;
  for (let n = 2; ; n += 1) {
    const candidate = `${start}${n}`;
    if (!upperTaken.has(candidate)) return candidate;
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Reading a pasted list                                                                      */
/* ------------------------------------------------------------------------------------------ */

export interface InferredAxis {
  readonly name: string;
  readonly values: readonly { readonly label: string; readonly code: string }[];
}

export interface InferredRow {
  readonly raw: string;
  /** Axis name to value label. */
  readonly attributes: Readonly<Record<string, string>>;
  readonly sku: string | null;
  readonly name: string | null;
  readonly qty: string | null;
  readonly rate: string | null;
}

export interface InferResult {
  readonly mode: 'columns' | 'sku';
  readonly axes: readonly InferredAxis[];
  readonly rows: readonly InferredRow[];
  readonly unmatched: readonly { readonly line: number; readonly raw: string; readonly why: string }[];
  /** What the reader decided that people should check ("Two columns are called Size. The second one is now Size 2."). */
  readonly notes: readonly { readonly line: number; readonly text: string }[];
}

/** The most rows a pasted list can hold. */
export const MAX_PASTE_ROWS = 200;

/** A cell delimiter of a pasted sheet or CSV. Semicolons are what Excel writes in many countries. */
export type SheetDelimiter = '\t' | ',' | ';';

/** Splits one line of a tab, comma or semicolon sheet into trimmed cells. Delimiters inside double quotes stay. */
export function splitCells(line: string, delimiter: SheetDelimiter): string[] {
  if (delimiter === '\t') return line.split('\t').map((cell) => cell.trim().replace(/^"(.*)"$/, '$1'));
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i] as string;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      cells.push(cell.trim());
      cell = '';
    } else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

/** Non empty lines with their 1 based line numbers. */
export function textLines(text: string): { line: number; raw: string }[] {
  return text
    .split(/\r\n|\r|\n/)
    .map((raw, index) => ({ line: index + 1, raw: raw.replace(/\s+$/, '') }))
    .filter((row) => row.raw.trim() !== '');
}

/** How many times `delimiter` splits a line outside double quotes. */
function delimiterCount(raw: string, delimiter: SheetDelimiter): number {
  let quoted = false;
  let count = 0;
  for (const ch of raw) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === delimiter) count += 1;
  }
  return count;
}

const DELIMITERS: readonly SheetDelimiter[] = ['\t', ';', ','];

/**
 * The cell delimiter most lines use: tab, semicolon or comma (outside double quotes). The one on
 * the most lines wins, then the one used most times; ties go to tab, then semicolon (a semicolon
 * file often has decimal commas inside cells), then comma. Null when no delimiter is on most lines.
 */
export function sheetDelimiter(lines: readonly { raw: string }[]): SheetDelimiter | null {
  if (lines.length === 0) return null;
  const half = lines.length / 2;
  let best: { delimiter: SheetDelimiter; lines: number; uses: number } | null = null;
  for (const delimiter of DELIMITERS) {
    const counts = lines.map((row) => delimiterCount(row.raw, delimiter));
    const onLines = counts.filter((count) => count > 0).length;
    if (onLines <= half) continue;
    const uses = counts.reduce((sum, count) => sum + count, 0);
    if (!best || onLines > best.lines || (onLines === best.lines && uses > best.uses)) best = { delimiter, lines: onLines, uses };
  }
  return best ? best.delimiter : null;
}

/** The delimiter of a sheet: `sheetDelimiter`, else the one on the most lines, else a comma. */
export function anyDelimiter(lines: readonly { raw: string }[]): SheetDelimiter {
  const found = sheetDelimiter(lines);
  if (found) return found;
  let best: SheetDelimiter = ',';
  let top = 0;
  for (const delimiter of DELIMITERS) {
    const onLines = lines.filter((row) => delimiterCount(row.raw, delimiter) > 0).length;
    if (onLines > top) {
      best = delimiter;
      top = onLines;
    }
  }
  return best;
}

/**
 * A number such as `100`, `1,200`, `$1.95` or `.5`. A comma must group thousands, so a decimal
 * comma (`10,5`) is not read as 105, and a grouped number starts with 1 to 9, so a European
 * `0,500` (0.5) is not read as 500. A plain `0500` with no comma is still 500.
 */
const NUMBER = /^[+-]?\$?\s*([1-9]\d{0,2}(,\d{3})+|\d+)(\.\d+)?$|^[+-]?\$?\s*\.\d+$/;
const SKU_LIKE = /^[A-Za-z0-9]+([-_/][A-Za-z0-9]+)+$/;

/** True when a cell holds a number such as `100`, `1,200` or `$1.95`. */
export function looksLikeNumber(cell: string): boolean {
  return NUMBER.test(cell.trim());
}

/** A number cell as a plain decimal string (`$1,200.50` becomes `1200.50`), or null. */
export function plainNumber(cell: string): string | null {
  const text = cell.trim();
  if (!looksLikeNumber(text)) return null;
  return text.replace(/[$,\s]/g, '');
}

/**
 * What is wrong with a plain number cell for a qty (3 decimals) or a rate (4 decimals), or null.
 * Extra decimals are refused, never rounded quietly, and neither can be below 0.
 */
export function decimalProblem(plain: string, decimals: 3 | 4, what: 'qty' | 'rate'): string | null {
  if (what === 'qty') {
    const problem = qtyNumberProblem(plain);
    return problem === null ? null : qtyMessage(problem, 'qty');
  }
  if (plain.startsWith('-') && /[1-9]/.test(plain)) return valueMessage('rate', 'negative');
  const [whole = '', frac = ''] = plain.replace(/^[+-]/, '').split('.');
  if (frac.length > decimals && /[1-9]/.test(frac.slice(decimals))) return valueMessage('rate', 'decimals');
  if (wholeDigits(whole) > MAX_RATE_WHOLE_DIGITS) return valueMessage('rate', 'too_large');
  return null;
}

/** What can be wrong with a qty or scrap cell (the shared `ValueProblem`). */
export type QtyProblem = ValueProblem;

/**
 * Every qty and scrap message, from the one message table (`valueMessage` in messages), so the
 * variant paste, the plan paste, the planner and the CSV imports use the same words. `where`
 * names the cell of a grid ("Nov 30"); `cell` is the text as typed, for the messages that quote
 * it. "The qty 5. is not a number (Nov 30).", "The qty $10 looks like a price. Type only how many
 * units.", "The qty cannot be less than 0.", "Use up to 3 decimals for scrap." and "The qty is
 * too large (Nov 30). Use up to 99,999,999."
 */
export function qtyMessage(problem: QtyProblem, what: 'qty' | 'scrap', where?: string, cell = ''): string {
  return valueMessage(what, problem, where, cell);
}

/** What is wrong with a plain number as a qty: below 0, more than 3 decimals, or 100,000,000 or more. */
function qtyNumberProblem(plain: string): 'negative' | 'decimals' | 'too_large' | null {
  if (plain.startsWith('-') && /[1-9]/.test(plain)) return 'negative';
  const [whole = '', frac = ''] = plain.replace(/^[+-]/, '').split('.');
  if (frac.length > 3 && /[1-9]/.test(frac.slice(3))) return 'decimals';
  if (wholeDigits(whole) > MAX_QTY_WHOLE_DIGITS) return 'too_large';
  return null;
}

/**
 * Reads a qty or scrap cell as a plain decimal string, or says why it cannot be used. More than 3
 * decimals is refused, never rounded, and so is 100,000,000 or more (the database CHECK). A cell
 * with a dollar sign is refused too: "$10" in a qty column almost always means a price column was
 * read as the qty, so it is never taken as 10 kits.
 */
export function readQtyCell(cell: string, what: 'qty' | 'scrap', where?: string): { plain: string } | { why: string } {
  const text = cell.trim();
  const number = plainNumber(text);
  if (text.includes('$') && number !== null) return { why: qtyMessage('price', what, where, text) };
  if (number === null || text.includes('$')) return { why: qtyMessage('not_a_number', what, where, text) };
  const problem = qtyNumberProblem(number);
  return problem === null ? { plain: number } : { why: qtyMessage(problem, what, where, text) };
}

/** How many cells a row has, up to its last filled one ("a,b,," has 2). */
export function filledWidth(cells: readonly string[]): number {
  for (let index = cells.length - 1; index >= 0; index -= 1) if ((cells[index] ?? '').trim() !== '') return index + 1;
  return 0;
}

/** What a row is held to: the header's cells, the cells most rows have, or the named columns a file without a header uses. */
export type ExpectedCells = { readonly kind: 'header'; readonly cells: number } | { readonly kind: 'most'; readonly cells: number } | { readonly kind: 'columns'; readonly names: readonly string[] };

function listWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join('');
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(', ')}, and ${words[words.length - 1]}`;
}

/**
 * Why a row with more cells than the sheet has columns is refused (SPEC Appendix B.2.1), with the
 * fix. Cells are never dropped quietly: the whole row is refused and nothing in it is read, so no
 * part of a number is ever saved alone. A comma file most often has a number such as 1,200 typed
 * without quotes, which splits it in two, so that is named when the row shows it: "Row 4 has more
 * cells than the header. It has 4 cells and the header has 3. Put "1,200" in quotes, or type it as
 * 1200." `line` is the row's line in the pasted text or file (the header is line 1).
 */
export function extraCellsMessage(cells: readonly string[], expected: ExpectedCells, delimiter: SheetDelimiter, line?: number): string {
  const count = filledWidth(cells);
  const row = line === undefined ? 'This row' : `Row ${line}`;
  const want =
    expected.kind === 'columns'
      ? `${row} has more cells than the columns read. It has ${count} cells and a row needs ${expected.names.length}: ${listWords(expected.names)}.`
      : expected.kind === 'header'
        ? `${row} has more cells than the header. It has ${count} cells and the header has ${expected.cells}.`
        : `${row} has more cells than most rows. It has ${count} cells and most rows have ${expected.cells}.`;
  let fix: string;
  if (delimiter === ',') {
    let split: string | null = null;
    for (let index = 0; index + 1 < count && split === null; index += 1) {
      const head = (cells[index] ?? '').trim();
      let end = index + 1;
      while (end < count && /^\d{3}$/.test((cells[end] ?? '').trim())) end += 1;
      const tail = (cells[end] ?? '').trim();
      if (end < count && /^\d{3}\.\d+$/.test(tail)) end += 1;
      if (end === index + 1) continue;
      const joined = [head, ...cells.slice(index + 1, end).map((cell) => cell.trim())].join(',');
      if (/^\$?[1-9]\d{0,2}$/.test(head) && plainNumber(joined) !== null) split = joined;
    }
    const columns = expected.kind === 'columns' ? expected.names.length : expected.cells;
    // The 1,200 hint only fits when the cells that split look like a thousands group (the last
    // cell is exactly 3 digits). "2.10" then "5" is a decimal rate, not a number with a comma.
    const extra = cells.slice(columns, count).map((cell) => cell.trim());
    const digits = extra.length > 0 && extra.every((cell) => /^\d+(\.\d+)?$/.test(cell) || cell === '') && /^\d{3}$/.test(extra[extra.length - 1] ?? '');
    fix = split !== null ? `Put "${split}" in quotes, or type it as ${plainNumber(split)}.` : digits ? 'Put a number like 1,200 in quotes, or type it as 1200.' : 'Take out the extra comma, or put a cell that has a comma in quotes.';
  } else fix = delimiter === ';' ? 'Take out the extra semicolon.' : 'Take out the extra tab.';
  return `${want} ${fix}`;
}

/** The most whole digits a qty can have (`pm.builds.planned_qty` and `pm.build_output.qty` are CHECK `< 100000000`). */
export const MAX_QTY_WHOLE_DIGITS = 8;
/** The most whole digits a rate can have (every rate column is CHECK `< 1000000`). */
export const MAX_RATE_WHOLE_DIGITS = 6;
/** UI copy for a qty at or above the 100,000,000 database limit. */
export const QTY_TOO_LARGE = qtyMessage('too_large', 'qty');
/** UI copy for scrap at or above the 100,000,000 limit (the same cap as the qty). */
export const SCRAP_TOO_LARGE = qtyMessage('too_large', 'scrap');
/** UI copy for a rate at or above the $1,000,000 database limit (the same words as `RATE_TOO_LARGE_MESSAGE` in price). */
export const RATE_TOO_LARGE = RATE_TOO_LARGE_MESSAGE;

/** UI copy for a qty or scrap cell that holds a price such as `$10`: it is a number, but not a count of units. */
export function priceInQtyMessage(cell: string, what: 'qty' | 'scrap', where?: string): string {
  return qtyMessage('price', what, where, cell);
}

/** " (Nov 30)" for a message about one cell of a grid (from the shared message table). */
export { placeNote };

/** Whole digits of a plain number's whole part, leading zeros aside. */
export function wholeDigits(whole: string): number {
  return whole.replace(/^0+/, '').length;
}

type ColumnRole = 'sku' | 'name' | 'qty' | 'rate' | 'attribute';

const QTY_NAMES = ['qty', 'default qty', 'quantity', 'units', 'count', 'planned qty'];
const RATE_NAMES = ['rate', 'price', 'unit price', 'default rate', 'unit rate'];

function roleOf(header: string): ColumnRole {
  const name = header.trim().toLowerCase().replace(/\s+/g, ' ');
  if (name === 'sku') return 'sku';
  if (name === 'name') return 'name';
  if (QTY_NAMES.includes(name)) return 'qty';
  if (RATE_NAMES.includes(name)) return 'rate';
  return 'attribute';
}

function addValue(values: { label: string; code: string }[], label: string): void {
  if (values.some((value) => value.label.toLowerCase() === label.toLowerCase())) return;
  values.push({ label, code: suggestCode(label, new Set(values.map((value) => value.code))) });
}

/**
 * The role of a column with no header from its cells: every filled cell a plain number makes it
 * a rate when one has `$` or more than 3 decimals, else a qty. Null when it is not a number column.
 */
function numberColumnRole(cells: readonly string[]): 'qty' | 'rate' | null {
  const filled = cells.map((cell) => cell.trim()).filter((cell) => cell !== '');
  if (filled.length === 0 || !filled.every((cell) => looksLikeNumber(cell))) return null;
  const rate = filled.some((cell) => cell.includes('$') || ((plainNumber(cell) as string).split('.')[1] ?? '').length > 3);
  return rate ? 'rate' : 'qty';
}

/** The width most rows have; the larger one on a tie, so no row is cut short by the guess. */
function mostCommonWidth(widths: readonly number[]): number {
  const counts = new Map<number, number>();
  for (const width of widths) counts.set(width, (counts.get(width) ?? 0) + 1);
  let best = 0;
  let top = 0;
  for (const [width, count] of counts) {
    if (count > top || (count === top && width > best)) {
      best = width;
      top = count;
    }
  }
  return best;
}

function inferColumns(lines: { line: number; raw: string }[], delimiter: SheetDelimiter): InferResult {
  const table = lines.map((row) => ({ ...row, cells: splitCells(row.raw, delimiter) }));
  const first = table[0] as (typeof table)[number];
  const rest = table.slice(1);
  const repeatsBelow = (cell: string, index: number): boolean => rest.some((row) => (row.cells[index] ?? '').toLowerCase() === cell.toLowerCase() && cell !== '');
  const named = first.cells.some((cell) => roleOf(cell) !== 'attribute');
  const header = named || first.cells.every((cell, index) => cell !== '' && !looksLikeNumber(cell) && !SKU_LIKE.test(cell) && !repeatsBelow(cell, index));
  const body = header ? rest : table;
  // The column count is the header's when there is one. With no header it is the count most rows
  // have (the larger on a tie). A row with filled cells past it is left out, never read as an
  // extra attribute: one stray comma ("Small,Brown,0,500") must not add an axis to every row.
  const width = header ? filledWidth(first.cells) : mostCommonWidth(body.map((row) => filledWidth(row.cells)));
  const expected: ExpectedCells = header ? { kind: 'header', cells: width } : { kind: 'most', cells: width };
  const unmatched: { line: number; raw: string; why: string }[] = [];
  const notes: { line: number; text: string }[] = [];

  const columns: { index: number; role: ColumnRole; name: string }[] = [];
  let attributeCount = 0;
  // axisNameProblem only checks that an axis with values has a fine, unique name, so one stand in value is enough.
  const STAND_IN = [{ id: '', label: '', code: '' }];
  const attributeNames = (): Pick<AttributeAxis, 'name' | 'values'>[] => columns.filter((column) => column.role === 'attribute').map((column) => ({ name: column.name, values: STAND_IN }));
  // Roles a header names, so a number column is never read as a Qty (or Rate) the header has elsewhere.
  const headerRoles = new Set<ColumnRole>(header ? first.cells.slice(0, width).map((cell) => roleOf(cell)) : []);
  for (let index = 0; index < width; index += 1) {
    const title = header ? (first.cells[index] ?? '').trim().replace(/\s+/g, ' ') : '';
    let role: ColumnRole = header ? roleOf(title) : 'attribute';
    if (role === 'attribute') {
      // A column whose every value is a number is never an attribute (B.2.2). It is the Qty column
      // when no Qty header exists (a Rate column when its cells look like prices: a `$` or more
      // than 3 decimals), with or without a header row. When that role is taken it is left out
      // with the reason.
      const numbers = numberColumnRole(body.map((row) => row.cells[index] ?? ''));
      if (numbers !== null) {
        const free = (want: 'qty' | 'rate'): boolean => !headerRoles.has(want) && !columns.some((column) => column.role === want);
        // With no header, a second column of plain numbers is the rate ("Small,Brown,100,1.95").
        // Under a header it is not: a column called Pack with 12 and 24 is no price.
        const pick = free(numbers) ? numbers : !header && numbers === 'qty' && free('rate') ? 'rate' : null;
        if (pick === null) {
          const which = title === '' ? `Column ${index + 1}` : `The column ${title}`;
          unmatched.push({ line: first.line, raw: first.raw, why: `${which} has only numbers and was left out. An attribute needs words, such as Small or Brown.` });
          continue;
        }
        role = pick;
      }
    }
    if (role === 'attribute') {
      attributeCount += 1;
      let name = title || `Attribute ${attributeCount}`;
      const problem = axisNameProblem([...attributeNames(), { name, values: STAND_IN }]);
      if (problem !== null && problem.startsWith('Two attributes are called')) {
        const base = name;
        for (let n = 2; axisNameProblem([...attributeNames(), { name, values: STAND_IN }]) !== null; n += 1) name = `${base} ${n}`;
        notes.push({ line: first.line, text: `Two columns are called ${base}. The second one is now ${name}.` });
      } else if (problem !== null) {
        attributeCount -= 1;
        unmatched.push({ line: first.line, raw: first.raw, why: `${problem} The column ${title} was left out.` });
        continue;
      }
      if (attributeCount > MAX_AXES) {
        unmatched.push({ line: first.line, raw: first.raw, why: `Only ${MAX_AXES} attributes fit. The column ${name} was left out.` });
        continue;
      }
      columns.push({ index, role, name });
    } else if (!columns.some((column) => column.role === role)) columns.push({ index, role, name: title });
    else if (header) unmatched.push({ line: first.line, raw: first.raw, why: `Two columns are called ${title}. The second one was left out.` });
  }

  const axes = columns.filter((column) => column.role === 'attribute').map((column) => ({ name: column.name, values: [] as { label: string; code: string }[] }));
  const rows: InferredRow[] = [];
  const skuLines = new Map<string, number>();
  const comboLines = new Map<string, number>();
  for (const row of body) {
    if (filledWidth(row.cells) > width) {
      unmatched.push({ line: row.line, raw: row.raw, why: extraCellsMessage(row.cells, expected, delimiter, row.line) });
      continue;
    }
    if (rows.length >= MAX_PASTE_ROWS) {
      unmatched.push({ line: row.line, raw: row.raw, why: `Only ${MAX_PASTE_ROWS} rows fit. This row was left out.` });
      continue;
    }
    const cell = (role: ColumnRole): string | null => {
      const column = columns.find((entry) => entry.role === role);
      const value = column ? (row.cells[column.index] ?? '').trim() : '';
      return value === '' ? null : value;
    };
    const attributes: Record<string, string> = {};
    let missing: string | null = null;
    for (const column of columns) {
      if (column.role !== 'attribute') continue;
      const value = (row.cells[column.index] ?? '').trim();
      if (value === '') missing = missing ?? column.name;
      else attributes[column.name] = value;
    }
    const sku = cell('sku');
    if (missing !== null) {
      unmatched.push({ line: row.line, raw: row.raw, why: `This row has no ${missing}.` });
      continue;
    }
    const qtyText = cell('qty');
    const rateText = cell('rate');
    // "$10" in a qty column is a price read as the qty, so it is refused like the import does.
    const qtyRead = qtyText === null ? null : readQtyCell(qtyText, 'qty');
    if (qtyRead !== null && 'why' in qtyRead) {
      unmatched.push({ line: row.line, raw: row.raw, why: qtyRead.why });
      continue;
    }
    const qty = qtyRead === null ? null : qtyRead.plain;
    // A rate cell is read the way the price card reads a typed rate, with the same words.
    const rateRead = rateText === null ? null : readRateText(rateText);
    if (rateRead !== null && !rateRead.ok) {
      unmatched.push({ line: row.line, raw: row.raw, why: rateTextMessage(rateRead.problem, rateText as string) });
      continue;
    }
    const rate = rateText === null ? null : (plainNumber(rateText) ?? (rateRead?.ok ? rateRead.price : null));
    // The same SKU or the same values twice would make the same variant twice, so the later row goes to unmatched.
    const upperSku = sku === null ? null : sku.toUpperCase();
    const skuLine = upperSku === null ? undefined : skuLines.get(upperSku);
    if (skuLine !== undefined) {
      unmatched.push({ line: row.line, raw: row.raw, why: repeatedSkuMessage(skuLine) });
      continue;
    }
    const combo = comboText(columns.filter((column) => column.role === 'attribute').map((column) => column.name), attributes);
    const comboLine = combo === null ? undefined : comboLines.get(combo);
    if (comboLine !== undefined) {
      unmatched.push({ line: row.line, raw: row.raw, why: repeatedValuesMessage(comboLine) });
      continue;
    }
    if (upperSku !== null) skuLines.set(upperSku, row.line);
    if (combo !== null) comboLines.set(combo, row.line);
    axes.forEach((axis) => addValue(axis.values, attributes[axis.name] as string));
    rows.push({ raw: row.raw, attributes, sku: upperSku, name: cell('name'), qty, rate });
  }
  return { mode: 'columns', axes: axes.filter((axis) => axis.values.length > 0), rows, unmatched, notes };
}

/** "This SKU is already on line 1." for a pasted SKU that repeats. */
export function repeatedSkuMessage(line: number): string {
  return `This SKU is already on line ${line}.`;
}

/** "These values are already on line 1." for a pasted row whose attribute values repeat. */
export function repeatedValuesMessage(line: number): string {
  return `These values are already on line ${line}.`;
}

/** The attribute values of a row in axis order, case aside, or null when the row has no attributes. */
function comboText(axisNames: readonly string[], attributes: Readonly<Record<string, string>>): string | null {
  if (axisNames.length === 0) return null;
  return axisNames.map((name) => (attributes[name] ?? '').trim().toLowerCase()).join('\u0000');
}

function commonSeparator(lines: readonly { raw: string }[]): string {
  const options = ['-', '_', '/', ' '];
  let best = '-';
  let bestCount = -1;
  for (const option of options) {
    const count = lines.reduce((sum, row) => sum + (row.raw.trim().split(option).length - 1), 0);
    if (count > bestCount) {
      best = option;
      bestCount = count;
    }
  }
  return best;
}

/** A value code the database takes (`pm.program_attributes` values CHECK `^[A-Z0-9]{1,6}$`). */
export const VALUE_CODE_RULE = /^[A-Z0-9]{1,6}$/;

/** Size codes of the known words table; the other known words are colors. */
const SIZE_CODES = new Set(['S', 'M', 'L', 'XL', 'XXL']);

/** The known words table code of a label ("Extra Large" and "X-Large" are XL), or null. */
function knownCode(label: string): string | null {
  const words = foldAccents(label).trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
  return KNOWN_CODES.find(([word]) => word === words)?.[1] ?? null;
}

/**
 * A shared first part is the program code (GLOVE) and is dropped only when it looks like one:
 * letters and digits, upper case as typed, and not a value of the known words table (a list that
 * is all XL keeps its XL).
 */
function programPrefix(parts: readonly string[]): boolean {
  return parts.length > 0 && /^[A-Z0-9]+$/.test(parts[0] as string) && KNOWN_LABELS[parts[0] as string] === undefined;
}

/**
 * True when a pasted line reads as a SKU: no spaces, and all one case (`GLOVE-S-BRN`, or
 * `glove-s-brn` typed in lower case). A line with spaces or with mixed case ("Small Brown",
 * "Strawberry", "Small-Brown") is a name.
 */
function readsAsSku(raw: string): boolean {
  const text = raw.trim();
  if (/\s/.test(text)) return false;
  if (!/[a-z]/.test(text)) return true;
  // All lower case: a SKU only when it has a separator (`glove-s-brn`); a lone lower case word ("banana") is a name.
  return !/[A-Z]/.test(text) && /[-_/]/.test(text);
}

/** Title case for a word typed all in lower case ("small" to "Small"); anything with a capital is kept as typed. */
function labelAsTyped(text: string): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (/[A-Z]/.test(clean)) return clean;
  return clean.replace(/(^|[\s-])([a-z])/g, (_, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`);
}

/**
 * The label of one part of a pasted name: a short known code is spelled out (`brn` and `BRN` are
 * Brown, `S` is Small, `xl` is XL), anything else is kept as typed, with a first capital when it
 * was typed all in lower case ("small" is Small).
 */
function nameLabel(part: string): string {
  const upper = part.trim().toUpperCase();
  const known = KNOWN_LABELS[upper];
  if (known !== undefined && upper.length <= 3) return known;
  return labelAsTyped(part);
}

/** Joins a known label of two words split by the separator back into one part ("Extra" "Large" is Extra Large). */
function mergeKnownWords(parts: readonly string[], sep: string): string[] {
  const out: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] as string;
    const next = parts[index + 1];
    if (next !== undefined && knownCode(`${part} ${next}`) !== null) {
      out.push(`${part}${sep === ' ' ? ' ' : sep}${next}`);
      index += 1;
    } else out.push(part);
  }
  return out;
}

/** The parts count most lines have (ties go to the larger count). */
function commonCount(rows: readonly { parts: readonly string[] }[]): number {
  const counts = new Map<number, number>();
  for (const row of rows) counts.set(row.parts.length, (counts.get(row.parts.length) ?? 0) + 1);
  let mode = 0;
  let modeCount = -1;
  for (const [count, seen] of counts) {
    if (seen > modeCount || (seen === modeCount && count > mode)) {
      mode = count;
      modeCount = seen;
    }
  }
  return mode;
}

/** The kind of an attribute from its values: Size when every value is a known size, Color when every value is a known color, else null. */
function kindOfValues(values: readonly { label: string }[]): 'Size' | 'Color' | null {
  const codes = values.map((value) => knownCode(value.label) ?? (KNOWN_LABELS[value.label.toUpperCase()] !== undefined ? value.label.toUpperCase() : null));
  if (codes.length === 0 || codes.some((code) => code === null)) return null;
  if (codes.every((code) => SIZE_CODES.has(code as string))) return 'Size';
  if (codes.every((code) => !SIZE_CODES.has(code as string))) return 'Color';
  return null;
}

/**
 * Names pasted attributes the same way in SKU mode and names mode: a given name first (a shared
 * word such as "size" in "size 7"), else Size or Color from the values, else "Part 1", "Part 2"
 * (the fallback the wizard then asks people to rename). Names never repeat: a second Size is
 * Size 2. Returns the old name to new name map so rows can follow.
 */
function nameAxes(axes: { name: string; values: { label: string; code: string }[] }[], given: readonly (string | null)[] = []): Map<string, string> {
  const renamed = new Map<string, string>();
  const taken = new Set<string>();
  axes.forEach((axis, index) => {
    const wanted = given[index] ?? null;
    const usable = wanted !== null && axisNameProblem([{ name: wanted, values: [{ id: '', label: '', code: '' }] }]) === null ? wanted : null;
    const kind = kindOfValues(axis.values) ?? usable ?? `Part ${index + 1}`;
    let name = kind;
    for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${kind} ${n}`;
    taken.add(name.toLowerCase());
    renamed.set(axis.name, name);
    axis.name = name;
  });
  return renamed;
}

function inferSkus(all: { line: number; raw: string }[], separator: string | undefined): InferResult {
  // A pasted SKU column often keeps its header ("SKU"). It is not a SKU, so it is left out.
  const lines = all.length > 1 && isSkuHeader((all[0] as { raw: string }).raw) ? all.slice(1) : all;
  const sep = separator && separator !== '' ? separator : commonSeparator(lines);
  // A space never sits in a SKU, and mixed case reads as words: such a list is a list of names.
  if (sep === ' ' || !lines.every((row) => readsAsSku(row.raw))) return inferNames(lines, sep);
  const split = lines.map((row) => ({ ...row, sku: row.raw.trim(), parts: row.raw.trim().split(sep).map((part) => part.trim()).filter((part) => part !== '') }));
  const mode = commonCount(split);
  const unmatched: { line: number; raw: string; why: string }[] = [];
  const good = split.filter((row) => {
    if (row.parts.length === mode) return true;
    unmatched.push({ line: row.line, raw: row.raw, why: `This SKU has ${row.parts.length} ${row.parts.length === 1 ? 'part' : 'parts'}. The others have ${mode}.` });
    return false;
  });
  const firstPart = (row: { parts: readonly string[] }): string => (row.parts[0] as string).toUpperCase();
  const prefix = good.length > 0 && mode > 1 && good.every((row) => firstPart(row) === firstPart(good[0] as (typeof good)[number])) && programPrefix([firstPart(good[0] as (typeof good)[number])]) ? 1 : 0;
  const positions = mode - prefix;
  const axes = Array.from({ length: Math.min(positions, MAX_AXES) }, (_, index) => ({ name: `Part ${index + 1}`, values: [] as { label: string; code: string }[] }));
  /** Each axis's values by the part as typed (upper case), so a part that needs a new code keeps one value. */
  const byPart = axes.map(() => new Map<string, { label: string; code: string }>());
  const rows: InferredRow[] = [];
  const skuLines = new Map<string, number>();
  const comboLines = new Map<string, number>();
  for (const row of good) {
    if (positions > MAX_AXES) {
      unmatched.push({ line: row.line, raw: row.raw, why: `This SKU has ${positions} parts after the program code. The limit is ${MAX_AXES}.` });
      continue;
    }
    if (rows.length >= MAX_PASTE_ROWS) {
      unmatched.push({ line: row.line, raw: row.raw, why: `Only ${MAX_PASTE_ROWS} rows fit. This row was left out.` });
      continue;
    }
    // The same SKU (or the same parts with other separators, such as A-1 and A--1) makes the same variant, so it goes to unmatched.
    const upperSku = row.sku.toUpperCase();
    const comboKey = row.parts.slice(prefix).map((part) => part.toUpperCase()).join('\u0000');
    const firstLine = skuLines.get(upperSku) ?? comboLines.get(comboKey);
    if (firstLine !== undefined) {
      unmatched.push({ line: row.line, raw: row.raw, why: repeatedSkuMessage(firstLine) });
      continue;
    }
    skuLines.set(upperSku, row.line);
    comboLines.set(comboKey, row.line);
    const attributes: Record<string, string> = {};
    const labels: string[] = [];
    row.parts.slice(prefix).forEach((part, index) => {
      const axis = axes[index] as (typeof axes)[number];
      const seen = byPart[index] as Map<string, { label: string; code: string }>;
      const upper = part.toUpperCase();
      let value = seen.get(upper);
      if (!value) {
        const label = labelForCode(upper);
        // A part the database cannot hold as a code (longer than 6, or with other characters) gets a short one.
        const code = VALUE_CODE_RULE.test(upper) && !axis.values.some((entry) => entry.code === upper) ? upper : suggestCode(label, new Set(axis.values.map((entry) => entry.code)));
        value = { label, code };
        seen.set(upper, value);
        axis.values.push(value);
      }
      attributes[axis.name] = value.label;
      labels.push(value.label);
    });
    rows.push({ raw: row.raw, attributes, sku: upperSku, name: labels.join(' '), qty: null, rate: null });
  }
  // Name the attributes from their values, as names mode does (S, M, XL is Size; BRN, YLW is Color).
  const renamed = nameAxes(axes);
  const named = rows.map((row) => ({ ...row, attributes: Object.fromEntries(Object.entries(row.attributes).map(([name, label]) => [renamed.get(name) ?? name, label])) }));
  return { mode: 'sku', axes: positions > MAX_AXES ? [] : axes, rows: named, unmatched: unmatched.sort((a, b) => a.line - b.line), notes: [] };
}

/**
 * A pasted list of names, one kit per line ("Small Brown", "Extra Large Yellow", "Strawberry").
 * Each part is an attribute value, kept as typed ("Small" stays Small; "brn" is spelled out as
 * Brown), with a code from `suggestCode` (S, BRN, STR) that the database takes. Known labels of
 * two words ("Extra Large", "X Large") are one part. A name has no SKU. An attribute whose values
 * are all known sizes is called Size, all known colors Color, else "Part 1", "Part 2". A first
 * part every line shares is dropped when it is not a known value (never a word like Small): a
 * program code (GLOVE) is just left out, and a word ("size" in "size 7" and "size 8") becomes
 * the name of the attribute after it (Size, with values 7 and 8), with a note.
 */
function inferNames(lines: { line: number; raw: string }[], sep: string): InferResult {
  const splitter = sep === ' ' ? /\s+/ : sep;
  const split = lines.map((row) => ({ ...row, parts: mergeKnownWords(row.raw.trim().split(splitter).map((part) => part.trim()).filter((part) => part !== ''), sep) }));
  const mode = commonCount(split);
  const unmatched: { line: number; raw: string; why: string }[] = [];
  const notes: { line: number; text: string }[] = [];
  const good = split.filter((row) => {
    if (row.parts.length === mode) return true;
    unmatched.push({
      line: row.line,
      raw: row.raw,
      why: `This name has ${row.parts.length} ${row.parts.length === 1 ? 'part' : 'parts'}. The others have ${mode}. To use a value of more than one word, paste a sheet with one column per attribute.`,
    });
    return false;
  });
  const sharedFirst = good.length > 1 && mode > 1 && good.every((row) => (row.parts[0] as string).toLowerCase() === (good[0]?.parts[0] as string).toLowerCase()) ? (good[0]?.parts[0] as string) : null;
  // A shared first part that is not a known value is dropped: a program code (GLOVE) is just
  // left out, and a word ("size" in "size 7", "size 8") names the attribute after it.
  const sharedWord = sharedFirst !== null && !programPrefix([sharedFirst]) && knownCode(sharedFirst) === null && KNOWN_LABELS[sharedFirst.toUpperCase()] === undefined ? sharedFirst : null;
  const prefix = sharedFirst !== null && (programPrefix([sharedFirst]) || sharedWord !== null) ? 1 : 0;
  const positions = mode - prefix;
  const axes = Array.from({ length: Math.min(positions, MAX_AXES) }, (_, index) => ({ name: `Part ${index + 1}`, values: [] as { label: string; code: string }[] }));
  const kept: { line: number; raw: string; labels: string[] }[] = [];
  const comboLines = new Map<string, number>();
  for (const row of good) {
    if (positions > MAX_AXES) {
      unmatched.push({ line: row.line, raw: row.raw, why: `This name has ${positions} parts. The limit is ${MAX_AXES}.` });
      continue;
    }
    if (kept.length >= MAX_PASTE_ROWS) {
      unmatched.push({ line: row.line, raw: row.raw, why: `Only ${MAX_PASTE_ROWS} rows fit. This row was left out.` });
      continue;
    }
    const labels = row.parts.slice(prefix).map((part) => nameLabel(part));
    const comboKey = labels.map((label) => label.toLowerCase()).join('\u0000');
    const firstLine = comboLines.get(comboKey);
    if (firstLine !== undefined) {
      unmatched.push({ line: row.line, raw: row.raw, why: repeatedValuesMessage(firstLine) });
      continue;
    }
    comboLines.set(comboKey, row.line);
    labels.forEach((label, index) => addValue((axes[index] as (typeof axes)[number]).values, label));
    kept.push({ line: row.line, raw: row.raw, labels });
  }
  // Name the attributes: Size or Color from their values, else the shared word, else Part N.
  const wordName = sharedWord === null ? null : labelAsTyped(sharedWord);
  nameAxes(axes, [wordName]);
  const first = lines[0];
  if (first && sharedWord !== null && kept.length > 0 && axes[0]) {
    notes.push({
      line: first.line,
      text: axes[0].name === wordName ? `Every line starts with ${sharedWord}, so ${wordName} is the name of the attribute, not a value.` : `Every line starts with ${sharedWord}, so it was left out of the values.`,
    });
  }
  const rows: InferredRow[] = kept.map((row) => {
    const attributes: Record<string, string> = {};
    row.labels.forEach((label, index) => {
      const axis = axes[index] as (typeof axes)[number];
      attributes[axis.name] = (axis.values.find((value) => value.label.toLowerCase() === label.toLowerCase()) as { label: string }).label;
    });
    return { raw: row.raw, attributes, sku: null, name: row.labels.join(' '), qty: null, rate: null };
  });
  if (first && rows.length > 0) notes.push({ line: first.line, text: 'These lines were read as names, not SKUs, so the kits have no SKU yet. Each part of a name is one attribute.' });
  return { mode: 'sku', axes: positions > MAX_AXES ? [] : axes, rows, unmatched: unmatched.sort((a, b) => a.line - b.line), notes };
}

/**
 * Reads a pasted list of kits (3.9). A sheet (tabs or commas on most lines) is read by columns:
 * SKU, Name, Qty and Rate columns fill those fields and every other column is an attribute. A
 * plain list of SKUs is split by the separator: a shared first part that looks like a program
 * code (GLOVE) is dropped, and every other position is an attribute, named Size or Color when
 * every value is a known size or color, else "Part 1", "Part 2" for the wizard to rename. SKUs
 * typed on one line with commas, tabs or semicolons between them are read the same way, one SKU
 * per item. A list of names ("Small Brown", "Extra Large Yellow", "Strawberry": spaces or mixed
 * case) is read as names: values as typed, no SKU, and a note says so. Every value code fits the
 * database (1 to 6 of A to Z and 0 to 9). At most 4 attributes and 200 rows. A SKU that repeats
 * ("This SKU is already on line 1.") or a row with the same values as an earlier one ("These
 * values are already on line 1.") is left out, so the wizard never makes the same variant twice.
 * Anything else that cannot be used is listed in `unmatched` with the reason, in line order.
 */
export function inferAxes(input: { readonly text: string; readonly separator?: string }): InferResult {
  const lines = textLines(input.text);
  if (lines.length === 0) return { mode: 'sku', axes: [], rows: [], unmatched: [], notes: [] };
  const flat = skuListCells(lines);
  if (flat) return inferSkus(flat, input.separator);
  const delimiter = sheetDelimiter(lines);
  return delimiter ? inferColumns(lines, delimiter) : inferSkus(lines, input.separator);
}

/**
 * A list of SKUs typed with commas, tabs or semicolons between them (`GLOVE-S-BRN, GLOVE-S-YLW`):
 * every cell on every line looks like a SKU, so there is no header and nothing else to read.
 * Returns one item per SKU, each keeping the line it came from, or null when the text has no
 * such list (a real sheet, or one SKU per line).
 */
function skuListCells(lines: readonly { line: number; raw: string }[]): { line: number; raw: string }[] | null {
  if (!lines.some((row) => /[\t,;]/.test(row.raw))) return null;
  const table = lines.map((row) => ({ line: row.line, cells: row.raw.split(/[\t,;]/).map((cell) => cell.trim()).filter((cell) => cell !== '') }));
  if (!table.every((row) => row.cells.length > 0 && row.cells.every((cell) => SKU_LIKE.test(cell)))) return null;
  const cells = table.flatMap((row) => row.cells.map((cell) => ({ line: row.line, raw: cell })));
  // Hyphenated labels in a sheet ("X-Large,Dark-Brown") look like SKUs too. Read the cells as a
  // SKU list only when they all start with the same program code, or all have the shape of a
  // code (upper case, with a digit or a known code such as BRN).
  const first = (cell: string): string => (cell.split(/[-_/]/)[0] ?? '').toUpperCase();
  const prefix = first(cells[0]?.raw ?? '');
  const sharedPrefix = cells.length > 1 && cells.every((cell) => first(cell.raw) === prefix);
  if (!sharedPrefix && !cells.every((cell) => codeShaped(cell.raw))) return null;
  return cells;
}

/** True when a SKU looks like a code: no lower case letters, and a digit or a known code in it (`S-BRN`, `KIT-1042`). */
function codeShaped(cell: string): boolean {
  if (/[a-z]/.test(cell)) return false;
  if (/\d/.test(cell)) return true;
  return cell.split(/[-_/]/).some((part) => KNOWN_LABELS[part] !== undefined);
}

/** Words a pasted SKU column may keep as its header ("SKU", "Item code", "Kit SKUs"). */
const SKU_HEADER_WORDS = new Set(['sku', 'skus', 'item', 'items', 'code', 'codes', 'kit', 'kits', 'variant', 'variants', 'product', 'products', 'part', 'number', 'no', 'id']);

/** True when a line is a column header such as "SKU", "Item code" or "Variant SKU", not a SKU. */
export function isSkuHeader(raw: string): boolean {
  const words = raw.trim().toLowerCase().replace(/[#.:]/g, ' ').split(/[\s_]+/).filter((word) => word !== '');
  if (words.length === 0 || words.length > 3) return false;
  if (!words.every((word) => SKU_HEADER_WORDS.has(word))) return false;
  return words.some((word) => ['sku', 'skus', 'item', 'items', 'code', 'codes', 'kit', 'kits', 'variant', 'variants'].includes(word));
}
