'use client';

/**
 * Edit Product drawer (PO line editor). Pack type, Quantity*, Price per pack type*,
 * read-only total, then "Receiving details": received qty (read-only), receiving
 * location, expiry / production / lot (enabled only for tracked products), LP type, LP number.
 */
import * as React from 'react';
import { useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Lock, PackagePlus } from 'lucide-react';
import { LocationPicker } from '@/components/shared/entity-pickers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DisabledReason } from '@/components/ui/tooltip';
import { Drawer } from '@/components/ui/drawer';
import { Form, FormField, FormGrid, FormSection, useZodForm } from '@/components/ui/form';
import { useApiQuery } from '@/lib/query-client';
import { useFormat } from '@/lib/format';
import { MAX_LINE_QTY } from '@/lib/grid-defs/receiving/po-schemas';
import { DateF, NumF, SelectF, TextF } from '../fields';
import { ProductThumb } from '../receiving-shared';
import { lineTotalOrNull, type LineDraft } from './po-form-model';

const lineFormSchema = z
  .object({
    packType: z.string().min(1, 'Choose a pack type'),
    orderedQuantity: z
      .number({ message: 'Quantity is required' })
      .int('Use a whole number')
      .min(1, 'Quantity must be at least 1')
      .max(MAX_LINE_QTY, 'Quantity is too large'),
    unitCost: z
      .number({ message: 'Price per pack type is required' })
      .min(0, "Price can't be negative")
      .max(10_000_000, 'Price is too large'),
    receivedQuantity: z.number(),
    receivingLocationId: z.string().nullable(),
    receivingLocationCode: z.string().nullable(),
    lotNumber: z.string().max(100, 'Use at most 100 characters').nullable(),
    expiryDate: z.string().nullable(),
    productionDate: z.string().nullable(),
    lpTypeId: z.string().nullable(),
    lpNumber: z.string().max(100, 'Use at most 100 characters').nullable(),
    note: z.string().max(500, 'Use at most 500 characters').nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.orderedQuantity < v.receivedQuantity)
      ctx.addIssue({
        code: 'custom',
        path: ['orderedQuantity'],
        message: `${v.receivedQuantity} are already received; the quantity can't be lower.`,
      });
    if (v.expiryDate && v.productionDate && v.expiryDate < v.productionDate)
      ctx.addIssue({
        code: 'custom',
        path: ['expiryDate'],
        message: 'Expiry date must be after the production date.',
      });
  });
type LineForm = z.input<typeof lineFormSchema>;

interface LpType {
  readonly id: string;
  readonly code: string;
  readonly description: string | null;
}

function Total({
  control,
}: {
  readonly control: ReturnType<typeof useZodForm<typeof lineFormSchema>>['control'];
}) {
  const fmt = useFormat();
  const qty = useWatch({ control, name: 'orderedQuantity' }) as number | null;
  const price = useWatch({ control, name: 'unitCost' }) as number | null;
  const total = lineTotalOrNull(qty, price);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-body">Total price</span>
      <span
        className="flex h-9 items-center justify-end rounded-md border border-border bg-surface-sunken px-3 text-sm font-semibold tabular-nums text-foreground"
        aria-live="polite"
      >
        {total === null ? '—' : fmt.money(total)}
      </span>
    </div>
  );
}

