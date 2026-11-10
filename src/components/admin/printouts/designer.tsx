"use client";

/**
 * Printout designer (wizard step 3): toggle and reorder sections and line-table columns, set
 * paper, font, size, logo position, accent color, title and footer, and watch a live PDF
 * preview rendered by the server against a built-in sample or a real order.
 */
import * as React from "react";
import { ArrowDown, ArrowUp, RefreshCw } from "lucide-react";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { useApiQuery } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import {
  columnsFor, FONTS, LOGO_POSITIONS, moveItem, PAPER_SIZES, sectionsFor, layoutSchema,
  type PrintoutFormValues, type PrintoutLayout,
} from "@/lib/grid-defs/admin/printouts";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { NumberInput } from "@/components/ui/number-input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { TextField } from "@/components/ui/text-field";
import { fetchPdfUrl } from "./pdf-fetch";

type F = PrintoutFormValues;
const PREVIEW_DEBOUNCE_MS = 600;
const BUILT_IN = "__sample";
const LOGO_LABELS: Record<(typeof LOGO_POSITIONS)[number], string> = { left: "Left", center: "Center", right: "Right", hidden: "Hidden" };

const sampleSchema = z.array(z.object({ id: z.string(), label: z.string(), description: z.string() }));

interface Item { readonly key: string; readonly enabled: boolean }

function ReorderList({ title, description, items, labelOf, hintOf, onChange }: { readonly title: string; readonly description: string; readonly items: readonly Item[]; readonly labelOf: (k: string) => string; readonly hintOf?: (k: string) => string | undefined; readonly onChange: (items: Item[]) => void }) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
        <p className="text-[12px] text-secondary">{description}</p>
      </div>
      <ol className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {items.map((it, i) => (
          <li key={it.key} className={cn("flex items-center gap-2 px-3 py-2", !it.enabled && "bg-surface-sunken/50")}>
            <span className="w-5 text-right text-[11px] tabular-nums text-faint">{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className={cn("block text-[13px]", it.enabled ? "font-medium text-foreground" : "text-faint")}>{labelOf(it.key)}</span>
              {hintOf?.(it.key) ? <span className="block truncate text-[11px] text-faint">{hintOf(it.key)}</span> : null}
            </span>
            <Button size="icon-sm" variant="ghost" aria-label={`Move ${labelOf(it.key)} up`} disabled={i === 0} onClick={() => onChange(moveItem(items, i, -1))}><ArrowUp className="h-3.5 w-3.5" /></Button>
            <Button size="icon-sm" variant="ghost" aria-label={`Move ${labelOf(it.key)} down`} disabled={i === items.length - 1} onClick={() => onChange(moveItem(items, i, 1))}><ArrowDown className="h-3.5 w-3.5" /></Button>
            <Switch aria-label={`Show ${labelOf(it.key)}`} checked={it.enabled} onCheckedChange={(v) => onChange(items.map((x) => (x.key === it.key ? { ...x, enabled: v === true } : x)))} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function Labeled({ label, htmlFor, children }: { readonly label: string; readonly htmlFor?: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-[12px] font-medium text-body">{label}</label>
      {children}
    </div>
  );
}

function usePreview(typeKey: string, layout: PrintoutLayout, sampleId: string) {
  const [state, setState] = React.useState<{ url: string | null; loading: boolean; error: string | null }>({ url: null, loading: true, error: null });
  const [nonce, setNonce] = React.useState(0);
  const key = JSON.stringify(layout);
  const valid = layoutSchema.safeParse(layout);
  const invalid = valid.success ? null : valid.error.issues[0]?.message ?? "Fix the highlighted settings";
  React.useEffect(() => {
    if (!valid.success) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      setState((s) => ({ ...s, loading: true }));
      fetchPdfUrl("/api/printouts/preview", { typeKey, layout: valid.data, sampleIds: sampleId === BUILT_IN ? [] : [sampleId] }, ctrl.signal)
        .then((url) => setState((s) => { if (s.url) URL.revokeObjectURL(s.url); return { url, loading: false, error: null }; }))
        .catch((e: unknown) => { if (!ctrl.signal.aborted) setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : "Preview failed" })); });
    }, PREVIEW_DEBOUNCE_MS);
    return () => { ctrl.abort(); window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeKey, key, sampleId, nonce]);
  // Revoke only on unmount (an effect keyed on the url would revoke it right away under StrictMode).
  const urlRef = React.useRef<string | null>(null);
  React.useEffect(() => { urlRef.current = state.url; }, [state.url]);
  React.useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);
  return { ...state, loading: invalid ? false : state.loading, error: invalid ?? state.error, refresh: () => setNonce((n) => n + 1) };
}

