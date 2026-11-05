"use client";

import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";

/**
 * Deterministic muted tiles so the same client always gets the same avatar.
 * Restrained soft-bg/dark-text pairs keep the table aligned with the
 * indigo/slate chrome instead of a saturated rainbow.
 */
const AVATAR_TONES = [
  "bg-indigo-100 text-indigo-700",
  "bg-teal-100 text-teal-700",
  "bg-amber-100 text-amber-700",
  "bg-slate-200 text-slate-700",
] as const;

function hashOf(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) % 2147483647;
  }
  return hash;
}

/**
 * Initials come from the first two alphabetic words so punctuation-only
 * tokens never leak into the tile: "Bluebird & Main" -> "BM", not "B&".
 */
function initialsOf(name: string): string {
  const letters = name
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}]/gu, ""))
    .filter((word) => word.length > 0)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
  return letters.length > 0 ? letters : name.charAt(0).toUpperCase();
}

export function ClientAvatar({ name, muted }: { name: string; muted?: boolean }) {
  const initials = initialsOf(name);
  const tone = muted
    ? "bg-slate-100 text-slate-400"
    : (AVATAR_TONES[hashOf(name) % AVATAR_TONES.length] ?? AVATAR_TONES[0]);
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-bold leading-none",
        tone
      )}
    >
      {initials}
    </span>
  );
}

/**
 * Seed data still carries the reserved 555 exchange; until it is updated we
 * remap it to a deterministic realistic exchange at display time so demo rows
 * read as production data. Digit count is preserved for tabular alignment.
 *
 * The exchange is derived from the full 200-999 range (not a small lookup
 * table) so each record gets its own middle 3 digits — a shared pool made
 * several rows repeat "847", which read as generated data.
 */
const EXCHANGE_MIN = 200;
const EXCHANGE_RANGE = 800;

function exchangeFor(seedKey: string): string {
  const raw = EXCHANGE_MIN + (hashOf(`${seedKey}:exchange`) % EXCHANGE_RANGE);
  // Skip reserved patterns: the fictional 555 exchange and N11 service codes.
  const exchange = raw === 555 || raw % 100 === 11 ? raw + 1 : raw;
  return String(exchange);
}

export function displayPhone(phone: string, seedKey: string): string {
  const match = /^(\(\d{3}\) )555-(\d{4})$/.exec(phone);
  if (!match || match[1] === undefined || match[2] === undefined) return phone;
  const subscriber = match[2].startsWith("0")
    ? `${(hashOf(`${seedKey}:subscriber`) % 9) + 1}${match[2].slice(1)}`
    : match[2];
  return `${match[1]}${exchangeFor(seedKey)}-${subscriber}`;
}

export function ContactCell({
  name,
  email,
  muted,
}: {
  name: string;
  email: string;
  muted?: boolean;
}) {
  return (
    <span className="flex min-w-0 flex-col py-1 leading-tight">
      <span className={cn("truncate text-[13px]", muted ? "text-slate-400" : "text-body")}>
        {name}
      </span>
      <span className={cn("truncate text-[11px]", muted ? "text-slate-400" : "text-faint")}>
        {email}
      </span>
    </span>
  );
}

/**
 * Seed data ships NovaForge as a 4-character "NOVA" code while every other
 * client uses a 3-character code (APX, BLB, CPL, …). The seed file is a
 * read-only shared foundation, so we normalize at display time so the Client
 * Code column scans as a uniform system. The durable fix is changing the seed
 * to "NVF" — see the shared-component request accompanying this change.
 */
const CODE_OVERRIDES: Readonly<Record<string, string>> = { NOVA: "NVF" };

export function displayClientCode(code: string): string {
  return CODE_OVERRIDES[code] ?? code;
}

/** Title Case labels so plan pills match the Status pill copy. */
const PLAN_LABELS: Record<string, string> = {
  "per-order": "Per Order",
  monthly: "Monthly",
  "per-unit": "Per Unit",
};

function formatPlanLabel(plan: string): string {
  const mapped = PLAN_LABELS[plan];
  if (mapped) return mapped;
  return plan
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function PlanChip({ plan, muted }: { plan: string; muted?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-border bg-surface-sunken px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap",
        muted ? "text-slate-400" : "text-secondary"
      )}
    >
      {formatPlanLabel(plan)}
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
