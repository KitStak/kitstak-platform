import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { PoCreatePage } from "@/components/receiving/po-create-page";
import { requirePagePermission } from "@/server/auth/permissions";

export const metadata: Metadata = { title: "Create purchase order" };

/** Server-side gate: roles without PO create permission land on /forbidden (the API also rejects the POST). */
async function Gated() {
  await requirePagePermission("inventory.purchase_orders.create", "/receiving/new");
  return <PoCreatePage />;
}

/** Create Purchase Order wizard. Client component (drafts, route state) inside Suspense. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Gated />
    </Suspense>
  );
}
