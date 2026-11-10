import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { BillingEditPage } from "@/components/billing/billing-edit-page";

export const metadata: Metadata = { title: "Billing form" };

async function Detail({ params }: { readonly params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BillingEditPage id={id} />;
}

export default function Page({ params }: { readonly params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Detail params={params} />
    </Suspense>
  );
}
