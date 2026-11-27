'use client';
/**
 * Step 2 Variants (docs/programs/SPEC.md 5.4): "Make a matrix" (the variant generator with rate
 * rules, conflicts and kit matching), "Paste a list" (engine `inferAxes`, then "Use these kits"
 * moves the result into the matrix) and "Add one by one" (a table editor).
 */
import { useMemo } from 'react';
import { CheckCircle2, ClipboardPaste, Grid3x3, Link2, ListPlus, Plus, Search, Trash2, X } from 'lucide-react';
import { formatUnitPrice } from '@kitstak/programs-engine';
import { Badge, Button, IconButton, Input, Popover, PopoverContent, PopoverTrigger, ToggleGroup, cn, toast } from '@/components/ui';
import { PasteList, VariantGenerator, buildRows, localId, patchOverrides, type EditorRow } from '@/features/programs/editors';
import { unitOf, variantRates, wizardVariants, type ManualRow, type VariantMode } from './wizard-model';
import type { StepProps } from './wizard-types';

function KitCell({ row, items, onLink }: { readonly row: EditorRow; readonly items: StepProps['data']['kitItems']; readonly onLink: (id: string | null) => void }) {
  const linked = row.coreItemId ? items.find((item) => item.id === row.coreItemId) : null;
  if (linked) {
    return (
      <span className="inline-flex max-w-full items-center gap-1">
        <Badge tone="success" icon={<CheckCircle2 aria-hidden />} className="min-w-0"><span className="truncate" title={linked.name}>Kit found</span></Badge>
        <IconButton size="sm" label={`Unlink ${linked.name}`} icon={<X aria-hidden />} onClick={() => onLink(null)} className="size-5" />
      </span>
    );
  }
  if (items.length === 0) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1 rounded-sm text-2xs font-medium text-fg-secondary outline-none hover:text-fg focus-visible:outline-2 focus-visible:outline-focus">
          <Link2 aria-hidden className="size-3" />
          Link kit
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-72 w-72 overflow-y-auto p-1">
        <p className="px-2 pt-1 pb-1.5 text-xs text-fg-muted">Kits for this customer</p>
        {items.map((item) => (
          <button key={item.id} type="button" onClick={() => onLink(item.id)} className="flex w-full flex-col rounded-sm px-2 py-1.5 text-left outline-none hover:bg-hover focus-visible:bg-hover">
            <span className="truncate text-sm text-fg">{item.name}</span>
            <span className="font-key text-2xs text-fg-muted">{item.sku}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function ManualTable({ rows, onChange, problems, showErrors, unitPlural, cardRate }: { readonly rows: readonly ManualRow[]; readonly onChange: (rows: ManualRow[]) => void; readonly problems: Readonly<Record<string, string>>; readonly showErrors: boolean; readonly unitPlural: string; readonly cardRate: string | null }) {
  const update = (id: string, patch: Partial<ManualRow>) => onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const add = () => onChange([...rows, { id: localId('v'), name: '', key: '', sku: '', defaultQty: '', unitPrice: '' }]);
  return (
    <div className="flex flex-col gap-2" data-testid="manual-variants">
      <div className="overflow-x-auto rounded-xl border border-border-subtle bg-panel shadow-xs">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-border-subtle bg-sunken text-left text-xs text-fg-muted">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Name</th>
              <th scope="col" className="w-28 px-3 py-2 font-medium">Key</th>
              <th scope="col" className="w-40 px-3 py-2 font-medium">SKU</th>
              <th scope="col" className="w-28 px-3 py-2 text-right font-medium">Default qty</th>
              <th scope="col" className="w-28 px-3 py-2 text-right font-medium">Rate</th>
              <th scope="col" className="w-10"><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const problem = showErrors ? problems[`row:${row.id}`] : undefined;
              return (
                <tr key={row.id} className="border-b border-border-subtle last:border-0 align-top">
                  <td className="px-2 py-1.5">
                    <Input aria-label={`Name of variant ${index + 1}`} value={row.name} invalid={Boolean(problem)} onChange={(event) => update(row.id, { name: event.target.value, key: row.key || '' })} onBlur={() => (!row.key && row.name ? update(row.id, { key: row.name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 16) }) : undefined)} />
                    {problem ? <p role="alert" className="mt-1 text-2xs font-medium text-danger-text">{problem}</p> : null}
                  </td>
                  <td className="px-2 py-1.5"><Input aria-label={`Key of variant ${index + 1}`} value={row.key} className="font-key uppercase" onChange={(event) => update(row.id, { key: event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 16) })} /></td>
                  <td className="px-2 py-1.5"><Input aria-label={`SKU of variant ${index + 1}`} value={row.sku} className="font-key" onChange={(event) => update(row.id, { sku: event.target.value.slice(0, 64) })} /></td>
                  <td className="px-2 py-1.5"><Input aria-label={`Default qty of variant ${index + 1}`} value={row.defaultQty} inputMode="decimal" className="text-right tabular-nums" onChange={(event) => update(row.id, { defaultQty: event.target.value })} /></td>
                  <td className="px-2 py-1.5"><Input aria-label={`Rate of variant ${index + 1}`} value={row.unitPrice} inputMode="decimal" placeholder={cardRate ? `${formatUnitPrice(cardRate)} card` : undefined} className="text-right tabular-nums" onChange={(event) => update(row.id, { unitPrice: event.target.value })} /></td>
                  <td className="px-1 py-1.5"><IconButton size="sm" label={`Remove variant ${index + 1}`} icon={<Trash2 aria-hidden />} onClick={() => onChange(rows.filter((entry) => entry.id !== row.id))} /></td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-fg-muted">No variants yet. Add the first {unitPlural.replace(/s$/, '')} you build.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <Button variant="secondary" size="sm" leadingIcon={<Plus aria-hidden />} onClick={add} className="self-start" data-testid="add-variant">Add variant</Button>
    </div>
  );
}

export function StepVariants({ state, set, data, problems, showErrors }: StepProps) {
  const unit = unitOf(state.basics);
  const mode = state.variants.mode;
  const generator = state.variants.generator;
  const cardRate = state.price.lines.perUnit.on && state.price.lines.perUnit.price.trim() ? state.price.lines.perUnit.price : null;
  const customer = state.basics.customer;
  const items = useMemo(() => (customer?.kind === 'core' ? data.kitItems.filter((item) => item.customerId === customer.id) : []), [customer, data.kitItems]);
  const rows = useMemo(() => buildRows(generator, state.basics.key).rows, [generator, state.basics.key]);
  const setMode = (next: VariantMode) => set((s) => ({ ...s, variants: { ...s.variants, mode: next } }));
  const matchKits = () => {
    const bySku = new Map(items.map((item) => [item.sku.toUpperCase(), item]));
    let found = 0;
    let overrides = generator.overrides;
    for (const row of rows) {
      const item = row.sku ? bySku.get(row.sku.toUpperCase()) : undefined;
      if (item && row.include) {
        overrides = patchOverrides(overrides, [row.comboKey], { coreItemId: item.id });
        found += 1;
      }
    }
    set((s) => ({ ...s, variants: { ...s.variants, generator: { ...s.variants.generator, overrides } } }));
    if (found) toast.success(`Found ${found} ${found === 1 ? 'kit' : 'kits'}`, 'Matched by SKU for this customer.');
    else toast.info('No kits matched', 'No kit for this customer has the same SKU. Use Link kit on a variant.');
  };
  const count = wizardVariants(state).length;
  const rates = variantRates(state);
  const priced = [...rates.values()].filter((rate) => rate.price).length;

  return (
    <div className="flex flex-col gap-4" data-testid="wizard-variants">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          label="How to add variants"
          value={mode}
          onValueChange={setMode}
          options={[
            { value: 'matrix', label: 'Make a matrix', icon: <Grid3x3 aria-hidden /> },
            { value: 'paste', label: 'Paste a list', icon: <ClipboardPaste aria-hidden /> },
            { value: 'list', label: 'Add one by one', icon: <ListPlus aria-hidden /> },
          ]}
        />
        {mode === 'matrix' && items.length > 0 && rows.length > 0 ? (
          <Button variant="secondary" size="sm" leadingIcon={<Search aria-hidden />} onClick={matchKits} data-testid="match-kits">Match kits</Button>
        ) : null}
      </div>

      {showErrors && problems.variants ? <p role="alert" className="rounded-md bg-danger-subtle px-3 py-2 text-sm font-medium text-danger-text" data-field="variants">{problems.variants}</p> : null}
      {showErrors && problems.rules ? <p role="alert" className="rounded-md bg-danger-subtle px-3 py-2 text-sm font-medium text-danger-text">{problems.rules}</p> : null}

      {mode === 'matrix' && rows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle bg-panel px-3 py-2.5 shadow-xs" data-testid="card-rate-inline">
          <label htmlFor="wizard-card-rate" className="text-sm font-medium text-fg">Card rate</label>
          <Input
            id="wizard-card-rate"
            value={state.price.lines.perUnit.price}
            inputMode="decimal"
            leadingIcon={<span className="text-sm text-fg-muted">$</span>}
            trailing={<span className="text-xs text-fg-muted">per {unit.singular}</span>}
            containerClassName="w-40"
            onChange={(event) => set((s) => ({ ...s, price: { ...s.price, lines: { ...s.price.lines, perUnit: { ...s.price.lines.perUnit, on: true, price: event.target.value } } } }))}
            data-testid="wizard-card-rate"
          />
          <span className="min-w-0 flex-1 text-xs text-fg-muted">Empty rate cells and rules that add to the rate use it. You can change it on the Price card step.</span>
        </div>
      ) : null}

      {mode === 'matrix' ? (
        <VariantGenerator
          value={generator}
          onChange={(value) => set((s) => ({ ...s, variants: { ...s.variants, generator: value } }))}
          programKey={state.basics.key || 'KEY'}
          unit={unit}
          cardRate={cardRate}
          renderKitCell={customer?.kind === 'core' ? (row) => <KitCell row={row} items={items} onLink={(id) => set((s) => ({ ...s, variants: { ...s.variants, generator: { ...s.variants.generator, overrides: patchOverrides(s.variants.generator.overrides, [row.comboKey], { coreItemId: id }) } } }))} /> : undefined}
        />
      ) : mode === 'paste' ? (
        <PasteList
          unit={unit}
          previous={generator}
          initialText={state.variants.pasteText}
          onUse={(value) => {
            set((s) => ({ ...s, variants: { ...s.variants, mode: 'matrix', generator: value } }));
            const made = buildRows(value, state.basics.key).rows.filter((row) => row.include).length;
            toast.success(`${made} ${made === 1 ? unit.singular : unit.plural} ready`, 'Name the attributes, set rates and pick what to include.');
          }}
        />
      ) : (
        <ManualTable rows={state.variants.manual} onChange={(manual) => set((s) => ({ ...s, variants: { ...s.variants, manual } }))} problems={problems} showErrors={showErrors} unitPlural={unit.plural} cardRate={cardRate} />
      )}

      {mode !== 'paste' && count > 0 ? (
        <p className={cn('text-xs text-fg-muted')}>
          {count} {count === 1 ? 'variant' : 'variants'} included · {priced === count ? 'every one has a rate' : priced === 0 ? 'set the card rate on the next step' : `${priced} of ${count} have a rate`}. Rates and rules here become the first price card version.
        </p>
      ) : null}
    </div>
  );
}
