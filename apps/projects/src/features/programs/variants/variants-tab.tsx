'use client';
/**
 * Variants tab (docs/programs/SPEC.md 5.11): the program's kits in card order. Drag to reorder,
 * inline edits for name, SKU, default qty, standard minutes and material cost, the current rate
 * with where it comes from (click to change it from a date), the linked kit with what can be built,
 * this month's units and revenue, and a row menu. Rate changes gather into one pending draft;
 * the sticky bar sends owners to review and publish it, and proposers to ask for review.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Boxes, CalendarPlus, ChevronDown, ClipboardPaste, GripVertical, Grid3x3, Link2, MoreHorizontal, Pencil, Plus, Shapes, Tag, Trash2, Unlink } from 'lucide-react';
import { formatCents, formatQty, formatUnitPrice, shortDate, unitLabel } from '@kitstak/programs-engine';
import { Badge, Button, ConfirmDialog, DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, EmptyState, IconButton, SearchInput, Spinner, Switch, Tooltip, cn } from '@/components/ui';
import { useServerAction } from '@/lib/hooks/use-action';
import { useAttributes, useVariantKit } from '@/lib/hooks/use-programs';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import type { AttributeDTO, VariantDTO } from '@/lib/program-types';
import { deleteVariantAction, linkVariantKitAction, reorderVariantsAction, restoreVariantAction, retireVariantAction, updateVariantAction } from '@/server/actions/variants';
import { deleteVersionAction, requestReviewAction } from '@/server/actions/price-cards';
import { useCurrentProgram } from '../program-context';
import { PriceFromChip, VariantDot } from '../kit/chips';
import { readQty, trimQty } from '../kit/qty-input';
import { useProgramOverlays } from '../overlays/overlay-params';
import { BUILD_FILTER_PARAM, DEFAULT_BUILD_FILTERS, formatBuildFilters } from '../builds/builds-model';
import { readPrice } from '../editors';
import { AddOneDialog, ChangeRateDialog, EditVariantDialog, LinkKitDialog, VariantMatrixDialog, type KitItem, type MatrixMode } from './variant-dialogs';

/* ---------------------------------------------------------------------------------------------- */
/* Inline cells                                                                                   */
/* ---------------------------------------------------------------------------------------------- */

function InlineCell({ value, display, label, onSave, disabled, mono, numeric, validate }: { readonly value: string; readonly display?: React.ReactNode; readonly label: string; readonly onSave: (next: string) => Promise<boolean>; readonly disabled?: boolean; readonly mono?: boolean; readonly numeric?: boolean; readonly validate?: (text: string) => string | null }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) ref.current?.select();
  }, [editing]);
  const commit = async () => {
    if (text.trim() === value.trim()) {
      setEditing(false);
      return;
    }
    const problem = validate?.(text) ?? null;
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    const ok = await onSave(text.trim());
    setSaving(false);
    if (ok) setEditing(false);
  };
  if (disabled) return <span className={cn('block truncate px-1.5', mono && 'font-key text-xs', numeric && 'text-right tabular-nums')}>{display ?? (value || <span className="text-fg-muted">None</span>)}</span>;
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setText(value);
          setError(null);
          setEditing(true);
        }}
        aria-label={`Edit ${label}`}
        className={cn('block w-full truncate rounded-sm px-1.5 py-0.5 text-left outline-none hover:bg-hover hover:shadow-[inset_0_0_0_1px_var(--border-subtle)] focus-visible:outline-2 focus-visible:outline-focus', mono && 'font-key text-xs', numeric && 'text-right tabular-nums')}
      >
        {display ?? (value || <span className="text-fg-muted opacity-0 transition-opacity group-hover:opacity-100">Add</span>)}
      </button>
    );
  }
  return (
    <Tooltip content={error ?? ''} open={Boolean(error)}>
      <input
        ref={ref}
        value={text}
        aria-label={label}
        aria-invalid={Boolean(error)}
        disabled={saving}
        onChange={(event) => {
          setText(event.target.value);
          setError(null);
        }}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void commit();
          if (event.key === 'Escape') {
            setEditing(false);
            setError(null);
          }
        }}
        className={cn('h-7 w-full rounded-sm border bg-panel px-1.5 text-sm outline-none focus:border-focus', error ? 'border-danger' : 'border-border-input', mono && 'font-key text-xs', numeric && 'text-right tabular-nums')}
      />
    </Tooltip>
  );
}

function useInView<T extends Element>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || seen) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setSeen(true);
        observer.disconnect();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [seen]);
  return [ref, seen] as const;
}

