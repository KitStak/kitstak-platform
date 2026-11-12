import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { ChannelMethodsPage } from "@/components/integrations/logs/logs-pages";

export const metadata: Metadata = { title: "Channel Methods" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ChannelMethodsPage  />
    </Suspense>
  );
}
