import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { ClientsPage } from "@/components/clients/clients-page";

export const metadata: Metadata = { title: "Clients" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ClientsPage />
    </Suspense>
  );
}