export function DesignerStep({ form, typeKey }: { readonly form: UseFormReturn<F>; readonly typeKey: string }) {
  const layout = useWatch({ control: form.control, name: "layout" }) as PrintoutLayout;
  const [sampleId, setSampleId] = React.useState(BUILT_IN);
  const samplesQ = useApiQuery<unknown>(["printout-samples"], layout.family === "document" ? "/api/printouts/samples" : null, { staleTime: 60_000 });
  const samples = sampleSchema.safeParse(samplesQ.data?.data);
  const sampleOptions = [{ value: BUILT_IN, label: "Built-in sample (SO010412)" }, ...(samples.success ? samples.data.map((s) => ({ value: s.id, label: `${s.label} · ${s.description}` })) : [])];
  const preview = usePreview(typeKey, layout, sampleId);
  const set = <K extends keyof PrintoutLayout>(k: K, v: PrintoutLayout[K]) => form.setValue(`layout.${k}` as "layout.paper", v as never, { shouldDirty: true, shouldValidate: true });
  const sectionDefs = sectionsFor(typeKey);
  const columnDefs = columnsFor(typeKey);
  const papers = layout.family === "label" ? PAPER_SIZES.filter((p) => p.startsWith("4x")) : PAPER_SIZES.filter((p) => !p.startsWith("4x"));
  const errors = form.formState.errors.layout;
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(340px,420px)_1fr]">
      <div className="flex flex-col gap-5">
        <section className="grid grid-cols-2 gap-3">
          <Labeled label="Paper size" htmlFor="pd-paper"><Select id="pd-paper" value={layout.paper} onChange={(v) => v && set("paper", v as PrintoutLayout["paper"])} options={papers.map((p) => ({ value: p, label: p.startsWith("4x") ? `${p.replace("x", " × ")} in` : p }))} /></Labeled>
          <Labeled label="Font" htmlFor="pd-font"><Select id="pd-font" value={layout.font} onChange={(v) => v && set("font", v as PrintoutLayout["font"])} options={FONTS.map((f) => ({ value: f, label: f }))} /></Labeled>
          <Labeled label="Font size (pt)" htmlFor="pd-size"><NumberInput id="pd-size" value={layout.fontSize} min={7} max={16} onChange={(v) => set("fontSize", Math.min(16, Math.max(7, v ?? 10)))} invalid={Boolean(errors?.fontSize)} /></Labeled>
          <Labeled label="Accent color" htmlFor="pd-accent">
            <span className="flex items-center gap-2">
              <input type="color" aria-label="Pick accent color" value={layout.accentColor} onChange={(e) => set("accentColor", e.target.value.toUpperCase())} className="h-8 w-9 cursor-pointer rounded border border-border bg-surface p-0.5" />
              <TextField id="pd-accent" value={layout.accentColor} maxLength={7} onChange={(e) => set("accentColor", e.target.value)} invalid={Boolean(errors?.accentColor)} />
            </span>
          </Labeled>
          <div className="col-span-2">
            <Labeled label="Logo position">
              <SegmentedControl ariaLabel="Logo position" value={layout.logoPosition} onChange={(v) => set("logoPosition", v)} options={LOGO_POSITIONS.map((p) => ({ value: p, label: LOGO_LABELS[p] }))} />
            </Labeled>
          </div>
          <div className="col-span-2"><Labeled label="Title" htmlFor="pd-title"><TextField id="pd-title" value={layout.title} maxLength={60} onChange={(e) => set("title", e.target.value)} /></Labeled></div>
          {layout.family === "document" ? <div className="col-span-2"><Labeled label="Footer text" htmlFor="pd-footer"><TextField id="pd-footer" value={layout.footerText} maxLength={200} onChange={(e) => set("footerText", e.target.value)} placeholder="e.g. Thank you for your order." /></Labeled></div> : null}
        </section>
        {errors ? <Callout variant="error" title="Check the design settings">{errors.message ?? errors.accentColor?.message ?? errors.fontSize?.message ?? "One setting is invalid."}</Callout> : null}
        <ReorderList title="Sections" description="Switch sections on or off and set the order they print in."
          items={layout.sections} labelOf={(k) => sectionDefs.find((s) => s.key === k)?.label ?? k} hintOf={(k) => sectionDefs.find((s) => s.key === k)?.description}
          onChange={(items) => set("sections", items)} />
        {columnDefs.length ? (
          <ReorderList title="Lines table columns" description="Choose and order the columns of the lines table."
            items={layout.columns} labelOf={(k) => columnDefs.find((c) => c.key === k)?.label ?? k} onChange={(items) => set("columns", items)} />
        ) : null}
      </div>
      <section className="flex min-h-[520px] flex-col gap-2 rounded-lg border border-border bg-surface-sunken/60 p-3" aria-label="Live preview">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[13px] font-semibold text-foreground">Live preview</h3>
          {preview.loading ? <Spinner className="h-3.5 w-3.5" label="Rendering preview" /> : null}
          <span className="ml-auto flex items-center gap-2">
            {layout.family === "document" ? <span className="w-72"><Select aria-label="Preview record" value={sampleId} onChange={(v) => setSampleId(v ?? BUILT_IN)} options={sampleOptions} /></span> : null}
            <Button size="sm" variant="ghost" onClick={preview.refresh} aria-label="Refresh preview"><RefreshCw className="h-3.5 w-3.5" />Refresh</Button>
          </span>
        </div>
        {preview.error ? <Callout variant="error" title="Preview unavailable">{preview.error}</Callout> : null}
        {preview.url ? (
          <iframe title="Printout preview" src={`${preview.url}#toolbar=0&navpanes=0&view=FitH`} className={cn("min-h-[480px] w-full flex-1 rounded-md border border-border bg-white transition-opacity", preview.loading && "opacity-60")} />
        ) : !preview.error ? (
          <div className="flex flex-1 items-center justify-center text-[13px] text-secondary"><Spinner className="mr-2 h-4 w-4" label="Rendering" />Rendering preview…</div>
        ) : null}
      </section>
    </div>
  );
}
