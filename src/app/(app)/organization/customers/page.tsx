import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { requirePagePermission } from "@/server/auth/permissions";
import { CustomersPage } from "@/components/organization/customers-page";

export const metadata: Metadata = { title: "Customers" };

/** Server-side gate: roles without settings.customers.view land on /forbidden instead of page chrome with a retryable 403. */
async function Gated() {
  await requirePagePermission("settings.customers.view", "/organization/customers");
  return <CustomersPage />;
}

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Gated />
    </Suspense>
  );
}
