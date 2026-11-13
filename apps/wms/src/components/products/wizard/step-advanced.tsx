'use client';

/**
 * Advanced step: 8-section accordion (kits get customs, hazmat and channel allocation only).
 * A section with an error opens itself so the inline message and focus land on the field.
 */
import * as React from 'react';
import { useFormContext, useFormState, useWatch, type FieldErrors } from 'react-hook-form';
import { Minus, Pencil, Plus, Trash2 } from 'lucide-react';
import { countryOptions } from '@/lib/countries';
import {
  DATE_FORMATS,
  HAZMAT_ATTRIBUTES,
  HAZMAT_CONTAINER_TYPES,
  HAZMAT_QUANTITY_TYPES,
  HAZMAT_QUANTITY_UNITS,
  HAZMAT_TYPES,
  SCAN_METHODS,
  SERIAL_METHODS,
} from '@/lib/grid-defs/products/catalog-options';
import type { ChannelAllocationFormValue } from '@/lib/grid-defs/products/product-form';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { FieldError, FormField, FormGrid, FormGridFull } from '@/components/ui/form';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Switch } from '@/components/ui/switch';
import { useProductWizard } from './context';
import { AllocationModal, ReplenishmentModal, type LevelDraft } from './advanced-modals';
import { NumF, SelectF, TextF, YesNoF, opts } from './fields';

/** One disabled look for every control in a switched-off group (inputs, selects, steppers). */
const DISABLED_GROUP =
  '[&_button:disabled]:cursor-not-allowed [&_button:disabled]:bg-surface-sunken [&_button:disabled]:text-faint [&_input:disabled]:text-faint [&_label]:text-secondary';

type SectionKey =
  'customs' | 'expiry' | 'hazmat' | 'channels' | 'lot' | 'production' | 'replenishment' | 'serial';

const SECTION_FIELDS: Record<SectionKey, readonly string[]> = {
  customs: ['customs'],
  expiry: [
    'trackExpiry',
    'expiryReceivingOnly',
    'expiryFormat',
    'expiryScanMethod',
    'useProductionDate',
    'shelfLifeDays',
  ],
  hazmat: ['isHazmat', 'hazmat'],
  channels: ['channelAllocations'],
  lot: ['trackLot', 'lotReceivingOnly', 'autoCreateLot', 'lotRegex', 'lotScanMethod'],
  production: ['trackProductionDate', 'productionReceivingOnly', 'productionFormat', 'productionScanMethod'],
  replenishment: ['replenishmentStrategy', 'replenishmentMin', 'replenishmentMax', 'replenishmentLevels'],
  serial: ['trackSerial', 'trackSecondarySerial', 'serialMethod', 'skipSerialScan', 'serialRegex'],
};

function hasError(errors: FieldErrors, key: SectionKey): boolean {
  return SECTION_FIELDS[key].some((f) => Boolean((errors as Record<string, unknown>)[f]));
}

