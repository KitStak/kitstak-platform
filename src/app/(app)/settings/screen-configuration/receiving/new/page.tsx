import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { ScreenConfigEditorPage } from "@/components/admin/screen-configs/editor-page";
import { requirePagePermission } from "@/server/auth/permissions";

export const metadata: Metadata = { title: "Create receiving configuration" };

async function Guard() {
  await requirePagePermission("settings.screen_configuration.create", "/settings/screen-configuration/receiving/new");
  return <ScreenConfigEditorPage editId={null} />;
}

/** `/settings/screen-configuration/receiving/new` — General / Conditions / Configuration. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Guard />
    </Suspense>
  );
}
