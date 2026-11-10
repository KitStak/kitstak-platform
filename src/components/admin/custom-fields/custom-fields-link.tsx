"use client";

/** "Custom fields" header button for entity pages (LP Types, Shipment Packages, …) → the manager filtered to that entity. */
import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { useCan } from "@/lib/permissions-client";
import { customFieldEntityOf, customFieldsHref } from "@/lib/grid-defs/admin/custom-fields";
import type { CustomFieldEntity } from "@/lib/enums";

export function CustomFieldsLink({ entity }: { readonly entity: CustomFieldEntity }) {
  const info = customFieldEntityOf(entity);
  const { allowed } = useCan(info ? [info.permission, "settings.company_settings.view"] : [], "any");
  if (!info || !allowed) return null;
  return (
    <Link href={customFieldsHref(entity)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-body shadow-xs hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
      <SlidersHorizontal className="h-4 w-4 text-secondary" aria-hidden />Custom fields
    </Link>
  );
}