function Section({
  k,
  title,
  description,
  summary,
  open,
  onToggle,
  invalid,
  children,
}: {
  readonly k: SectionKey;
  readonly title: string;
  readonly description: string;
  readonly summary?: string | null;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly invalid: boolean;
  readonly children: React.ReactNode;
}) {
  const id = `adv-${k}`;
  return (
    <section className={cn('rounded-lg border bg-surface', invalid ? 'border-danger/60' : 'border-border')}>
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={onToggle}
          className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border text-secondary">
            {open ? (
              <Minus className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Plus className="h-3.5 w-3.5" aria-hidden />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-foreground">{title}</span>
            <span className="block truncate text-xs text-secondary">{description}</span>
          </span>
          {invalid ? (
            <Badge tone="danger" size="sm">
              Needs attention
            </Badge>
          ) : summary ? (
            <Badge tone="success" size="sm">
              {summary}
            </Badge>
          ) : null}
        </button>
      </h3>
      <div id={id} hidden={!open} className="border-t border-border px-4 py-4">
        {children}
      </div>
    </section>
  );
}

function ScanMethod({ name, disabled }: { readonly name: string; readonly disabled?: boolean }) {
  return (
    <FormField name={name} label="Scan method" disabled={disabled}>
      {(c) => (
        <SegmentedControl
          ariaLabel="Scan method"
          disabled={disabled}
          value={((c.value as string | null) ?? 'During Picking') as (typeof SCAN_METHODS)[number]}
          onChange={(v) => c.onChange(v)}
          options={SCAN_METHODS.map((m) => ({ value: m, label: m }))}
        />
      )}
    </FormField>
  );
}

function CountryField() {
  const options = React.useMemo(
    () =>
      countryOptions(['US', 'CA', 'CN', 'MX']).map((o) => ({
        value: o.value,
        label: `${o.label} (${o.value})`,
      })),
    [],
  );
  return (
    <FormField name="customs.originCountry" label="Origin country code">
      {(c) => (
        <Combobox
          id={c.id}
          aria-label="Origin country"
          clearable
          value={(c.value as string | null) || null}
          onChange={(v) => c.onChange(v ?? '')}
          options={options}
          placeholder="Search country"
          invalid={c.invalid}
        />
      )}
    </FormField>
  );
}

function ChannelAllocations() {
  const form = useFormContext();
  const { options } = useProductWizard();
  const rows = (useWatch({ name: 'channelAllocations' }) as ChannelAllocationFormValue[] | undefined) ?? [];
  const [editing, setEditing] = React.useState<ChannelAllocationFormValue | null>(null);
  const { errors } = useFormState({ name: 'channelAllocations' });
  const err = errors.channelAllocations as { message?: string; root?: { message?: string } } | undefined;
  const store = (id: string) => options.channels.find((c) => c.value === id)?.label ?? 'Unknown channel';
  const wh = (id: string | null) =>
    id ? (options.warehouses.find((w) => w.value === id)?.label ?? 'None') : 'All warehouses';
  const commit = (next: ChannelAllocationFormValue[]) =>
    form.setValue('channelAllocations', next, { shouldDirty: true });
  const fresh = (): ChannelAllocationFormValue => ({
    key: `ca_${Math.random().toString(36).slice(2, 9)}`,
    channelConnectionId: '',
    warehouseId: null,
    staticQty: null,
    reserveQty: null,
    allocationPct: null,
  });
  const taken = new Set(
    rows.filter((r) => r.key !== editing?.key).map((r) => `${r.channelConnectionId}:${r.warehouseId ?? ''}`),
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">Allocations</p>
        <Button size="sm" variant="primary" onClick={() => setEditing(fresh())}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add allocation
        </Button>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[560px] text-xs">
          <thead className="bg-surface-sunken text-left text-2xs font-semibold text-faint">
            <tr>
              <th className="px-3 py-2">Channel setup</th>
              <th className="px-3 py-2">Warehouse</th>
              <th className="px-3 py-2 text-right">Static qty</th>
              <th className="px-3 py-2 text-right">Reserve qty</th>
              <th className="px-3 py-2 text-right">Allocation %</th>
              <th className="px-3 py-2 text-right">Synced qty</th>
              <th className="w-16 px-3 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-faint">
                  Nothing to display
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.key}>
                  <td className="px-3 py-2 font-medium text-foreground">{store(r.channelConnectionId)}</td>
                  <td className="px-3 py-2">{wh(r.warehouseId)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.staticQty ?? 'None'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.reserveQty ?? 'None'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.allocationPct === null ? 'None' : `${r.allocationPct}%`}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-faint">Next sync</td>
                  <td className="px-2 py-1">
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit allocation for ${store(r.channelConnectionId)}`}
                        onClick={() => setEditing(r)}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove allocation for ${store(r.channelConnectionId)}`}
                        onClick={() => commit(rows.filter((x) => x.key !== r.key))}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-danger" aria-hidden />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <FieldError id="alloc-err" message={err?.message ?? err?.root?.message} />
      {editing ? (
        <AllocationModal
          open
          initial={editing}
          takenChannelIds={taken}
          onOpenChange={(o) => (o ? null : setEditing(null))}
          onSave={(v) =>
            commit(
              rows.some((r) => r.key === v.key) ? rows.map((r) => (r.key === v.key ? v : r)) : [...rows, v],
            )
          }
        />
      ) : null}
    </div>
  );
}

type Level = { warehouseId: string; minLevel: number | null; maxLevel: number | null };

