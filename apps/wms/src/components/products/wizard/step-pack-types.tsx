'use client';

/**
 * Pack Type step (UOM model): Unit of measure · Irregulars (n) · Hierarchicals (n).
 * Primary first, then hierarchical packs (Case = n × Unit…) and irregular alternates.
 */
import * as React from 'react';
import { useFormContext, useFormState, useWatch } from 'react-hook-form';
import { Box, Boxes, Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  normalizePackTypes,
  newPackType,
  type PackKind,
  type PackTypeFormValue,
} from '@/lib/grid-defs/products/product-form';
import {
  formatVolume,
  hasIncompleteDimensions,
  hasMissingWeight,
} from '@/lib/grid-defs/products/catalog-options';
import { rederiveDependentWeights } from '@/lib/grid-defs/products/pack-derivation';
import { Badge } from '@/components/ui/badge';
import { Barcode } from '@/components/ui/barcode';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FieldError } from '@/components/ui/form';
import { SegmentedTabs } from '@/components/ui/tabs';
import { useProductWizard } from './context';
import { PackTypeModal } from './pack-type-modal';

type Tab = 'uom' | 'irregular' | 'hierarchical';

function fmt(n: number | null | undefined, d = 2): string {
  return (n ?? 0).toFixed(d);
}

function DetailRow({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-2xs font-medium text-faint">{label}</dt>
      <dd className="truncate text-sm text-body">{children}</dd>
    </div>
  );
}

export function PackCard({
  pack,
  all,
  onEdit,
  onDelete,
}: {
  readonly pack: PackTypeFormValue;
  readonly all: readonly PackTypeFormValue[];
  readonly onEdit?: () => void;
  readonly onDelete?: () => void;
}) {
  const { options } = useProductWizard();
  const normalized = normalizePackTypes(all);
  const qty = normalized.find((p) => p.key === pack.key)?.uomQty ?? pack.uomQty ?? 1;
  const parent =
    pack.kind === 'Hierarchical'
      ? (all.find((p) => p.key === pack.parentKey) ?? all.find((p) => p.kind === 'Primary'))
      : null;
  const box = options.shipmentPackages.find((o) => o.value === pack.useShipPackageId)?.label ?? 'Any box';
  const Icon = pack.kind === 'Primary' ? Box : pack.kind === 'Hierarchical' ? Layers : Boxes;
  return (
    <article className="rounded-lg border border-border bg-surface shadow-xs" data-pack-type={pack.packType}>
      <header className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-soft text-primary">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-2xs font-semibold text-faint">
            {pack.kind === 'Primary' ? 'Primary (UOM)' : pack.kind}
          </p>
          <p className="truncate text-base font-semibold text-foreground">
            {pack.packType}
            <span className="ml-2 text-xs font-normal text-secondary">
              {pack.kind === 'Hierarchical' && parent
                ? `= ${pack.childQty ?? 2} × ${parent.packType} · `
                : ''}
              UOM qty {qty}
            </span>
          </p>
        </div>
        {hasIncompleteDimensions(pack) ? (
          <Badge
            tone="warning"
            title="Length, width or height is 0. Cubing and box selection need all three."
          >
            Incomplete dimensions
          </Badge>
        ) : null}
        {hasMissingWeight(pack) ? (
          <Badge tone="warning" title="Weight is 0. Rate shopping and shipping labels need a weight.">
            No weight
          </Badge>
        ) : null}
        {onEdit ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Edit ${pack.packType}`}
            title={`Edit ${pack.packType}`}
            onClick={onEdit}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </Button>
        ) : null}
        {onDelete ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${pack.packType}`}
            title={`Delete ${pack.packType}`}
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5 text-danger" aria-hidden />
          </Button>
        ) : null}
      </header>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 px-4 py-3 md:grid-cols-4">
        <DetailRow label="L × W × H">
          {fmt(pack.length)} × {fmt(pack.width)} × {fmt(pack.height)} {pack.dimensionUnit.toLowerCase()}
        </DetailRow>
        <DetailRow label="Weight">
          {fmt(pack.weight)} {pack.weightUnit.toLowerCase()}
        </DetailRow>
        <DetailRow label="Volume">
          {formatVolume(pack.volume)} {pack.volumeUnit.toLowerCase()}
        </DetailRow>
        <DetailRow label="Shipping box">{box}</DetailRow>
        <DetailRow label="Own box for shipping">{pack.useOwnBox ? 'Yes' : 'No'}</DetailRow>
        {pack.kind !== 'Primary' ? (
          <DetailRow label="Uses primary barcodes">{pack.usePrimaryBarcodes ? 'Yes' : 'No'}</DetailRow>
        ) : null}
      </dl>
      <div className="flex flex-wrap gap-3 border-t border-border px-4 py-3">
        {pack.barcodes.length ? (
          pack.barcodes.map((b) => (
            <div
              key={b}
              className="flex flex-col items-center rounded-md border border-border bg-white px-1 pb-1"
            >
              <Barcode
                value={b}
                height={8}
                scale={1}
                showText={false}
                className="px-2.5 pt-1.5 pb-0.5"
                aria-label={`Barcode ${b}`}
              />
              <span className="font-mono text-2xs leading-4 text-body" aria-hidden>
                {b}
              </span>
            </div>
          ))
        ) : (
          <p className="text-xs text-faint">No barcodes. Add one so this pack can be scanned.</p>
        )}
      </div>
    </article>
  );
}

