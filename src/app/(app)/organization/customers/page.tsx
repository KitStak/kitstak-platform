import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { CustomersPage } from "@/components/organization/customers-page";

export const metadata: Metadata = { title: "Customers" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CustomersPage />
    </Suspense>
  );
}
