'use client';

/**
 * Receive items (partial web receive; KitStaks addition — Logiwa has none). Per line:
 * quantity (defaults to remaining), receiving location with a putaway suggestion and its
 * reason, LP (none / scan existing / create new from an LP type), lot / expiry / production
 * date per the product's tracking, damage reason + photo, serials (count = qty) and a note.
 * Over-receipt needs an explicit confirmation. Posts to `/api/purchase-orders/[id]/receive`.
 */
import * as React from 'react';
import { useFieldArray, useWatch, type UseFormReturn } from 'react-hook-form';
import { keepPreviousData } from '@tanstack/react-query';
import { z } from 'zod';
import { AlertTriangle, Camera, Lightbulb, PackageCheck, X } from 'lucide-react';
import { LocationPicker, LpPicker } from '@/components/shared/entity-pickers';
import { uploadFile } from '@/components/shared/upload-file';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Checkbox } from '@/components/ui/checkbox';
import { ChipInput } from '@/components/ui/chip-input';
import { Drawer } from '@/components/ui/drawer';
import { Form, FormField, FormGrid, useZodForm } from '@/components/ui/form';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { apiRequest, isApiError } from '@/lib/api-client';
import { useApiQuery } from '@/lib/query-client';
import { DAMAGE_REASONS } from '@/lib/grid-defs/receiving/receiving-history';
import {
  EXPIRED_LOT_MESSAGE,
  isExpired,
  MAX_LINE_QTY,
  todayIn,
  trackingIssues,
} from '@/lib/grid-defs/receiving/po-schemas';
import { DateF, NumF, optionsOf, SelectF, TextF } from './fields';
import {
  errorMessage,
  ProductThumb,
  useInvalidateReceiving,
  type PoDetail,
  type PoLineRow,
} from './receiving-shared';
import { humanReasons, putawayAlgorithmLabel, shortReason } from './wizard/po-form-model';
import { DisabledReason } from '@/components/ui/tooltip';

const lineSchema = z.object({
  include: z.boolean(),
  lineId: z.string(),
  quantity: z.number().nullable(),
  locationId: z.string().nullable(),
  locationCode: z.string().nullable(),
  lpMode: z.enum(['none', 'existing', 'new']),
  lpId: z.string().nullable(),
  lpLabel: z.string().nullable(),
  lpTypeId: z.string().nullable(),
  lotNumber: z.string().nullable(),
  expiryDate: z.string().nullable(),
  productionDate: z.string().nullable(),
  damageReason: z.string().nullable(),
  damageImageFileId: z.string().nullable(),
  damageImageName: z.string().nullable(),
  serials: z.array(z.string()),
  note: z.string().max(500, 'Use at most 500 characters').nullable(),
  /** Set while the location is the putaway suggestion (cleared on a manual pick). */
  fromSuggestion: z.boolean(),
  /** What the putaway suggestion was computed with (sent so the server re-runs the same one). */
  suggestBasis: z
    .object({
      qty: z.number(),
      lot: z.string().nullable(),
      expiry: z.string().nullable(),
      damageReason: z.string().nullable(),
    })
    .nullable(),
  /** Location ids of the latest suggestion (client only): a manual pick of one still counts as directed. */
  suggestedIds: z.array(z.string()),
});
type LineValues = z.infer<typeof lineSchema>;

export const INVALID_DAY_MESSAGE = 'Enter a valid date as YYYY/MM/DD';

/** Builds the zod schema with the PO's lines so tracking and remaining checks run client-side too. */
export function receiveFormSchema(lines: readonly PoLineRow[], today: string = todayIn()) {
  const byId = new Map(lines.map((l) => [l.id, l]));
  return z
    .object({ allowOverReceipt: z.boolean(), allowExpired: z.boolean(), lines: z.array(lineSchema) })
    .superRefine((v, ctx) => {
      if (!v.lines.some((l) => l.include))
        ctx.addIssue({ code: 'custom', path: ['lines'], message: 'Select at least one line to receive.' });
      v.lines.forEach((l, i) => {
        if (!l.include) return;
        const row = byId.get(l.lineId);
        if (!row) return;
        const at = (field: string, message: string) =>
          ctx.addIssue({ code: 'custom', path: ['lines', i, field], message });
        if (l.quantity === null || !Number.isInteger(l.quantity) || l.quantity < 1)
          at('quantity', 'Enter a quantity of at least 1');
        if (!l.locationId) at('locationId', 'Choose a receiving location');
        if (l.lpMode === 'existing' && !l.lpId) at('lpId', 'Scan or choose an LP');
        if (l.lpMode === 'new' && !l.lpTypeId) at('lpTypeId', 'Choose an LP type');
        const remaining = Math.max(0, row.orderedQuantity - row.receivedQuantity);
        if ((l.quantity ?? 0) > remaining && !v.allowOverReceipt)
          at('quantity', `Only ${remaining} remaining. Confirm the over-receipt below to receive more.`);
        // The typed text is the value (DateF liveValidate): unparseable text blocks Receive.
        const badDay = (v: string | null | undefined) => Boolean(v) && !/^\d{4}-\d{2}-\d{2}$/.test(v ?? '');
        if (row.tracking.expiry && badDay(l.expiryDate)) {
          at('expiryDate', INVALID_DAY_MESSAGE);
          return;
        }
        if (row.tracking.production && badDay(l.productionDate)) {
          at('productionDate', INVALID_DAY_MESSAGE);
          return;
        }
        const issues = trackingIssues(
          { ...l, quantity: l.quantity ?? 0, uomRatio: row.uomQuantity },
          row.tracking,
          row.sku,
        );
        for (const [field, message] of Object.entries(issues)) at(field, message);
        if (row.tracking.expiry && isExpired(l.expiryDate, today) && !v.allowExpired && !issues.expiryDate)
          at('expiryDate', `${EXPIRED_LOT_MESSAGE} Confirm below to receive it anyway.`);
      });
    });
}
type ReceiveForm = z.infer<ReturnType<typeof receiveFormSchema>>;

