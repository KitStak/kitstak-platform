'use client';
/**
 * Variants tab dialogs (docs/programs/SPEC.md 5.11): Make a matrix and Edit attributes (the shared
 * VariantGenerator with existing variants marked; new combinations can be added, existing ones are
 * never removed here), Paste a list, Add one, Change rate, Link kit and Edit.
 */
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ClipboardPaste, Grid3x3, Link2, Pencil, Plus, Search, Tag } from 'lucide-react';
import { formatUnitPrice, shortDate } from '@kitstak/programs-engine';
import { Button, ColorPicker, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, Field, Input, IsoDatePicker, Select, Switch, ToggleGroup, cn, toast } from '@/components/ui';
import { useServerAction } from '@/lib/hooks/use-action';
import { useAttributes } from '@/lib/hooks/use-programs';
import { qk } from '@/lib/query-keys';
import { LABEL_COLORS, type LabelColor } from '@/lib/constants';
import type { AttributeDTO, VariantDTO } from '@/lib/program-types';
import { createVariantsAction, linkVariantKitAction, saveAttributesAction, setVariantRateAction, updateVariantAction } from '@/server/actions/variants';
import { unwrap } from '@/lib/hooks/use-action';
import { PasteList, VariantGenerator, buildRows, readPrice, type VariantGeneratorValue } from '../editors';
import { useCurrentProgram } from '../program-context';
import { readQty, trimQty } from '../kit/qty-input';
import {
  attributesChanged,
  existingForGenerator,
  generatorFromAttributes,
  isExistingRow,
  keyFromName,
  mapRowAttributes,
  mergeForSave,
  newAxes,
  newCountText,
  removalConflict,
  removedAttributes,
  rowExistsByCodes,
  toSaveInputs,
  uniqueKey,
} from './variants-model';

function DialogIcon({ children }: { readonly children: React.ReactNode }) {
  return <span className="flex size-9 items-center justify-center rounded-lg bg-sunken text-icon">{children}</span>;
}

function useRefreshVariants() {
  const { key } = useCurrentProgram();
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: qk.program(key) });
    await queryClient.invalidateQueries({ queryKey: ['programs'] });
  };
}

/* ---------------------------------------------------------------------------------------------- */
/* Matrix, paste and Edit attributes                                                              */
/* ---------------------------------------------------------------------------------------------- */

export type MatrixMode = 'matrix' | 'paste' | 'edit';

export function VariantMatrixDialog({ mode, open, onOpenChange }: { readonly mode: MatrixMode; readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) {
  const { key, unit, variants, program } = useCurrentProgram();
  const attributesQuery = useAttributes(key);
  const attributes = useMemo(() => attributesQuery.data ?? [], [attributesQuery.data]);
  if (attributesQuery.isLoading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="xl">
          <DialogHeader title="Loading attributes" />
          <DialogBody className="py-10 text-center text-sm text-fg-muted">One moment.</DialogBody>
        </DialogContent>
      </Dialog>
    );
  }
  return <MatrixBody mode={mode} open={open} onOpenChange={onOpenChange} attributes={attributes} programKey={key} unitPlural={unit.plural} variantsCount={variants.filter((v) => v.status === 'active').length} cardRate={program.currentVersion?.lines.find((line) => line.kind === 'per_unit' && line.variantId === null)?.unitPrice ?? null} />;
}

