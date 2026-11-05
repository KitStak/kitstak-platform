"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ColumnDef } from "@tanstack/react-table";
import { Copy, Eye, MoreHorizontal, Package, PencilLine, Power } from "lucide-react";
import { cn, formatDate, formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";
import { StatusPill } from "@/components/ui/status-pill";
import {
  categoryTileClass,
  createdAtFor,
  isFragileHint,
  isHazmatHint,
  isOversized,
} from "./derive";
import type { ProductRow } from "./types";

export function ProductImageTile({
  category,
  className,
  iconClassName,
}: {
  category: string;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <span
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md",
        categoryTileClass(category),
        className
      )}
      aria-hidden
    >
      <Package className={cn("h-3.5 w-3.5", iconClassName)} />
    </span>
  );
}

export function CategoryChip({ category }: { category: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-neutral-soft px-2 py-0.5 text-[11px] font-medium text-neutral whitespace-nowrap">
      {category}
    </span>
  );
}

export function KitChip({ isKit }: { isKit: boolean }) {
  if (!isKit) return <span className="text-[12px] text-faint">—</span>;
  return (
    <span className="inline-flex items-center rounded bg-primary-soft px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-primary">
      KIT
    </span>
  );
}

export function YesNo({ value }: { value: boolean }) {
  return value ? (
    <span className="text-[12px] font-medium text-warning">Yes</span>
  ) : (
    <span className="text-[12px] text-faint">No</span>
  );
}

function RowMenu({ row }: { row: ProductRow }) {
  const router = useRouter();
  return (
    <Dropdown
      align="end"
      trigger={() => (
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.sku}`}>
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
    header: "Image",
    size: 56,
    enableSorting: false,
    cell: ({ row }) => <ProductImageTile category={row.original.category} />,
  },
  {
    accessorKey: "clientName",
    header: "Client",
    cell: ({ row }) => (
      <span className="block max-w-[140px] truncate text-body" title={row.original.clientName}>
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
    header: "Barcode",
    cell: ({ row }) => (
      <span className="font-mono text-[12px] tabular-nums text-secondary">
        {row.original.barcode}
      </span>
    ),
  },
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <span className="block max-w-[260px] truncate text-body" title={row.original.name}>
        {row.original.name}
      </span>
    ),
  },
  {
    accessorKey: "category",
    header: "Category",
    cell: ({ row }) => <CategoryChip category={row.original.category} />,
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusPill status={row.original.status} />,
  },
  {
    accessorKey: "isKit",
    header: "Kit",
    size: 56,
    cell: ({ row }) => <KitChip isKit={row.original.isKit} />,
  },
  {
    id: "fragile",
    header: "Fragile",
    size: 72,
    enableSorting: false,
    cell: ({ row }) => <YesNo value={isFragileHint(row.original.name)} />,
  },
  {
    id: "oversized",
    header: "Oversized",
    size: 84,
    enableSorting: false,
    cell: ({ row }) => <YesNo value={isOversized(row.original.weightOz)} />,
  },
  {
    id: "hazmat",
    header: "Hazmat",
    size: 72,
    enableSorting: false,
    cell: ({ row }) => <YesNo value={isHazmatHint(row.original.name)} />,
  },
  {
    accessorKey: "price",
    header: "Price",
    size: 84,
    cell: ({ row }) => (
      <div className="text-right tabular-nums text-body">
        {formatMoney(row.original.price)}
      </div>
    ),
  },
  {
    accessorKey: "weightOz",
    header: "Weight (oz)",
    size: 92,
    cell: ({ row }) => (
      <div className="text-right tabular-nums text-secondary">
        {row.original.weightOz.toFixed(1)}
      </div>
    ),
  },
  {
    id: "createdAt",
    header: "Created",
    size: 104,
    enableSorting: false,
    cell: ({ row }) => (
      <span className="text-secondary">{formatDate(createdAtFor(row.original.id))}</span>
    ),
  },
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
