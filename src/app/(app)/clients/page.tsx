import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { requirePagePermission } from "@/server/auth/permissions";
import { ClientsPage } from "@/components/clients/clients-page";

export const metadata: Metadata = { title: "Clients" };

/** Server-side gate: roles without settings.clients.view land on /forbidden instead of page chrome with a retryable 403. */
async function Gated() {
  await requirePagePermission("settings.clients.view", "/clients");
  return <ClientsPage />;
}

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Gated />
    </Suspense>
  );
}