/**
 * Why Receive can't post yet: the first issue of the drawer schema, named by SKU ("CPL-BAG: Enter a
 * quantity of at least 1"), or null when the form is valid.
 */
export function receiveBlockedReason(
  lines: readonly PoLineRow[],
  values: unknown,
  today: string = todayIn(),
): string | null {
  const result = receiveFormSchema(lines, today).safeParse(values);
  if (result.success) return null;
  const issue = result.error.issues[0];
  if (!issue) return null;
  const [root, index] = issue.path;
  if (root !== 'lines' || typeof index !== 'number') return issue.message;
  const lineId = (values as { lines?: { lineId?: string }[] }).lines?.[index]?.lineId;
  const sku = lines.find((l) => l.id === lineId)?.sku;
  return sku && !issue.message.includes(sku) ? `${sku}: ${issue.message}` : issue.message;
}

interface Suggestion {
  readonly algorithm: string;
  readonly rule: string | null;
  readonly suggestions: readonly {
    readonly locationId: string;
    readonly code: string;
    readonly reasons: readonly string[];
  }[];
  readonly defaultLocation: { readonly id: string; readonly code: string } | null;
}

interface LpType {
  readonly id: string;
  readonly code: string;
  readonly description: string | null;
}

const LP_MODES = [
  { value: 'none' as const, label: 'No LP' },
  { value: 'existing' as const, label: 'Scan LP' },
  { value: 'new' as const, label: 'New LP' },
];

/**
 * Lines report while their putaway suggestion is still loading; Receive stays disabled until
 * every included line has resolved, so the posted location never depends on click timing.
 */
const SuggestPendingCtx = React.createContext<(lineId: string, pending: boolean) => void>(() => undefined);

