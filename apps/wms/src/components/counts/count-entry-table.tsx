'use client';

/**
 * Per-bucket count entry table shared by the Count Sheet and Quick Count. One row per
 * expected bucket (SKU · lot · LP) with its system qty, a counted-qty input and a live
 * difference; plus "Add found stock" for product the system did not expect. Expected
 * stock left blank is rejected client-side (the server would count it as 0).
 * "Mark damaged" (Logiwa mobile count action) splits units of a row into a damaged row with a
 * damage reason; on Update Inv. those units post to a damaged bucket (not allocatable).
 */
import * as React from 'react';
import { Copy, PackagePlus, PackageX, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { TextField } from '@/components/ui/text-field';
import { searchPicker, toOption } from '@/components/shared/entity-pickers';
import { countedValueError, parseCountedText, percentDifference } from '@/lib/grid-defs/counts/count-math';
import { useLookupNames } from '@/components/admin/data-setup/use-lookup-names';
import { DeltaBadge, DifferenceBadge } from './count-badges';

export interface SheetBucket {
  readonly inventoryId: string;
  readonly productId: string;
  readonly sku: string;
  readonly productName: string;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
  readonly lpNumber: string | null;
  readonly lpId?: string | null;
  /** Set on damaged stock buckets. */
  readonly damageReason?: string | null;
  readonly packType: string;
  readonly systemQty: number;
  readonly allocated: number;
}

export interface EntryDraft {
  readonly key: string;
  readonly inventoryId: string | null;
  readonly productId: string;
  readonly sku: string;
  readonly productName: string;
  readonly lotNumber: string | null;
  readonly lpNumber: string | null;
  readonly lpId?: string | null;
  readonly expiryDate?: string | null;
  readonly packType?: string | null;
  /** Damaged stock row (expected damaged bucket, or units marked damaged by the counter). */
  readonly damageReason?: string | null;
  /** Key of the row this damaged row was split from. */
  readonly damagedFrom?: string;
  readonly systemQty: number;
  readonly counted: number | null;
  /** Units of this bucket allocated to orders / work orders (hidden on blind counts). */
  readonly allocated?: number;
}

export interface EntryPayload {
  readonly inventoryId?: string | null;
  readonly productId?: string | null;
  readonly lotNumber?: string | null;
  readonly expiryDate?: string | null;
  readonly lpId?: string | null;
  readonly packType?: string | null;
  readonly damageReason?: string | null;
  readonly countedQty: number;
}

export function draftsFromBuckets(buckets: readonly SheetBucket[]): EntryDraft[] {
  return buckets.map((b) => ({
    key: b.inventoryId,
    inventoryId: b.inventoryId,
    productId: b.productId,
    sku: b.sku,
    productName: b.productName,
    lotNumber: b.lotNumber,
    lpNumber: b.lpNumber,
    lpId: b.lpId ?? null,
    expiryDate: b.expiryDate,
    packType: b.packType,
    damageReason: b.damageReason ?? null,
    systemQty: b.systemQty,
    counted: null,
    allocated: b.allocated,
  }));
}

export { countedValueError };

/** Default reason when Data Setup has no damage reasons the counter can read. */
export const DEFAULT_COUNT_DAMAGE_REASON = 'Damaged';

/** Same physical bucket (SKU · lot · expiry · LP · damage reason): the server rejects it entered twice. */
const bucketIdentity = (d: EntryDraft): string =>
  [d.productId, d.lotNumber ?? '', d.expiryDate ?? '', d.lpId ?? '', d.damageReason ?? ''].join('|');

/** A damaged split row for `d` (no units until the counter enters them). */
export function damagedDraftFor(d: EntryDraft, reason: string): EntryDraft {
  return {
    key: `dmg:${d.key}`,
    inventoryId: null,
    productId: d.productId,
    sku: d.sku,
    productName: d.productName,
    lotNumber: d.lotNumber,
    lpNumber: d.lpNumber,
    lpId: d.lpId ?? null,
    expiryDate: d.expiryDate ?? null,
    packType: d.packType ?? null,
    damageReason: reason,
    damagedFrom: d.key,
    systemQty: 0,
    counted: null,
  };
}

/** First problem with the drafts, or null when every row has a valid count. */
export function draftsError(drafts: readonly EntryDraft[]): string | null {
  if (drafts.length === 0) return null;
  const bad = drafts.find((d) => countedValueError(d.counted));
  if (bad) return `${bad.sku}: ${countedValueError(bad.counted)}.`;
  const seen = new Set<string>();
  for (const d of drafts) {
    const id = bucketIdentity(d);
    if (seen.has(id))
      return `${d.sku}${d.damageReason ? ` (damaged: ${d.damageReason})` : ''} is listed twice. Enter the quantity on the existing row and remove the extra one.`;
    seen.add(id);
  }
  const blank = drafts.find((d) => d.counted === null);
  return blank
    ? `Enter a counted quantity for ${blank.sku}${blank.lotNumber ? ` (lot ${blank.lotNumber})` : ''}. Enter 0 if it is not there.`
    : null;
}

export function toPayload(drafts: readonly EntryDraft[]): EntryPayload[] {
  return drafts.map((d) =>
    d.inventoryId
      ? { inventoryId: d.inventoryId, countedQty: d.counted ?? 0 }
      : {
          productId: d.productId,
          lotNumber: d.lotNumber || null,
          countedQty: d.counted ?? 0,
          ...(d.damageReason
            ? {
                damageReason: d.damageReason,
                expiryDate: d.expiryDate ?? null,
                lpId: d.lpId ?? null,
                packType: d.packType ?? null,
              }
            : {}),
        },
  );
}

/** Totals row. Any invalid counted value hides the counted total and the difference (`invalid`). */
export function draftTotals(drafts: readonly EntryDraft[]): {
  system: number;
  counted: number | null;
  delta: number | null;
  pct: number | null;
  invalid: boolean;
} {
  const system = drafts.reduce((s, d) => s + d.systemQty, 0);
  const invalid = drafts.some((d) => countedValueError(d.counted));
  if (invalid) return { system, counted: null, delta: null, pct: null, invalid };
  const counted = drafts.reduce((s, d) => s + (d.counted ?? 0), 0);
  const allCounted = drafts.every((d) => d.counted !== null);
  return {
    system,
    counted,
    delta: counted - system,
    pct: allCounted ? percentDifference(system, counted) : null,
    invalid,
  };
}

export interface CountEntryTableProps {
  readonly drafts: readonly EntryDraft[];
  readonly onChange: (next: readonly EntryDraft[]) => void;
  readonly warehouseId: string;
  /** SKU-mode lines only count one product: hides "Add found stock" for others. */
  readonly productId?: string | null;
  readonly disabled?: boolean;
  readonly showErrors?: boolean;
  readonly idPrefix: string;
  /** Blind count: no system qty, no difference, no copy / fill-from-system shortcuts. */
  readonly blind?: boolean;
}

/** Keys that can never form a valid counted qty (whole number, 0 or more). */
const BLOCKED_KEYS = new Set(['-', '+', 'e', 'E', '.', ',']);

/**
 * Counted-qty input: digits only. Typing a sign, decimal point or letter is blocked; pasted text
 * that is not a whole number is refused with a message instead of being clamped or rounded.
 * A value set any other way (autofill, scripts) is shown as entered and validated by the table.
 */
function CountQtyInput({
  id,
  label,
  value,
  onChange,
  disabled,
  invalid,
  errorId,
  large = false,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: number | null;
  readonly onChange: (v: number | null) => void;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly errorId?: string;
  readonly large?: boolean;
}) {
  const [text, setText] = React.useState(value === null ? '' : String(value));
  const [pasteError, setPasteError] = React.useState<string | null>(null);
  // Follow outside changes (Use system qty, Fill blanks) without fighting the user's typing:
  // adjust state while rendering when the value prop moves (React's "previous prop" pattern, no effect).
  const [seen, setSeen] = React.useState(value);
  if (!Object.is(seen, value)) {
    setSeen(value);
    if (!(Object.is(parseCountedText(text), value) || (value === null && text.trim() === '')))
      setText(value === null ? '' : String(value));
  }
  React.useEffect(() => {
    if (!pasteError) return;
    const t = window.setTimeout(() => setPasteError(null), 4000);
    return () => window.clearTimeout(t);
  }, [pasteError]);
  const describedBy = [errorId, pasteError ? `${id}-paste` : null].filter(Boolean).join(' ') || undefined;
  return (
    <>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        aria-label={label}
        aria-invalid={invalid || Boolean(pasteError) || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        value={text}
        maxLength={11}
        onKeyDown={(e) => {
          if (BLOCKED_KEYS.has(e.key)) e.preventDefault();
        }}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData('text');
          const n = parseCountedText(pasted);
          if (n === null || countedValueError(n)) {
            e.preventDefault();
            setPasteError(`"${pasted.trim().slice(0, 12)}" is not a whole number of 0 or more`);
          }
        }}
        onChange={(e) => {
          setText(e.target.value);
          setPasteError(null);
          onChange(parseCountedText(e.target.value));
        }}
        className={cn(
          'w-full rounded-md border bg-surface px-2.5 text-right tabular-nums',
          large ? 'h-11 text-md font-semibold' : 'h-8 text-sm',
          ' text-foreground outline-none transition-colors placeholder:text-faint focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60',
          invalid || pasteError
            ? 'border-danger focus-visible:ring-danger/25'
            : 'border-border-strong focus-visible:border-primary focus-visible:ring-primary/25',
        )}
      />
      {pasteError ? (
        <p id={`${id}-paste`} role="alert" className="mt-0.5 text-2xs font-medium text-danger">
          {pasteError}
        </p>
      ) : null}
    </>
  );
}

