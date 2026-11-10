import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { AppsPage } from "@/components/admin/apps/apps-page";
import { requirePagePermission } from "@/server/auth/permissions";

export const metadata: Metadata = { title: "Apps" };

async function Guard() {
  await requirePagePermission(["settings.add_ons.view", "settings.company_settings.view"], "/settings/apps");
  return <AppsPage />;
}

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Guard />
    </Suspense>
  );
}
