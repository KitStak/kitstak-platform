import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { CustomFieldsPage } from "@/components/admin/custom-fields/custom-fields-page";
import { CUSTOM_FIELD_MANAGER_PERMISSIONS } from "@/lib/grid-defs/admin/custom-fields";
import { requirePagePermission } from "@/server/auth/permissions";
import type { PermissionKey } from "@/server/auth/permission-catalog";

export const metadata: Metadata = { title: "Custom Fields" };

async function Guard() {
  await requirePagePermission(CUSTOM_FIELD_MANAGER_PERMISSIONS as readonly PermissionKey[], "/settings/custom-fields");
  return <CustomFieldsPage />;
}

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Guard />
    </Suspense>
  );
}
