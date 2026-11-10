"use client";

/**
 * ConfirmDialog (BUILD_PLAN 0.3 / F4.2): coloured header band holding the question,
 * optional sub-line, optional mini-table of the affected records, `No` / `Yes`.
 * Async confirm shows a spinner and keeps the dialog open until it settles; a thrown
 * error is shown inline so the user can retry. `typeToConfirm` gates mass deletes.
 * The safe choice (Cancel / No / Stay) receives focus when the dialog opens, except in
 * the type-to-confirm variant, where the confirm input does (Enter submits once it matches).
 */
import * as React from "react";
import { AlertDialog } from "radix-ui";
import { AlertTriangle, Info, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { overlayClass } from "./dialog";
import { Spinner } from "./spinner";

export type ConfirmVariant = "danger" | "attention" | "info";

export interface ConfirmColumn {
  readonly key: string;
  readonly label: string;
}

export interface ConfirmRecords {
  readonly columns: readonly ConfirmColumn[];
  readonly rows: readonly Readonly<Record<string, React.ReactNode>>[];
  /** Rows beyond this are summarised as "+N more". Default 50. */
  readonly maxRows?: number;
}

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly variant?: ConfirmVariant;
  readonly records?: ConfirmRecords;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly onConfirm: () => void | Promise<void>;
  /** User must type this exact text before Yes enables (e.g. "DELETE"). */
  readonly typeToConfirm?: string;
  /** Header icon override (defaults per variant, e.g. a bin for danger). */
  readonly icon?: React.ComponentType<{ className?: string }>;
  readonly children?: React.ReactNode;
}

const VARIANTS: Readonly<Record<ConfirmVariant, { readonly band: string; readonly Icon: React.ComponentType<{ className?: string }>; readonly button: "danger" | "primary" }>> = {
  danger: { band: "bg-danger text-white", Icon: Trash2, button: "danger" },
  attention: { band: "bg-warning text-white", Icon: AlertTriangle, button: "primary" },
  info: { band: "bg-primary text-white", Icon: Info, button: "primary" },
};

const DEFAULT_MAX_ROWS = 50;

function RecordsTable({ records }: { readonly records: ConfirmRecords }) {
  const max = records.maxRows ?? DEFAULT_MAX_ROWS;
  const shown = records.rows.slice(0, max);
  const hidden = records.rows.length - shown.length;
  return (
    <div className="mt-3 max-h-[220px] overflow-auto rounded-md border border-border ks-scroll">
      <table className="w-full border-collapse text-left text-[12px]">
        <thead className="sticky top-0 bg-surface-sunken">
          <tr>
            {records.columns.map((c) => (
              <th key={c.key} scope="col" className="border-b border-border px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, i) => (
            <tr key={i} className="border-b border-border last:border-b-0">
              {records.columns.map((c) => (
                <td key={c.key} className="px-2.5 py-1.5 text-body tabular-nums">
                  {row[c.key] ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {hidden > 0 ? <p className="border-t border-border bg-surface-sunken px-2.5 py-1.5 text-[11px] text-secondary">+{hidden} more</p> : null}
    </div>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  variant = "danger",
  records,
  confirmLabel = "Yes",
  cancelLabel = "No",
  onConfirm,
  typeToConfirm,
  icon,
  children,
}: ConfirmDialogProps) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [typed, setTyped] = React.useState("");
  const style = VARIANTS[variant];
  const Icon = icon ?? style.Icon;
  const typedOk = !typeToConfirm || typed.trim() === typeToConfirm;
  const inputId = React.useId();
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleOpenChange = (next: boolean) => {
    if (pending) return;
    if (!next) {
      setTyped("");
      setError(null);
    }
    onOpenChange(next);
  };

  const confirm = async (event?: React.SyntheticEvent) => {
    event?.preventDefault();
    if (!typedOk || pending) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      setTyped("");
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The action failed. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog.Root open={open} onOpenChange={handleOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={overlayClass} />
        <AlertDialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-32px)] max-w-[480px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl bg-surface shadow-lg outline-none"
          data-variant={variant}
          onOpenAutoFocus={(event) => {
            if (!typeToConfirm) return;
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <div className={cn("flex items-start gap-2.5 px-5 py-3.5", style.band)}>
            <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <AlertDialog.Title className="text-[14px] font-semibold leading-5">{title}</AlertDialog.Title>
          </div>
          <div className="px-5 py-4">
            {description ? (
              <AlertDialog.Description className="text-[13px] leading-5 text-body">{description}</AlertDialog.Description>
            ) : (
              <AlertDialog.Description className="sr-only">Confirm this action</AlertDialog.Description>
            )}
            {records ? <RecordsTable records={records} /> : null}
            {children}
            {typeToConfirm ? (
              <div className="mt-3 flex flex-col gap-1.5">
                <label htmlFor={inputId} className="text-[12px] text-body">
                  Type <span className="font-mono font-semibold text-foreground">{typeToConfirm}</span> to confirm
                </label>
                <input
                  ref={inputRef}
                  id={inputId}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    void confirm();
                  }}
                  autoComplete="off"
                  spellCheck={false}
                  className="h-8 rounded-md border border-border-strong/70 bg-surface px-2.5 text-[13px] text-body focus:border-info focus:outline-none focus:ring-2 focus:ring-info/25"
                />
              </div>
            ) : null}
            {error ? (
              <p role="alert" className="mt-3 rounded-md bg-danger-soft px-2.5 py-1.5 text-[12px] text-danger">
                {error}
              </p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2 border-t border-border bg-surface-sunken px-5 py-3">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary" disabled={pending}>
                {cancelLabel}
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button variant={style.button} onClick={confirm} disabled={!typedOk || pending} aria-busy={pending}>
                {pending ? <Spinner className="h-3.5 w-3.5" label="Working" /> : null}
                {confirmLabel}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
