import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { ChannelConnectionsPage } from "@/components/integrations/channels/channel-connections-page";

export const metadata: Metadata = { title: "Channel Connections" };

async function Content({ params }: { readonly params: Promise<{ provider: string }> }) {
  const p = await params;
  return <ChannelConnectionsPage provider={p.provider} />;
}

export default function Page({ params }: { readonly params: Promise<{ provider: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={params} />
    </Suspense>
  );
}