export function CountEntryTable({
  drafts,
  onChange,
  warehouseId,
  productId,
  disabled,
  showErrors,
  idPrefix,
  blind = false,
}: CountEntryTableProps) {
  const [foundProduct, setFoundProduct] = React.useState<{ id: string; label: string; name: string } | null>(
    null,
  );
  const [foundLot, setFoundLot] = React.useState('');
  // Values are kept as entered (no silent clamp or rounding): a negative or fractional value shows its
  // message, hides the difference and blocks Submit until it is fixed. The server rejects them too.
  const setCount = (key: string, counted: number | null) =>
    onChange(drafts.map((d) => (d.key === key ? { ...d, counted } : d)));
  const cols = blind ? 4 : 6;
  const loadProducts = React.useCallback(
    async (q: string, signal: AbortSignal) =>
      (await searchPicker('products', q, { warehouseId }, signal)).map(toOption),
    [warehouseId],
  );
  const totals = draftTotals(drafts);
  const damageNames = useLookupNames('damage_reason');
  const damageOptions = React.useMemo(() => {
    const names = damageNames.map((r) => r.name);
    return (names.length ? names : [DEFAULT_COUNT_DAMAGE_REASON]).map((n) => ({ value: n, label: n }));
  }, [damageNames]);
  const markDamaged = (d: EntryDraft) => {
    if (drafts.some((x) => x.damagedFrom === d.key)) return;
    const idx = drafts.findIndex((x) => x.key === d.key);
    const next = [...drafts];
    next.splice(idx + 1, 0, damagedDraftFor(d, damageOptions[0]?.value ?? DEFAULT_COUNT_DAMAGE_REASON));
    onChange(next);
    requestAnimationFrame(() => document.getElementById(`${idPrefix}-dmg:${d.key}`)?.focus());
  };
  const setReason = (key: string, reason: string | null) =>
    onChange(
      drafts.map((d) => (d.key === key ? { ...d, damageReason: reason || DEFAULT_COUNT_DAMAGE_REASON } : d)),
    );

  const [foundNotice, setFoundNotice] = React.useState<string | null>(null);
  const focusRow = (key: string) =>
    requestAnimationFrame(() => {
      const el = document.getElementById(`${idPrefix}-${key}`) as HTMLInputElement | null;
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus();
      el?.select();
    });
  const addFound = () => {
    if (!foundProduct) return;
    const lot = foundLot.trim() || null;
    // Already a row for this SKU · lot (expected or found): send the counter to it instead of a duplicate row.
    const existing = findExistingRow(drafts, foundProduct.id, lot);
    if (existing) {
      setFoundNotice(
        `${existing.sku}${lot ? ` (lot ${lot})` : ''} is already listed here. Enter what you found on its row.`,
      );
      setFoundProduct(null);
      setFoundLot('');
      focusRow(existing.key);
      return;
    }
    setFoundNotice(null);
    const key = `found:${foundProduct.id}:${lot ?? ''}`;
    onChange([
      ...drafts,
      {
        key,
        inventoryId: null,
        productId: foundProduct.id,
        sku: foundProduct.label,
        productName: foundProduct.name,
        lotNumber: lot,
        lpNumber: null,
        systemQty: 0,
        counted: null,
      },
    ]);
    setFoundProduct(null);
    setFoundLot('');
    focusRow(key);
  };

  // Narrow containers (handheld, phone, small modal) get one card per bucket with a full-width qty input.
  const rootRef = React.useRef<HTMLDivElement>(null);
  const narrow = useNarrowContainer(rootRef, CARD_LAYOUT_MAX_WIDTH);

  const rowState = (d: EntryDraft) => {
    const valueError = countedValueError(d.counted);
    const invalid = Boolean(valueError) || Boolean(showErrors && d.counted === null);
    const delta = blind || d.counted === null || valueError ? null : d.counted - d.systemQty;
    return { valueError, invalid, delta };
  };
  const kindBadge = (d: EntryDraft) =>
    d.damageReason ? (
      <span className="ml-1.5 rounded bg-danger-soft px-1.5 py-px text-2xs font-semibold text-danger">
        Damaged
      </span>
    ) : d.inventoryId ? null : (
      <span className="ml-1.5 rounded bg-primary-soft px-1.5 py-px text-2xs font-semibold text-primary">
        Found
      </span>
    );
  // Allocated stock (critic r5): counting below it shorts unpicked orders, and picked / in-job stock
  // can't be posted at all, so the counter sees the commitment up front.
  const allocBadge = (d: EntryDraft) => {
    const n = blind ? 0 : (d.allocated ?? 0);
    if (n <= 0) return null;
    const below = d.counted !== null && Number.isFinite(d.counted) && d.counted < n;
    return (
      <span
        data-allocated={n}
        title={
          below
            ? `Counted below the ${n} allocated units: Update Inv. shorts unpicked orders first; picked or in-job units can't be posted`
            : `${n} of ${d.systemQty} units are allocated to orders`
        }
        className={cn(
          'ml-1.5 rounded px-1.5 py-px text-2xs font-semibold ',
          below ? 'bg-warning-soft text-warning' : 'bg-neutral-soft text-neutral',
        )}
      >
        {n} alloc.
      </span>
    );
  };
  const badge = (d: EntryDraft) => (
    <>
      {kindBadge(d)}
      {allocBadge(d)}
    </>
  );
  const reasonEditor = (d: EntryDraft, wide = false) =>
    d.damagedFrom ? (
      <span className={cn('mt-1 block', wide ? 'w-full' : 'w-[180px]')}>
        <Combobox
          id={`${idPrefix}-${d.key}-reason`}
          aria-label={`Damage reason for ${d.sku}`}
          options={damageOptions}
          value={d.damageReason ?? null}
          onChange={(v) => setReason(d.key, v)}
          disabled={disabled}
          placeholder="Damage reason"
        />
      </span>
    ) : d.damageReason ? (
      <span className="mt-0.5 block text-2xs text-danger">{d.damageReason}</span>
    ) : null;
  const qtyInput = (d: EntryDraft, large = false) => {
    const { valueError, invalid } = rowState(d);
    return (
      <>
        <CountQtyInput
          id={`${idPrefix}-${d.key}`}
          label={`Counted qty for ${d.sku}`}
          value={d.counted}
          onChange={(v) => setCount(d.key, v)}
          disabled={disabled}
          invalid={invalid}
          errorId={valueError ? `${idPrefix}-${d.key}-err` : undefined}
          large={large}
        />
        {valueError ? (
          <p id={`${idPrefix}-${d.key}-err`} role="alert" className="mt-0.5 text-2xs font-medium text-danger">
            {valueError}
          </p>
        ) : null}
      </>
    );
  };
  const actions = (d: EntryDraft, large = false) => {
    const iconCls = large ? 'h-11 w-11' : undefined;
    return (
      <span className="flex items-center justify-end gap-0.5">
        {d.inventoryId ? (
          blind ? null : (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={iconCls}
              aria-label={`Use system qty for ${d.sku}`}
              title="Use system qty"
              disabled={disabled}
              onClick={() => setCount(d.key, d.systemQty)}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden />
            </Button>
          )
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={iconCls}
            aria-label={`Remove ${d.sku}${d.damageReason ? ' damaged row' : ''}`}
            title={d.damagedFrom ? 'Remove damaged row' : 'Remove found stock'}
            disabled={disabled}
            onClick={() => onChange(drafts.filter((x) => x.key !== d.key))}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </Button>
        )}
        {d.damageReason ? null : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={iconCls}
            aria-label={`Mark damaged units of ${d.sku}`}
            title={
              drafts.some((x) => x.damagedFrom === d.key)
                ? 'A damaged row is already added below'
                : 'Mark damaged: count damaged units on their own row'
            }
            disabled={disabled || drafts.some((x) => x.damagedFrom === d.key)}
            onClick={() => markDamaged(d)}
          >
            <PackageX className="h-3.5 w-3.5" aria-hidden />
          </Button>
        )}
      </span>
    );
  };
  const empty = (
    <>
      <p className="text-sm font-semibold text-foreground">
        {blind ? 'Nothing listed to count here' : 'No stock expected here'}
      </p>
      <p className="mt-0.5 text-xs text-secondary">
        If you find product, add it below. Submitting an empty count confirms the location is empty.
      </p>
    </>
  );
  const totalCounted =
    totals.counted === null ? (
      <span className="font-normal text-danger" title="Fix the invalid counted quantities">
        None
      </span>
    ) : (
      totals.counted.toLocaleString()
    );
  const totalPct = totals.invalid ? (
    <span className="text-faint">None</span>
  ) : (
    <DifferenceBadge value={totals.pct} />
  );

  return (
    <div ref={rootRef} className="flex min-w-0 flex-col gap-2" data-layout={narrow ? 'cards' : 'table'}>
      {narrow ? (
        <div className="flex flex-col gap-2">
          {drafts.length === 0 ? (
            <div className="rounded-lg border border-border px-3 py-6 text-center">{empty}</div>
          ) : null}
          <ul className="flex flex-col gap-2" aria-label="Count entries">
            {drafts.map((d) => {
              const { delta } = rowState(d);
              return (
                <li
                  key={d.key}
                  className={cn(
                    'rounded-lg border border-border bg-surface p-3',
                    delta !== null && delta !== 0 && 'border-warning/50 bg-warning-soft/30',
                    d.damagedFrom && 'ml-4',
                  )}
                >
                  <div className="flex items-start gap-2">
                    <span className="flex min-w-0 flex-1 flex-col leading-tight">
                      <span className="flex min-w-0 items-center">
                        <span className="truncate text-base font-semibold text-foreground">{d.sku}</span>
                        {badge(d)}
                      </span>
                      <span className="truncate text-xs text-secondary">{d.productName}</span>
                      {d.lotNumber || d.lpNumber ? (
                        <span className="truncate text-xs text-secondary">
                          {[d.lotNumber ? `Lot ${d.lotNumber}` : null, d.lpNumber ? `LP ${d.lpNumber}` : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      ) : null}
                      {reasonEditor(d, true)}
                    </span>
                    <span className="-mr-2 -mt-2 shrink-0">{actions(d, true)}</span>
                  </div>
                  <div
                    className={cn(
                      'mt-2 grid items-end gap-2',
                      blind ? 'grid-cols-1' : 'grid-cols-[auto_minmax(0,1fr)_auto]',
                    )}
                  >
                    {blind ? null : (
                      <span className="flex flex-col pb-2.5">
                        <span className="text-2xs font-semibold text-faint">System</span>
                        <span className="text-base font-semibold tabular-nums text-foreground">
                          {d.systemQty.toLocaleString()}
                        </span>
                      </span>
                    )}
                    <span className="flex min-w-0 flex-col">
                      <label htmlFor={`${idPrefix}-${d.key}`} className="text-2xs font-semibold text-faint">
                        Counted
                      </label>
                      {qtyInput(d, true)}
                    </span>
                    {blind ? null : (
                      <span className="pb-3">
                        {delta === null ? (
                          <span className="text-faint">None</span>
                        ) : (
                          <DeltaBadge value={delta} system={d.systemQty} />
                        )}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {drafts.length > 0 ? (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-sunken px-3 py-2 text-xs font-semibold">
              <span className="text-secondary">Total</span>
              <span className="flex items-center gap-2 tabular-nums">
                {blind ? (
                  <span>Counted {totalCounted}</span>
                ) : (
                  <>
                    <span>
                      {totalCounted}{' '}
                      <span className="font-normal text-secondary">/ {totals.system.toLocaleString()}</span>
                    </span>
                    {totalPct}
                  </>
                )}
              </span>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="ks-scroll overflow-auto rounded-lg border border-border">
          <table className="w-full min-w-[600px] border-collapse text-sm">
            <thead className="bg-surface-sunken text-left text-2xs font-semibold text-faint">
              <tr>
                <th scope="col" className="px-3 py-2">
                  SKU
                </th>
                <th scope="col" className="px-3 py-2">
                  Lot / LP
                </th>
                {blind ? null : (
                  <th scope="col" className="px-3 py-2 text-right">
                    System qty
                  </th>
                )}
                <th scope="col" className="w-[150px] px-3 py-2">
                  Counted qty
                </th>
                {blind ? null : (
                  <th scope="col" className="px-3 py-2 text-right">
                    Difference
                  </th>
                )}
                <th scope="col" className="w-[76px] px-2 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {drafts.length === 0 ? (
                <tr>
                  <td colSpan={cols} className="px-3 py-8 text-center">
                    {empty}
                  </td>
                </tr>
              ) : (
                drafts.map((d) => {
                  const { delta } = rowState(d);
                  return (
                    <tr
                      key={d.key}
                      className={cn(
                        'border-t border-border',
                        delta !== null && delta !== 0 && 'bg-warning-soft/40',
                      )}
                    >
                      <td className="px-3 py-1.5">
                        <span className="flex flex-col leading-tight">
                          <span className="font-semibold text-foreground">
                            {d.sku}
                            {badge(d)}
                          </span>
                          <span className="truncate text-2xs text-secondary">{d.productName}</span>
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-secondary">
                        <span className="block">
                          {[d.lotNumber, d.lpNumber].filter(Boolean).join(' · ') || 'None'}
                        </span>
                        {reasonEditor(d)}
                      </td>
                      {blind ? null : (
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {d.systemQty.toLocaleString()}
                        </td>
                      )}
                      <td className="px-3 py-1.5">{qtyInput(d)}</td>
                      {blind ? null : (
                        <td className="px-3 py-1.5 text-right">
                          {delta === null ? (
                            <span className="text-faint">None</span>
                          ) : (
                            <DeltaBadge value={delta} system={d.systemQty} />
                          )}
                        </td>
                      )}
                      <td className="px-2 py-1.5">{actions(d)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {drafts.length > 0 ? (
              <tfoot className="border-t border-border-strong bg-surface-sunken text-xs font-semibold">
                <tr>
                  <td className="px-3 py-2 text-secondary" colSpan={2}>
                    Total
                  </td>
                  {blind ? null : (
                    <td className="px-3 py-2 text-right tabular-nums">{totals.system.toLocaleString()}</td>
                  )}
                  <td className="px-3 py-2 tabular-nums">{totalCounted}</td>
                  {blind ? null : <td className="px-3 py-2 text-right">{totalPct}</td>}
                  <td />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      )}
      <div className={cn('flex flex-wrap items-end gap-2', narrow && 'flex-col items-stretch')}>
        {blind ? (
          <span className="text-xs text-secondary">
            Blind count: enter what you find. System quantities are hidden for this job.
          </span>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className={narrow ? 'h-11' : undefined}
            disabled={disabled || drafts.every((d) => !d.inventoryId)}
            onClick={() =>
              onChange(
                drafts.map((d) => (d.inventoryId && d.counted === null ? { ...d, counted: d.systemQty } : d)),
              )
            }
          >
            <Copy className="h-3.5 w-3.5" aria-hidden />
            Fill blanks with system qty
          </Button>
        )}
        {narrow ? null : <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden />}
        <div className={narrow ? 'w-full' : 'min-w-[220px] flex-1'}>
          <Combobox
            id={`${idPrefix}-found`}
            aria-label="Found product"
            loadOptions={loadProducts}
            minChars={1}
            value={foundProduct?.id ?? null}
            selectedOptions={
              foundProduct ? [{ value: foundProduct.id, label: foundProduct.label }] : undefined
            }
            onChange={(v, o) => {
              setFoundNotice(null);
              setFoundProduct(v && o ? { id: v, label: o.label, name: o.description ?? '' } : null);
            }}
            placeholder={productId ? "Only this line's SKU can be added" : 'Found stock: search SKU'}
            disabled={disabled || Boolean(productId)}
            clearable
          />
        </div>
        <div className={narrow ? 'flex gap-2' : 'contents'}>
          <div className={narrow ? 'min-w-0 flex-1' : 'w-[140px]'}>
            <TextField
              aria-label="Found lot"
              placeholder="Lot (optional)"
              value={foundLot}
              maxLength={60}
              onChange={(e) => setFoundLot(e.target.value)}
              disabled={disabled || !foundProduct}
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className={narrow ? 'h-auto shrink-0' : undefined}
            disabled={disabled || !foundProduct}
            onClick={addFound}
          >
            <PackagePlus className="h-3.5 w-3.5" aria-hidden />
            {narrow ? 'Add found' : 'Add found stock'}
          </Button>
        </div>
      </div>
      {foundNotice ? (
        <p role="status" className="text-xs font-medium text-primary">
          {foundNotice}
        </p>
      ) : null}
    </div>
  );
}

/** Below this container width the entry table renders as one card per bucket (handheld layout). */
export const CARD_LAYOUT_MAX_WIDTH = 600;

/** True while the element is narrower than `max` px (ResizeObserver; first paint uses the viewport). */
function useNarrowContainer(ref: React.RefObject<HTMLElement | null>, max: number): boolean {
  const [narrow, setNarrow] = React.useState(() => typeof window !== 'undefined' && window.innerWidth < max);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setNarrow(w < max);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, max]);
  return narrow;
}

/**
 * The row a "found" SKU · lot would duplicate: any non-damaged row (expected or already found) of the
 * same product and lot. Damaged rows are separate buckets, so they never match.
 */
export function findExistingRow(
  drafts: readonly EntryDraft[],
  productId: string,
  lot: string | null,
): EntryDraft | null {
  const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase();
  return (
    drafts.find((d) => !d.damageReason && d.productId === productId && norm(d.lotNumber) === norm(lot)) ??
    null
  );
}
