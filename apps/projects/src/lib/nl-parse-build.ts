/**
 * Quick add in build mode (docs/programs/SPEC.md 5.17). Pure and deterministic.
 *
 *   build [qty] [variant words] [program word or +KEY] [date words] [@assignee] [!priority]
 *
 *   "build 100 small brown glove tomorrow"  -> GLOVE, Small Brown, 100, tomorrow
 *   "+ECOMM 250 gift fri"                    -> ECOMM, Gift box, 250, Friday
 *   "build 40 +FRA next mon"                 -> a build in project FRA (no variant)
 *
 * Dates, `@assignee`, `!priority` and `+KEY` reuse the task parser (src/lib/nl-parse.ts) so the
 * same words mean the same thing in both modes. The program word matches the program key or a
 * word of its name; the variant is the best match over variant names, keys and SKUs of that
 * program only.
 */
import { parseQuickAdd, type QuickAddPerson, type QuickAddToken } from './nl-parse';

export type IsoDate = string;

export interface BuildQuickAddVariant {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly sku: string | null;
}

export interface BuildQuickAddContainer {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly kind: 'program' | 'project';
  readonly unit?: { readonly singular: string; readonly plural: string } | null;
  readonly variants: readonly BuildQuickAddVariant[];
}

export type BuildSegmentKind = 'mode' | 'qty' | 'variant' | 'program' | 'date' | 'assignee' | 'priority';

export interface BuildSegment {
  readonly text: string;
  readonly kind: BuildSegmentKind | null;
  /** True for a part that was read but could not be used (an unknown +KEY or @name). */
  readonly unresolved?: boolean;
}

export interface BuildUnresolved {
  readonly kind: 'program' | 'variant' | 'qty' | 'assignee';
  readonly text: string;
  readonly message: string;
  /** Up to 5 close choices (variant or container ids). */
  readonly suggestions: readonly string[];
}

export interface BuildQuickAddParse {
  /** True when the text starts with "build " (or the dialog opened as New build). */
  readonly buildMode: boolean;
  readonly containerId?: string;
  readonly variantId?: string;
  /** Plain decimal text ("100", "12.5"). */
  readonly qty?: string;
  readonly date?: IsoDate;
  /** The resolved assignee id. */
  readonly assigneeId?: string;
  /** The raw `@name` text when one was typed. */
  readonly assigneeToken?: string;
  readonly priority?: string;
  /** Words left after every part was read (used as the build title when given). */
  readonly rest: string;
  readonly segments: readonly BuildSegment[];
  readonly unresolved: readonly BuildUnresolved[];
}

export interface BuildQuickAddOptions {
  readonly containers: readonly BuildQuickAddContainer[];
  readonly today: IsoDate;
  readonly people?: readonly QuickAddPerson[];
  readonly meId?: string | null;
  /** The container picked by hand (or the page the dialog opened on); text can still override it. */
  readonly defaultContainerId?: string | null;
  /** Read the text as a build even without the leading "build " word. */
  readonly forceBuild?: boolean;
}

const BUILD_WORD = /^\s*build\s+/i;
const QTY_RE = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,3})?$/;
const STOP = new Set(['of', 'for', 'the', 'a', 'an', 'x', 'kits', 'kit', 'units', 'unit', 'orders', 'order', 'packs', 'pack', 'boxes', 'box', 'on', 'in', 'to', 'at']);

