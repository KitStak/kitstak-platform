"use client";

/**
 * Add / edit pack type modal (Primary · Hierarchical · Irregular), spec 05 §1 step 3.
 * Local state with the shared `packTypeSchema`; barcodes warn when already in use.
 * Beyond Logiwa: volume auto-computes from L×W×H (overridable), hierarchical UOM qty is
 * derived live from Child Qty × parent.
 */
import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ExternalLink, RotateCcw } from "lucide-react";
import { apiFetch, isApiError } from "@/lib/api-client";
import { useCan } from "@/lib/permissions-client";
import { Combobox } from "@/components/ui/combobox";
import { toast } from "@/components/ui/toast";
import { DIMENSION_UNITS, VOLUME_UNITS, WEIGHT_UNITS, computeVolume, formatVolume, hasIncompleteDimensions, hasMissingWeight } from "@/lib/grid-defs/products/catalog-options";
import { derivedPackWeight, minimumPackVolume } from "@/lib/grid-defs/products/pack-derivation";
import { BARCODE_MAX, normalizePackTypes, packTypeSchema, type PackKind, type PackTypeFormValue } from "@/lib/grid-defs/products/product-form";
import { Button } from "@/components/ui/button";
import { ChipInput } from "@/components/ui/chip-input";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { FieldError, FieldLabel } from "@/components/ui/form";
import { NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { YesNoToggle } from "@/components/ui/yes-no-toggle";
import { Spinner } from "@/components/ui/spinner";
import { DisabledReason } from "@/components/ui/tooltip";
import { useProductWizard } from "./context";
import { NEUTRAL_NO, opts } from "./fields";

/** Fixed 3-column field row (pack-type modals and the Kit / Packaging Packing step). */
export const ROW = "grid grid-cols-1 items-start gap-x-4 gap-y-3.5 md:grid-cols-3";

/**
 * Red outline for the conflicting barcode chips. The shared ChipInput has no per-chip state,
 * so the chips are matched by their remove button's accessible name inside this modal only.
 */
export function conflictChipCss(scope: string, codes: readonly string[]): string {
  const esc = (v: string) => v.replace(/["\\]/g, "\\$&");
  const selector = codes.map((c) => `[data-chip-scope="${esc(scope)}"] span:has(> button[aria-label="${esc(`Remove ${c}`)}"])`).join(",");
  return `${selector}{box-shadow:inset 0 0 0 1px var(--color-danger);background:var(--color-danger-soft);color:var(--color-danger)}`;
}

/** Range message for a committed numeric value (kept as typed, never clamped). */
export function packRangeError(v: number | null | undefined, min: number): string | undefined {
  return typeof v === "number" && v < min ? `Must be ${min} or more` : undefined;
}

const TITLES: Record<PackKind, string> = { Primary: "primary (UOM) pack type", Hierarchical: "hierarchical pack type", Irregular: "irregular pack type" };
const BARCODE_CHECK_DELAY_MS = 0;

interface BarcodeUse {
  readonly barcode: string;
  readonly sku: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly packType: string;
}

function useBarcodeUses(codes: readonly string[], excludeProductId: string | null): { readonly uses: readonly BarcodeUse[]; readonly checking: boolean } {
  const [state, setState] = React.useState<{ key: string; uses: readonly BarcodeUse[] }>({ key: "", uses: [] });
  const setUses = (key: string) => (uses: readonly BarcodeUse[]) => setState({ key, uses });
  const key = codes.join(",");
  React.useEffect(() => {
    if (!key) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      apiFetch<BarcodeUse[]>("/api/products/check-barcodes", { query: { barcodes: key, excludeProductId: excludeProductId ?? undefined }, signal: controller.signal })
        .then(setUses(key))
        .catch((e: unknown) => { if (!(e instanceof DOMException && e.name === "AbortError")) setUses(key)([]); });
    }, BARCODE_CHECK_DELAY_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [key, excludeProductId]);
  return { uses: key && state.key === key ? state.uses : [], checking: Boolean(key) && state.key !== key };
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
  /** The product's client: a barcode used by another product of this client blocks Add unless overridden. */
  readonly clientId?: string | null;
  readonly onSave: (pack: PackTypeFormValue) => void;
}

export function PackTypeModal({ open, onOpenChange, kind, initial, packs, clientId = null, onSave }: PackTypeModalProps) {
  const { options, productId, refetchOptions } = useProductWizard();
  const canManagePackTypes = useCan("settings.data_setup.view").allowed;
  /** Pack types created here this session (shown before the option list refetches). */
  const [created, setCreated] = React.useState<readonly string[]>([]);
  const createPackType = async (input: string) => {
    const name = input.trim();
    try {
      const row = await apiFetch<{ id: string; name: string }>("/api/lookups/pack_type", { method: "POST", body: { name } });
      setCreated((c) => [...c, row.name]);
      refetchOptions();
      toast.success("Pack type added", `${row.name} is now in the pack type master and available on every product.`);
      return { value: row.name, label: row.name };
    } catch (error) {
      toast.error("Could not add the pack type", isApiError(error) ? error.message : "Try again.");
      throw error;
    }
  };
  const [draft, setDraft] = React.useState<PackTypeFormValue>(initial);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  /** Hierarchical weight follows child qty × contained pack weight until the user types one. */
  const [weightAuto, setWeightAuto] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setDraft(initial);
      setErrors({});
      const derived = kind === "Hierarchical" ? derivedPackWeight(initial, packs) : null;
      setWeightAuto(derived !== null && (hasMissingWeight(initial) || initial.weight === derived));
    }
    // packs is read only when (re)opening; re-deriving on every parent render would reset the toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial, kind]);

  const set = <K extends keyof PackTypeFormValue>(key: K, value: PackTypeFormValue[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const others = packs.filter((p) => p.key !== draft.key);
  const parents = others.filter((p) => p.kind !== "Irregular");
  const isEdit = packs.some((p) => p.key === initial.key);
  const derivedQty = kind === "Hierarchical" ? normalizePackTypes([...others, draft]).find((p) => p.key === draft.key)?.uomQty ?? 1 : kind === "Primary" ? 1 : draft.uomQty;
  const volume = draft.volumeOverridden ? draft.volume : computeVolume(draft.length ?? 0, draft.width ?? 0, draft.height ?? 0, draft.dimensionUnit, draft.volumeUnit);
  const derivedWeight = kind === "Hierarchical" ? derivedPackWeight(draft, others) : null;
  const weight = weightAuto && derivedWeight !== null ? derivedWeight : draft.weight;
  const parentPack = kind === "Hierarchical" ? others.find((p) => p.key === draft.parentKey) ?? others.find((p) => p.kind === "Primary") : undefined;
  const minVolume = kind === "Hierarchical" ? minimumPackVolume(draft, others) : null;
  const packLabel = draft.packType || "this pack";
  const dataGaps = [
    hasIncompleteDimensions(draft) ? `No outer dimensions: cartonization and box selection will treat ${packLabel} as 0 × 0 × 0${minVolume ? ` (its contents need at least ${formatVolume(minVolume)} ${draft.volumeUnit.toLowerCase()})` : ""}.` : null,
    hasMissingWeight({ weight }) ? `No weight: rate shopping and shipping labels will use 0 ${draft.weightUnit.toLowerCase()}s for ${packLabel}.` : null,
  ].filter((m): m is string => Boolean(m));
  const usedNames = new Set(others.map((p) => p.packType.toLowerCase()));
  const masterNames = [...options.packTypes.map((o) => o.value), ...created.filter((c) => !options.packTypes.some((o) => o.value.toLowerCase() === c.toLowerCase()))];
  // A pack already on the product whose name left the master stays selectable for its own card.
  if (draft.packType && !masterNames.some((n) => n.toLowerCase() === draft.packType.toLowerCase())) masterNames.push(draft.packType);
  const packTypeOptions = masterNames.map((n) => ({ value: n, label: n, disabled: usedNames.has(n.toLowerCase()), description: usedNames.has(n.toLowerCase()) ? "Already used on this product" : undefined }));
  const siblingCodes = new Map(others.flatMap((p) => p.barcodes.map((b) => [b.toLowerCase(), p.packType] as const)));
  const { uses, checking } = useBarcodeUses(draft.barcodes, productId);
  const chipScope = React.useId();
  const blocking = uses.filter((u) => Boolean(clientId) && u.clientId === clientId);
  const otherClient = uses.filter((u) => !clientId || u.clientId !== clientId);

  const save = () => {
    const candidate = { ...draft, uomQty: derivedQty, volume, weight };
    const parsed = packTypeSchema.safeParse(candidate);
    const next: Record<string, string> = {};
    if (!parsed.success) for (const i of parsed.error.issues) next[String(i.path[0] ?? "_")] ??= i.message;
    if (!draft.packType) next.packType = "Select a pack type";
    const ranges: [string, number | null | undefined, number][] = [["length", draft.length, 0], ["width", draft.width, 0], ["height", draft.height, 0], ["weight", weight, 0], ["volume", volume, 0]];
    if (kind === "Hierarchical") ranges.push(["childQty", draft.childQty, 2]);
    if (kind === "Irregular") ranges.push(["uomQty", draft.uomQty, 1]);
    for (const [k, v, m] of ranges) {
      const msg = packRangeError(v, m);
      if (msg) next[k] = msg;
    }
    if (draft.packType && usedNames.has(draft.packType.toLowerCase())) next.packType = `${draft.packType} is already used on this product`;
    const clash = draft.barcodes.find((b) => siblingCodes.has(b.toLowerCase()));
    if (clash) next.barcodes = `${clash} is already on the ${siblingCodes.get(clash.toLowerCase())} pack type`;
    else if (blocking[0]) next.barcodes = `Barcode already used by ${blocking[0].sku} (${blocking[0].packType}). Remove it to continue.`;
    setErrors(next);
    if (Object.keys(next).length) return;
    onSave(candidate);
    onOpenChange(false);
  };

  const uomQtyError = errors.uomQty || (kind === "Irregular" ? packRangeError(draft.uomQty, 1) : undefined);
  const uomQtyField = (
    <Field label="UOM quantity" error={uomQtyError} info={kind === "Hierarchical" ? "Derived: child qty × the contained pack's UOM quantity" : kind === "Primary" ? "The primary pack is always 1" : "How many units this pack holds"}>
      <NumberInput aria-label="UOM quantity" value={kind === "Irregular" ? draft.uomQty : derivedQty} onChange={(v) => set("uomQty", v)} disabled={kind !== "Irregular"} invalid={Boolean(uomQtyError)} />
    </Field>
  );
  const primaryBarcodesField = (
    <Field label="Use primary (UOM) barcode(s)" info="Scanning a primary barcode also identifies this pack">
      <YesNoToggle className={NEUTRAL_NO} ariaLabel="Use primary barcodes" value={draft.usePrimaryBarcodes ?? false} onChange={(v) => set("usePrimaryBarcodes", v)} />
    </Field>
  );
  const conflictCodes = [...new Set([...blocking.map((u) => u.barcode), ...draft.barcodes.filter((b) => siblingCodes.has(b.toLowerCase()))])];
  const addReason = checking ? "Checking barcodes…" : blocking[0] ? `Barcode ${blocking[0].barcode} is already used by ${blocking[0].sku} (${blocking[0].packType}). Remove it to continue.` : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" onKeyDown={(e) => {
        // Enter that picks an option in a Select (its listbox portals but React bubbles it here)
        // must not submit with the pre-selection draft.
        const target = e.target as HTMLElement;
        if (e.key === "Enter" && !e.defaultPrevented && target.tagName !== "TEXTAREA" && !target.closest("[data-chip-input],[role=combobox],[role=listbox],[role=option],[aria-haspopup]")) {
          e.preventDefault();
          save();
        }
      }}>
        <DialogHeader title={`${isEdit ? "Edit" : "Add"} ${TITLES[kind]}`} description={kind === "Hierarchical" ? "A pack made of child packs, e.g. Case = 12 × Unit, Pallet = 40 × Case." : kind === "Irregular" ? "An alternate pack that is not nested in the hierarchy." : "The base unit every quantity is counted in (UOM quantity 1)."} />
        <DialogBody className="flex flex-col gap-y-3.5">
          {/* Fixed 3-column rows (same as the Kit / Packaging Packing step): identity, then
              [Dimension unit], [L][W][H], [Volume unit][Volume][Shipping box], [Weight unit][Weight][Own box]. */}
          <div className={ROW}>
            <Field label="Pack type" required error={errors.packType} info="Pack types come from the pack type master (Settings › Data setup › Pack Type).">
              <Combobox
                aria-label="Pack type"
                value={draft.packType || null}
                onChange={(v) => { set("packType", v ?? ""); setErrors(({ packType: _p, ...rest }) => rest); }}
                options={packTypeOptions}
                placeholder="Select pack type"
                emptyText="No pack type found."
                invalid={Boolean(errors.packType)}
                creatable={canManagePackTypes}
                onCreate={createPackType}
              />
              <span className="flex items-center justify-between gap-2 text-[12px] text-secondary">
                <span>{canManagePackTypes ? "Type a new name to add it to the master." : "Custom pack types are added in the master."}</span>
                <Link href="/settings/data-setup/pack-types" target="_blank" rel="noopener" className="inline-flex shrink-0 items-center gap-1 font-semibold text-primary hover:underline">
                  Manage pack types<ExternalLink className="h-3 w-3" aria-hidden />
                </Link>
              </span>
            </Field>
            {kind === "Hierarchical" ? (
              <>
                <Field label="Contains" info="The pack this one is made of">
                  <Select aria-label="Parent pack type" value={draft.parentKey ?? null} onChange={(v) => set("parentKey", v)} options={parents.map((p) => ({ value: p.key, label: `${p.packType} (UOM ${normalizePackTypes(packs).find((x) => x.key === p.key)?.uomQty ?? p.uomQty})` }))} />
                </Field>
                <Field label="Child qty" required error={errors.childQty || packRangeError(draft.childQty, 2)}>
                  <NumberInput aria-label="Child qty" value={draft.childQty ?? null} onChange={(v) => set("childQty", v)} invalid={Boolean(errors.childQty || packRangeError(draft.childQty, 2))} />
                </Field>
              </>
            ) : (
              <>
                {uomQtyField}
                {kind === "Irregular" ? primaryBarcodesField : <span className="hidden md:block" aria-hidden />}
              </>
            )}
          </div>
          {kind === "Hierarchical" ? (
            <div className={ROW}>
              {uomQtyField}
              {primaryBarcodesField}
              <span className="hidden md:block" aria-hidden />
            </div>
          ) : null}
          <div className={ROW}>
            <Field label="Dimension unit">
              <Select aria-label="Dimension unit" value={draft.dimensionUnit} onChange={(v) => set("dimensionUnit", v ?? "Inch")} options={opts(DIMENSION_UNITS)} />
            </Field>
          </div>
          <div className={ROW}>
          <Field label="Length" error={errors.length || packRangeError(draft.length, 0)}><NumberInput aria-label="Length" decimals={2} value={draft.length} onChange={(v) => set("length", v)} placeholder="0.00" invalid={Boolean(errors.length || packRangeError(draft.length, 0))} /></Field>
          <Field label="Width" error={errors.width || packRangeError(draft.width, 0)}><NumberInput aria-label="Width" decimals={2} value={draft.width} onChange={(v) => set("width", v)} placeholder="0.00" invalid={Boolean(errors.width || packRangeError(draft.width, 0))} /></Field>
          <Field label="Height" error={errors.height || packRangeError(draft.height, 0)}><NumberInput aria-label="Height" decimals={2} value={draft.height} onChange={(v) => set("height", v)} placeholder="0.00" invalid={Boolean(errors.height || packRangeError(draft.height, 0))} /></Field>
          </div>
          <div className={ROW}>
          <Field label="Volume unit">
            <Select aria-label="Volume unit" value={draft.volumeUnit} onChange={(v) => set("volumeUnit", v ?? "Cubic Inch")} options={opts(VOLUME_UNITS)} />
          </Field>
          <Field label="Volume" error={errors.volume || packRangeError(volume, 0)} info={draft.volumeOverridden ? "Entered manually" : "Calculated from L × W × H. Type to override."}>
            <div className="flex items-center gap-1">
              <NumberInput aria-label="Volume" decimals={5} value={volume} invalid={Boolean(errors.volume || packRangeError(volume, 0))} onChange={(v) => setDraft((d) => ({ ...d, volume: v, volumeOverridden: true }))} />
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
          </div>
          <div className={ROW}>
          <Field label="Weight unit">
            <Select aria-label="Weight unit" value={draft.weightUnit} onChange={(v) => set("weightUnit", v ?? "Pound")} options={opts(WEIGHT_UNITS)} />
          </Field>
          <Field label="Weight" error={errors.weight || packRangeError(weight, 0)}
            info={derivedWeight !== null && parentPack
              ? (weightAuto ? `Calculated: ${Math.max(1, Math.floor(draft.childQty ?? 2))} × ${parentPack.packType || "contained pack"} weight. Type to override.` : "Entered manually")
              : kind === "Hierarchical" ? "Enter the contained pack's weight to calculate this one" : undefined}>
            <div className="flex items-center gap-1">
              <NumberInput aria-label="Weight" decimals={2} value={weight} onChange={(v) => { setWeightAuto(false); set("weight", v); }} placeholder="0.00" invalid={Boolean(errors.weight || packRangeError(weight, 0))} />
              {!weightAuto && derivedWeight !== null && derivedWeight !== weight ? (
                <Button variant="ghost" size="icon-sm" aria-label={`Use calculated weight ${derivedWeight}`} title={`Use calculated weight (${derivedWeight})`} onClick={() => setWeightAuto(true)}>
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                </Button>
              ) : null}
            </div>
          </Field>
          <Field label="Use item's own box for shipping" info="The item ships in its own packaging: no carton is added at packing.">
            <YesNoToggle className={NEUTRAL_NO} ariaLabel="Use item's own box for shipping" value={draft.useOwnBox ?? false} onChange={(v) => set("useOwnBox", v)} />
          </Field>
          </div>
          {dataGaps.length ? (
            <ul data-testid="pack-data-gaps" className="flex flex-col gap-0.5 rounded-md border border-warning/30 bg-warning-soft px-2.5 py-1.5 text-[12px] text-body" aria-live="polite">
              {dataGaps.map((m) => (
                <li key={m} className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
                  <span>{m} You can save now and add it later.</span>
                </li>
              ))}
            </ul>
          ) : null}
          <Field label="Barcode(s)" error={errors.barcodes}>
            <div data-chip-input data-chip-scope={chipScope}>
              <ChipInput aria-label="Barcodes" value={draft.barcodes} onChange={(v) => set("barcodes", [...v])} maxLength={BARCODE_MAX} maxItems={20} placeholder="Enter and add barcode (press Enter)" invalid={Boolean(errors.barcodes)}
                validate={(t) => (siblingCodes.has(t.toLowerCase()) ? `Already on the ${siblingCodes.get(t.toLowerCase())} pack type` : null)} />
              {conflictCodes.length ? <style>{conflictChipCss(chipScope, conflictCodes)}</style> : null}
            </div>
            {checking ? (
              <p className="flex items-center gap-1.5 text-[12px] text-secondary" role="status" aria-live="polite">
                <Spinner className="h-3 w-3" />
                Checking barcode{draft.barcodes.length === 1 ? "" : "s"}…
              </p>
            ) : null}
            {blocking.length ? (
              <ul className="flex flex-col gap-0.5 rounded-md border border-danger/30 bg-danger-soft px-2.5 py-1.5 text-[12px] text-body" role="alert">
                {blocking.map((u) => (
                  <li key={`${u.barcode}-${u.sku}-${u.packType}`} className="flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-danger" aria-hidden />
                    <span>Barcode <span className="font-mono font-semibold">{u.barcode}</span> already used by {u.sku} ({u.packType}). A barcode can identify only one product per client.</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {otherClient.length ? (
              <ul className="flex flex-col gap-0.5 rounded-md border border-warning/30 bg-warning-soft px-2.5 py-1.5 text-[12px] text-body" aria-live="polite">
                {otherClient.map((u) => (
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
          <DisabledReason reason={addReason}>
            <Button variant="primary" onClick={save} disabled={Boolean(addReason)}>{isEdit ? "Save" : "Add"}</Button>
          </DisabledReason>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