function MatrixBody({ mode, open, onOpenChange, attributes, programKey, variantsCount, cardRate }: { readonly mode: MatrixMode; readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly attributes: readonly AttributeDTO[]; readonly programKey: string; readonly unitPlural: string; readonly variantsCount: number; readonly cardRate: string | null }) {
  const { unit, variants } = useCurrentProgram();
  const refresh = useRefreshVariants();
  const [value, setValue] = useState<VariantGeneratorValue>(() => {
    // Variants the program has start unchecked, so they read as "already made", not as clashes.
    const seeded = generatorFromAttributes(attributes);
    const overrides = Object.fromEntries(buildRows(seeded, programKey).rows.filter((row) => isExistingRow(row, variants)).map((row) => [row.comboKey, { include: false }]));
    return { ...seeded, overrides };
  });
  const [pasting, setPasting] = useState(mode === 'paste');
  const [forExisting, setForExisting] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const replace = mode === 'edit';
  const result = useMemo(() => buildRows(value, programKey), [value, programKey]);
  const fromSaved = pasting ? false : value.axes.every((axis) => attributes.some((attribute) => attribute.id === axis.id) || !attributes.some((attribute) => attribute.name.trim().toLowerCase() === axis.name.trim().toLowerCase()));
  const merged = useMemo(() => mergeForSave(attributes, value.axes, replace), [attributes, value.axes, replace]);
  const added = useMemo(() => newAxes(merged, attributes), [merged, attributes]);
  const removed = replace ? removedAttributes(value.axes, attributes) : [];
  const removal = removalConflict(variants, removed.map((attribute) => attribute.id));
  const usedRemoved = removed.filter((attribute) => variants.some((variant) => variant.attributes[attribute.id]));
  const newRows = result.rows.filter((row) => row.include && !rowExistsByCodes(row, value.axes, attributes, variants));
  const needsValue = variantsCount > 0 ? added.filter((axis) => !forExisting[axis.name]) : [];
  const changed = attributesChanged(merged, attributes);
  const canSave = !saving && !result.error && !removal && needsValue.length === 0 && (newRows.length > 0 || changed);
  const save = async () => {
    setSaving(true);
    try {
      let saved: readonly AttributeDTO[] = attributes;
      if (changed) {
        saved = await unwrap(saveAttributesAction({ key: programKey, axes: toSaveInputs(merged, attributes), valuesForExisting: variantsCount > 0 && added.length ? forExisting : undefined }));
      }
      if (newRows.length > 0) {
        const rows = newRows.map((row) => {
          const attributesForRow = mapRowAttributes(row, value.axes, saved);
          return { name: row.name, key: row.key, sku: row.sku, attributes: attributesForRow ?? undefined, defaultQty: row.defaultQty ? row.defaultQty.replace(/,/g, '') : null, unitPrice: row.unitPrice ? row.unitPrice.replace('$', '') : null };
        });
        const created = await unwrap(createVariantsAction({ key: programKey, rows }));
        toast.success(`Added ${created.length === 1 ? '1 variant' : `${created.length} variants`}.`, rows.some((row) => row.unitPrice) ? 'Typed rates wait as pending changes on the price card.' : undefined);
      } else {
        toast.success('Attributes saved.');
      }
      await refresh();
      onOpenChange(false);
    } catch (error) {
      toast.error("Couldn't save the variants", error instanceof Error ? error.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };
  const title = mode === 'edit' ? 'Edit attributes' : pasting ? 'Paste a list' : 'Make a matrix';
  const description =
    mode === 'edit'
      ? 'Add values or attributes. New combinations become variants. Variants you have are never removed here.'
      : pasting
        ? 'Paste rows from a sheet. We find the attributes, then you check the variants before they are added.'
        : 'Pick attributes like Size and Color. Every combination is a variant. Ones you already have are marked.';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="w-[min(1080px,calc(100vw-24px))]" data-testid="variant-matrix-dialog">
        <DialogHeader icon={<DialogIcon>{pasting ? <ClipboardPaste aria-hidden className="size-4" /> : <Grid3x3 aria-hidden className="size-4" />}</DialogIcon>} title={title} description={description} />
        <DialogBody className="flex max-h-[68dvh] flex-col gap-4 overflow-y-auto">
          {pasting ? (
            <PasteList
              unit={unit}
              onUse={(pasted) => {
                setValue(pasted);
                setPasting(false);
              }}
            />
          ) : (
            <>
              {variantsCount > 0 ? <p className="rounded-md bg-sunken px-3 py-2 text-xs text-fg-secondary">{`The ${variantsCount} ${variantsCount === 1 ? 'variant' : 'variants'} you have start unchecked. Check a new combination to add it.`}</p> : null}
              <VariantGenerator value={value} onChange={setValue} programKey={programKey} unit={unit} cardRate={cardRate} existing={fromSaved ? existingForGenerator(variants) : []} showRules={false} />
              {variantsCount > 0 && added.length > 0 ? (
                <div className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning-subtle/40 p-3" data-testid="new-axis-prompt">
                  {added.map((axis) => (
                    <Field key={axis.id} label={`${axis.name || 'New attribute'}: value for the ${variantsCount} existing ${variantsCount === 1 ? 'variant' : 'variants'}`} required hint="Your current variants get this value, so every variant has every attribute.">
                      {({ inputId }) => (
                        <Select
                          id={inputId}
                          value={forExisting[axis.name]}
                          onValueChange={(code) => setForExisting((current) => ({ ...current, [axis.name]: code }))}
                          placeholder="Pick a value"
                          options={axis.values.map((entry) => ({ value: entry.code, label: entry.label }))}
                          className="max-w-xs"
                        />
                      )}
                    </Field>
                  ))}
                </div>
              ) : null}
              {removal ? <p className="rounded-md bg-danger-subtle px-3 py-2 text-sm text-danger-text">{removal}</p> : null}
              {!removal && usedRemoved.length > 0 ? <p className="rounded-md bg-sunken px-3 py-2 text-sm text-fg-secondary">{`${usedRemoved.map((attribute) => attribute.name).join(' and ')} will be removed from every variant. Names and keys stay the same.`}</p> : null}
            </>
          )}
        </DialogBody>
        <DialogFooter className="justify-between">
          <span className="text-sm text-fg-secondary" data-testid="matrix-new-count">
            {pasting ? 'Paste, then check the result.' : result.error ?? newCountText(newRows.length)}
          </span>
          <span className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {pasting ? null : (
              <Button onClick={() => void save()} disabled={!canSave} loading={saving} data-testid="matrix-save">
                {newRows.length > 0 ? `Add ${newCountText(newRows.length).toLowerCase()}` : 'Save attributes'}
              </Button>
            )}
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Add one                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

export function AddOneDialog({ open, onOpenChange }: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) {
  const { key, unit, variants } = useCurrentProgram();
  const attributesQuery = useAttributes(key);
  const refresh = useRefreshVariants();
  const [name, setName] = useState('');
  const [variantKey, setVariantKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [sku, setSku] = useState('');
  const [qty, setQty] = useState('');
  const [rate, setRate] = useState('');
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [tried, setTried] = useState(false);
  const taken = useMemo(() => new Set(variants.map((variant) => variant.key.toUpperCase())), [variants]);
  const suggested = uniqueKey(keyFromName(name), taken);
  const finalKey = (keyEdited ? variantKey : suggested).toUpperCase();
  const qtyRead = readQty(qty);
  const rateRead = rate.trim() ? readPrice(rate) : null;
  const create = useServerAction(createVariantsAction, {
    errorTitle: "Couldn't add the variant",
    successMessage: () => `Added ${name.trim()}.`,
    onSuccess: async () => {
      await refresh();
      onOpenChange(false);
    },
  });
  const errors = {
    name: name.trim() ? (variants.some((variant) => variant.name.toLowerCase() === name.trim().toLowerCase()) ? 'A variant already has this name.' : null) : 'Name the variant.',
    key: /^[A-Z0-9][A-Z0-9-]{0,15}$/.test(finalKey) ? (taken.has(finalKey) ? 'Another variant uses this key.' : null) : 'Use up to 16 letters, numbers or dashes.',
    qty: qtyRead.ok ? null : qtyRead.message,
    rate: rateRead && !rateRead.ok ? rateRead.message : null,
  };
  const submit = () => {
    setTried(true);
    if (Object.values(errors).some(Boolean)) return;
    const attributes = Object.fromEntries(Object.entries(picked).filter(([, value]) => value && value !== 'none'));
    void create.run({ key, rows: [{ name: name.trim(), key: finalKey, sku: sku.trim() || null, attributes, defaultQty: qtyRead.ok ? (qtyRead.qty ?? null) : null, unitPrice: rateRead && rateRead.ok ? rateRead.price : null }] });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="add-one-dialog">
        <DialogHeader icon={<DialogIcon><Plus aria-hidden className="size-4" /></DialogIcon>} title="Add a variant" description={`One more kit this program makes. Builds of it count toward the same price card.`} />
        <DialogBody className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <Field label="Name" required error={tried ? errors.name : null}>
              {({ inputId, invalid }) => <Input id={inputId} autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={80} invalid={invalid} placeholder="XXL Brown" />}
            </Field>
            <Field label="Key" required error={tried ? errors.key : null} hint="Short code used in build titles.">
              {({ inputId, invalid }) => (
                <Input
                  id={inputId}
                  value={finalKey}
                  onChange={(event) => {
                    setKeyEdited(true);
                    setVariantKey(event.target.value.toUpperCase());
                  }}
                  maxLength={16}
                  invalid={invalid}
                  className="font-key"
                />
              )}
            </Field>
          </div>
          {(attributesQuery.data ?? []).length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {(attributesQuery.data ?? []).map((attribute) => (
                <Field key={attribute.id} label={attribute.name}>
                  {({ inputId }) => (
                    <Select
                      id={inputId}
                      value={picked[attribute.id] ?? 'none'}
                      onValueChange={(value) => setPicked((current) => ({ ...current, [attribute.id]: value }))}
                      options={[{ value: 'none', label: 'None' }, ...attribute.values.map((value) => ({ value: value.id, label: value.label }))]}
                    />
                  )}
                </Field>
              ))}
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="SKU">
              {({ inputId }) => <Input id={inputId} value={sku} onChange={(event) => setSku(event.target.value)} maxLength={64} className="font-key" placeholder={`${key}-${finalKey || 'KEY'}`} />}
            </Field>
            <Field label={`Default ${unit.plural}`} error={tried ? errors.qty : null}>
              {({ inputId, invalid }) => <Input id={inputId} value={qty} onChange={(event) => setQty(event.target.value)} inputMode="decimal" invalid={invalid} placeholder="100" />}
            </Field>
            <Field label="Rate" error={tried ? errors.rate : null} hint="Blank uses the card rate.">
              {({ inputId, invalid }) => <Input id={inputId} value={rate} onChange={(event) => setRate(event.target.value)} inputMode="decimal" invalid={invalid} leadingIcon={<span className="text-sm text-fg-muted">$</span>} />}
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} loading={create.pending} data-testid="add-one-save">
            Add variant
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Change rate                                                                                    */
/* ---------------------------------------------------------------------------------------------- */

export function ChangeRateDialog({ variant, open, onOpenChange }: { readonly variant: VariantDTO; readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) {
  const { today, program, unit } = useCurrentProgram();
  const refresh = useRefreshVariants();
  const [useCard, setUseCard] = useState(false);
  const [amount, setAmount] = useState(variant.currentRate ? trimQty(variant.currentRate.unitPrice) : '');
  const [starting, setStarting] = useState(today);
  const [tried, setTried] = useState(false);
  const read = readPrice(amount);
  const change = useServerAction(setVariantRateAction, {
    errorTitle: "Couldn't add the rate change",
    successMessage: `Added to changes starting ${shortDate(starting)}. Publish them from the price card.`,
    onSuccess: async () => {
      await refresh();
      onOpenChange(false);
    },
  });
  const error = !useCard && !read.ok ? read.message : null;
  const cardRate = program.currentVersion?.lines.find((line) => line.kind === 'per_unit' && line.variantId === null)?.unitPrice ?? null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="change-rate-dialog">
        <DialogHeader icon={<DialogIcon><Tag aria-hidden className="size-4" /></DialogIcon>} title={`Change rate for ${variant.name}`} description={`Now ${formatUnitPrice(variant.currentRate?.unitPrice ?? null)}${variant.currentRate?.ruleText ? ` from "${variant.currentRate.ruleText}"` : ''}. Changes wait in one draft until they are published.`} />
        <DialogBody className="flex flex-col gap-4">
          <ToggleGroup
            label="Rate"
            value={useCard ? 'card' : 'amount'}
            onValueChange={(next) => setUseCard(next === 'card')}
            options={[
              { value: 'amount', label: 'Set an amount' },
              { value: 'card', label: 'Use card rate' },
            ]}
          />
          {useCard ? (
            <p className="rounded-md bg-sunken px-3 py-2 text-sm text-fg-secondary">{cardRate ? `${variant.name} will use the card rate of ${formatUnitPrice(cardRate)}, plus any rate rule that fits it.` : 'No card rate is set yet, so this variant will have no price until one is.'}</p>
          ) : (
            <Field label="Amount" required error={tried ? error : null}>
              {({ inputId, invalid }) => <Input id={inputId} autoFocus value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" invalid={invalid} leadingIcon={<span className="text-sm text-fg-muted">$</span>} trailing={<span className="pr-2 text-xs text-fg-muted">per {unit.singular}</span>} />}
            </Field>
          )}
          <Field label="Starting" required hint="Days before this keep their old price.">
            {({ inputId }) => <IsoDatePicker id={inputId} value={starting} onChange={(value) => value && setStarting(value)} />}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            loading={change.pending}
            onClick={() => {
              setTried(true);
              if (error) return;
              void change.run({ variantId: variant.id, unitPrice: useCard ? null : read.ok ? read.price : null, startsOn: starting });
            }}
            data-testid="change-rate-save"
          >
            Add to changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Link kit                                                                                       */
/* ---------------------------------------------------------------------------------------------- */

export interface KitItem {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly customerId: string | null;
}

export function LinkKitDialog({ variant, items, open, onOpenChange }: { readonly variant: VariantDTO; readonly items: readonly KitItem[]; readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) {
  const { program } = useCurrentProgram();
  const refresh = useRefreshVariants();
  const [query, setQuery] = useState('');
  const [onlyCustomer, setOnlyCustomer] = useState(program.customer?.kind === 'core');
  const link = useServerAction(linkVariantKitAction, {
    errorTitle: "Couldn't link the kit",
    successMessage: (dto) => `${dto.name} now uses ${dto.coreItem?.sku ?? dto.coreItem?.name ?? 'the kit'}.`,
    onSuccess: async () => {
      await refresh();
      onOpenChange(false);
    },
  });
  const needle = query.trim().toLowerCase();
  const shown = items
    .filter((item) => !onlyCustomer || program.customer?.kind !== 'core' || item.customerId === program.customer.id)
    .filter((item) => !needle || item.sku.toLowerCase().includes(needle) || item.name.toLowerCase().includes(needle))
    .slice(0, 60);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="link-kit-dialog">
        <DialogHeader icon={<DialogIcon><Link2 aria-hidden className="size-4" /></DialogIcon>} title={`Link a kit to ${variant.name}`} description="Pick the kit item this variant builds. KitStak reads parts and stock from it. Nothing in the warehouse changes." />
        <DialogBody className="flex flex-col gap-3">
          <Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} leadingIcon={<Search aria-hidden className="size-4" />} placeholder="Search kits by SKU or name" aria-label="Search kits" />
          {program.customer?.kind === 'core' ? <Switch checked={onlyCustomer} onCheckedChange={setOnlyCustomer} label={`Only kits for ${program.customer.name}`} size="sm" /> : null}
          <ul className="flex max-h-[44dvh] flex-col overflow-y-auto rounded-lg border border-border-subtle" role="listbox" aria-label="Kits">
            {shown.length === 0 ? <li className="px-3 py-6 text-center text-sm text-fg-muted">{items.length === 0 ? 'No kit items in this workspace yet. Add kits to your items list first.' : 'No kits match that search.'}</li> : null}
            {shown.map((item) => (
              <li key={item.id} role="option" aria-selected={variant.coreItem?.id === item.id}>
                <button
                  type="button"
                  disabled={link.pending}
                  onClick={() => void link.run({ id: variant.id, coreItemId: item.id, title: item.name, sku: item.sku })}
                  className={cn('flex w-full items-center gap-3 border-b border-border-subtle px-3 py-2 text-left text-sm last:border-b-0 hover:bg-hover focus-visible:bg-hover focus-visible:outline-none', variant.coreItem?.id === item.id && 'bg-selected')}
                >
                  <span className="w-32 shrink-0 truncate font-key text-xs text-fg-secondary">{item.sku}</span>
                  <span className="min-w-0 flex-1 truncate text-fg">{item.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Edit                                                                                           */
/* ---------------------------------------------------------------------------------------------- */

export function EditVariantDialog({ variant, open, onOpenChange }: { readonly variant: VariantDTO; readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) {
  const { unit, moneyHidden } = useCurrentProgram();
  const refresh = useRefreshVariants();
  const [form, setForm] = useState({
    name: variant.name,
    sku: variant.sku ?? '',
    defaultQty: trimQty(variant.defaultQty ?? ''),
    packQty: trimQty(variant.packQty ?? ''),
    stdMinutesPerUnit: trimQty(variant.stdMinutesPerUnit ?? ''),
    materialCostPerUnit: variant.materialCostPerUnit ? trimQty(variant.materialCostPerUnit) : '',
    color: (variant.color && (LABEL_COLORS as readonly string[]).includes(variant.color) ? variant.color : 'gray') as LabelColor,
  });
  const update = useServerAction(updateVariantAction, {
    errorTitle: "Couldn't save the variant",
    successMessage: 'Variant saved.',
    onSuccess: async () => {
      await refresh();
      onOpenChange(false);
    },
  });
  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));
  const qty = (text: string) => (text.trim() ? text.trim().replace(/,/g, '') : null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="edit-variant-dialog">
        <DialogHeader icon={<DialogIcon><Pencil aria-hidden className="size-4" /></DialogIcon>} title={`Edit ${variant.name}`} description={`Key ${variant.key}. The key stays the same so old builds keep their names.`} />
        <DialogBody className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <Field label="Name" required>
              {({ inputId }) => <Input id={inputId} value={form.name} onChange={(event) => set({ name: event.target.value })} maxLength={80} />}
            </Field>
            <Field label="SKU">
              {({ inputId }) => <Input id={inputId} value={form.sku} onChange={(event) => set({ sku: event.target.value })} maxLength={64} className="font-key" />}
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={`Default ${unit.plural}`}>
              {({ inputId }) => <Input id={inputId} value={form.defaultQty} onChange={(event) => set({ defaultQty: event.target.value })} inputMode="decimal" />}
            </Field>
            <Field label="Pack qty" hint="Units per scan.">
              {({ inputId }) => <Input id={inputId} value={form.packQty} onChange={(event) => set({ packQty: event.target.value })} inputMode="decimal" />}
            </Field>
            <Field label="Standard minutes" hint={`Per ${unit.singular}, for Workload.`}>
              {({ inputId }) => <Input id={inputId} value={form.stdMinutesPerUnit} onChange={(event) => set({ stdMinutesPerUnit: event.target.value })} inputMode="decimal" />}
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {moneyHidden ? null : (
              <Field label="Material cost" hint={`Per ${unit.singular}. Pulse uses it for margin.`}>
                {({ inputId }) => <Input id={inputId} value={form.materialCostPerUnit} onChange={(event) => set({ materialCostPerUnit: event.target.value })} inputMode="decimal" leadingIcon={<span className="text-sm text-fg-muted">$</span>} />}
              </Field>
            )}
            <Field label="Color">
              {() => <ColorPicker value={form.color} onChange={(color) => set({ color })} />}
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            loading={update.pending}
            disabled={!form.name.trim()}
            onClick={() =>
              void update.run({
                id: variant.id,
                expectedVersion: variant.version,
                patch: {
                  name: form.name.trim(),
                  sku: form.sku.trim() || null,
                  defaultQty: qty(form.defaultQty),
                  packQty: qty(form.packQty),
                  stdMinutesPerUnit: qty(form.stdMinutesPerUnit),
                  ...(moneyHidden ? {} : { materialCostPerUnit: form.materialCostPerUnit.trim() ? form.materialCostPerUnit.trim().replace('$', '') : null }),
                  color: form.color,
                },
              })
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