function SuggestionHint({
  po,
  line,
  index,
  form,
}: {
  readonly po: PoDetail;
  readonly line: PoLineRow;
  readonly index: number;
  readonly form: UseFormReturn<ReceiveForm>;
}) {
  const qtyLive = useWatch({ control: form.control, name: `lines.${index}.quantity` });
  // Debounced, and only valid quantities: typing "-3" or clearing the field doesn't refetch.
  const [qty, setQty] = React.useState(() =>
    qtyLive && Number.isInteger(qtyLive) && qtyLive >= 1 ? qtyLive : 1,
  );
  React.useEffect(() => {
    if (!qtyLive || !Number.isInteger(qtyLive) || qtyLive < 1) return;
    const t = setTimeout(() => setQty(qtyLive), 400);
    return () => clearTimeout(t);
  }, [qtyLive]);
  const lot = useWatch({ control: form.control, name: `lines.${index}.lotNumber` });
  const expiry = useWatch({ control: form.control, name: `lines.${index}.expiryDate` });
  const damage = useWatch({ control: form.control, name: `lines.${index}.damageReason` });
  const locationId = useWatch({ control: form.control, name: `lines.${index}.locationId` });
  const q = useApiQuery<Suggestion>(
    ['po-suggest', po.id, line.id, qty, lot ?? '', expiry ?? '', damage ?? ''],
    `/api/purchase-orders/${po.id}/suggest`,
    {
      query: {
        lineId: line.id,
        qty: Math.max(1, qty),
        ...(lot ? { lot } : {}),
        ...(expiry ? { expiry } : {}),
        ...(damage ? { damageReason: damage } : {}),
      },
      staleTime: 30_000,
      retry: false,
      placeholderData: keepPreviousData,
    },
  );
  const data = q.data?.data;
  const top = data?.suggestions[0];
  const reportPending = React.useContext(SuggestPendingCtx);
  const waiting = q.isPending && !q.isError;
  React.useEffect(() => {
    reportPending(line.id, waiting);
    return () => reportPending(line.id, false);
  }, [reportPending, line.id, waiting]);
  const applied = React.useRef(false);
  React.useEffect(() => {
    // Placeholder data belongs to the previous inputs: wait for the answer to the current ones.
    if (!data || q.isPlaceholderData) return;
    const current = form.getValues(`lines.${index}.locationId`);
    const basis = {
      qty: Math.max(1, qty),
      lot: lot ?? null,
      expiry: expiry ?? null,
      damageReason: damage ?? null,
    };
    const top = data.suggestions[0];
    form.setValue(
      `lines.${index}.suggestedIds`,
      data.suggestions.map((s) => s.locationId),
    );
    if (applied.current) {
      // A later suggestion (lot, expiry, quantity or damage changed): while the location is
      // still the auto-applied suggestion, follow the new top pick so the posted location and
      // the recorded putaway algorithm always agree. A manual pick is never overridden.
      if (!form.getValues(`lines.${index}.fromSuggestion`)) return;
      if (top && !data.suggestions.some((s) => s.locationId === current)) {
        form.setValue(`lines.${index}.locationId`, top.locationId, { shouldValidate: true });
        form.setValue(`lines.${index}.locationCode`, top.code);
      }
      form.setValue(`lines.${index}.suggestBasis`, basis);
      return;
    }
    // The line starts on the warehouse default receiving location (prefilled at once); swap in
    // the suggestion when it arrives, unless the user already picked a location.
    const prefilledDefault =
      !line.receivingLocationId &&
      current === po.defaultReceivingLocation?.id &&
      !form.getFieldState(`lines.${index}.locationId`).isDirty;
    if (current && !prefilledDefault) {
      // A preset or hand-picked location still counts as directed when the algorithm suggests it.
      const directed = data.suggestions.some((s) => s.locationId === current);
      form.setValue(`lines.${index}.fromSuggestion`, directed);
      if (directed) form.setValue(`lines.${index}.suggestBasis`, basis);
      return;
    }
    applied.current = true;
    const pick =
      top ??
      (data.defaultLocation
        ? { locationId: data.defaultLocation.id, code: data.defaultLocation.code }
        : null);
    if (pick && pick.locationId !== current) {
      form.setValue(`lines.${index}.locationId`, pick.locationId, { shouldValidate: true });
      form.setValue(`lines.${index}.locationCode`, pick.code);
    }
    // Remember that the location is the suggestion and what it was computed with: the server
    // re-runs the algorithm and records it / its rule on the Receiving ledger row.
    form.setValue(
      `lines.${index}.fromSuggestion`,
      Boolean(top) && (pick?.locationId ?? current) === top?.locationId,
    );
    form.setValue(`lines.${index}.suggestBasis`, basis);
  }, [
    data,
    q.isPlaceholderData,
    form,
    index,
    line.receivingLocationId,
    po.defaultReceivingLocation?.id,
    qty,
    lot,
    expiry,
    damage,
  ]);

  if (q.isPending) {
    return (
      <p className="flex items-center gap-1.5 text-2xs text-faint" aria-live="polite">
        <Spinner className="h-3 w-3" label="Finding a putaway location" />
        Checking putaway rules…
      </p>
    );
  }
  if (q.isError && !data)
    return <p className="text-2xs text-faint">No putaway suggestion available. Choose a location.</p>;
  if (!data) return null;
  const others = data.suggestions.filter((s) => s.locationId !== locationId).slice(0, 3);
  const reasons = top ? humanReasons(top.reasons, { damaged: Boolean(damage) }) : [];
  return (
    <div className="flex flex-col gap-1 text-2xs">
      {top ? (
        <p className="flex min-w-0 items-start gap-1 text-secondary">
          <Lightbulb className="mt-px h-3 w-3 shrink-0 text-warning" aria-hidden />
          <span>
            Suggested <span className="font-semibold text-foreground">{top.code}</span>
            <span className="text-faint"> · {putawayAlgorithmLabel(data.algorithm)}</span>
            {reasons.length ? (
              <span
                className="block truncate"
                title={[...reasons, ...(data.rule ? [`Rule: ${data.rule}`] : [])].join(' · ')}
              >
                {shortReason(reasons)}
              </span>
            ) : null}
          </span>
        </p>
      ) : (
        <p className="text-faint">
          No putaway rule matched
          {data.defaultLocation
            ? `; using the default receiving location ${data.defaultLocation.code}.`
            : '.'}
        </p>
      )}
      {others.length > 0 || (data.defaultLocation && data.defaultLocation.id !== locationId) ? (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-faint">Use:</span>
          {[
            ...others.map((s) => ({ id: s.locationId, code: s.code })),
            ...(data.defaultLocation &&
            data.defaultLocation.id !== locationId &&
            !others.some((o) => o.locationId === data.defaultLocation?.id)
              ? [data.defaultLocation]
              : []),
          ].map((s) => (
            <button
              key={s.id}
              type="button"
              className="rounded-full border border-border px-2 py-px font-medium text-primary hover:bg-primary-soft"
              onClick={() => {
                form.setValue(`lines.${index}.locationId`, s.id, { shouldValidate: true, shouldDirty: true });
                form.setValue(`lines.${index}.locationCode`, s.code);
                form.setValue(
                  `lines.${index}.fromSuggestion`,
                  data.suggestions.some((x) => x.locationId === s.id),
                );
              }}
            >
              {s.code}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PhotoField({
  form,
  index,
  poId,
}: {
  readonly form: UseFormReturn<ReceiveForm>;
  readonly index: number;
  readonly poId: string;
}) {
  const name = useWatch({ control: form.control, name: `lines.${index}.damageImageName` });
  const [busy, setBusy] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const id = await uploadFile(file, 'attachment', { entityType: 'purchase_order', entityId: poId });
      form.setValue(`lines.${index}.damageImageFileId`, id, { shouldDirty: true });
      form.setValue(`lines.${index}.damageImageName`, file.name);
    } catch (error) {
      toast.error('Upload failed', errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-body">Damage photo</span>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      {name ? (
        <span className="flex h-9 items-center gap-2 rounded-md border border-border px-2.5 text-xs">
          <Camera className="h-3.5 w-3.5 text-faint" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{name}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Remove photo"
            onClick={() => {
              form.setValue(`lines.${index}.damageImageFileId`, null);
              form.setValue(`lines.${index}.damageImageName`, null);
            }}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </span>
      ) : (
        <Button variant="secondary" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? (
            <Spinner className="h-3.5 w-3.5" label="Uploading" />
          ) : (
            <Camera className="h-3.5 w-3.5" aria-hidden />
          )}
          Add photo
        </Button>
      )}
    </div>
  );
}

/** Expiry date with an inline warning as soon as the picked day is in the past. */
function ExpiryField({
  form,
  index,
  name,
}: {
  readonly form: UseFormReturn<ReceiveForm>;
  readonly index: number;
  readonly name: string;
}) {
  const expiry = useWatch({ control: form.control, name: `lines.${index}.expiryDate` });
  const hasError = Boolean(form.formState.errors.lines?.[index]?.expiryDate);
  return (
    <div className="flex flex-col gap-1">
      <DateF name={name} label="Expiry date" required liveValidate />
      {isExpired(expiry, todayIn()) && !hasError ? (
        <p className="flex items-center gap-1 text-2xs font-medium text-warning" role="status">
          <AlertTriangle className="h-3 w-3" aria-hidden />
          {EXPIRED_LOT_MESSAGE}
        </p>
      ) : null}
    </div>
  );
}

function LineCard({
  po,
  line,
  index,
  form,
  lpTypes,
}: {
  readonly po: PoDetail;
  readonly line: PoLineRow;
  readonly index: number;
  readonly form: UseFormReturn<ReceiveForm>;
  readonly lpTypes: readonly LpType[];
}) {
  const include = useWatch({ control: form.control, name: `lines.${index}.include` });
  const qtyRaw = useWatch({ control: form.control, name: `lines.${index}.quantity` });
  const qty = qtyRaw ?? 0;
  const lpMode = useWatch({ control: form.control, name: `lines.${index}.lpMode` });
  const damage = useWatch({ control: form.control, name: `lines.${index}.damageReason` });
  const locCode = useWatch({ control: form.control, name: `lines.${index}.locationCode` });
  const lpLabel = useWatch({ control: form.control, name: `lines.${index}.lpLabel` });
  const remaining = Math.max(0, line.orderedQuantity - line.receivedQuantity);
  const t = line.tracking;
  const p = (f: string) => `lines.${index}.${f}`;
  const over = qty > remaining;
  const qtyInvalid =
    include && (qtyRaw === null || qtyRaw === undefined || !Number.isInteger(qty) || qty < 1);
  // Live quantity check (don't wait for submit): -3, 0 or 1.5 shows the error immediately.
  React.useEffect(() => {
    const path = `lines.${index}.quantity` as const;
    const current = form.getFieldState(path).error;
    if (qtyInvalid) form.setError(path, { type: 'live', message: 'Enter a quantity of at least 1' });
    else if (current?.type === 'live') form.clearErrors(path);
  }, [qtyInvalid, index, form]);
  const needSerials = qty * line.uomQuantity;

  return (
    <section
      className={`rounded-lg border ${include ? 'border-border-strong bg-surface shadow-xs' : 'border-border bg-surface-sunken/40'} p-3`}
      aria-label={`Receive ${line.sku}`}
    >
      <div className="flex items-center gap-3">
        <Checkbox
          checked={include}
          onCheckedChange={(v) =>
            form.setValue(`lines.${index}.include`, Boolean(v), {
              shouldDirty: true,
              shouldValidate: form.formState.isSubmitted,
            })
          }
          aria-label={`Receive ${line.sku}`}
        />
        <ProductThumb url={line.imageUrl} label={line.sku} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {line.sku} <span className="font-normal text-secondary">· {line.productName}</span>
          </p>
          <p className="text-2xs text-faint">
            Ordered {line.orderedQuantity.toLocaleString()} · Received{' '}
            {line.receivedQuantity.toLocaleString()} ·{' '}
            <span className={remaining > 0 ? 'font-semibold text-foreground' : 'text-success'}>
              {remaining.toLocaleString()} remaining
            </span>{' '}
            · {line.packType}
          </p>
        </div>
        <div className="flex gap-1">
          {t.lot ? <Badge tone="info">Lot</Badge> : null}
          {t.expiry ? <Badge tone="info">Expiry</Badge> : null}
          {t.production ? <Badge tone="info">Prod. date</Badge> : null}
          {t.serial ? <Badge tone="info">Serial</Badge> : null}
          {over && include ? <Badge tone="success">+{(qty - remaining).toLocaleString()} over</Badge> : null}
        </div>
      </div>
      {include ? (
        <div className="mt-3 border-t border-border pt-3">
          <FormGrid columns={3}>
            <NumF
              name={p('quantity')}
              label={`Quantity (${line.packType})`}
              required
              min={1}
              max={MAX_LINE_QTY}
            />
            <FormField name={p('locationId')} label="Receiving location" required className="md:col-span-2">
              {(c) => (
                <div className="flex flex-col gap-1">
                  <LocationPicker
                    id={c.id}
                    warehouseId={po.warehouseId}
                    value={(c.value as string | null) ?? null}
                    selectedLabel={locCode ?? undefined}
                    onChange={(v, item) => {
                      c.onChange(v);
                      form.setValue(`lines.${index}.locationCode`, item ? String(item.label) : null);
                      // Picking a suggested location by hand still follows the putaway algorithm.
                      form.setValue(
                        `lines.${index}.fromSuggestion`,
                        Boolean(v && form.getValues(`lines.${index}.suggestedIds`).includes(v)),
                      );
                    }}
                    onBlur={c.onBlur}
                    invalid={c.invalid}
                    placeholder="Scan or search location"
                  />
                  <SuggestionHint po={po} line={line} index={index} form={form} />
                </div>
              )}
            </FormField>
            <div className="flex flex-col gap-1 md:col-span-3">
              <span className="text-xs font-medium text-body">License plate</span>
              <SegmentedControl
                options={LP_MODES}
                value={lpMode}
                onChange={(v) => form.setValue(`lines.${index}.lpMode`, v, { shouldDirty: true })}
                size="sm"
                ariaLabel={`LP for ${line.sku}`}
              />
            </div>
            {lpMode === 'existing' ? (
              <FormField name={p('lpId')} label="LP number" required className="md:col-span-2">
                {(c) => (
                  <LpPicker
                    id={c.id}
                    warehouseId={po.warehouseId}
                    value={(c.value as string | null) ?? null}
                    selectedLabel={lpLabel ?? undefined}
                    onChange={(v, item) => {
                      c.onChange(v);
                      form.setValue(`lines.${index}.lpLabel`, item ? String(item.label) : null);
                    }}
                    onBlur={c.onBlur}
                    invalid={c.invalid}
                  />
                )}
              </FormField>
            ) : null}
            {lpMode === 'new' ? (
              <SelectF
                name={p('lpTypeId')}
                label="LP type"
                required
                options={lpTypes.map((x) => ({
                  value: x.id,
                  label: x.code,
                  description: x.description ?? undefined,
                }))}
                placeholder={lpTypes.length ? 'Select LP type' : 'No LP types in this warehouse'}
                description="A new LP number is assigned automatically."
                className="md:col-span-2"
              />
            ) : null}
            {t.lot ? <TextF name={p('lotNumber')} label="Lot batch number" required maxLength={100} /> : null}
            {t.expiry ? <ExpiryField form={form} index={index} name={p('expiryDate')} /> : null}
            {t.production ? (
              <DateF name={p('productionDate')} label="Production date" required liveValidate />
            ) : null}
            <SelectF
              name={p('damageReason')}
              label="Damage reason"
              options={optionsOf(DAMAGE_REASONS)}
              clearable
              placeholder="Not damaged"
            />
            {damage ? <PhotoField form={form} index={index} poId={po.id} /> : null}
            {t.serial ? (
              <FormField
                name={p('serials')}
                label={`Serial numbers (${needSerials} required)`}
                required
                className="md:col-span-3"
                description={
                  line.preAdvisedSerials?.length
                    ? `${line.preAdvisedSerials.filter((x) => !x.received).length} pre-advised serial(s) not received yet; prefilled in import order.`
                    : undefined
                }
              >
                {(c) => (
                  <ChipInput
                    id={c.id}
                    value={(c.value as string[]) ?? []}
                    onChange={(v) => c.onChange([...v])}
                    onBlur={c.onBlur}
                    invalid={c.invalid}
                    aria-describedby={c['aria-describedby']}
                    placeholder="Scan or paste serials, separated by Enter or commas"
                    maxItems={needSerials || undefined}
                    maxLength={100}
                    caseInsensitive
                  />
                )}
              </FormField>
            ) : null}
            <TextF name={p('note')} label="Note" maxLength={500} className="md:col-span-3" />
          </FormGrid>
        </div>
      ) : null}
    </section>
  );
}

const FIELD_SELECTOR =
  'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([disabled]), select:not([disabled]), textarea:not([disabled])';

/**
 * Scanner-safe Enter: in a receiving form a scanner sends Enter after every scan, so Enter
 * in a field moves to the next field instead of posting receipts. Receive only posts from
 * the footer button. Controls that use Enter themselves (serial chips, pickers) call
 * preventDefault first and are left alone.
 */
export function advanceOnEnter(event: React.KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Enter' || event.defaultPrevented || event.nativeEvent.isComposing) return;
  const target = event.target as HTMLElement;
  if (!(target instanceof HTMLInputElement) || target.type === 'checkbox' || target.type === 'radio') return;
  event.preventDefault();
  const root = event.currentTarget.closest('form') ?? event.currentTarget;
  const fields = [...root.querySelectorAll<HTMLElement>(FIELD_SELECTOR)].filter(
    (el) => el.offsetParent !== null || el === target,
  );
  const next = fields[fields.indexOf(target) + 1];
  next?.focus();
}

function defaultsFor(po: PoDetail, onlyLineId?: string | null): ReceiveForm {
  return {
    allowOverReceipt: false,
    allowExpired: false,
    lines: po.lines.map((l): LineValues => {
      const remaining = Math.max(0, l.orderedQuantity - l.receivedQuantity);
      // Serial-tracked lines start with their pre-advised serials that are not received yet.
      const advised = l.tracking.serial
        ? (l.preAdvisedSerials ?? [])
            .filter((x) => !x.received)
            .map((x) => x.serial)
            .slice(0, (remaining > 0 ? remaining : 1) * l.uomQuantity)
        : [];
      return {
        include: onlyLineId ? l.id === onlyLineId : remaining > 0,
        lineId: l.id,
        quantity: remaining > 0 ? remaining : 1,
        // Prefill at once: the line's own location, else the warehouse default receiving location
        // (the putaway suggestion replaces the default when it arrives).
        locationId: l.receivingLocationId ?? po.defaultReceivingLocation?.id ?? null,
        locationCode: l.receivingLocationCode ?? po.defaultReceivingLocation?.code ?? null,
        lpMode: 'none',
        lpId: null,
        lpLabel: null,
        lpTypeId: l.lpTypeId,
        lotNumber: l.lotNumber,
        expiryDate: l.expiryDate,
        productionDate: l.productionDate,
        damageReason: null,
        damageImageFileId: null,
        damageImageName: null,
        serials: advised,
        note: null,
        fromSuggestion: false,
        suggestBasis: null,
        suggestedIds: [],
      };
    }),
  };
}

export interface ReceiveSummary {
  readonly lines: number;
  readonly units: number;
  /** What still needs an explicit confirm (over-receipt / expired lot), else null. */
  readonly needsConfirm: string | null;
}

function ReceiveItemsForm({
  po,
  formId,
  onDone,
  onDirty,
  onBusy,
  onBlocked,
  onSummary,
  onlyLineId,
}: {
  readonly po: PoDetail;
  readonly formId: string;
  readonly onDone: () => void;
  readonly onDirty: (d: boolean) => void;
  readonly onBusy: (b: boolean) => void;
  readonly onBlocked: (reason: string | null) => void;
  readonly onSummary: (s: ReceiveSummary) => void;
  readonly onlyLineId?: string | null;
}) {
  const schema = React.useMemo(() => receiveFormSchema(po.lines), [po.lines]);
  const form = useZodForm(schema, defaultsFor(po, onlyLineId));
  const { fields } = useFieldArray({ control: form.control, name: 'lines' });
  const invalidate = useInvalidateReceiving();
  const lpTypes = useApiQuery<LpType[]>(['po-lp-types', po.warehouseId], '/api/purchase-orders/lp-types', {
    query: { warehouseId: po.warehouseId },
  });
  const values = useWatch({ control: form.control });
  const dirty = form.formState.isDirty;
  React.useEffect(() => onDirty(dirty), [dirty, onDirty]);
  const byId = new Map(po.lines.map((l) => [l.id, l]));
  const overLines = (values.lines ?? []).filter(
    (l) =>
      l.include &&
      (l.quantity ?? 0) >
        Math.max(
          0,
          (byId.get(l.lineId ?? '')?.orderedQuantity ?? 0) -
            (byId.get(l.lineId ?? '')?.receivedQuantity ?? 0),
        ),
  );
  const included = (values.lines ?? []).filter((l) => l.include);
  const totalUnits = included.reduce((s, l) => s + Math.max(0, l.quantity ?? 0), 0);
  const today = todayIn();
  const expiredLines = included.filter(
    (l) => byId.get(l.lineId ?? '')?.tracking.expiry && isExpired(l.expiryDate, today),
  );
  const needsConfirm =
    overLines.length > 0 && !values.allowOverReceipt
      ? 'Confirm the over-receipt'
      : expiredLines.length > 0 && !values.allowExpired
        ? 'Confirm the expired lot'
        : null;
  React.useEffect(
    () => onSummary({ lines: included.length, units: totalUnits, needsConfirm }),
    [included.length, totalUnits, needsConfirm, onSummary],
  );
  const [pendingLines, setPendingLines] = React.useState<ReadonlySet<string>>(() => new Set());
  const reportPending = React.useCallback((lineId: string, pending: boolean) => {
    setPendingLines((prev) => {
      if (prev.has(lineId) === pending) return prev;
      const next = new Set(prev);
      if (pending) next.add(lineId);
      else next.delete(lineId);
      return next;
    });
  }, []);
  // One gate for every required field (quantity, location, LP, lot, expiry, serials, confirms):
  // Receive is disabled with the first reason, shown in the footer, never validated only on click.
  const blocked =
    receiveBlockedReason(po.lines, values) ??
    (pendingLines.size > 0 ? 'Finding the putaway location…' : null);
  React.useEffect(() => onBlocked(blocked), [blocked, onBlocked]);
  const rootError = form.formState.errors.lines?.message ?? form.formState.errors.lines?.root?.message;

  const submit = async (v: ReceiveForm) => {
    const sent = v.lines.map((l, i) => ({ l, i })).filter(({ l }) => l.include);
    onBusy(true);
    try {
      const { data } = await apiRequest<{ status: string; receivedUnits: number; receiptIds: string[] }>(
        `/api/purchase-orders/${po.id}/receive`,
        {
          method: 'POST',
          body: {
            version: po.version,
            allowOverReceipt: v.allowOverReceipt,
            allowExpired: v.allowExpired,
            lines: sent.map(({ l }) => ({
              lineId: l.lineId,
              quantity: l.quantity,
              locationId: l.locationId,
              lpMode: l.lpMode,
              lpId: l.lpMode === 'existing' ? l.lpId : null,
              lpTypeId: l.lpMode === 'new' ? l.lpTypeId : null,
              lotNumber: l.lotNumber,
              expiryDate: l.expiryDate,
              productionDate: l.productionDate,
              damageReason: l.damageReason,
              damageImageFileId: l.damageReason ? l.damageImageFileId : null,
              serials: l.serials,
              note: l.note,
              fromSuggestion: l.fromSuggestion,
              suggestBasis: l.suggestBasis,
            })),
          },
        },
      );
      toast.success(
        'Success',
        `You have successfully received orders. ${data.receiptIds.length} receipt${data.receiptIds.length === 1 ? '' : 's'} posted; ${po.code} is ${data.status}.`,
      );
      form.reset(v);
      await invalidate();
      onDone();
    } catch (error) {
      if (isApiError(error)) {
        let first = true;
        for (const [path, messages] of Object.entries(error.fieldErrors)) {
          const m = /^lines\.(\d+)\.(.+)$/.exec(path);
          const target = m ? sent[Number(m[1])] : undefined;
          if (!m || !target || !messages[0]) continue;
          form.setError(
            `lines.${target.i}.${m[2]}` as `lines.${number}.quantity`,
            { type: 'server', message: messages[0] },
            { shouldFocus: first },
          );
          first = false;
        }
      }
      toast.error('Error', errorMessage(error));
    } finally {
      onBusy(false);
    }
  };

  return (
    <SuggestPendingCtx.Provider value={reportPending}>
      <Form form={form} id={formId} onSubmit={submit} className="gap-3">
        <div className="contents" onKeyDown={advanceOnEnter}>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-secondary">
              Receiving into <span className="font-semibold text-foreground">{po.warehouseName}</span>
            </span>
            <span className="flex-1" />
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                fields.forEach((f, i) => {
                  const l = byId.get(f.lineId);
                  if (l && l.orderedQuantity > l.receivedQuantity)
                    form.setValue(`lines.${i}.include`, true, { shouldDirty: true });
                })
              }
            >
              Select all open
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                fields.forEach((_, i) => form.setValue(`lines.${i}.include`, false, { shouldDirty: true }))
              }
            >
              Clear
            </Button>
          </div>
          {fields.map((f, i) => {
            const line = byId.get(f.lineId);
            return line ? (
              <LineCard
                key={f.id}
                po={po}
                line={line}
                index={i}
                form={form}
                lpTypes={lpTypes.data?.data ?? []}
              />
            ) : null;
          })}
          {rootError ? (
            <p role="alert" className="text-xs font-medium text-danger">
              {rootError}
            </p>
          ) : null}
          {overLines.length > 0 ? (
            <Callout variant="attention" title="Over-receipt">
              <div className="flex flex-col gap-2">
                <span>
                  {overLines.length} line{overLines.length === 1 ? ' exceeds' : 's exceed'} the ordered
                  quantity. Over-received units show as a positive difference on the PO receiving report.
                </span>
                <FormField name="allowOverReceipt" inline>
                  {(c) => (
                    <Checkbox
                      id={c.id}
                      checked={Boolean(c.value)}
                      onCheckedChange={(v) => {
                        c.onChange(Boolean(v));
                        void form.trigger('lines');
                      }}
                      label="I confirm receiving more than ordered"
                    />
                  )}
                </FormField>
              </div>
            </Callout>
          ) : null}
          {expiredLines.length > 0 ? (
            <Callout variant="attention" title="Expired lot">
              <div className="flex flex-col gap-2">
                <span>
                  {expiredLines.length} line{expiredLines.length === 1 ? ' has' : 's have'} an expiry date in
                  the past. Expired stock should go to a quarantine or damage location, not a sellable one.
                </span>
                <FormField name="allowExpired" inline>
                  {(c) => (
                    <Checkbox
                      id={c.id}
                      checked={Boolean(c.value)}
                      onCheckedChange={(v) => {
                        c.onChange(Boolean(v));
                        void form.trigger('lines');
                      }}
                      label="I confirm receiving expired stock"
                    />
                  )}
                </FormField>
              </div>
            </Callout>
          ) : null}
        </div>
      </Form>
    </SuggestPendingCtx.Provider>
  );
}

export function ReceiveItemsDrawer({
  po,
  open,
  onOpenChange,
  onlyLineId,
}: {
  readonly po: PoDetail;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onlyLineId?: string | null;
}) {
  const formId = React.useId();
  const [dirty, setDirty] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [blocked, setBlocked] = React.useState<string | null>(null);
  const [summary, setSummary] = React.useState<ReceiveSummary | null>(null);
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) setDirty(false);
        onOpenChange(next);
      }}
      dirty={dirty && !busy}
      width={60}
      title={
        <span className="flex items-center gap-2">
          <PackageCheck className="h-4 w-4 text-primary" aria-hidden />
          Receive items · {po.code}
        </span>
      }
      description="Quantities default to what is still open. Tracked attributes are required per product."
      footer={
        <>
          {/* Selection summary lives in the footer (never over the last line card's fields). */}
          {summary ? (
            <span
              className="mr-auto flex min-w-0 flex-1 flex-col gap-0.5 text-xs text-secondary"
              aria-live="polite"
            >
              <span className="flex items-center gap-2 whitespace-nowrap">
                <PackageCheck className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                {summary.lines} line{summary.lines === 1 ? '' : 's'} · {summary.units.toLocaleString()} units
                selected
              </span>
              {/* The reason Receive is disabled is always visible in full (wraps, never truncates). */}
              {!busy && (blocked ?? summary.needsConfirm) ? (
                <span
                  className="flex min-w-0 items-start gap-1 text-warning"
                  data-testid="receive-blocked-reason"
                >
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="min-w-0 break-words">{blocked ?? summary.needsConfirm}</span>
                </span>
              ) : null}
            </span>
          ) : null}
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <DisabledReason reason={busy ? null : blocked}>
            <Button
              type="submit"
              form={formId}
              variant="primary"
              disabled={busy || Boolean(blocked)}
              aria-busy={busy}
            >
              {busy ? (
                <Spinner className="h-3.5 w-3.5" label="Receiving" />
              ) : (
                <PackageCheck className="h-3.5 w-3.5" aria-hidden />
              )}
              Receive
            </Button>
          </DisabledReason>
        </>
      }
    >
      {open ? (
        <ReceiveItemsForm
          key={`${po.id}:${po.version}:${onlyLineId ?? ''}`}
          po={po}
          formId={formId}
          onlyLineId={onlyLineId}
          onDirty={setDirty}
          onBusy={setBusy}
          onBlocked={setBlocked}
          onSummary={setSummary}
          onDone={() => {
            setDirty(false);
            onOpenChange(false);
          }}
        />
      ) : null}
    </Drawer>
  );
}