export function AddCard({
  icon: Icon,
  title,
  description,
  onAdd,
  disabledReason,
}: {
  readonly icon: React.ComponentType<{ className?: string }>;
  readonly title: string;
  readonly description: string;
  readonly onAdd: () => void;
  readonly disabledReason?: string | null;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-dashed border-border-strong/70 bg-surface-sunken/60 px-4 py-3">
      <Icon className="h-6 w-6 text-faint" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-secondary">{description}</p>
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={onAdd}
        disabled={Boolean(disabledReason)}
        title={disabledReason ?? undefined}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        Add
      </Button>
    </div>
  );
}

/** Adds or replaces `pack`, re-deriving calculated case/pallet weights (typed weights are kept). */
export function packsAfterSave(
  packs: readonly PackTypeFormValue[],
  pack: PackTypeFormValue,
): PackTypeFormValue[] {
  const exists = packs.some((p) => p.key === pack.key);
  const next = exists ? packs.map((p) => (p.key === pack.key ? pack : p)) : [...packs, pack];
  return normalizePackTypes(rederiveDependentWeights(packs, next));
}

/** Removes `pack`; packs nested in it re-parent to its parent (or the primary). */
export function packsAfterRemove(
  packs: readonly PackTypeFormValue[],
  pack: PackTypeFormValue,
): PackTypeFormValue[] {
  const fallback = pack.parentKey ?? packs.find((p) => p.kind === 'Primary')?.key ?? null;
  const next = packs
    .filter((p) => p.key !== pack.key)
    .map((p) => (p.parentKey === pack.key ? { ...p, parentKey: fallback } : p));
  return normalizePackTypes(rederiveDependentWeights(packs, next));
}