function squash(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

interface Word {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

function splitWords(text: string, offset: number): Word[] {
  const out: Word[] = [];
  const re = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) out.push({ text: match[0], start: offset + match.index, end: offset + match.index + match[0].length });
  return out;
}

/** How well a run of words names a variant: exact SKU or key 100, every name word 50 + words, else word overlap. */
function variantScore(words: readonly string[], variant: BuildQuickAddVariant): number {
  if (words.length === 0) return 0;
  const joined = squash(words.join(''));
  if (variant.sku && squash(variant.sku) === joined) return 100;
  if (squash(variant.key) === joined) return 95;
  if (squash(variant.name) === joined) return 90;
  const nameWords = wordsOf(variant.name);
  if (nameWords.length === 0) return 0;
  const hits = nameWords.filter((word) => words.some((typed) => typed === word || (typed.length >= 3 && word.startsWith(typed)))).length;
  if (hits === 0) return 0;
  const extra = words.filter((typed) => !nameWords.some((word) => typed === word || (typed.length >= 3 && word.startsWith(typed)))).length;
  return (hits === nameWords.length ? 50 : 10) + hits * 5 - extra * 3;
}

function containerWordMatch(word: string, container: BuildQuickAddContainer): boolean {
  const w = squash(word);
  if (w.length < 2) return false;
  if (squash(container.key) === w) return true;
  // A word of the name, also in the singular ("gloves" names "Glove kits", "glove" too).
  return wordsOf(container.name).some((nameWord) => nameWord.length >= 3 && (nameWord === w || nameWord === w.replace(/s$/, '') || nameWord.replace(/s$/, '') === w));
}

/** Variants closest to the typed words, best first (for the red chip's suggestion list). */
export function suggestVariants(text: string, variants: readonly BuildQuickAddVariant[], limit = 5): string[] {
  const words = wordsOf(text);
  return variants
    .map((variant) => ({ id: variant.id, score: words.length ? variantScore(words, variant) : 0 }))
    .filter((entry) => entry.score > 0 || words.length === 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.id);
}

export function parseBuildQuickAdd(input: string, options: BuildQuickAddOptions): BuildQuickAddParse {
  const text = input ?? '';
  const modeMatch = BUILD_WORD.exec(text);
  const buildMode = Boolean(modeMatch) || Boolean(options.forceBuild);
  const bodyStart = modeMatch ? modeMatch[0].length : 0;
  const body = text.slice(bodyStart);
  const segmentsAt: { start: number; end: number; kind: BuildSegmentKind; unresolved?: boolean }[] = [];
  if (modeMatch) segmentsAt.push({ start: text.indexOf(modeMatch[0].trim()), end: text.indexOf(modeMatch[0].trim()) + 5, kind: 'mode' });

  // 1. Sigils and dates through the task parser (+KEY matches programs and projects alike).
  const parsed = parseQuickAdd(body, {
    today: options.today,
    people: options.people,
    meId: options.meId,
    projects: options.containers.map((container) => ({ id: container.id, key: container.key, name: container.name })),
    stripUnknownPeople: true,
  });
  const used: QuickAddToken[] = [];
  for (const token of parsed.tokens) {
    if (token.kind === 'label') continue;
    used.push(token);
    const kind: BuildSegmentKind = token.kind === 'project' ? 'program' : (token.kind as Exclude<typeof token.kind, 'project' | 'label'>);
    segmentsAt.push({ start: bodyStart + token.start, end: bodyStart + token.end, kind, unresolved: token.unresolved });
  }
  const unresolved: BuildUnresolved[] = [];
  const projectToken = parsed.tokens.find((token) => token.kind === 'project');
  if (projectToken?.unresolved) {
    unresolved.push({ kind: 'program', text: projectToken.raw, message: `No program or project called ${projectToken.raw.slice(1)}`, suggestions: options.containers.filter((c) => c.kind === 'program').slice(0, 5).map((c) => c.id) });
  }
  const assigneeToken = parsed.tokens.find((token) => token.kind === 'assignee');
  if (assigneeToken?.unresolved) unresolved.push({ kind: 'assignee', text: assigneeToken.raw, message: `No one named ${assigneeToken.raw.slice(1)}`, suggestions: [] });

  // 2. The plain words left between the tokens.
  const taken = (start: number, end: number) => segmentsAt.some((span) => start < span.end && end > span.start);
  const words = splitWords(body, bodyStart).filter((word) => !taken(word.start, word.end));

  // 3. Qty: the first plain number.
  let qty: string | undefined;
  const qtyWord = words.find((word) => QTY_RE.test(word.text));
  if (qtyWord) {
    qty = qtyWord.text.replace(/,/g, '');
    segmentsAt.push({ start: qtyWord.start, end: qtyWord.end, kind: 'qty' });
  }
  let left = words.filter((word) => word !== qtyWord);

  // 4. Container: +KEY wins, then a program word, then the default.
  let container: BuildQuickAddContainer | undefined = projectToken && !projectToken.unresolved ? options.containers.find((c) => c.id === projectToken.value) : undefined;
  if (!container) {
    const programs = options.containers.filter((c) => c.kind === 'program');
    for (const word of left) {
      const match = programs.find((program) => containerWordMatch(word.text, program));
      if (match) {
        container = match;
        segmentsAt.push({ start: word.start, end: word.end, kind: 'program' });
        left = left.filter((entry) => entry !== word);
        break;
      }
    }
  }
  if (!container && options.defaultContainerId) container = options.containers.find((c) => c.id === options.defaultContainerId);

  // 5. Variant: the best scoring run of the remaining words inside the container.
  let variantId: string | undefined;
  const candidates = left.filter((word) => !STOP.has(word.text.toLowerCase()));
  if (container && container.kind === 'program' && container.variants.length > 0 && candidates.length > 0) {
    let best: { id: string; score: number; from: number; to: number } | null = null;
    const topScore = new Map<string, number>();
    for (let from = 0; from < candidates.length; from += 1) {
      for (let to = from; to < Math.min(candidates.length, from + 4); to += 1) {
        const run = candidates.slice(from, to + 1).map((word) => word.text.toLowerCase());
        for (const variant of container.variants) {
          const score = variantScore(run, variant);
          topScore.set(variant.id, Math.max(topScore.get(variant.id) ?? 0, score));
          if (score > 0 && (!best || score > best.score || (score === best.score && to - from > best.to - best.from))) best = { id: variant.id, score, from, to };
        }
      }
    }
    // A partial name ("gift") only counts when no other variant matches it as well ("small" is two).
    const ties = best ? [...topScore.values()].filter((score) => score === best!.score).length : 0;
    if (best && best.score >= 15 && (best.score >= 90 || ties === 1)) {
      variantId = best.id;
      const run = candidates.slice(best.from, best.to + 1);
      const first = run[0]!;
      const last = run[run.length - 1]!;
      segmentsAt.push({ start: first.start, end: last.end, kind: 'variant' });
      left = left.filter((word) => !run.includes(word));
    } else {
      const guess = candidates.map((word) => word.text).join(' ');
      unresolved.push({ kind: 'variant', text: guess, message: `No variant matches "${guess}"`, suggestions: suggestVariants(guess, container.variants) });
    }
  }
  if (buildMode && qty === undefined) unresolved.push({ kind: 'qty', text: '', message: 'Type how many to build, like "build 100".', suggestions: [] });

  // 6. Segments for the highlighted input.
  const sorted = [...segmentsAt].sort((a, b) => a.start - b.start);
  const segments: BuildSegment[] = [];
  let cursor = 0;
  for (const span of sorted) {
    if (span.start < cursor) continue;
    if (span.start > cursor) segments.push({ text: text.slice(cursor, span.start), kind: null });
    segments.push({ text: text.slice(span.start, span.end), kind: span.kind, unresolved: span.unresolved });
    cursor = span.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), kind: null });

  const rest = left
    .map((word) => word.text)
    .filter((word) => !STOP.has(word.toLowerCase()))
    .join(' ')
    .trim();
  const assignee = parsed.assigneeId ?? undefined;
  return {
    buildMode,
    ...(container ? { containerId: container.id } : {}),
    ...(variantId ? { variantId } : {}),
    ...(qty !== undefined ? { qty } : {}),
    ...(parsed.dueDate ? { date: parsed.dueDate } : {}),
    ...(assignee ? { assigneeId: assignee } : {}),
    ...(assigneeToken ? { assigneeToken: assigneeToken.raw } : {}),
    ...(parsed.priority ? { priority: parsed.priority } : {}),
    rest,
    segments,
    unresolved,
  };
}

/** True when the text asks for build mode ("build 100 ..."). */
export function looksLikeBuild(text: string): boolean {
  return BUILD_WORD.test(text);
}
