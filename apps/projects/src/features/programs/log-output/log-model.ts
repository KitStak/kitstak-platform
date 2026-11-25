/**
 * Pure model of the Log output dialog (docs/programs/SPEC.md 5.9): which rows show, what each
 * typed cell means (Add or Set), the live totals, the entries sent to `logOutputAction`, scan
 * matching, and which builds the Close the day step asks about. No React; unit tested in
 * `log-model.test.ts`. Quantities are 3 decimal strings summed as scaled bigints; money is cents
 * from the engine (`mulQuantityPrice`), never floats.
 */
import { fromScaled, mulQuantityPrice, quantityToScaled } from '@kitstak/programs-engine';
import type { IsoDate, OutputEntryInput, OutputSheetDTO, OutputSheetRow } from '@/lib/program-types';
import { readQty } from '../kit/qty-input';

export type ShowMode = 'run' | 'today' | 'open';

export interface RowDraft {
  /** What is typed in Built today (empty = no change). */
  readonly built: string;
  readonly mode: 'add' | 'set';
  readonly scrap: string;
  /** null = follow the "mark done when full" default. */
  readonly done: boolean | null;
  readonly note: string;
}

export interface NewRow {
  readonly id: string;
  readonly variantId: string;
  readonly variantName: string;
  readonly variantColor: string | null;
  readonly qty: string;
}

const ZERO = BigInt(0);
const q = (value: string | null | undefined): bigint => {
  if (!value) return ZERO;
  try {
    return quantityToScaled(value);
  } catch {
    return ZERO;
  }
};

/** Default mode: Add when the row already has output that day, else Set. */
export function defaultMode(row: OutputSheetRow): 'add' | 'set' {
  return q(row.builtToday) > ZERO ? 'add' : 'set';
}

export function emptyDraft(row: OutputSheetRow): RowDraft {
  return { built: '', mode: defaultMode(row), scrap: '', done: null, note: '' };
}

/** Rows to show for a mode: this run, the day's builds (and carried over ones), or every open build. */
export function visibleRows(sheet: OutputSheetDTO, show: ShowMode, runId: string | null, buildIds: readonly string[] | null): OutputSheetRow[] {
  if (buildIds && buildIds.length) return sheet.rows.filter((row) => buildIds.includes(row.buildId));
  if (show === 'run' && runId) return sheet.rows.filter((row) => row.runId === runId);
  if (show === 'today') return sheet.rows.filter((row) => row.buildDate === sheet.date || row.carriedOver || q(row.builtToday) > ZERO);
  return sheet.rows.filter((row) => row.statusCategory !== 'done' && row.statusCategory !== 'cancelled' ? true : row.buildDate === sheet.date);
}

/** The day total after this draft is saved (Add adds to what is logged that day, Set replaces it). */
export function todayAfter(row: OutputSheetRow, draft: RowDraft | undefined): bigint {
  if (!draft || draft.built.trim() === '') return q(row.builtToday);
  const read = readQty(draft.built);
  if (!read.ok || read.qty === null) return q(row.builtToday);
  return draft.mode === 'add' ? q(row.builtToday) + q(read.qty) : q(read.qty);
}

/** Built across every day after save. */
export function totalAfter(row: OutputSheetRow, draft: RowDraft | undefined): bigint {
  return q(row.builtBefore) + todayAfter(row, draft);
}

/** Remaining to plan after save, never below zero. */
export function remainingAfter(row: OutputSheetRow, draft: RowDraft | undefined): string {
  const rest = q(row.plannedQty) - totalAfter(row, draft);
  return fromScaled(rest > ZERO ? rest : ZERO, 3);
}

export function overPlanBy(row: OutputSheetRow, draft: RowDraft | undefined): bigint {
  const over = totalAfter(row, draft) - q(row.plannedQty);
  return over > ZERO ? over : ZERO;
}

/** Whether the row will be marked done: the person's choice, else full when auto done is on. */
export function willBeDone(row: OutputSheetRow, draft: RowDraft | undefined, autoDoneWhenFull: boolean): boolean {
  if (draft?.done !== null && draft?.done !== undefined) return draft.done;
  if (row.statusCategory === 'done') return true;
  return autoDoneWhenFull && q(row.plannedQty) > ZERO && totalAfter(row, draft) >= q(row.plannedQty) && todayAfter(row, draft) !== q(row.builtToday);
}

export function draftError(draft: RowDraft | undefined): string | null {
  if (!draft) return null;
  const built = readQty(draft.built);
  if (!built.ok) return built.message;
  const scrap = readQty(draft.scrap, 'scrap');
  if (!scrap.ok) return scrap.message;
  return null;
}

export function isDirty(row: OutputSheetRow, draft: RowDraft | undefined): boolean {
  if (!draft) return false;
  if (draft.built.trim() !== '' && todayAfter(row, draft) !== q(row.builtToday)) return true;
  if (draft.built.trim() !== '' && draft.mode === 'add' && q(readQty(draft.built).ok ? (readQty(draft.built) as { qty: string | null }).qty : '0') > ZERO) return true;
  if (draft.scrap.trim() !== '') return true;
  if (draft.done !== null && draft.done !== (row.statusCategory === 'done')) return true;
  return draft.note.trim() !== '';
}

export interface Totals {
  readonly planned: string;
  readonly built: string;
  /** Null when money is hidden. */
  readonly revenueCents: string | null;
  readonly overPlan: number;
  readonly changed: number;
}

