import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { SettingsHub } from "@/components/admin/settings-hub";
import { settingsHubPermissions, settingsHubSections } from "@/components/admin/settings-hub-data";
import { requirePagePermission } from "@/server/auth/permissions";
import { isPermissionKey } from "@/server/auth/permission-catalog";

export const metadata: Metadata = { title: "Settings" };

async function Hub() {
  const auth = await requirePagePermission(settingsHubPermissions().filter(isPermissionKey), "/settings");
  return <SettingsHub sections={settingsHubSections(auth.permissions as ReadonlySet<string>)} />;
}

/** `/settings` is a hub listing every section the user can open (round 4; was a redirect to Users). */
export default function SettingsIndexPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Hub />
    </Suspense>
  );
}
