/**
 * Variants (docs/programs/SPEC.md 3.9, D7): the variant generator (attributes like Size x Color
 * make a matrix), name, key and SKU patterns, conflict checks, value codes, and reading a pasted
 * list of kits back into attributes. Pure functions.
 */
import { RATE_TOO_LARGE_MESSAGE } from './price';

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

/** A number such as `100`, `1,200`, `$1.95` or `.5`. A comma must group thousands, so a decimal comma (`10,5`) is not read as 105. */
const NUMBER = /^[+-]?\$?\s*(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$|^[+-]?\$?\s*\.\d+$/;
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
  if (plain.startsWith('-') && /[1-9]/.test(plain)) return what === 'rate' ? 'A rate cannot be less than $0.' : 'A qty cannot be less than 0.';
  const [whole = '', frac = ''] = plain.replace(/^[+-]/, '').split('.');
  if (frac.length > decimals && /[1-9]/.test(frac.slice(decimals))) return what === 'rate' ? 'Use up to 4 decimals for a rate.' : 'Use up to 3 decimals.';
  if (wholeDigits(whole) > (what === 'rate' ? MAX_RATE_WHOLE_DIGITS : MAX_QTY_WHOLE_DIGITS)) return what === 'rate' ? RATE_TOO_LARGE : QTY_TOO_LARGE;
  return null;
}

/** The most whole digits a qty can have (`pm.builds.planned_qty` and `pm.build_output.qty` are CHECK `< 100000000`). */
export const MAX_QTY_WHOLE_DIGITS = 8;
/** The most whole digits a rate can have (every rate column is CHECK `< 1000000`). */
export const MAX_RATE_WHOLE_DIGITS = 6;
/** UI copy for a qty at or above the 100,000,000 database limit. */
export const QTY_TOO_LARGE = 'The qty is too large. Use up to 99,999,999.';
/** UI copy for scrap at or above the 100,000,000 limit (the same cap as the qty). */
export const SCRAP_TOO_LARGE = 'The scrap is too large. Use up to 99,999,999.';
/** UI copy for a rate at or above the $1,000,000 database limit (the same words as `RATE_TOO_LARGE_MESSAGE` in price). */
export const RATE_TOO_LARGE = RATE_TOO_LARGE_MESSAGE;

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

