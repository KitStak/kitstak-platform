import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { WaveRulesPage } from "@/components/wave-rules/wave-rules-page";

export const metadata: Metadata = { title: "Wave rules" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <WaveRulesPage />
    </Suspense>
  );
}
