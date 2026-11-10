import * as React from "react";
import { AlertTriangle, Info, X, XCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type CalloutVariant = "attention" | "info" | "error" | "success";

const STYLES: Readonly<Record<CalloutVariant, { readonly box: string; readonly icon: string; readonly Icon: React.ComponentType<{ className?: string }> }>> = {
  attention: { box: "border-warning/30 bg-warning-soft", icon: "text-warning", Icon: AlertTriangle },
  info: { box: "border-primary/25 bg-primary-soft", icon: "text-primary", Icon: Info },
  error: { box: "border-danger/30 bg-danger-soft", icon: "text-danger", Icon: XCircle },
  success: { box: "border-success/30 bg-success-soft", icon: "text-success", Icon: CheckCircle2 },
};

export interface CalloutProps {
  readonly variant?: CalloutVariant;
  readonly title?: React.ReactNode;
  readonly children?: React.ReactNode;
  readonly action?: React.ReactNode;
  readonly onDismiss?: () => void;
  readonly className?: string;
}

/** Inline banner: Attention / Info / Error (+ Success). Errors are announced. */
export function Callout({ variant = "info", title, children, action, onDismiss, className }: CalloutProps) {
  const style = STYLES[variant];
  const Icon = style.Icon;
  return (
    <div role={variant === "error" ? "alert" : "status"} className={cn("flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5", style.box, className)}>
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", style.icon)} aria-hidden />
      <div className="min-w-0 flex-1 text-[13px] leading-5 text-body">
        {title ? <p className="font-semibold text-foreground">{title}</p> : null}
        {children ? <div className={title ? "mt-0.5 text-secondary" : undefined}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
      {onDismiss ? (
        <button type="button" aria-label="Dismiss" onClick={onDismiss} className="-mr-1 rounded p-1 text-faint transition-colors hover:bg-black/5 hover:text-body">
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