function Replenishment() {
  const form = useFormContext();
  const { options } = useProductWizard();
  const strategy = (useWatch({ name: 'replenishmentStrategy' }) as string) ?? 'Global';
  const levels = (useWatch({ name: 'replenishmentLevels' }) as Level[] | undefined) ?? [];
  const [modal, setModal] = React.useState<{ draft: LevelDraft; editing: boolean } | null>(null);
  const { errors } = useFormState({ name: 'replenishmentLevels' });
  const err = errors.replenishmentLevels as { message?: string; root?: { message?: string } } | undefined;
  const whName = (id: string) => options.warehouses.find((w) => w.value === id)?.label ?? 'Unknown warehouse';
  const commit = (next: Level[]) => form.setValue('replenishmentLevels', next, { shouldDirty: true });
  return (
    <div className="flex flex-col gap-3.5">
      <FormField name="replenishmentStrategy" label="Select replenishment strategy">
        {(c) => (
          <SegmentedControl
            ariaLabel="Replenishment strategy"
            value={(c.value as 'Global' | 'Per Warehouse') ?? 'Global'}
            onChange={(v) => c.onChange(v)}
            options={[
              { value: 'Global', label: 'Global' },
              { value: 'Per Warehouse', label: 'Per warehouse' },
            ]}
          />
        )}
      </FormField>
      {strategy === 'Global' ? (
        <FormGrid columns={2}>
          <NumF name="replenishmentMin" label="Min. replenishment level" />
          <NumF name="replenishmentMax" label="Max. replenishment level" />
        </FormGrid>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="primary"
              onClick={() =>
                setModal({ draft: { warehouseIds: [], minLevel: null, maxLevel: null }, editing: false })
              }
              disabled={levels.length >= options.warehouses.length && options.warehouses.length > 0}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Add replenishment level
            </Button>
          </div>
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-xs">
              <thead className="bg-surface-sunken text-left text-2xs font-semibold text-faint">
                <tr>
                  <th className="px-3 py-2">Warehouse</th>
                  <th className="px-3 py-2 text-right">Min. rep. level</th>
                  <th className="px-3 py-2 text-right">Max. rep. level</th>
                  <th className="w-16 px-3 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {levels.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-faint">
                      Nothing to display
                    </td>
                  </tr>
                ) : (
                  levels.map((l) => (
                    <tr key={l.warehouseId}>
                      <td className="px-3 py-2 font-medium text-foreground">{whName(l.warehouseId)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.minLevel ?? 0}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.maxLevel ?? 0}</td>
                      <td className="px-2 py-1">
                        <div className="flex justify-end">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Edit level for ${whName(l.warehouseId)}`}
                            onClick={() =>
                              setModal({
                                draft: {
                                  warehouseIds: [l.warehouseId],
                                  minLevel: l.minLevel,
                                  maxLevel: l.maxLevel,
                                },
                                editing: true,
                              })
                            }
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Remove level for ${whName(l.warehouseId)}`}
                            onClick={() => commit(levels.filter((x) => x.warehouseId !== l.warehouseId))}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-danger" aria-hidden />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <FieldError id="rep-err" message={err?.message ?? err?.root?.message} />
        </div>
      )}
      {modal ? (
        <ReplenishmentModal
          open
          initial={modal.draft}
          editing={modal.editing}
          takenWarehouseIds={new Set(levels.map((l) => l.warehouseId))}
          onOpenChange={(o) => (o ? null : setModal(null))}
          onSave={(d) => {
            const rest = levels.filter((l) => !d.warehouseIds.includes(l.warehouseId));
            commit([
              ...rest,
              ...d.warehouseIds.map((w) => ({
                warehouseId: w,
                minLevel: d.minLevel ?? 0,
                maxLevel: d.maxLevel ?? 0,
              })),
            ]);
          }}
        />
      ) : null}
    </div>
  );
}

