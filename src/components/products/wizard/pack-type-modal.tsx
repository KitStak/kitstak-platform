"use client";

/**
 * Add / edit pack type modal (Primary · Hierarchical · Irregular), spec 05 §1 step 3.
 * Local state with the shared `packTypeSchema`; barcodes warn when already in use.
 * Beyond Logiwa: volume auto-computes from L×W×H (overridable), hierarchical UOM qty is
 * derived live from Child Qty × parent.
 */
import * as React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { DIMENSION_UNITS, VOLUME_UNITS, WEIGHT_UNITS, computeVolume } from "@/lib/grid-defs/products/catalog-options";
import { BARCODE_MAX, normalizePackTypes, packTypeSchema, type PackKind, type PackTypeFormValue } from "@/lib/grid-defs/products/product-form";
import { Button } from "@/components/ui/button";
import { ChipInput } from "@/components/ui/chip-input";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { FieldError, FieldLabel } from "@/components/ui/form";
import { NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { YesNoToggle } from "@/components/ui/yes-no-toggle";
import { DisabledReason } from "@/components/ui/tooltip";
import { useProductWizard } from "./context";
import { opts } from "./fields";

const TITLES: Record<PackKind, string> = { Primary: "primary (UOM) pack type", Hierarchical: "hierarchical pack type", Irregular: "irregular pack type" };
const BARCODE_CHECK_DELAY_MS = 400;

interface BarcodeUse {
  readonly barcode: string;
  readonly sku: string;
  readonly clientName: string;
  readonly packType: string;
}

function useBarcodeUses(codes: readonly string[], excludeProductId: string | null): readonly BarcodeUse[] {
  const [uses, setUses] = React.useState<readonly BarcodeUse[]>([]);
  const key = codes.join(",");
  React.useEffect(() => {
    if (!key) {
      setUses([]);
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      apiFetch<BarcodeUse[]>("/api/products/check-barcodes", { query: { barcodes: key, excludeProductId: excludeProductId ?? undefined }, signal: controller.signal })
        .then(setUses)
        .catch(() => setUses([]));
    }, BARCODE_CHECK_DELAY_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [key, excludeProductId]);
  return uses;
}

function Field({ label, required, info, error, children, className }: { readonly label: string; readonly required?: boolean; readonly info?: React.ReactNode; readonly error?: string; readonly children: React.ReactNode; readonly className?: string }) {
  const id = React.useId();
  return (
    <div className={className ?? "flex flex-col gap-1.5"}>
      <FieldLabel required={required} info={info}>{label}</FieldLabel>
      <div className="flex flex-col gap-1" id={id}>
        {children}
        <FieldError id={`${id}-err`} message={error} />
      </div>
    </div>
  );
}

export interface PackTypeModalProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly kind: PackKind;
  readonly initial: PackTypeFormValue;
  /** Every pack on the product (for parents, name and barcode clashes). */
  readonly packs: readonly PackTypeFormValue[];
  readonly onSave: (pack: PackTypeFormValue) => void;
}

export function PackTypeModal({ open, onOpenChange, kind, initial, packs, onSave }: PackTypeModalProps) {
  const { options, productId } = useProductWizard();
  const [draft, setDraft] = React.useState<PackTypeFormValue>(initial);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    if (open) {
      setDraft(initial);
      setErrors({});
    }
  }, [open, initial]);

  const set = <K extends keyof PackTypeFormValue>(key: K, value: PackTypeFormValue[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const others = packs.filter((p) => p.key !== draft.key);
  const parents = others.filter((p) => p.kind !== "Irregular");
  const isEdit = packs.some((p) => p.key === initial.key);
  const derivedQty = kind === "Hierarchical" ? normalizePackTypes([...others, draft]).find((p) => p.key === draft.key)?.uomQty ?? 1 : kind === "Primary" ? 1 : draft.uomQty;
  const volume = draft.volumeOverridden ? draft.volume : computeVolume(draft.length ?? 0, draft.width ?? 0, draft.height ?? 0, draft.dimensionUnit, draft.volumeUnit);
  const usedNames = new Set(others.map((p) => p.packType.toLowerCase()));
  const packTypeOptions = options.packTypes.map((o) => ({ value: o.value, label: o.label, disabled: usedNames.has(o.value.toLowerCase()), description: usedNames.has(o.value.toLowerCase()) ? "Already used on this product" : undefined }));
  const siblingCodes = new Map(others.flatMap((p) => p.barcodes.map((b) => [b.toLowerCase(), p.packType] as const)));
  const uses = useBarcodeUses(draft.barcodes, productId);

  const save = () => {
    const candidate = { ...draft, uomQty: derivedQty, volume };
    const parsed = packTypeSchema.safeParse(candidate);
    const next: Record<string, string> = {};
    if (!parsed.success) for (const i of parsed.error.issues) next[String(i.path[0] ?? "_")] ??= i.message;
    if (usedNames.has(draft.packType.toLowerCase())) next.packType = `${draft.packType} is already used on this product`;
    const clash = draft.barcodes.find((b) => siblingCodes.has(b.toLowerCase()));
    if (clash) next.barcodes = `${clash} is already on the ${siblingCodes.get(clash.toLowerCase())} pack type`;
    setErrors(next);
    if (Object.keys(next).length) return;
    onSave(candidate);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA" && !(e.target as HTMLElement).closest("[data-chip-input]")) {
          e.preventDefault();
          save();
        }
      }}>
        <DialogHeader title={`${isEdit ? "Edit" : "Add"} ${TITLES[kind]}`} description={kind === "Hierarchical" ? "A pack made of child packs, e.g. Case = 12 × Unit, Pallet = 40 × Case." : kind === "Irregular" ? "An alternate pack that is not nested in the hierarchy." : "The base unit every quantity is counted in (UOM quantity 1)."} />
        <DialogBody className="grid grid-cols-1 gap-x-4 gap-y-3.5 md:grid-cols-3">
          <Field label="Pack type" required error={errors.packType} className="flex flex-col gap-1.5 md:col-span-1">
            <Select aria-label="Pack type" value={draft.packType || null} onChange={(v) => set("packType", v ?? "")} options={packTypeOptions} placeholder="Select pack type" invalid={Boolean(errors.packType)} />
          </Field>
          {kind === "Hierarchical" ? (
            <>
              <Field label="Contains" info="The pack this one is made of">
                <Select aria-label="Parent pack type" value={draft.parentKey ?? null} onChange={(v) => set("parentKey", v)} options={parents.map((p) => ({ value: p.key, label: `${p.packType} (UOM ${normalizePackTypes(packs).find((x) => x.key === p.key)?.uomQty ?? p.uomQty})` }))} />
              </Field>
              <Field label="Child qty" required error={errors.childQty}>
                <NumberInput aria-label="Child qty" min={2} value={draft.childQty ?? null} onChange={(v) => set("childQty", v)} invalid={Boolean(errors.childQty)} />
              </Field>
            </>
          ) : null}
          <Field label="UOM quantity" error={errors.uomQty} info={kind === "Hierarchical" ? "Derived: child qty × the contained pack's UOM quantity" : kind === "Primary" ? "The primary pack is always 1" : "How many units this pack holds"}>
            <NumberInput aria-label="UOM quantity" min={1} value={kind === "Irregular" ? draft.uomQty : derivedQty} onChange={(v) => set("uomQty", v)} disabled={kind !== "Irregular"} invalid={Boolean(errors.uomQty)} />
          </Field>
          {kind !== "Hierarchical" ? <span className="hidden md:block" /> : null}

          <Field label="Dimension unit">
            <Select aria-label="Dimension unit" value={draft.dimensionUnit} onChange={(v) => set("dimensionUnit", v ?? "Inch")} options={opts(DIMENSION_UNITS)} />
          </Field>
          <span className="hidden md:block" />
          <span className="hidden md:block" />
          <Field label="Length" error={errors.length}><NumberInput aria-label="Length" decimals={2} min={0} value={draft.length} onChange={(v) => set("length", v)} placeholder="0.00" /></Field>
          <Field label="Width" error={errors.width}><NumberInput aria-label="Width" decimals={2} min={0} value={draft.width} onChange={(v) => set("width", v)} placeholder="0.00" /></Field>
          <Field label="Height" error={errors.height}><NumberInput aria-label="Height" decimals={2} min={0} value={draft.height} onChange={(v) => set("height", v)} placeholder="0.00" /></Field>
          <Field label="Volume unit">
            <Select aria-label="Volume unit" value={draft.volumeUnit} onChange={(v) => set("volumeUnit", v ?? "Cubic Inch")} options={opts(VOLUME_UNITS)} />
          </Field>
          <Field label="Volume" info={draft.volumeOverridden ? "Entered manually" : "Calculated from L × W × H. Type to override."}>
            <div className="flex items-center gap-1">
              <NumberInput aria-label="Volume" decimals={5} min={0} value={volume} onChange={(v) => setDraft((d) => ({ ...d, volume: v, volumeOverridden: true }))} />
              {draft.volumeOverridden ? (
                <Button variant="ghost" size="icon-sm" aria-label="Recalculate volume" title="Recalculate from dimensions" onClick={() => set("volumeOverridden", false)}>
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                </Button>
              ) : null}
            </div>
          </Field>
          <Field label="Use this shipping box only">
            <Select aria-label="Use this shipping box only" clearable placeholder="Any box" value={draft.useShipPackageId} onChange={(v) => set("useShipPackageId", v)} options={options.shipmentPackages.map((o) => ({ value: o.value, label: o.label, description: o.description }))} />
          </Field>
          <Field label="Weight unit">
            <Select aria-label="Weight unit" value={draft.weightUnit} onChange={(v) => set("weightUnit", v ?? "Pound")} options={opts(WEIGHT_UNITS)} />
          </Field>
          <Field label="Weight" error={errors.weight}><NumberInput aria-label="Weight" decimals={2} min={0} value={draft.weight} onChange={(v) => set("weight", v)} placeholder="0.00" /></Field>
          <Field label="Use item's own box for shipping" info="Informational: not enforced at the packing station.">
            <YesNoToggle ariaLabel="Use item's own box for shipping" value={draft.useOwnBox} onChange={(v) => set("useOwnBox", v)} />
          </Field>
          {kind !== "Primary" ? (
            <Field label="Use primary (UOM) barcode(s)" info="Scanning a primary barcode also identifies this pack">
              <YesNoToggle ariaLabel="Use primary barcodes" value={draft.usePrimaryBarcodes} onChange={(v) => set("usePrimaryBarcodes", v)} />
            </Field>
          ) : null}
          <Field label="Barcode(s)" error={errors.barcodes} className="flex flex-col gap-1.5 md:col-span-3">
            <div data-chip-input>
              <ChipInput aria-label="Barcodes" value={draft.barcodes} onChange={(v) => set("barcodes", [...v])} maxLength={BARCODE_MAX} maxItems={20} placeholder="Enter and add barcode (press Enter)" invalid={Boolean(errors.barcodes)}
                validate={(t) => (siblingCodes.has(t.toLowerCase()) ? `Already on the ${siblingCodes.get(t.toLowerCase())} pack type` : null)} />
            </div>
            {uses.length ? (
              <ul className="flex flex-col gap-0.5 rounded-md border border-warning/30 bg-warning-soft px-2.5 py-1.5 text-[12px] text-body" aria-live="polite">
                {uses.map((u) => (
                  <li key={`${u.barcode}-${u.sku}-${u.packType}`} className="flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
                    <span><span className="font-mono font-semibold">{u.barcode}</span> is already used by {u.sku} ({u.packType}, {u.clientName}). Scans may be ambiguous.</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <DisabledReason reason={draft.packType ? null : "Select a pack type"}>
            <Button variant="primary" onClick={save} disabled={!draft.packType}>{isEdit ? "Save" : "Add"}</Button>
          </DisabledReason>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

