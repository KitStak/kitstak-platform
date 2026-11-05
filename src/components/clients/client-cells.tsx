"use client";

import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";

/** Deterministic gradient tiles so the same client always gets the same avatar. */
const AVATAR_GRADIENTS = [
  "bg-gradient-to-br from-indigo-500 to-blue-600",
  "bg-gradient-to-br from-violet-500 to-fuchsia-600",
  "bg-gradient-to-br from-sky-500 to-cyan-600",
  "bg-gradient-to-br from-emerald-500 to-teal-600",
  "bg-gradient-to-br from-amber-500 to-orange-600",
  "bg-gradient-to-br from-rose-500 to-pink-600",
] as const;

function hashOf(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) % 2147483647;
  }
  return hash;
}

export function ClientAvatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
  const gradient =
    AVATAR_GRADIENTS[hashOf(name) % AVATAR_GRADIENTS.length] ?? AVATAR_GRADIENTS[0];
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-bold leading-none text-white shadow-xs",
        gradient
      )}
    >
      {initials}
    </span>
  );
}

export function ContactCell({ name, email }: { name: string; email: string }) {
  return (
    <span className="flex min-w-0 flex-col py-1 leading-tight">
      <span className="truncate text-[13px] text-body">{name}</span>
      <span className="truncate text-[11px] text-faint">{email}</span>
    </span>
  );
}

export function PlanChip({ plan }: { plan: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-surface-sunken px-2 py-0.5 text-[11px] font-medium leading-4 text-secondary whitespace-nowrap">
      {plan}
    </span>
  );
}

export function ClientRowActions({ name }: { name: string }) {
  return (
    <Dropdown
      align="end"
      trigger={() => (
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${name}`}>
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </Button>
      )}
    >
      {(close) => (
        <>
          <DropdownItem onClick={close}>View client</DropdownItem>
          <DropdownItem onClick={close}>Edit client</DropdownItem>
          <DropdownSeparator />
          <DropdownItem destructive onClick={close}>
            Deactivate
          </DropdownItem>
        </>
      )}
    </Dropdown>
  );
}