function inferColumns(lines: { line: number; raw: string }[], delimiter: SheetDelimiter): InferResult {
  const table = lines.map((row) => ({ ...row, cells: splitCells(row.raw, delimiter) }));
  const first = table[0] as (typeof table)[number];
  const rest = table.slice(1);
  const repeatsBelow = (cell: string, index: number): boolean => rest.some((row) => (row.cells[index] ?? '').toLowerCase() === cell.toLowerCase() && cell !== '');
  const named = first.cells.some((cell) => roleOf(cell) !== 'attribute');
  const header = named || first.cells.every((cell, index) => cell !== '' && !looksLikeNumber(cell) && !SKU_LIKE.test(cell) && !repeatsBelow(cell, index));
  const width = Math.max(...table.map((row) => row.cells.length));
  const body = header ? rest : table;
  const unmatched: { line: number; raw: string; why: string }[] = [];
  const notes: { line: number; text: string }[] = [];

  const columns: { index: number; role: ColumnRole; name: string }[] = [];
  let attributeCount = 0;
  // axisNameProblem only checks that an axis with values has a fine, unique name, so one stand in value is enough.
  const STAND_IN = [{ id: '', label: '', code: '' }];
  const attributeNames = (): Pick<AttributeAxis, 'name' | 'values'>[] => columns.filter((column) => column.role === 'attribute').map((column) => ({ name: column.name, values: STAND_IN }));
  for (let index = 0; index < width; index += 1) {
    const title = header ? (first.cells[index] ?? '').trim().replace(/\s+/g, ' ') : '';
    let role: ColumnRole = header ? roleOf(title) : 'attribute';
    if (!header) {
      // With no header, a column of plain numbers is a qty or a rate, never an attribute.
      const numbers = numberColumnRole(body.map((row) => row.cells[index] ?? ''));
      if (numbers !== null) {
        const free = (want: 'qty' | 'rate'): boolean => !columns.some((column) => column.role === want);
        const pick = free(numbers) ? numbers : numbers === 'qty' && free('rate') ? 'rate' : null;
        if (pick === null) {
          unmatched.push({ line: first.line, raw: first.raw, why: `Column ${index + 1} has only numbers and was left out.` });
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
    const qty = qtyText === null ? null : plainNumber(qtyText);
    const rate = rateText === null ? null : plainNumber(rateText);
    if (qtyText !== null && qty === null) {
      unmatched.push({ line: row.line, raw: row.raw, why: `The qty ${qtyText} is not a number.` });
      continue;
    }
    if (rateText !== null && rate === null) {
      unmatched.push({ line: row.line, raw: row.raw, why: `The rate ${rateText} is not a number.` });
      continue;
    }
    const qtyProblem = qty === null ? null : decimalProblem(qty, 3, 'qty');
    const rateProblem = rate === null ? null : decimalProblem(rate, 4, 'rate');
    if (qtyProblem !== null || rateProblem !== null) {
      unmatched.push({ line: row.line, raw: row.raw, why: (qtyProblem ?? rateProblem) as string });
      continue;
    }
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

function inferSkus(all: { line: number; raw: string }[], separator: string | undefined): InferResult {
  // A pasted SKU column often keeps its header ("SKU"). It is not a SKU, so it is left out.
  const lines = all.length > 1 && isSkuHeader((all[0] as { raw: string }).raw) ? all.slice(1) : all;
  const sep = separator && separator !== '' ? separator : commonSeparator(lines);
  const split = lines.map((row) => ({ ...row, sku: row.raw.trim(), parts: row.raw.trim().split(sep).map((part) => part.trim()).filter((part) => part !== '') }));
  const counts = new Map<number, number>();
  for (const row of split) counts.set(row.parts.length, (counts.get(row.parts.length) ?? 0) + 1);
  let mode = 0;
  let modeCount = -1;
  for (const [count, seen] of counts) {
    if (seen > modeCount || (seen === modeCount && count > mode)) {
      mode = count;
      modeCount = seen;
    }
  }
  const unmatched: { line: number; raw: string; why: string }[] = [];
  const good = split.filter((row) => {
    if (row.parts.length === mode) return true;
    unmatched.push({ line: row.line, raw: row.raw, why: `This SKU has ${row.parts.length} ${row.parts.length === 1 ? 'part' : 'parts'}. The others have ${mode}.` });
    return false;
  });
  const prefix = good.length > 0 && mode > 1 && good.every((row) => (row.parts[0] as string).toUpperCase() === (good[0]?.parts[0] as string).toUpperCase()) ? 1 : 0;
  const positions = mode - prefix;
  const axes = Array.from({ length: Math.min(positions, MAX_AXES) }, (_, index) => ({ name: `Part ${index + 1}`, values: [] as { label: string; code: string }[] }));
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
      const code = part.toUpperCase();
      let value = axis.values.find((entry) => entry.code === code);
      if (!value) {
        value = { label: labelForCode(code), code };
        axis.values.push(value);
      }
      attributes[axis.name] = value.label;
      labels.push(value.label);
    });
    rows.push({ raw: row.raw, attributes, sku: row.sku.toUpperCase(), name: labels.join(' '), qty: null, rate: null });
  }
  return { mode: 'sku', axes: positions > MAX_AXES ? [] : axes, rows, unmatched, notes: [] };
}

/**
 * Reads a pasted list of kits (3.9). A sheet (tabs or commas on most lines) is read by columns:
 * SKU, Name, Qty and Rate columns fill those fields and every other column is an attribute. A
 * plain list of SKUs is split by the separator: a part every line shares is the program prefix
 * and is dropped, and every other position is an attribute ("Part 1", "Part 2"). SKUs typed on
 * one line with commas, tabs or semicolons between them are read the same way, one SKU per item. At most 4
 * attributes and 200 rows. A SKU that repeats ("This SKU is already on line 1.") or, in columns
 * mode, a row with the same values as an earlier one ("These values are already on line 1.") is
 * left out, so the wizard never makes the same variant twice. Anything else that cannot be used is
 * listed in `unmatched` with the reason.
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
