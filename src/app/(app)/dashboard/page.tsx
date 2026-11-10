import type { Metadata } from "next";
import { Suspense } from "react";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import DashboardLoading from "./loading";

export const metadata: Metadata = { title: "Dashboard" };

/** The filter selection lives in the URL (useSearchParams), so the view renders inside Suspense. */
export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <DashboardView />
    </Suspense>
  );
}