function KitCell({ variant, canEdit, onLink }: { readonly variant: VariantDTO; readonly canEdit: boolean; readonly onLink: () => void }) {
  const { key } = useCurrentProgram();
  const [ref, seen] = useInView<HTMLDivElement>();
  const linked = variant.coreItem ?? variant.wmsProduct;
  const kit = useVariantKit(key, variant.id, { enabled: seen && Boolean(linked) });
  if (!linked) {
    return canEdit ? (
      <button type="button" onClick={onLink} className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-fg-secondary outline-none hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-focus">
        <Link2 aria-hidden className="size-3.5" />
        Link kit
      </button>
    ) : (
      <span className="px-1.5 text-xs text-fg-muted">None</span>
    );
  }
  const capacity = kit.data?.available ? kit.data.warehouses?.reduce((best, row) => Math.max(best, Number(row.netKittingCapacity)), 0) ?? null : null;
  const asOf = kit.data?.warehouses?.[0]?.asOf;
  return (
    <div ref={ref} className="flex min-w-0 flex-col gap-0.5 px-1.5">
      <span className="inline-flex min-w-0 items-center gap-1 text-xs">
        <Boxes aria-hidden className="size-3.5 shrink-0 text-icon" />
        <span className="truncate font-key text-fg-secondary" title={linked.name}>
          {linked.sku ?? linked.name}
        </span>
      </span>
      {kit.isLoading && seen ? (
        <Spinner size="xs" label="Checking stock" />
      ) : capacity !== null ? (
        <Tooltip content={asOf ? `From the warehouse as of ${new Date(asOf).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : 'From the warehouse'}>
          <span tabIndex={0} className={cn('w-fit text-2xs font-medium tabular-nums', capacity > 0 ? 'text-success-text' : 'text-danger-text')}>
            Can build {formatQty(String(capacity))}
          </span>
        </Tooltip>
      ) : null}
    </div>
  );
}

function variantBuildsHref(key: string, variantId: string): string {
  return `${routes.programBuilds(key, 'table')}?${BUILD_FILTER_PARAM}=${encodeURIComponent(formatBuildFilters({ ...DEFAULT_BUILD_FILTERS, variants: [variantId] }))}`;
}

/* ---------------------------------------------------------------------------------------------- */
/* Pending changes bar                                                                            */
/* ---------------------------------------------------------------------------------------------- */

function PendingBar() {
  const { key, program, capabilities } = useCurrentProgram();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [discarding, setDiscarding] = useState(false);
  const pending = program.pendingRateChanges;
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: qk.program(key) });
  };
  const ask = useServerAction(requestReviewAction, { successMessage: 'Sent for review. Owners will see it on the price card.', errorTitle: "Couldn't ask for review", onSuccess: refresh });
  const discard = useServerAction(deleteVersionAction, {
    successMessage: 'Rate changes discarded.',
    errorTitle: "Couldn't discard the changes",
    onSuccess: async () => {
      setDiscarding(false);
      await refresh();
    },
  });
  if (!pending || !(capabilities.canPropose || capabilities.canPrice)) return null;
  const text = `${pending.count} rate ${pending.count === 1 ? 'change' : 'changes'} starting ${shortDate(pending.startsOn)}`;
  return (
    <div className="sticky bottom-3 z-10 mx-auto mt-4 flex w-fit max-w-full flex-wrap items-center gap-2 rounded-xl border border-border-default bg-raised px-4 py-2.5 shadow-lg" data-testid="pending-changes-bar">
      <Tag aria-hidden className="size-4 text-warning-text" />
      <span className="text-sm font-medium text-fg">{text}</span>
      <span className="flex items-center gap-1.5">
        {capabilities.canPrice ? (
          <Button size="sm" onClick={() => router.push(`${routes.programTab(key, 'price-card')}?version=${pending.versionId}`)}>
            Review and publish
          </Button>
        ) : (
          <Button size="sm" loading={ask.pending} onClick={() => void ask.run({ versionId: pending.versionId })}>
            Ask for review
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setDiscarding(true)}>
          Discard changes
        </Button>
      </span>
      <ConfirmDialog open={discarding} onOpenChange={setDiscarding} title="Discard these rate changes?" description="Rates stay as they are on the price card in force." confirmLabel="Discard" destructive loading={discard.pending} onConfirm={() => void discard.run({ versionId: pending.versionId })} />
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Tab                                                                                            */
/* ---------------------------------------------------------------------------------------------- */

type Dialog = { readonly kind: 'rate' | 'kit' | 'edit'; readonly variant: VariantDTO } | { readonly kind: 'matrix'; readonly mode: MatrixMode } | { readonly kind: 'one' } | { readonly kind: 'delete'; readonly variant: VariantDTO } | null;

function attributeChips(variant: VariantDTO, attributes: readonly AttributeDTO[]): { readonly id: string; readonly text: string }[] {
  return attributes.flatMap((attribute) => {
    const valueId = variant.attributes[attribute.id];
    const value = attribute.values.find((entry) => entry.id === valueId);
    return value ? [{ id: `${attribute.id}:${value.id}`, text: value.label }] : [];
  });
}

export function VariantsTab({ kitItems }: { readonly kitItems: readonly KitItem[] }) {
  const { key, unit, variants, capabilities, moneyHidden } = useCurrentProgram();
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const overlays = useProgramOverlays();
  const attributes = useAttributes(key);
  const [query, setQuery] = useState('');
  const [showRetired, setShowRetired] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(() => (params?.get('add') === '1' ? { kind: 'matrix', mode: 'matrix' } : null));
  const [order, setOrder] = useState<readonly string[] | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const canEdit = capabilities.canEdit;
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: qk.program(key) });
  };
  const update = useServerAction(updateVariantAction, { errorTitle: "Couldn't save the variant", onSuccess: refresh });
  const retire = useServerAction(retireVariantAction, { successMessage: 'Variant retired. New builds cannot use it. Past builds keep it.', errorTitle: "Couldn't retire the variant", onSuccess: refresh });
  const restore = useServerAction(restoreVariantAction, { successMessage: 'Variant is active again.', errorTitle: "Couldn't restore the variant", onSuccess: refresh });
  const remove = useServerAction(deleteVariantAction, {
    successMessage: 'Variant deleted.',
    errorTitle: "Couldn't delete the variant",
    onSuccess: async () => {
      setDialog(null);
      await refresh();
    },
  });
  const unlink = useServerAction(linkVariantKitAction, { successMessage: 'Kit unlinked.', errorTitle: "Couldn't unlink the kit", onSuccess: refresh });
  const reorder = useServerAction(reorderVariantsAction, { errorTitle: "Couldn't save the order", onSuccess: refresh, onError: () => setOrder(null) });
  const byId = useMemo(() => new Map(variants.map((variant) => [variant.id, variant])), [variants]);
  const ordered = useMemo(() => (order ? order.map((id) => byId.get(id)).filter((variant): variant is VariantDTO => Boolean(variant)) : variants), [order, byId, variants]);
  const needle = query.trim().toLowerCase();
  const shown = ordered.filter((variant) => (showRetired || variant.status === 'active') && (!needle || variant.name.toLowerCase().includes(needle) || variant.key.toLowerCase().includes(needle) || (variant.sku ?? '').toLowerCase().includes(needle)));
  const activeCount = variants.filter((variant) => variant.status === 'active').length;
  const retiredCount = variants.length - activeCount;
  const save = async (variant: VariantDTO, patch: Parameters<typeof updateVariantAction>[0]['patch']) => Boolean(await update.run({ id: variant.id, expectedVersion: variant.version, patch }));
  const qtyValidate = (text: string) => {
    const read = readQty(text);
    return read.ok ? null : read.message;
  };
  const drop = (targetId: string) => {
    if (!dragging || dragging === targetId) return;
    const ids = ordered.map((variant) => variant.id).filter((id) => id !== dragging);
    const index = ids.indexOf(targetId);
    ids.splice(index < 0 ? ids.length : index, 0, dragging);
    setOrder(ids);
    setDragging(null);
    void reorder.run({ key, ids });
  };
  const addMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button data-testid="add-variants">
          <Plus aria-hidden />
          Add variants
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem icon={<Grid3x3 aria-hidden />} description="Size x Color makes every combination." onSelect={() => setDialog({ kind: 'matrix', mode: 'matrix' })}>
          Make a matrix
        </DropdownMenuItem>
        <DropdownMenuItem icon={<ClipboardPaste aria-hidden />} description="From a sheet or an email." onSelect={() => setDialog({ kind: 'matrix', mode: 'paste' })}>
          Paste a list
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Plus aria-hidden />} description="One kit with its own name." onSelect={() => setDialog({ kind: 'one' })}>
          Add one
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-5" data-testid="variants-tab">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-baseline gap-2 text-lg font-semibold text-fg">
          Variants
          <span className="text-sm font-normal text-fg-muted tabular-nums">{activeCount}</span>
        </h2>
        <div className="w-full sm:w-64">
          <SearchInput value={query} onValueChange={setQuery} placeholder="Search by name, key or SKU" aria-label="Search variants" />
        </div>
        {retiredCount > 0 ? <Switch checked={showRetired} onCheckedChange={setShowRetired} label={`Show retired (${retiredCount})`} size="sm" /> : null}
        <span className="ml-auto flex items-center gap-2">
          {canEdit && activeCount > 0 ? (
            <Button variant="secondary" onClick={() => setDialog({ kind: 'matrix', mode: 'edit' })} data-testid="edit-attributes">
              <Shapes aria-hidden />
              Edit attributes
            </Button>
          ) : null}
          {canEdit ? addMenu : null}
        </span>
      </header>
      {variants.length === 0 ? (
        <EmptyState
          visual={<Shapes aria-hidden className="size-10 text-icon" />}
          title="No variants yet"
          description={`Variants are the kits this program makes, like Small Brown. Each build makes one variant.`}
          actions={
            canEdit ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => setDialog({ kind: 'matrix', mode: 'matrix' })}>Make a matrix</Button>
                <Button variant="secondary" onClick={() => setDialog({ kind: 'matrix', mode: 'paste' })}>
                  Paste a list
                </Button>
                <Button variant="ghost" onClick={() => setDialog({ kind: 'one' })}>
                  Add one
                </Button>
              </div>
            ) : null
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border-subtle bg-panel shadow-xs">
          <table className="w-full min-w-[1120px] text-sm" data-testid="variants-table">
            <thead>
              <tr className="h-9 border-b border-border-subtle text-left text-xs text-fg-muted">
                <th scope="col" className="w-8" aria-label="Order" />
                <th scope="col" className="min-w-[150px] px-1.5 font-medium">Name</th>
                <th scope="col" className="px-1.5 font-medium">Key</th>
                <th scope="col" className="px-1.5 font-medium">SKU</th>
                <th scope="col" className="px-1.5 font-medium">Attributes</th>
                <th scope="col" className="px-1.5 text-right font-medium">Default qty</th>
                <th scope="col" className="px-1.5 text-right font-medium">Pack</th>
                <th scope="col" className="px-1.5 text-right font-medium">Std min</th>
                {moneyHidden ? null : <th scope="col" className="px-1.5 font-medium">Rate</th>}
                {moneyHidden ? null : <th scope="col" className="px-1.5 text-right font-medium">Material</th>}
                <th scope="col" className="px-1.5 font-medium">Kit</th>
                <th scope="col" className="px-1.5 text-right font-medium">This month</th>
                <th scope="col" className="px-1.5 font-medium">Status</th>
                <th scope="col" className="sticky right-0 w-10 bg-panel" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {shown.map((variant, index) => {
                const retired = variant.status !== 'active';
                const chips = attributeChips(variant, attributes.data ?? []);
                const rowIndex = ordered.findIndex((entry) => entry.id === variant.id);
                return (
                  <tr
                    key={variant.id}
                    className={cn('group h-[37px] border-b border-border-subtle last:border-b-0 hover:bg-hover/60', retired && 'text-fg-muted', dragging === variant.id && 'opacity-50')}
                    onDragOver={(event) => {
                      if (dragging) event.preventDefault();
                    }}
                    onDrop={() => drop(variant.id)}
                    data-testid="variant-row"
                  >
                    <td className="pl-1.5">
                      {canEdit && !needle ? (
                        <span
                          draggable
                          onDragStart={() => setDragging(variant.id)}
                          onDragEnd={() => setDragging(null)}
                          onKeyDown={(event) => {
                            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                            event.preventDefault();
                            const ids = ordered.map((entry) => entry.id);
                            const to = rowIndex + (event.key === 'ArrowUp' ? -1 : 1);
                            if (to < 0 || to >= ids.length) return;
                            ids.splice(rowIndex, 1);
                            ids.splice(to, 0, variant.id);
                            setOrder(ids);
                            void reorder.run({ key, ids });
                          }}
                          tabIndex={0}
                          role="button"
                          aria-label={`Move ${variant.name}. Use the up and down arrow keys.`}
                          className="flex size-6 cursor-grab items-center justify-center rounded-sm text-icon opacity-0 outline-none group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-focus"
                        >
                          <GripVertical aria-hidden className="size-4" />
                        </span>
                      ) : (
                        <span className="sr-only">{index + 1}</span>
                      )}
                    </td>
                    <td className="max-w-[220px]">
                      <span className="flex items-center gap-1">
                        <VariantDot color={variant.color} className="ml-1 shrink-0" />
                        <InlineCell value={variant.name} label={`${variant.name} name`} disabled={!canEdit || retired} onSave={(name) => save(variant, { name })} validate={(text) => (text.trim() ? null : 'Name the variant.')} />
                      </span>
                    </td>
                    <td className="px-1.5 font-key text-xs whitespace-nowrap text-fg-secondary">{variant.key}</td>
                    <td className="max-w-[150px]">
                      <InlineCell value={variant.sku ?? ''} label={`${variant.name} SKU`} mono disabled={!canEdit || retired} onSave={(sku) => save(variant, { sku: sku || null })} />
                    </td>
                    <td className="px-1.5">
                      <span className="flex gap-1 whitespace-nowrap">
                        {chips.length === 0 ? <span className="text-xs text-fg-muted">None</span> : null}
                        {chips.map((chip) => (
                          <span key={chip.id} className="rounded-sm bg-muted px-1.5 text-2xs leading-[18px] font-medium text-fg-secondary">
                            {chip.text}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="w-[96px]">
                      <InlineCell value={variant.defaultQty ? trimQty(variant.defaultQty) : ''} display={variant.defaultQty ? formatQty(variant.defaultQty) : undefined} label={`${variant.name} default qty`} numeric disabled={!canEdit || retired} validate={qtyValidate} onSave={(text) => save(variant, { defaultQty: text ? text.replace(/,/g, '') : null })} />
                    </td>
                    <td className="w-[64px] px-1.5 text-right text-fg-secondary tabular-nums">{variant.packQty ? formatQty(variant.packQty) : <span className="text-fg-muted">1</span>}</td>
                    <td className="w-[80px]">
                      <InlineCell value={variant.stdMinutesPerUnit ? trimQty(variant.stdMinutesPerUnit) : ''} label={`${variant.name} standard minutes`} numeric disabled={!canEdit || retired} validate={qtyValidate} onSave={(text) => save(variant, { stdMinutesPerUnit: text || null })} />
                    </td>
                    {moneyHidden ? null : (
                      <td className="px-1.5">
                        {variant.currentRate ? (
                          <button
                            type="button"
                            disabled={!(capabilities.canPropose || capabilities.canPrice) || retired}
                            onClick={() => setDialog({ kind: 'rate', variant })}
                            className="flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-left outline-none enabled:hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"
                            title={variant.currentRate.ruleText ?? undefined}
                          >
                            <span className="font-medium text-fg tabular-nums">{formatUnitPrice(variant.currentRate.unitPrice)}</span>
                            <PriceFromChip source={variant.currentRate.source === 'none' ? 'none' : variant.currentRate.source} ruleText={variant.currentRate.ruleText} />
                          </button>
                        ) : (
                          <span className="text-xs text-fg-muted">No price</span>
                        )}
                        {variant.currentRate?.ruleText ? <span className="block truncate px-1 text-2xs text-fg-muted">{variant.currentRate.ruleText}</span> : null}
                      </td>
                    )}
                    {moneyHidden ? null : (
                      <td className="w-[92px]">
                        <InlineCell
                          value={variant.materialCostPerUnit ? trimQty(variant.materialCostPerUnit) : ''}
                          display={variant.materialCostPerUnit ? formatUnitPrice(variant.materialCostPerUnit) : undefined}
                          label={`${variant.name} material cost`}
                          numeric
                          disabled={!canEdit || retired}
                          validate={(text) => {
                            if (!text.trim()) return null;
                            const read = readPrice(text);
                            return read.ok ? null : read.message;
                          }}
                          onSave={(text) => save(variant, { materialCostPerUnit: text ? text.replace('$', '') : null })}
                        />
                      </td>
                    )}
                    <td className="max-w-[160px]">
                      <KitCell variant={variant} canEdit={canEdit && !retired} onLink={() => setDialog({ kind: 'kit', variant })} />
                    </td>
                    <td className="px-1.5 text-right whitespace-nowrap">
                      <span className="block text-fg tabular-nums">{unitLabel(variant.monthUnits, unit)}</span>
                      {moneyHidden ? null : <span className="block text-2xs text-fg-muted tabular-nums">{formatCents(variant.monthRevenueCents, { cents: true })}</span>}
                    </td>
                    <td className="px-1.5">
                      <Badge tone={retired ? 'neutral' : 'success'} size="sm">
                        {retired ? 'Retired' : 'Active'}
                      </Badge>
                    </td>
                    <td className="sticky right-0 bg-panel pr-1.5 group-hover:bg-[color-mix(in_srgb,var(--surface-hover)_60%,var(--surface-panel))]">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton label={`Actions for ${variant.name}`} icon={<MoreHorizontal aria-hidden />} size="sm" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          {canEdit || capabilities.canPropose ? (
                            <DropdownMenuGroup>
                              <DropdownMenuLabel>Edit</DropdownMenuLabel>
                              {canEdit ? (
                                <DropdownMenuItem icon={<Pencil aria-hidden />} onSelect={() => setDialog({ kind: 'edit', variant })}>
                                  Edit
                                </DropdownMenuItem>
                              ) : null}
                              {!moneyHidden && (capabilities.canPropose || capabilities.canPrice) && !retired ? (
                                <DropdownMenuItem icon={<Tag aria-hidden />} onSelect={() => setDialog({ kind: 'rate', variant })}>
                                  Change rate
                                </DropdownMenuItem>
                              ) : null}
                              {canEdit && !retired ? (
                                <DropdownMenuItem icon={<Link2 aria-hidden />} onSelect={() => setDialog({ kind: 'kit', variant })}>
                                  {variant.coreItem ? 'Change kit' : 'Link kit'}
                                </DropdownMenuItem>
                              ) : null}
                              {canEdit && (variant.coreItem || variant.wmsProduct) ? (
                                <DropdownMenuItem icon={<Unlink aria-hidden />} onSelect={() => void unlink.run({ id: variant.id, coreItemId: null, wmsProductId: null })}>
                                  Unlink kit
                                </DropdownMenuItem>
                              ) : null}
                            </DropdownMenuGroup>
                          ) : null}
                          <DropdownMenuSeparator />
                          <DropdownMenuGroup>
                            <DropdownMenuLabel>Work</DropdownMenuLabel>
                            {capabilities.canPlan && !retired ? (
                              <DropdownMenuItem icon={<CalendarPlus aria-hidden />} onSelect={() => overlays.openPlanner('week')}>
                                Plan builds for this variant
                              </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuItem icon={<Boxes aria-hidden />} onSelect={() => router.push(variantBuildsHref(key, variant.id))}>
                              View builds
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                          {canEdit ? (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuGroup>
                                <DropdownMenuLabel>Danger</DropdownMenuLabel>
                                {retired ? (
                                  <DropdownMenuItem icon={<ArchiveRestore aria-hidden />} onSelect={() => void restore.run({ id: variant.id })}>
                                    Restore
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem icon={<Archive aria-hidden />} description="Keeps past builds. New builds cannot use it." onSelect={() => void retire.run({ id: variant.id })}>
                                    Retire
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem variant="danger" icon={<Trash2 aria-hidden />} description="Only when it has no builds." onSelect={() => setDialog({ kind: 'delete', variant })}>
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuGroup>
                            </>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={14} className="px-4 py-8 text-center text-sm text-fg-muted">
                    No variants match that search.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
      <PendingBar />
      {dialog?.kind === 'matrix' ? <VariantMatrixDialog mode={dialog.mode} open onOpenChange={(open) => (open ? null : setDialog(null))} /> : null}
      {dialog?.kind === 'one' ? <AddOneDialog open onOpenChange={(open) => (open ? null : setDialog(null))} /> : null}
      {dialog?.kind === 'rate' ? <ChangeRateDialog variant={dialog.variant} open onOpenChange={(open) => (open ? null : setDialog(null))} /> : null}
      {dialog?.kind === 'kit' ? <LinkKitDialog variant={dialog.variant} items={kitItems} open onOpenChange={(open) => (open ? null : setDialog(null))} /> : null}
      {dialog?.kind === 'edit' ? <EditVariantDialog variant={dialog.variant} open onOpenChange={(open) => (open ? null : setDialog(null))} /> : null}
      <ConfirmDialog
        open={dialog?.kind === 'delete'}
        onOpenChange={(open) => (open ? null : setDialog(null))}
        title={dialog?.kind === 'delete' ? `Delete ${dialog.variant.name}?` : 'Delete this variant?'}
        description="This only works when no build uses it. To keep its history, retire it instead."
        confirmLabel="Delete"
        destructive
        loading={remove.pending}
        onConfirm={() => {
          if (dialog?.kind === 'delete') void remove.run({ id: dialog.variant.id });
        }}
      />
    </div>
  );
}

