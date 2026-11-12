import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { RolesPage } from "@/components/admin/roles/roles-page";
import { requirePagePermission } from "@/server/auth/permissions";

export const metadata: Metadata = { title: "Roles" };

async function Guard() {
  await requirePagePermission("settings.roles.view", "/settings/roles");
  return <RolesPage />;
}

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Guard />
    </Suspense>
  );
}