function EditorForm({
  line,
  warehouseId,
  readOnly,
  formId,
  onApply,
  onDirty,
  onInvalid,
}: {
  readonly line: LineDraft;
  readonly warehouseId: string;
  readonly readOnly: boolean;
  readonly formId: string;
  readonly onApply: (line: LineDraft) => void;
  readonly onDirty: (dirty: boolean) => void;
  readonly onInvalid: (reason: string | null) => void;
}) {
  const form = useZodForm(lineFormSchema, {
    packType: line.packType,
    orderedQuantity: line.orderedQuantity,
    unitCost: line.unitCost,
    receivedQuantity: line.receivedQuantity,
    receivingLocationId: line.receivingLocationId,
    receivingLocationCode: line.receivingLocationCode,
    lotNumber: line.lotNumber,
    expiryDate: line.expiryDate,
    productionDate: line.productionDate,
    lpTypeId: line.lpTypeId,
    lpNumber: line.lpNumber,
    note: line.note,
  } satisfies LineForm);
  const dirty = form.formState.isDirty;
  React.useEffect(() => onDirty(dirty), [dirty, onDirty]);
  // Apply stays disabled until the line is valid (Logiwa parity), with the first issue as the tooltip.
  const watched = useWatch({ control: form.control });
  const parsed = lineFormSchema.safeParse(watched);
  const invalid = parsed.success ? null : (parsed.error.issues[0]?.message ?? 'Complete the required fields');
  React.useEffect(() => onInvalid(invalid), [invalid, onInvalid]);
  const lpTypes = useApiQuery<LpType[]>(
    ['po-lp-types', warehouseId],
    warehouseId ? '/api/purchase-orders/lp-types' : null,
    { query: { warehouseId } },
  );
  const lpOptions = (lpTypes.data?.data ?? []).map((t) => ({
    value: t.id,
    label: t.code,
    description: t.description ?? undefined,
  }));
  const locationCode = useWatch({ control: form.control, name: 'receivingLocationCode' });
  const t = line.tracking;
  const untracked = (what: string) => `${line.sku} isn't ${what} tracked.`;

  return (
    <Form
      form={form}
      id={formId}
      onSubmit={(v) =>
        onApply({
          ...line,
          packType: v.packType,
          orderedQuantity: v.orderedQuantity,
          unitCost: v.unitCost,
          receivingLocationId: v.receivingLocationId,
          receivingLocationCode: v.receivingLocationCode,
          lotNumber: t.lot ? v.lotNumber || null : null,
          expiryDate: t.expiry ? v.expiryDate : null,
          productionDate: t.production ? v.productionDate : null,
          lpTypeId: v.lpTypeId || null,
          lpTypeCode: lpOptions.find((o) => o.value === v.lpTypeId)?.label ?? null,
          lpNumber: v.lpNumber || null,
          note: v.note || null,
        })
      }
      className="gap-6"
    >
      <fieldset disabled={readOnly} className="contents">
        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-sunken p-3">
          <ProductThumb url={line.imageUrl} label={line.sku} size={44} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{line.sku}</p>
            <p className="truncate text-xs text-secondary">{line.productName}</p>
          </div>
          <div className="flex flex-wrap justify-end gap-1">
            {t.lot ? (
              <Badge tone="info" size="sm">
                Lot
              </Badge>
            ) : null}
            {t.expiry ? (
              <Badge tone="info" size="sm">
                Expiry
              </Badge>
            ) : null}
            {t.production ? (
              <Badge tone="info" size="sm">
                Production date
              </Badge>
            ) : null}
            {t.serial ? (
              <Badge tone="info" size="sm">
                Serial
              </Badge>
            ) : null}
          </div>
        </div>
        <FormGrid>
          <SelectF
            name="packType"
            label="Pack type"
            required
            options={line.packTypes.map((p) => ({
              value: p.packType,
              label: p.uomQty === 1 ? p.packType : `${p.packType} (${p.uomQty} ${line.uom})`,
            }))}
            disabled={readOnly || line.receivedQuantity > 0}
            info={
              line.receivedQuantity > 0 ? "The pack type can't change after receiving started." : undefined
            }
          />
          <NumF
            name="orderedQuantity"
            label="Quantity"
            required
            min={1}
            max={MAX_LINE_QTY}
            disabled={readOnly}
          />
          <NumF
            name="unitCost"
            label="Price per pack type"
            required
            decimals={2}
            min={0}
            suffix="USD"
            disabled={readOnly}
          />
          <Total control={form.control} />
        </FormGrid>
        <FormSection
          title="Receiving details"
          description="Optional expected attributes. Lot, expiry and production date apply to tracked products only."
        >
          <FormGrid>
            <NumF name="receivedQuantity" label="Received quantity" disabled info="Set by receipts." />
            <FormField name="receivingLocationId" label="Receiving location" disabled={readOnly}>
              {(c) => (
                <LocationPicker
                  id={c.id}
                  warehouseId={warehouseId}
                  value={(c.value as string | null) ?? null}
                  selectedLabel={locationCode ?? undefined}
                  onChange={(v, item) => {
                    c.onChange(v);
                    form.setValue('receivingLocationCode', item ? String(item.label) : null);
                  }}
                  onBlur={c.onBlur}
                  invalid={c.invalid}
                  disabled={c.disabled}
                  placeholder="Select inventory location"
                />
              )}
            </FormField>
            <DateF
              name="expiryDate"
              label="Expiry date"
              disabled={readOnly || !t.expiry}
              info={t.expiry ? undefined : untracked('expiry')}
            />
            <DateF
              name="productionDate"
              label="Production date"
              disabled={readOnly || !t.production}
              info={t.production ? undefined : untracked('production date')}
            />
            <TextF
              name="lotNumber"
              label="Lot batch number"
              maxLength={100}
              disabled={readOnly || !t.lot}
              info={t.lot ? undefined : untracked('lot')}
            />
            <SelectF
              name="lpTypeId"
              label="LP type"
              options={lpOptions}
              clearable
              placeholder={
                lpTypes.isPending
                  ? 'Loading LP types…'
                  : lpOptions.length
                    ? 'Select LP type'
                    : 'No LP types in this warehouse'
              }
              disabled={readOnly || lpOptions.length === 0}
            />
            <TextF
              name="lpNumber"
              label="LP number"
              maxLength={100}
              placeholder="Select LP number"
              disabled={readOnly}
              className="md:col-span-2"
            />
            <TextF
              name="note"
              label="Line note"
              maxLength={500}
              disabled={readOnly}
              className="md:col-span-2"
            />
          </FormGrid>
        </FormSection>
      </fieldset>
    </Form>
  );
}

