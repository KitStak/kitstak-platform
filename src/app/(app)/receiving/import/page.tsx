import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getImportDefinition, summarizeImport } from "@/server/imports";
import { requirePagePermission } from "@/server/auth/permissions";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { PoImportPage, type PoImportDefinition } from "@/components/receiving/po-import-page";

export const metadata: Metadata = { title: "Import purchase orders" };

type SearchParams = Promise<{ type?: string | string[] }>;

const KEYS = [
  { key: "purchase-orders", label: "Purchase orders" },
  { key: "po-serials", label: "Serial numbers" },
] as const;

async function ImportRoute({ searchParams }: { readonly searchParams: SearchParams }) {
  const { type } = await searchParams;
  await requirePagePermission(["inventory.purchase_orders.import_file", "inventory.purchase_orders.import_serial_numbers"], "/receiving/import");
  const defs: PoImportDefinition[] = KEYS.flatMap(({ key, label }) => {
    const def = getImportDefinition(key);
    if (!def) return [];
    const s = summarizeImport(def);
    return [{ key, label, title: s.title, description: s.description, configured: s.configured, permission: s.permission, columns: s.columns }];
  });
  if (defs.length === 0) notFound();
  const initialKey = type === "po-serials" ? "po-serials" : "purchase-orders";
  return <PoImportPage defs={defs} initialKey={initialKey} />;
}

/** `/receiving/import`: PO and serial-number imports with template, manual, upload and history. */
export default function Page({ searchParams }: { readonly searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ImportRoute searchParams={searchParams} />
    </Suspense>
  );
}
