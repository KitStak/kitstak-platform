"use client";

/**
 * Integration Management (`/integrations/channels`, `/integrations/carriers`; spec 06 §7):
 * left category menu (All / Channel Integrations / Carrier Integrations) and logo cards with
 * CONNECTED + "Show N Integrated …", or Connect Now! (beta / coming soon flagged honestly).
 */
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Clock, Plug, Search } from "lucide-react";
import { useApiQuery } from "@/lib/query-client";
import { svgDataUri } from "@/lib/channel-catalog";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { TextField } from "@/components/ui/text-field";
import { DisabledReason } from "@/components/ui/tooltip";
import { VerticalNav } from "@/components/ui/tabs";
import type { CatalogCard } from "@/server/repositories/channels";

function Card({ card }: { readonly card: CatalogCard }) {
  const router = useRouter();
  const href = `/integrations/${card.kind === "channel" ? "channels" : "carriers"}/${card.key}`;
  const soon = card.availability === "coming-soon";
  const noun = card.kind === "channel" ? (card.connected === 1 ? "Integrated Channel" : "Integrated Channels") : (card.connected === 1 ? "Integrated Carrier" : "Integrated Carriers");
  return (
    <article className={cn("group relative flex flex-col items-center gap-3 rounded-xl border bg-surface px-4 pb-4 pt-6 text-center shadow-sm transition-shadow hover:shadow-md", card.connected > 0 ? "border-success/40" : "border-border")}>
      <span className="absolute right-3 top-3 flex gap-1">
        {card.availability === "beta" ? <Badge size="sm" tone="warning">Beta</Badge> : null}
        {!card.hasLiveApi && !soon ? <Badge size="sm" tone="neutral" title="Live API adapter not built yet; KitStaks Sandbox stores work">Sandbox</Badge> : null}
      </span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={svgDataUri(card.logoSvg)} alt="" width={56} height={56} className="rounded-xl" />
      <div>
        <h3 className="text-[14px] font-semibold text-foreground">{card.name}</h3>
        <p className="mt-0.5 line-clamp-2 text-[12px] leading-4 text-secondary">{card.description}</p>
      </div>
      {card.connected > 0 ? (
        <div className="flex flex-col items-center gap-1">
          <span className="inline-flex items-center gap-1 text-[11px] font-bold tracking-wide text-success"><CheckCircle2 className="h-3.5 w-3.5" />CONNECTED</span>
          <Link href={href} className="text-[12px] font-medium text-primary hover:underline">Show {card.connected} {noun}</Link>
        </div>
      ) : soon ? (
        <DisabledReason reason="This integration is on the roadmap and can't be connected yet"><Button size="sm" variant="secondary" disabled><Clock className="h-3.5 w-3.5" />Coming soon</Button></DisabledReason>
      ) : (
        <Button size="sm" variant="primary" onClick={() => router.push(`${href}?connect=1`)}><Plug className="h-3.5 w-3.5" />Connect Now!</Button>
      )}
    </article>
  );
}

export function IntegrationCatalogPage({ kind }: { readonly kind: "channel" | "carrier" }) {
  const params = useSearchParams();
  const all = params.get("category") === "all";
  const [q, setQ] = React.useState("");
  const data = useApiQuery<CatalogCard[]>(["integration-catalog"], "/api/channels/catalog", { staleTime: 15_000 });
  const cards = (data.data?.data ?? []).filter((c) => (all || c.kind === kind) && c.name.toLowerCase().includes(q.trim().toLowerCase()));
  const sorted = [...cards].sort((a, b) => Number(b.connected > 0) - Number(a.connected > 0) || Number(a.availability === "coming-soon") - Number(b.availability === "coming-soon"));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Integration Management" tabs="integrations"
        helper={kind === "carrier" && !all ? "Connect carrier accounts to rate shop, buy labels and void them. The KitStaks Sandbox carrier is always available for testing." : "Connect KitStaks to e-commerce stores or carriers to streamline your process. Every channel also offers a KitStaks Sandbox store for testing."} />
      <div className="flex flex-1 gap-6 px-6 pb-6">
        <aside className="w-56 shrink-0">
          <VerticalNav ariaLabel="Integration categories" active={all ? "all" : kind} items={[
            { key: "all", label: "All", href: `/integrations/channels?category=all` },
            { key: "channel", label: "Channel Integrations", href: "/integrations/channels" },
            { key: "carrier", label: "Carrier Integrations", href: "/integrations/carriers" },
          ]} />
        </aside>
        <section className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex items-center gap-3">
            <TextField aria-label="Search integrations" placeholder="Search integrations" value={q} onChange={(e) => setQ(e.target.value)} leading={<Search className="h-4 w-4" />} wrapperClassName="w-72" />
            {data.isPending ? null : <span className="text-[12px] text-secondary">{sorted.filter((c) => c.connected > 0).length} connected · {sorted.length} shown</span>}
          </div>
          {data.isPending ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-48 w-full rounded-xl" />)}</div>
          ) : data.isError ? (
            <EmptyState title="Couldn't load integrations" description={data.error.message} action={<Button onClick={() => void data.refetch()}>Retry</Button>} />
          ) : sorted.length === 0 ? (
            <EmptyState title="No integrations match" description={`Nothing matches “${q}”.`} action={<Button variant="secondary" onClick={() => setQ("")}>Clear search</Button>} />
          ) : (
            <>
              {all ? <h2 className="text-[12px] font-semibold uppercase tracking-wide text-secondary">Channels &amp; carriers</h2> : null}
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{sorted.map((c) => <Card key={`${c.kind}-${c.key}`} card={c} />)}</div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