export function StepAdvanced() {
  const { category } = useProductWizard();
  const form = useFormContext();
  const { errors } = useFormState();
  const v = useWatch() as Record<string, unknown>;
  const kit = category === 'Kit';
  const [open, setOpen] = React.useState<Set<SectionKey>>(() => new Set());
  const errorKeys = (Object.keys(SECTION_FIELDS) as SectionKey[])
    .filter((k) => hasError(errors, k))
    .join(',');
  React.useEffect(() => {
    if (!errorKeys) return;
    setOpen((s) => new Set([...s, ...(errorKeys.split(',') as SectionKey[])]));
  }, [errorKeys]);
  const toggle = (k: SectionKey) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const sec = (k: SectionKey) => ({
    k,
    open: open.has(k),
    onToggle: () => toggle(k),
    invalid: hasError(errors, k),
  });
  const hz = Boolean(v.isHazmat);
  const exp = Boolean(v.trackExpiry);
  const lot = Boolean(v.trackLot);
  const prod = Boolean(v.trackProductionDate);
  const ser = Boolean(v.trackSerial);
  const customs = (v.customs ?? {}) as Record<string, unknown>;
  const allocCount = ((v.channelAllocations as unknown[]) ?? []).length;

  return (
    <div className="flex flex-col gap-2.5">
      <Section
        {...sec('customs')}
        title="Add custom declarations"
        description="Declared value, HS tariff code and origin for international shipments"
        summary={customs.hsCode || customs.declaredValue ? 'Configured' : null}
      >
        <FormGrid columns={2}>
          <NumF name="customs.declaredValue" label="Declared value" decimals={2} />
          <TextF name="customs.hsCode" label="HS tariff code" maxLength={20} placeholder="e.g. 6109.10" />
          <CountryField />
          <YesNoF name="customs.notDeclared" label="Is not declared to customs?" />
          <TextF name="customs.manufacturer" label="Manufacturer" maxLength={200} />
          <TextF
            name="customs.manufacturerProductId"
            label="Manufacturer product identifier"
            maxLength={300}
          />
          <FormGridFull>
            <TextF
              name="customs.description"
              label="Description"
              maxLength={200}
              placeholder="Customs description"
            />
          </FormGridFull>
        </FormGrid>
      </Section>
      {kit ? null : (
        <Section
          {...sec('expiry')}
          title="Expiry tracking"
          description="Capture expiry dates and enforce FEFO picking"
          summary={exp ? `On · ${String(v.expiryFormat ?? '')}` : null}
        >
          <FormGrid columns={2}>
            <YesNoF
              name="trackExpiry"
              label="Expiry date tracking"
              onValue={(on) => {
                if (on && !form.getValues('expiryFormat')) form.setValue('expiryFormat', 'yyyy-MM-dd');
              }}
            />
            <YesNoF
              name="expiryReceivingOnly"
              label="Receiving-only expiry tracking"
              disabled={!exp}
              info="Capture the date at receipt only"
            />
            <SelectF
              name="expiryFormat"
              label="Expiry date format"
              required={exp}
              disabled={!exp}
              options={opts(DATE_FORMATS)}
            />
            <ScanMethod name="expiryScanMethod" disabled={!exp} />
            <YesNoF
              name="useProductionDate"
              label="Use production date"
              disabled={!exp}
              info="Expiry = production date + shelf life"
            />
            <NumF name="shelfLifeDays" label="Shelf life in days" disabled={!exp} />
          </FormGrid>
        </Section>
      )}
      <Section
        {...sec('hazmat')}
        title="Hazmat information"
        description="Dangerous goods data sent to carriers"
        summary={hz ? `Hazardous · ${String((v.hazmat as Record<string, unknown>)?.type ?? '')}` : null}
      >
        <div className="flex flex-col gap-3.5">
          <FormField name="isHazmat" label="Mark this item as hazardous" inline>
            {(c) => (
              <Switch
                id={c.id}
                checked={Boolean(c.value)}
                onCheckedChange={(x) => c.onChange(x)}
                aria-label="Mark this item as hazardous"
              />
            )}
          </FormField>
          <FormGrid columns={2} className={hz ? undefined : DISABLED_GROUP}>
            <TextF
              name="hazmat.hazmatId"
              label="Hazmat ID"
              disabled={!hz}
              info="UN/NA identification number, e.g. UN3481"
              maxLength={100}
            />
            <SelectF
              name="hazmat.type"
              label="Hazmat type"
              required={hz}
              disabled={!hz}
              options={opts(HAZMAT_TYPES)}
              info="Carrier hazmat category"
            />
            <SelectF
              name="hazmat.attribute"
              label="Hazmat attribute"
              disabled={!hz}
              clearable
              options={opts(HAZMAT_ATTRIBUTES)}
              info="Lithium battery configuration"
            />
            <NumF
              name="hazmat.quantity"
              label="Quantity"
              decimals={3}
              disabled={!hz}
              info="Hazardous material per unit"
            />
            <SelectF
              name="hazmat.quantityType"
              label="Quantity type"
              disabled={!hz}
              clearable
              options={opts(HAZMAT_QUANTITY_TYPES)}
              info="Gross or net quantity"
            />
            <SelectF
              name="hazmat.quantityUnit"
              label="Quantity unit"
              disabled={!hz}
              clearable
              options={opts(HAZMAT_QUANTITY_UNITS)}
              info="Unit of the quantity"
            />
            <SelectF
              name="hazmat.containerType"
              label="Hazmat container type"
              disabled={!hz}
              clearable
              options={opts(HAZMAT_CONTAINER_TYPES)}
              info="Outer packaging type"
            />
            <TextF
              name="hazmat.properShippingName"
              label="Proper shipping name"
              disabled={!hz}
              maxLength={200}
              info="As listed in the dangerous goods regulations"
            />
            <TextF
              name="hazmat.classDivision"
              label="Class division"
              disabled={!hz}
              maxLength={50}
              info="e.g. 9 or 2.1"
            />
          </FormGrid>
        </div>
      </Section>
      {category === 'Packaging Material' ? null : (
        <Section
          {...sec('channels')}
          title="Inventory channel allocation"
          description="Static, reserve and percentage quantities pushed to each sales channel"
          summary={allocCount ? `${allocCount} allocation${allocCount === 1 ? '' : 's'}` : null}
        >
          <ChannelAllocations />
        </Section>
      )}
      {kit ? null : (
        <>
          <Section
            {...sec('lot')}
            title="Lot/batch tracking"
            description="Capture lot numbers at receiving, picking or packing"
            summary={lot ? 'On' : null}
          >
            <FormGrid columns={2}>
              <YesNoF name="trackLot" label="Lot/batch tracking" />
              <YesNoF name="lotReceivingOnly" label="Receiving-only lot/batch tracking" disabled={!lot} />
              <YesNoF name="autoCreateLot" label="Auto create lot/batch number" disabled={!lot} />
              <TextF
                name="lotRegex"
                label="Regex"
                disabled={!lot}
                placeholder="e.g. ^L[0-9]{6}$"
                maxLength={200}
              />
              <ScanMethod name="lotScanMethod" disabled={!lot} />
            </FormGrid>
          </Section>
          <Section
            {...sec('production')}
            title="Production date tracking"
            description="Capture manufacture dates"
            summary={prod ? `On · ${String(v.productionFormat ?? '')}` : null}
          >
            <FormGrid columns={2}>
              <YesNoF
                name="trackProductionDate"
                label="Active"
                onValue={(on) => {
                  if (on && !form.getValues('productionFormat'))
                    form.setValue('productionFormat', 'yyyy-MM-dd');
                }}
              />
              <YesNoF
                name="productionReceivingOnly"
                label="Receiving-only prod. date tracking"
                disabled={!prod}
              />
              <SelectF
                name="productionFormat"
                label="Production date format"
                required={prod}
                disabled={!prod}
                options={opts(DATE_FORMATS)}
              />
              <ScanMethod name="productionScanMethod" disabled={!prod} />
            </FormGrid>
          </Section>
          <Section
            {...sec('replenishment')}
            title="Replenishment levels"
            description="Min/max for pick-face replenishment, global or per warehouse"
            summary={
              String(v.replenishmentStrategy ?? 'Global') === 'Per Warehouse'
                ? `${((v.replenishmentLevels as unknown[]) ?? []).length} warehouse level(s)`
                : v.replenishmentMax
                  ? `Global ${String(v.replenishmentMin ?? 0)}–${String(v.replenishmentMax)}`
                  : null
            }
          >
            <Replenishment />
          </Section>
          <Section
            {...sec('serial')}
            title="Serial number tracking"
            description="Primary and secondary serials at receiving and packing"
            summary={ser ? String(v.serialMethod ?? 'On') : null}
          >
            <FormGrid columns={2}>
              <YesNoF name="trackSerial" label="Track serial number" />
              <YesNoF name="trackSecondarySerial" label="Track secondary serial number" disabled={!ser} />
              <SelectF
                name="serialMethod"
                label="Tracking method"
                required={ser}
                disabled={!ser}
                placeholder="None"
                options={opts(SERIAL_METHODS)}
              />
              <YesNoF name="skipSerialScan" label="Skip scan serial number" disabled={!ser} />
              <FormGridFull>
                <TextF
                  name="serialRegex"
                  label="Serial number regex"
                  disabled={!ser}
                  placeholder="e.g. ^SN[0-9]{8}$"
                  maxLength={200}
                />
              </FormGridFull>
            </FormGrid>
          </Section>
        </>
      )}
    </div>
  );
}
