"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ColumnDef } from "@tanstack/react-table";
import {
  Copy,
  Eye,
  Image as ImageIcon,
  MoreHorizontal,
  PencilLine,
  Power,
} from "lucide-react";
import { cn, formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";
import { StatusPill } from "@/components/ui/status-pill";
import { isFragileHint, isHazmatHint, isOversized } from "./derive";
import type { ProductRow } from "./types";

/**
 * Intentional empty-thumbnail state: 28×28 rounded-md tile with a soft
 * slate-50 fill, a 1px dashed slate-200 border, and a 14px image glyph at
 * slate-300. The dashed border + photo glyph read as "no photo on file yet"
 * (an awaiting-upload slot), never as 48 identical failed <img> loads.
 */
export function ProductImageTile({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50",
        className
      )}
      aria-hidden
    >
      <ImageIcon className="h-3.5 w-3.5 text-slate-300" />
    </span>
  );
}

/**
 * Product status cell. "Active" keeps the shared semantic StatusPill
 * (success tint). "Inactive" gets an explicit muted pill with the exact same
 * geometry (20px tall: 16px leading + 2×2px padding, 9999px radius, 11px
 * font) so the STATUS column reads as one component, never as a pill next to
 * plain bold gray text. Local override because the shared StatusPill's
 * neutral tint is too faint to register as a pill (ui/** is read-only here).
 */
export function ProductStatusPill({ status }: { status: ProductRow["status"] }) {
  if (status === "Inactive") {
    return (
      <span className="inline-flex items-center whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold leading-4 text-slate-500">
        Inactive
      </span>
    );
  }
  return <StatusPill status={status} />;
}

export function CategoryChip({ category }: { category: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-neutral-soft px-2 py-0.5 text-[11px] font-medium text-neutral whitespace-nowrap">
      {category}
    </span>
  );
}

interface ProductFlag {
  key: string;
  label: string;
  dot: string;
  text: string;
}

/**
 * Derive the handling flags a row actually carries. Pure and deterministic —
 * returns a new array each call, never mutates the row.
 */
function flagsFor(row: ProductRow): ProductFlag[] {
  const flags: ProductFlag[] = [];
  if (row.isKit) {
    flags.push({ key: "kit", label: "Kit", dot: "bg-primary", text: "text-primary" });
  }
  if (isFragileHint(row.name)) {
    flags.push({ key: "fragile", label: "Fragile", dot: "bg-warning", text: "text-warning" });
  }
  if (isOversized(row.weightOz)) {
    flags.push({ key: "oversized", label: "Oversized", dot: "bg-info", text: "text-info" });
  }
  if (isHazmatHint(row.name)) {
    flags.push({ key: "hazmat", label: "Hazmat", dot: "bg-danger", text: "text-danger" });
  }
  return flags;
}

/**
 * Single FLAGS column cell: compact dot+label badges for flags that are set.
 * Flagless rows render a muted em-dash on the column's left edge so the
 * column reads as "intentionally none" instead of broken/unpopulated data
 * (~11 of 16 visible rows carry no flags). Collapses the old KIT / FRAGILE /
 * OVERSIZED / HAZMAT columns into ~120px.
 */
export function FlagsCell({ row }: { row: ProductRow }) {
  const flags = flagsFor(row);
  if (flags.length === 0) {
    return (
      <span className="text-slate-300" aria-label="No flags">
        —
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      {flags.map((flag) => (
        <span
          key={flag.key}
          title={flag.label}
          className={cn(
            "inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium",
            flag.text
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", flag.dot)} aria-hidden />
          {flag.label}
        </span>
      ))}
    </span>
  );
}

function RowMenu({ row }: { row: ProductRow }) {
  const router = useRouter();
  return (
    <Dropdown
      align="end"
      trigger={() => (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Actions for ${row.sku}`}
          /* visible hover affordance: the "…" trigger gains a border on hover */
          className="border border-transparent hover:border-border-strong"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </Button>
      )}
    >
      {(close) => (
        <>
          <DropdownItem
            onClick={() => {
              close();
              router.push(`/products/${row.id}`);
            }}
          >
            <Eye className="h-3.5 w-3.5" aria-hidden /> View details
          </DropdownItem>
          <DropdownItem onClick={close}>
            <PencilLine className="h-3.5 w-3.5" aria-hidden /> Edit product
          </DropdownItem>
          <DropdownItem onClick={close}>
            <Copy className="h-3.5 w-3.5" aria-hidden /> Duplicate
          </DropdownItem>
          <DropdownSeparator />
          <DropdownItem destructive onClick={close}>
            <Power className="h-3.5 w-3.5" aria-hidden />
            {row.status === "Active" ? "Deactivate" : "Activate"}
          </DropdownItem>
        </>
      )}
    </Dropdown>
  );
}

export const productColumns: ColumnDef<ProductRow, unknown>[] = [
  {
    id: "image",
    header: "IMAGE",
    size: 56,
    enableSorting: false,
    cell: () => <ProductImageTile />,
  },
  {
    accessorKey: "clientName",
    header: "CLIENT",
    size: 180,
    cell: ({ row }) => (
      <span
        className="block min-w-[180px] max-w-[220px] truncate text-body"
        title={row.original.clientName}
      >
        {row.original.clientName}
      </span>
    ),
  },
  {
    accessorKey: "sku",
    header: "SKU",
    cell: ({ row }) => (
      <Link
        href={`/products/${row.original.id}`}
        onClick={(e) => e.stopPropagation()}
        className="font-medium text-primary hover:underline focus-visible:underline focus-visible:outline-none"
      >
        {row.original.sku}
      </Link>
    ),
  },
  {
    accessorKey: "barcode",
    header: "BARCODE",
    cell: ({ row }) => (
      <span className="font-mono text-[12px] tabular-nums text-secondary">
        {row.original.barcode}
      </span>
    ),
  },
  {
    accessorKey: "name",
    header: "NAME",
    size: 320,
    cell: ({ row }) => (
      <span
        className="block min-w-[320px] max-w-[360px] truncate text-body"
        title={row.original.name}
      >
        {row.original.name}
      </span>
    ),
  },
  {
    accessorKey: "category",
    header: "CATEGORY",
    cell: ({ row }) => <CategoryChip category={row.original.category} />,
  },
  {
    accessorKey: "status",
    header: "STATUS",
    cell: ({ row }) => <ProductStatusPill status={row.original.status} />,
  },
  {
    id: "flags",
    header: "FLAGS",
    size: 120,
    enableSorting: false,
    cell: ({ row }) => <FlagsCell row={row.original} />,
  },
  {
    accessorKey: "price",
    header: "PRICE",
    size: 84,
    cell: ({ row }) => (
      <div className="text-right tabular-nums text-body">
        {formatMoney(row.original.price)}
      </div>
    ),
  },
  /*
   * Weight (oz) and Created are intentionally not in the default column set:
   * at 1440px the full set clipped mid-letter at the right edge with no
   * visible horizontal scrollbar. The shared DataGrid has no prop for
   * default-hidden columns yet (see sharedComponentRequests), so fitting the
   * viewport means leaving them out here.
   */
  {
    id: "actions",
    size: 44,
    enableSorting: false,
    cell: ({ row }) => (
      <div onClick={(e) => e.stopPropagation()}>
        <RowMenu row={row.original} />
      </div>
    ),
  },
];
