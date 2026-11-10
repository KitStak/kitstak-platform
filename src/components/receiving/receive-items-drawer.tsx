"use client";

/**
 * Receive items (partial web receive; KitStaks addition — Logiwa has none). Per line:
 * quantity (defaults to remaining), receiving location with a putaway suggestion and its
 * reason, LP (none / scan existing / create new from an LP type), lot / expiry / production
 * date per the product's tracking, damage reason + photo, serials (count = qty) and a note.
 * Over-receipt needs an explicit confirmation. Posts to `/api/purchase-orders/[id]/receive`.
 */
import * as React from "react";
import { useFieldArray, useWatch, type UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { AlertTriangle, Camera, Lightbulb, PackageCheck, X } from "lucide-react";
import { LocationPicker, LpPicker } from "@/components/shared/entity-pickers";
import { uploadFile } from "@/components/shared/upload-file";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { ChipInput } from "@/components/ui/chip-input";
import { Drawer } from "@/components/ui/drawer";
import { Form, FormField, FormGrid, useZodForm } from "@/components/ui/form";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { apiRequest, isApiError } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { DAMAGE_REASONS } from "@/lib/grid-defs/receiving/receiving-history";
import { MAX_LINE_QTY, trackingIssues } from "@/lib/grid-defs/receiving/po-schemas";
import { DateF, NumF, optionsOf, SelectF, TextF } from "./fields";
import { errorMessage, ProductThumb, useInvalidateReceiving, type PoDetail, type PoLineRow } from "./receiving-shared";

const lineSchema = z.object({
  include: z.boolean(),
  lineId: z.string(),
  quantity: z.number().nullable(),
  locationId: z.string().nullable(),
  locationCode: z.string().nullable(),
  lpMode: z.enum(["none", "existing", "new"]),
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
  note: z.string().max(500, "Use at most 500 characters").nullable(),
});
type LineValues = z.infer<typeof lineSchema>;

/** Builds the zod schema with the PO's lines so tracking and remaining checks run client-side too. */
export function receiveFormSchema(lines: readonly PoLineRow[]) {
  const byId = new Map(lines.map((l) => [l.id, l]));
  return z.object({ allowOverReceipt: z.boolean(), lines: z.array(lineSchema) }).superRefine((v, ctx) => {
    if (!v.lines.some((l) => l.include)) ctx.addIssue({ code: "custom", path: ["lines"], message: "Select at least one line to receive." });
    v.lines.forEach((l, i) => {
      if (!l.include) return;
      const row = byId.get(l.lineId);
      if (!row) return;
      const at = (field: string, message: string) => ctx.addIssue({ code: "custom", path: ["lines", i, field], message });
      if (l.quantity === null || !Number.isInteger(l.quantity) || l.quantity < 1) at("quantity", "Enter a quantity of at least 1");
      if (!l.locationId) at("locationId", "Choose a receiving location");
      if (l.lpMode === "existing" && !l.lpId) at("lpId", "Scan or choose an LP");
      if (l.lpMode === "new" && !l.lpTypeId) at("lpTypeId", "Choose an LP type");
      const remaining = Math.max(0, row.orderedQuantity - row.receivedQuantity);
      if ((l.quantity ?? 0) > remaining && !v.allowOverReceipt) at("quantity", `Only ${remaining} remaining. Confirm the over-receipt below to receive more.`);
      const issues = trackingIssues({ ...l, quantity: l.quantity ?? 0, uomRatio: row.uomQuantity }, row.tracking, row.sku);
      for (const [field, message] of Object.entries(issues)) at(field, message);
    });
  });
}
type ReceiveForm = z.infer<ReturnType<typeof receiveFormSchema>>;

interface Suggestion {
  readonly algorithm: string;
  readonly rule: string | null;
  readonly suggestions: readonly { readonly locationId: string; readonly code: string; readonly reasons: readonly string[] }[];
  readonly defaultLocation: { readonly id: string; readonly code: string } | null;
}

interface LpType {
  readonly id: string;
  readonly code: string;
  readonly description: string | null;
}

const LP_MODES = [{ value: "none" as const, label: "No LP" }, { value: "existing" as const, label: "Scan LP" }, { value: "new" as const, label: "New LP" }];

function SuggestionHint({ po, line, index, form }: { readonly po: PoDetail; readonly line: PoLineRow; readonly index: number; readonly form: UseFormReturn<ReceiveForm> }) {
  const qty = useWatch({ control: form.control, name: `lines.${index}.quantity` }) ?? 1;
  const lot = useWatch({ control: form.control, name: `lines.${index}.lotNumber` });
  const expiry = useWatch({ control: form.control, name: `lines.${index}.expiryDate` });
  const damage = useWatch({ control: form.control, name: `lines.${index}.damageReason` });
  const locationId = useWatch({ control: form.control, name: `lines.${index}.locationId` });
  const q = useApiQuery<Suggestion>(["po-suggest", po.id, line.id, qty, lot ?? "", expiry ?? "", damage ?? ""], `/api/purchase-orders/${po.id}/suggest`, {
    query: { lineId: line.id, qty: Math.max(1, qty), ...(lot ? { lot } : {}), ...(expiry ? { expiry } : {}), ...(damage ? { damageReason: damage } : {}) },
    staleTime: 30_000,
    retry: false,
  });
  const data = q.data?.data;
  const top = data?.suggestions[0];
  const applied = React.useRef(false);
  React.useEffect(() => {
    if (applied.current || !data || form.getValues(`lines.${index}.locationId`)) return;
    applied.current = true;
    const pick = data.suggestions[0] ?? (data.defaultLocation ? { locationId: data.defaultLocation.id, code: data.defaultLocation.code } : null);
    if (pick) {
      form.setValue(`lines.${index}.locationId`, pick.locationId, { shouldValidate: true });
      form.setValue(`lines.${index}.locationCode`, pick.code);
    }
  }, [data, form, index]);

  if (q.isPending) return <p className="text-[11px] text-faint">Finding a putaway location…</p>;
  if (!data) return null;
  const others = data.suggestions.filter((s) => s.locationId !== locationId).slice(0, 3);
  return (
    <div className="flex flex-col gap-1 text-[11px]">
      {top ? (
        <p className="flex items-start gap-1 text-secondary">
          <Lightbulb className="mt-px h-3 w-3 shrink-0 text-warning" aria-hidden />
          <span>
            Suggested <span className="font-semibold text-foreground">{top.code}</span>
            {top.reasons.length ? ` — ${top.reasons.join(" · ")}` : ""}
            <span className="text-faint"> ({data.algorithm}{data.rule ? ` · ${data.rule}` : ""})</span>
          </span>
        </p>
      ) : (
        <p className="text-faint">No putaway rule matched{data.defaultLocation ? `; using the default receiving location ${data.defaultLocation.code}.` : "."}</p>
      )}
      {others.length > 0 || (data.defaultLocation && data.defaultLocation.id !== locationId) ? (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-faint">Use:</span>
          {[...others.map((s) => ({ id: s.locationId, code: s.code })), ...(data.defaultLocation && data.defaultLocation.id !== locationId && !others.some((o) => o.locationId === data.defaultLocation?.id) ? [data.defaultLocation] : [])].map((s) => (
            <button key={s.id} type="button" className="rounded-full border border-border px-2 py-px font-medium text-primary hover:bg-primary-soft" onClick={() => {
              form.setValue(`lines.${index}.locationId`, s.id, { shouldValidate: true, shouldDirty: true });
              form.setValue(`lines.${index}.locationCode`, s.code);
            }}>{s.code}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PhotoField({ form, index, poId }: { readonly form: UseFormReturn<ReceiveForm>; readonly index: number; readonly poId: string }) {
  const name = useWatch({ control: form.control, name: `lines.${index}.damageImageName` });
  const [busy, setBusy] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const id = await uploadFile(file, "attachment", { entityType: "purchase_order", entityId: poId });
      form.setValue(`lines.${index}.damageImageFileId`, id, { shouldDirty: true });
      form.setValue(`lines.${index}.damageImageName`, file.name);
    } catch (error) {
      toast.error("Upload failed", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] font-medium text-body">Damage photo</span>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void pick(e.target.files?.[0])} />
      {name ? (
        <span className="flex h-9 items-center gap-2 rounded-md border border-border px-2.5 text-[12px]">
          <Camera className="h-3.5 w-3.5 text-faint" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{name}</span>
          <Button variant="ghost" size="icon-sm" aria-label="Remove photo" onClick={() => { form.setValue(`lines.${index}.damageImageFileId`, null); form.setValue(`lines.${index}.damageImageName`, null); }}><X className="h-3.5 w-3.5" aria-hidden /></Button>
        </span>
      ) : (
        <Button variant="secondary" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? <Spinner className="h-3.5 w-3.5" label="Uploading" /> : <Camera className="h-3.5 w-3.5" aria-hidden />}
          Add photo
        </Button>
      )}
    </div>
  );
}

function LineCard({ po, line, index, form, lpTypes }: { readonly po: PoDetail; readonly line: PoLineRow; readonly index: number; readonly form: UseFormReturn<ReceiveForm>; readonly lpTypes: readonly LpType[] }) {
  const include = useWatch({ control: form.control, name: `lines.${index}.include` });
  const qty = useWatch({ control: form.control, name: `lines.${index}.quantity` }) ?? 0;
  const lpMode = useWatch({ control: form.control, name: `lines.${index}.lpMode` });
  const damage = useWatch({ control: form.control, name: `lines.${index}.damageReason` });
  const locCode = useWatch({ control: form.control, name: `lines.${index}.locationCode` });
  const lpLabel = useWatch({ control: form.control, name: `lines.${index}.lpLabel` });
  const remaining = Math.max(0, line.orderedQuantity - line.receivedQuantity);
  const t = line.tracking;
  const p = (f: string) => `lines.${index}.${f}`;
  const over = qty > remaining;
  const needSerials = qty * line.uomQuantity;

  return (
    <section className={`rounded-lg border ${include ? "border-primary/40 bg-surface shadow-xs" : "border-border bg-surface-sunken/40"} p-3`} aria-label={`Receive ${line.sku}`}>
      <div className="flex items-center gap-3">
        <Checkbox checked={include} onCheckedChange={(v) => form.setValue(`lines.${index}.include`, Boolean(v), { shouldDirty: true, shouldValidate: form.formState.isSubmitted })} aria-label={`Receive ${line.sku}`} />
        <ProductThumb url={line.imageUrl} label={line.sku} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-foreground">{line.sku} <span className="font-normal text-secondary">· {line.productName}</span></p>
          <p className="text-[11px] text-faint">
            Ordered {line.orderedQuantity.toLocaleString()} · Received {line.receivedQuantity.toLocaleString()} · <span className={remaining > 0 ? "font-semibold text-foreground" : "text-success"}>{remaining.toLocaleString()} remaining</span> · {line.packType}
          </p>
        </div>
        <div className="flex gap-1">
          {t.lot ? <Badge tone="info" size="sm">Lot</Badge> : null}
          {t.expiry ? <Badge tone="info" size="sm">Expiry</Badge> : null}
          {t.production ? <Badge tone="info" size="sm">Prod. date</Badge> : null}
          {t.serial ? <Badge tone="info" size="sm">Serial</Badge> : null}
          {over && include ? <Badge tone="success" size="sm">+{(qty - remaining).toLocaleString()} over</Badge> : null}
        </div>
      </div>
      {include ? (
        <div className="mt-3 border-t border-border pt-3">
          <FormGrid columns={3}>
            <NumF name={p("quantity")} label={`Quantity (${line.packType})`} required min={1} max={MAX_LINE_QTY} />
            <FormField name={p("locationId")} label="Receiving location" required className="md:col-span-2">
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
              <span className="text-[12px] font-medium text-body">License plate</span>
              <SegmentedControl options={LP_MODES} value={lpMode} onChange={(v) => form.setValue(`lines.${index}.lpMode`, v, { shouldDirty: true })} size="sm" ariaLabel={`LP for ${line.sku}`} />
            </div>
            {lpMode === "existing" ? (
              <FormField name={p("lpId")} label="LP number" required className="md:col-span-2">
                {(c) => <LpPicker id={c.id} warehouseId={po.warehouseId} value={(c.value as string | null) ?? null} selectedLabel={lpLabel ?? undefined} onChange={(v, item) => { c.onChange(v); form.setValue(`lines.${index}.lpLabel`, item ? String(item.label) : null); }} onBlur={c.onBlur} invalid={c.invalid} />}
              </FormField>
            ) : null}
            {lpMode === "new" ? (
              <SelectF name={p("lpTypeId")} label="LP type" required options={lpTypes.map((x) => ({ value: x.id, label: x.code, description: x.description ?? undefined }))} placeholder={lpTypes.length ? "Select LP type" : "No LP types in this warehouse"} description="A new LP number is assigned automatically." className="md:col-span-2" />
            ) : null}
            {t.lot ? <TextF name={p("lotNumber")} label="Lot batch number" required maxLength={100} /> : null}
            {t.expiry ? <DateF name={p("expiryDate")} label="Expiry date" required /> : null}
            {t.production ? <DateF name={p("productionDate")} label="Production date" required /> : null}
            <SelectF name={p("damageReason")} label="Damage reason" options={optionsOf(DAMAGE_REASONS)} clearable placeholder="Not damaged" />
            {damage ? <PhotoField form={form} index={index} poId={po.id} /> : null}
            {t.serial ? (
              <FormField name={p("serials")} label={`Serial numbers (${needSerials} required)`} required className="md:col-span-3">
                {(c) => <ChipInput id={c.id} value={(c.value as string[]) ?? []} onChange={(v) => c.onChange([...v])} onBlur={c.onBlur} invalid={c.invalid} aria-describedby={c["aria-describedby"]} placeholder="Scan or paste serials, separated by Enter or commas" maxItems={needSerials || undefined} maxLength={100} caseInsensitive />}
              </FormField>
            ) : null}
            <TextF name={p("note")} label="Note" maxLength={500} className="md:col-span-3" />
          </FormGrid>
        </div>
      ) : null}
    </section>
  );
}

function defaultsFor(po: PoDetail, onlyLineId?: string | null): ReceiveForm {
  return {
    allowOverReceipt: false,
    lines: po.lines.map((l): LineValues => {
      const remaining = Math.max(0, l.orderedQuantity - l.receivedQuantity);
      return {
        include: onlyLineId ? l.id === onlyLineId : remaining > 0, lineId: l.id, quantity: remaining > 0 ? remaining : 1,
        locationId: l.receivingLocationId, locationCode: l.receivingLocationCode, lpMode: "none", lpId: null, lpLabel: null, lpTypeId: l.lpTypeId,
        lotNumber: l.lotNumber, expiryDate: l.expiryDate, productionDate: l.productionDate, damageReason: null, damageImageFileId: null, damageImageName: null, serials: [], note: null,
      };
    }),
  };
}

function ReceiveItemsForm({ po, formId, onDone, onDirty, onBusy, onlyLineId }: { readonly po: PoDetail; readonly formId: string; readonly onDone: () => void; readonly onDirty: (d: boolean) => void; readonly onBusy: (b: boolean) => void; readonly onlyLineId?: string | null }) {
  const schema = React.useMemo(() => receiveFormSchema(po.lines), [po.lines]);
  const form = useZodForm(schema, defaultsFor(po, onlyLineId));
  const { fields } = useFieldArray({ control: form.control, name: "lines" });
  const invalidate = useInvalidateReceiving();
  const lpTypes = useApiQuery<LpType[]>(["po-lp-types", po.warehouseId], "/api/purchase-orders/lp-types", { query: { warehouseId: po.warehouseId } });
  const values = useWatch({ control: form.control });
  const dirty = form.formState.isDirty;
  React.useEffect(() => onDirty(dirty), [dirty, onDirty]);
  const byId = new Map(po.lines.map((l) => [l.id, l]));
  const overLines = (values.lines ?? []).filter((l) => l.include && (l.quantity ?? 0) > Math.max(0, (byId.get(l.lineId ?? "")?.orderedQuantity ?? 0) - (byId.get(l.lineId ?? "")?.receivedQuantity ?? 0)));
  const included = (values.lines ?? []).filter((l) => l.include);
  const totalUnits = included.reduce((s, l) => s + (l.quantity ?? 0), 0);
  const rootError = form.formState.errors.lines?.message ?? form.formState.errors.lines?.root?.message;

  const submit = async (v: ReceiveForm) => {
    const sent = v.lines.map((l, i) => ({ l, i })).filter(({ l }) => l.include);
    onBusy(true);
    try {
      const { data } = await apiRequest<{ status: string; receivedUnits: number; receiptIds: string[] }>(`/api/purchase-orders/${po.id}/receive`, {
        method: "POST",
        body: {
          version: po.version,
          allowOverReceipt: v.allowOverReceipt,
          lines: sent.map(({ l }) => ({
            lineId: l.lineId, quantity: l.quantity, locationId: l.locationId, lpMode: l.lpMode, lpId: l.lpMode === "existing" ? l.lpId : null,
            lpTypeId: l.lpMode === "new" ? l.lpTypeId : null, lotNumber: l.lotNumber, expiryDate: l.expiryDate, productionDate: l.productionDate,
            damageReason: l.damageReason, damageImageFileId: l.damageReason ? l.damageImageFileId : null, serials: l.serials, note: l.note,
          })),
        },
      });
      toast.success("Success", `You have successfully received orders. ${data.receiptIds.length} receipt${data.receiptIds.length === 1 ? "" : "s"} posted; ${po.code} is ${data.status}.`);
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
          form.setError(`lines.${target.i}.${m[2]}` as `lines.${number}.quantity`, { type: "server", message: messages[0] }, { shouldFocus: first });
          first = false;
        }
      }
      toast.error("Error", errorMessage(error));
    } finally {
      onBusy(false);
    }
  };

  return (
    <Form form={form} id={formId} onSubmit={submit} className="gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="text-secondary">Receiving into <span className="font-semibold text-foreground">{po.warehouseName}</span></span>
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => fields.forEach((f, i) => { const l = byId.get(f.lineId); if (l && l.orderedQuantity > l.receivedQuantity) form.setValue(`lines.${i}.include`, true, { shouldDirty: true }); })}>Select all open</Button>
        <Button variant="ghost" size="sm" onClick={() => fields.forEach((_, i) => form.setValue(`lines.${i}.include`, false, { shouldDirty: true }))}>Clear</Button>
      </div>
      {fields.map((f, i) => {
        const line = byId.get(f.lineId);
        return line ? <LineCard key={f.id} po={po} line={line} index={i} form={form} lpTypes={lpTypes.data?.data ?? []} /> : null;
      })}
      {rootError ? <p role="alert" className="text-[12px] font-medium text-danger">{rootError}</p> : null}
      {overLines.length > 0 ? (
        <Callout variant="attention" title="Over-receipt">
          <div className="flex flex-col gap-2">
            <span>{overLines.length} line{overLines.length === 1 ? "" : "s"} exceed the ordered quantity. Over-received units show as a positive difference on the PO receiving report.</span>
            <FormField name="allowOverReceipt" inline>
              {(c) => <Checkbox id={c.id} checked={Boolean(c.value)} onCheckedChange={(v) => { c.onChange(Boolean(v)); void form.trigger("lines"); }} label="I confirm receiving more than ordered" />}
            </FormField>
          </div>
        </Callout>
      ) : null}
      <p className="sticky bottom-0 -mx-5 -mb-4 flex items-center gap-2 border-t border-border bg-surface px-5 py-2 text-[12px] text-secondary">
        <PackageCheck className="h-3.5 w-3.5 text-primary" aria-hidden />
        {included.length} line{included.length === 1 ? "" : "s"} · {totalUnits.toLocaleString()} units selected
        {overLines.length > 0 && !values.allowOverReceipt ? <span className="ml-auto flex items-center gap-1 text-warning"><AlertTriangle className="h-3.5 w-3.5" aria-hidden />Confirm the over-receipt</span> : null}
      </p>
    </Form>
  );
}

export function ReceiveItemsDrawer({ po, open, onOpenChange, onlyLineId }: { readonly po: PoDetail; readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly onlyLineId?: string | null }) {
  const formId = React.useId();
  const [dirty, setDirty] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) setDirty(false);
        onOpenChange(next);
      }}
      dirty={dirty && !busy}
      width={60}
      title={<span className="flex items-center gap-2"><PackageCheck className="h-4 w-4 text-primary" aria-hidden />Receive items · {po.code}</span>}
      description="Quantities default to what is still open. Tracked attributes are required per product."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" disabled={busy} aria-busy={busy}>
            {busy ? <Spinner className="h-3.5 w-3.5" label="Receiving" /> : <PackageCheck className="h-3.5 w-3.5" aria-hidden />}
            Receive
          </Button>
        </>
      }
    >
      {open ? <ReceiveItemsForm key={`${po.id}:${po.version}:${onlyLineId ?? ""}`} po={po} formId={formId} onlyLineId={onlyLineId} onDirty={setDirty} onBusy={setBusy} onDone={() => { setDirty(false); onOpenChange(false); }} /> : null}
    </Drawer>
  );
}