export function LineEditorDrawer({
  line,
  warehouseId,
  readOnly = false,
  onOpenChange,
  onApply,
  isNew,
}: {
  readonly line: LineDraft | null;
  readonly warehouseId: string;
  readonly readOnly?: boolean;
  readonly isNew?: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onApply: (line: LineDraft) => void;
}) {
  const formId = React.useId();
  const [dirty, setDirty] = React.useState(false);
  const [invalid, setInvalid] = React.useState<string | null>(null);
  return (
    <Drawer
      open={line !== null}
      onOpenChange={(open) => {
        if (!open) setDirty(false);
        onOpenChange(open);
      }}
      dirty={dirty && !readOnly}
      width={45}
      title={
        <span className="flex items-center gap-2">
          {readOnly ? (
            <Lock className="h-4 w-4 text-faint" aria-hidden />
          ) : (
            <PackagePlus className="h-4 w-4 text-primary" aria-hidden />
          )}
          {readOnly ? 'Product details' : isNew ? 'Add product' : 'Edit product'}
        </span>
      }
      description={line ? `${line.sku} · ${line.productName}` : undefined}
      footer={
        readOnly ? (
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <DisabledReason reason={invalid}>
              <Button type="submit" form={formId} variant="primary" disabled={Boolean(invalid)}>
                Apply
              </Button>
            </DisabledReason>
          </>
        )
      }
    >
      {line ? (
        <EditorForm
          key={line.key}
          line={line}
          warehouseId={warehouseId}
          readOnly={readOnly}
          formId={formId}
          onDirty={setDirty}
          onInvalid={setInvalid}
          onApply={(next) => {
            setDirty(false);
            onApply(next);
          }}
        />
      ) : null}
    </Drawer>
  );
}
