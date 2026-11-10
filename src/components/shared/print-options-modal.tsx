"use client";

/**
 * Print Options modal (BUILD_PLAN F4.4). Template cards filtered by type and client
 * access, a Print Quantity input, and three actions:
 *   Preview  → renders through `POST /api/print` and shows the PDF inline
 *   Download → saves the rendered file
 *   Print    → hands the file to the local print agent when present (assigned printer),
 *              otherwise opens the PDF and calls `window.print()`
 * Templates come from `GET /api/printouts?typeKeys=&clientId=` (M14); until that exists
 * the catalog defaults are offered, and unimplemented types show "Not configured yet".
 */
import * as React from "react";
import { Download, Eye, FileText, Printer } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch, isApiError } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { getPrintType, isPrintImplemented } from "@/server/print/catalog";
import { MAX_COPIES } from "@/server/print/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { NumberInput } from "@/components/ui/number-input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { fileUrl, parseList, printResultSchema, printTemplateSchema, type PrintTemplate } from "./contracts";

/** Optional desktop print agent injected by the KitStaks printer bridge. */
interface PrintAgent {
  print(input: { readonly url: string; readonly printerType: string; readonly copies: number }): Promise<void>;
}

function printAgent(): PrintAgent | null {
  const candidate = (window as unknown as { kitstakPrintAgent?: unknown }).kitstakPrintAgent;
  return candidate && typeof (candidate as PrintAgent).print === "function" ? (candidate as PrintAgent) : null;
}

/** Catalog defaults used until printout templates are served. */
export function defaultTemplates(typeKeys: readonly string[]): readonly PrintTemplate[] {
  return typeKeys.flatMap((key) => {
    const type = getPrintType(key);
    return type ? [{ id: `default:${key}`, typeKey: key, name: type.name, description: "Default template", printerType: type.printerType, isDefault: true, allClients: true }] : [];
  });
}

/** Keeps templates of the requested types that the record's client may use. */
export function filterTemplates(templates: readonly PrintTemplate[], typeKeys: readonly string[], clientId?: string | null): readonly PrintTemplate[] {
  return templates.filter((t) => typeKeys.includes(t.typeKey) && (t.allClients || !clientId || (t.clientIds ?? []).includes(clientId)));
}

export interface PrintOptionsModalProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly typeKeys: readonly string[];
  /** Records passed to the renderer (each type defines its record schema). */
  readonly records: readonly unknown[];
  readonly clientId?: string | null;
  readonly title?: string;
}

type Busy = "preview" | "download" | "print" | null;

export function PrintOptionsModal({ open, onOpenChange, typeKeys, records, clientId, title = "Print options" }: PrintOptionsModalProps) {
  const remote = useApiQuery<unknown>(["printouts", typeKeys.join(","), clientId ?? ""], open ? "/api/printouts" : null, { query: { typeKeys: typeKeys.join(","), clientId: clientId ?? undefined }, retry: false });
  const served = parseList(printTemplateSchema, remote.data?.data);
  const templates = filterTemplates(served.length ? served : defaultTemplates(typeKeys), typeKeys, clientId);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [copies, setCopies] = React.useState<number | null>(1);
  const [busy, setBusy] = React.useState<Busy>(null);
  const [previewId, setPreviewId] = React.useState<string | null>(null);
  const selected = templates.find((t) => t.id === selectedId) ?? templates.find((t) => t.isDefault) ?? templates[0];
  const implemented = selected ? isPrintImplemented(selected.typeKey) : false;

  const reason = !selected
    ? "No printout template is available for this record"
    : !implemented
      ? "This printout is not configured yet"
      : records.length === 0
        ? "Nothing to print"
        : copies === null || copies < 1
          ? "Enter a print quantity"
          : busy
            ? "Preparing the file…"
            : null;

  const render = async (): Promise<string> => {
    if (!selected) throw new Error("No template selected");
    const result = await apiFetch<unknown>("/api/print", { method: "POST", body: { typeKey: selected.typeKey, records, options: { copies: copies ?? 1 } } });
    return printResultSchema.parse(result).fileId;
  };

  const run = async (action: Exclude<Busy, null>) => {
    setBusy(action);
    try {
      const id = await render();
      if (action === "preview") setPreviewId(id);
      else if (action === "download") {
        const a = document.createElement("a");
        a.href = fileUrl(id, true);
        a.download = "";
        a.click();
      } else {
        const agent = printAgent();
        if (agent && selected) {
          await agent.print({ url: fileUrl(id), printerType: selected.printerType ?? "Laser printer", copies: copies ?? 1 });
          toast.success("Sent to printer", `${selected.name} sent to your assigned printer`);
        } else {
          const w = window.open(fileUrl(id), "_blank");
          if (!w) toast.warning("Pop-up blocked", "Allow pop-ups for KitStak to print, or use Download.");
          else w.addEventListener("load", () => w.print(), { once: true });
        }
      }
    } catch (error) {
      toast.error("Print failed", isApiError(error) ? error.message : "The printout could not be prepared.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setPreviewId(null);
        onOpenChange(o);
      }}
    >
      <DialogContent size={previewId ? "xl" : "lg"}>
        <DialogHeader title={title} description={`${records.length} record${records.length === 1 ? "" : "s"} selected`} />
        <DialogBody className="flex flex-col gap-4">
          {remote.isPending ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : (
            <div role="radiogroup" aria-label="Printout template" className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {templates.map((t) => {
                const active = selected?.id === t.id;
                const ready = isPrintImplemented(t.typeKey);
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => {
                      setSelectedId(t.id);
                      setPreviewId(null);
                    }}
                    className={cn("flex items-start gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30", active ? "border-primary bg-primary-soft" : "border-border hover:border-primary/40 hover:bg-surface-sunken")}
                  >
                    <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-md", active ? "bg-primary text-white" : "bg-neutral-soft text-secondary")}>
                      <FileText className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                        <span className="truncate">{t.name}</span>
                        {t.isDefault ? <Badge tone="info" size="sm">Default</Badge> : null}
                      </span>
                      <span className="text-[12px] text-faint">{ready ? t.description || t.printerType : "Not configured yet"}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <label className="flex w-48 flex-col gap-1 text-[12px] font-semibold text-secondary">
            Print Quantity
            <NumberInput min={1} max={MAX_COPIES} value={copies} onChange={setCopies} aria-label="Print quantity" />
          </label>
          {previewId ? <iframe title="Printout preview" src={fileUrl(previewId)} className="h-[60vh] w-full rounded-md border border-border bg-surface-sunken" /> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {(["preview", "download", "print"] as const).map((action) => {
            const Icon = action === "preview" ? Eye : action === "download" ? Download : Printer;
            return (
              <DisabledReason key={action} reason={reason}>
                <Button variant={action === "print" ? "primary" : "secondary"} disabled={Boolean(reason)} onClick={() => void run(action)}>
                  {busy === action ? <Spinner className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" aria-hidden />}
                  {action === "preview" ? "Preview" : action === "download" ? "Download" : "Print"}
                </Button>
              </DisabledReason>
            );
          })}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
