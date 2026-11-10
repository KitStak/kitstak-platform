"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { comboTokens, isMacPlatform } from "@/lib/keyboard";

const subscribeNever = (): (() => void) => () => undefined;

export function Kbd({ children, className }: { readonly children: React.ReactNode; readonly className?: string }) {
  return (
    <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded border border-border-strong bg-surface-sunken px-1 font-sans text-[11px] font-medium text-secondary shadow-[0_1px_0_var(--border-strong)]", className)}>
      {children}
    </kbd>
  );
}

/** Renders a registry combo ("mod+k") as platform keys: ⌘ K or Ctrl K. */
export function KeyCombo({ combo, className }: { readonly combo: string; readonly className?: string }) {
  // Platform is only known in the browser; render the non-Mac form on the server.
  const mac = React.useSyncExternalStore(subscribeNever, isMacPlatform, () => false);
  const tokens = comboTokens(combo, mac);
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {tokens.map((t, i) => (
        <Kbd key={`${t}-${i}`}>{t}</Kbd>
      ))}
    </span>
  );
}