export function StepPackTypes() {
  const form = useFormContext();
  const packs = (useWatch({ name: 'packTypes' }) as PackTypeFormValue[] | undefined) ?? [];
  const clientId = (useWatch({ name: 'clientId' }) as string | null | undefined) ?? null;
  const { errors } = useFormState({ name: 'packTypes' });
  const [tab, setTab] = React.useState<Tab>('uom');
  const [modal, setModal] = React.useState<{ kind: PackKind; value: PackTypeFormValue } | null>(null);
  const [toDelete, setToDelete] = React.useState<PackTypeFormValue | null>(null);
  const primary = packs.find((p) => p.kind === 'Primary');
  const irregulars = packs.filter((p) => p.kind === 'Irregular');
  const hierarchicals = packs.filter((p) => p.kind === 'Hierarchical');
  const error = errors.packTypes as { message?: string; root?: { message?: string } } | undefined;
  const errorMessage = error?.message ?? error?.root?.message;

  // Calculated case/pallet weights follow their contained pack (typed weights are kept).
  const commit = (next: PackTypeFormValue[]) =>
    form.setValue('packTypes', next, { shouldDirty: true, shouldValidate: false });
  const open = (kind: PackKind, value?: PackTypeFormValue) =>
    setModal({ kind, value: value ?? newPackType(kind, packs) });
  const save = (pack: PackTypeFormValue) => {
    commit(packsAfterSave(packs, pack));
    if (form.getFieldState('packTypes').error) form.clearErrors('packTypes');
  };
  const remove = (pack: PackTypeFormValue) => commit(packsAfterRemove(packs, pack));
  const noPrimary = primary ? null : 'Add the primary (UOM) pack type first';

  return (
    <div className="flex flex-col gap-4" data-field="packTypes">
      <p className="text-xs text-secondary">Scanning any pack type barcode identifies the pack.</p>
      <SegmentedTabs
        ariaLabel="Pack type groups"
        active={tab}
        onChange={(k) => setTab(k as Tab)}
        tabs={[
          { key: 'uom', label: 'Unit of measure' },
          { key: 'irregular', label: 'Irregulars', count: irregulars.length },
          { key: 'hierarchical', label: 'Hierarchicals', count: hierarchicals.length },
        ]}
      />
      {tab === 'uom' ? (
        primary ? (
          <div className="flex flex-col gap-3">
            <PackCard
              pack={primary}
              all={packs}
              onEdit={() => open('Primary', primary)}
              onDelete={() => setToDelete(primary)}
            />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <AddCard
                icon={Boxes}
                title="Irregular"
                description="Alternate packs outside the hierarchy (e.g. a 3-pack)."
                onAdd={() => open('Irregular')}
              />
              <AddCard
                icon={Layers}
                title="Hierarchical"
                description="Nested packs: Case = n × Unit, Pallet = n × Case."
                onAdd={() => open('Hierarchical')}
              />
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => open('Primary')}
            aria-invalid={Boolean(errorMessage) || undefined}
            className="flex h-24 w-full flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-primary/40 bg-primary-soft/40 text-sm font-semibold text-primary transition-colors hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add primary (UOM) pack type
            <span className="text-xs font-normal text-secondary">
              Dimensions, weight and barcodes of one unit
            </span>
          </button>
        )
      ) : null}
      {tab !== 'uom' ? (
        <div className="flex flex-col gap-3">
          {(tab === 'irregular' ? irregulars : hierarchicals).map((p) => (
            <PackCard
              key={p.key}
              pack={p}
              all={packs}
              onEdit={() => open(p.kind, p)}
              onDelete={() => setToDelete(p)}
            />
          ))}
          <AddCard
            icon={tab === 'irregular' ? Boxes : Layers}
            title={tab === 'irregular' ? 'Add irregular pack type' : 'Add hierarchical pack type'}
            description={
              tab === 'irregular'
                ? 'Its UOM quantity is entered directly.'
                : 'Its UOM quantity is derived from child qty.'
            }
            onAdd={() => open(tab === 'irregular' ? 'Irregular' : 'Hierarchical')}
            disabledReason={noPrimary}
          />
        </div>
      ) : null}
      <FieldError id="pack-types-error" message={errorMessage} />
      {modal ? (
        <PackTypeModal
          open
          onOpenChange={(o) => (o ? null : setModal(null))}
          kind={modal.kind}
          initial={modal.value}
          packs={packs}
          clientId={clientId}
          onSave={save}
        />
      ) : null}
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => (o ? null : setToDelete(null))}
        title={`Delete pack type ${toDelete?.packType ?? ''}?`}
        description={
          toDelete?.kind === 'Primary'
            ? 'The product needs a primary pack type before it can be saved.'
            : 'Its barcodes are removed too. Packs nested in it move up one level.'
        }
        onConfirm={() => {
          if (toDelete) remove(toDelete);
        }}
      />
    </div>
  );
}
