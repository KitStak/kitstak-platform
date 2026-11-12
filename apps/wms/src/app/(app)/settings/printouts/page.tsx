import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { PrintoutTypesPage } from "@/components/admin/printouts/types-page";
import { requirePagePermission } from "@/server/auth/permissions";

export const metadata: Metadata = { title: "Printouts & Labels" };

async function Guard() {
  await requirePagePermission("settings.printouts_labels.view", "/settings/printouts");
  return <PrintoutTypesPage />;
}

/** `/settings/printouts` — printout type cards by category (M14 #8). */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Guard />
    </Suspense>
  );
}
