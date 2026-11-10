import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { PoCreatePage } from "@/components/receiving/po-create-page";

export const metadata: Metadata = { title: "Create purchase order" };

/** Create Purchase Order wizard. Client component (drafts, route state) inside Suspense. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PoCreatePage />
    </Suspense>
  );
}
