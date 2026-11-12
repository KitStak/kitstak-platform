import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { requirePagePermission } from "@/server/auth/permissions";
import { RetailersPage } from "@/components/organization/retailers-page";

export const metadata: Metadata = { title: "Retailers" };

/** Server-side gate: roles without settings.retailers.view land on /forbidden instead of page chrome with a retryable 403. */
async function Gated() {
  await requirePagePermission("settings.retailers.view", "/organization/retailers");
  return <RetailersPage />;
}

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Gated />
    </Suspense>
  );
}