/** Live footer totals for the shown rows plus new rows ("560 of 800 kits today · $1,092.00"). */
export function totalsFor(rows: readonly OutputSheetRow[], drafts: ReadonlyMap<string, RowDraft>, added: readonly NewRow[], moneyHidden: boolean, newRowPrice: (variantId: string) => string | null): Totals {
  let planned = ZERO;
  let built = ZERO;
  let cents: bigint | null = moneyHidden ? null : ZERO;
  let overPlan = 0;
  let changed = 0;
  for (const row of rows) {
    const draft = drafts.get(row.buildId);
    planned += q(row.plannedQty);
    const today = todayAfter(row, draft);
    built += today;
    if (cents !== null && row.unitPrice) cents += mulQuantityPrice(fromScaled(today, 3), row.unitPrice);
    if (overPlanBy(row, draft) > ZERO && isDirty(row, draft)) overPlan += 1;
    if (isDirty(row, draft)) changed += 1;
  }
  for (const row of added) {
    const read = readQty(row.qty);
    const qty = read.ok && read.qty ? q(read.qty) : ZERO;
    planned += qty;
    built += qty;
    const price = newRowPrice(row.variantId);
    if (cents !== null && price && qty > ZERO) cents += mulQuantityPrice(fromScaled(qty, 3), price);
    if (qty > ZERO) changed += 1;
  }
  return { planned: fromScaled(planned, 3), built: fromScaled(built, 3), revenueCents: cents === null ? null : cents.toString(), overPlan, changed };
}

/** The `logOutputAction` entries for the dirty rows and new rows. */
export function entriesFor(rows: readonly OutputSheetRow[], drafts: ReadonlyMap<string, RowDraft>, added: readonly NewRow[], autoDoneWhenFull: boolean): OutputEntryInput[] {
  const entries: OutputEntryInput[] = [];
  for (const row of rows) {
    const draft = drafts.get(row.buildId);
    if (!draft || !isDirty(row, draft)) continue;
    const built = readQty(draft.built);
    const scrap = readQty(draft.scrap, 'scrap');
    const typed = built.ok ? built.qty : null;
    const mode = typed === null ? 'add' : draft.mode;
    const qty = typed ?? '0.000';
    const done = willBeDone(row, draft, autoDoneWhenFull);
    entries.push({
      buildId: row.buildId,
      mode,
      qty,
      ...(scrap.ok && scrap.qty ? { scrapQty: scrap.qty } : {}),
      ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
      ...(done !== (row.statusCategory === 'done') ? { markDone: done } : done && typed !== null ? { markDone: true } : {}),
      ...(mode === 'set' ? { expectedVersion: row.outputVersion } : {}),
    });
  }
  for (const row of added) {
    const read = readQty(row.qty);
    if (!read.ok || !read.qty || q(read.qty) === ZERO) continue;
    entries.push({ newBuild: { variantId: row.variantId }, qty: read.qty, markDone: autoDoneWhenFull });
  }
  return entries;
}

/** Builds dated this day that stay below plan after save and are not done: the Close the day list. */
export function closeDayCandidates(sheet: OutputSheetDTO, rows: readonly OutputSheetRow[], drafts: ReadonlyMap<string, RowDraft>, autoDoneWhenFull: boolean): OutputSheetRow[] {
  return rows.filter((row) => {
    if (row.statusCategory === 'cancelled') return false;
    if (row.buildDate > sheet.date) return false;
    const draft = drafts.get(row.buildId);
    if (willBeDone(row, draft, autoDoneWhenFull) && draft?.done !== false) return false;
    return totalAfter(row, draft) < q(row.plannedQty);
  });
}

export interface ScanHit {
  readonly kind: 'row' | 'variant' | 'none';
  readonly buildId?: string;
  readonly variantId?: string;
  readonly packQty?: string;
}

const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/** A scan or typed code: a build key, SKU or variant key on the sheet, else a known variant. */
export function matchScan(text: string, sheet: OutputSheetDTO, shownIds: ReadonlySet<string>, variants: readonly { readonly id: string; readonly key: string; readonly sku: string | null; readonly name: string; readonly packQty: string | null }[]): ScanHit {
  const want = squash(text);
  if (!want) return { kind: 'none' };
  const hits = sheet.scanIndex.filter((entry) => squash(entry.buildKey) === want || (entry.sku && squash(entry.sku) === want) || (entry.variantKey && squash(entry.variantKey) === want));
  const shown = hits.find((entry) => shownIds.has(entry.buildId)) ?? hits[0];
  if (shown) return { kind: 'row', buildId: shown.buildId, packQty: shown.packQty };
  const variant = variants.find((entry) => (entry.sku && squash(entry.sku) === want) || squash(entry.key) === want || squash(entry.name) === want);
  if (variant) return { kind: 'variant', variantId: variant.id, packQty: variant.packQty ?? '1' };
  return { kind: 'none' };
}

/** Adds one scan (pack qty, default 1) to a typed Add value. */
export function addScan(current: string, packQty: string | null | undefined): string {
  const read = readQty(current);
  const base = read.ok && read.qty ? q(read.qty) : ZERO;
  const step = q(packQty && q(packQty) > ZERO ? packQty : '1');
  return fromScaled(base + step, 3).replace(/\.?0+$/, '');
}

/** "From Nov 24" for carried over rows. */
export function isCarried(row: OutputSheetRow, date: IsoDate): boolean {
  return row.carriedOver || row.buildDate < date;
}
