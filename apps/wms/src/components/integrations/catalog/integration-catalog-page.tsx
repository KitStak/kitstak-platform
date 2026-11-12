'use client';

/**
 * Integration Management (`/integrations/channels`, `/integrations/carriers`; spec 06 §7):
 * left category menu (All / Channel Integrations / Carrier Integrations) and logo cards with
 * a Connected (N) badge with Manage / Add, or Connect (beta / coming soon flagged honestly).
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Clock, Plug, Search } from 'lucide-react';
import { useApiQuery } from '@/lib/query-client';
import { svgDataUri } from '@/lib/channel-catalog';
import { brandMarkSvg } from '@/components/integrations/shared/brand-marks';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { TextField } from '@/components/ui/text-field';
import { DisabledReason } from '@/components/ui/tooltip';
import { VerticalNav } from '@/components/ui/tabs';
import type { CatalogCard } from '@/server/repositories/channels';
import { NO_PERMISSION, usePagePerms } from '@/components/integrations/shared/shared';

const CREATE_PERMS = ['create_setup'] as const;
const SANDBOX_ONLY: Readonly<Record<'channel' | 'carrier', string>> = {
  channel:
    "No live connection yet: KitStak can't connect to a real account for this integration today. Connecting creates a KitStak Sandbox store that simulates orders, inventory sync and shipment confirmation, so you can configure and test end to end.",
  carrier:
    "No live connection yet: KitStak can't reach this carrier's API today. Connecting creates a simulated carrier that validates requests and returns sandbox rates and labels, so you can configure rate shopping and labels end to end.",
};

/** Live adapter not yet exercised against a real account here: honest Beta, not "Live API". */
const UNVERIFIED =
  "Live adapter built to the provider's published API, not yet validated against a live account in this workspace. It switches to Live API after a connected account completes a successful call (Run on Channel Methods, or a rate/label call). Connecting already checks the credentials against the provider's API.";
const noApi = (card: CatalogCard) => card.key === 'kitstaks-sandbox' || card.key === 'custom-carrier';

function Card({ card, canCreate }: { readonly card: CatalogCard; readonly canCreate: boolean }) {
  const router = useRouter();
  const sandboxOnly = !card.hasLiveApi && card.availability !== 'coming-soon';
  const href = `/integrations/${card.kind === 'channel' ? 'channels' : 'carriers'}/${card.key}`;
  const soon = card.availability === 'coming-soon';
  const noun =
    card.kind === 'channel'
      ? card.connected === 1
        ? 'Integrated Channel'
        : 'Integrated Channels'
      : card.connected === 1
        ? 'Integrated Carrier'
        : 'Integrated Carriers';
  return (
    <article
      className={cn(
        'group relative flex h-full min-h-[244px] flex-col items-center gap-3 rounded-xl border bg-surface px-4 pb-4 pt-6 text-center shadow-sm transition-shadow hover:shadow-md',
        card.connected > 0 ? 'border-success/40' : 'border-border',
      )}
    >
      <span className="absolute right-3 top-3 flex gap-1">
        {card.availability === 'beta' || (card.hasLiveApi && !card.liveVerified && !noApi(card)) ? (
          <Badge
            size="sm"
            tone="warning"
            title={card.hasLiveApi && !card.liveVerified ? UNVERIFIED : undefined}
          >
            Beta
          </Badge>
        ) : null}
        {!card.hasLiveApi && !soon ? (
          <Badge size="sm" tone="neutral" title={SANDBOX_ONLY[card.kind]}>
            Sandbox only
          </Badge>
        ) : null}
        {card.key === 'custom-carrier' ? (
          <Badge
            size="sm"
            tone="neutral"
            title="Your own carrier with manual tracking numbers: no carrier API is called"
          >
            No API
          </Badge>
        ) : null}
        {card.liveVerified && !noApi(card) ? (
          <Badge
            size="sm"
            tone="success"
            title="Verified: a connected account in this workspace has completed successful live API calls"
          >
            Live API
          </Badge>
        ) : null}
      </span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={svgDataUri(
          card.key === 'kitstaks-sandbox' ? card.logoSvg : brandMarkSvg(card.kind, card.key, card.logoSvg),
        )}
        alt=""
        width={56}
        height={56}
        className="rounded-xl"
      />
      <div>
        <h3 className="text-base font-semibold text-foreground">{card.name}</h3>
        <p className="mt-0.5 line-clamp-2 min-h-8 text-xs leading-4 text-secondary">{card.description}</p>
        <Link
          href={`/integrations/help#${card.kind === 'carrier' ? `carrier-${card.key}` : card.key}`}
          target="_blank"
          className="mt-1 inline-block text-2xs font-medium text-primary hover:underline"
          aria-label={`Learn more about ${card.name}`}
        >
          Learn more
        </Link>
      </div>
      {/* Fixed-height footer pinned to the bottom so every card in the grid is the same height. */}
      <div className="mt-auto flex h-[60px] w-full flex-col items-center justify-end gap-1.5">
        {card.connected > 0 ? (
          <div className="flex flex-col items-center gap-1.5">
            <Badge size="sm" tone="success">
              <CheckCircle2 className="h-3 w-3" aria-hidden />
              Connected ({card.connected})
            </Badge>
            <span className="flex items-center gap-2">
              <Link
                href={href}
                className={buttonVariants({ size: 'sm', variant: 'secondary' })}
                aria-label={`Manage ${card.connected} ${noun.toLowerCase()} for ${card.name}`}
              >
                Manage
              </Link>
              {canCreate ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => router.push(`${href}?connect=1`)}
                  aria-label={`Add another ${card.name} connection`}
                >
                  <Plug className="h-3.5 w-3.5" />
                  Add
                </Button>
              ) : null}
            </span>
          </div>
        ) : soon ? (
          <DisabledReason reason="This integration is on the roadmap and can't be connected yet">
            <Button size="sm" variant="secondary" disabled>
              <Clock className="h-3.5 w-3.5" />
              Coming soon
            </Button>
          </DisabledReason>
        ) : !canCreate ? (
          <DisabledReason reason={NO_PERMISSION}>
            <Button size="sm" variant="secondary" disabled>
              <Plug className="h-3.5 w-3.5" />
              Connect
            </Button>
          </DisabledReason>
        ) : (
          <>
            <Button
              size="sm"
              variant="primary"
              onClick={() => router.push(`${href}?connect=1`)}
              aria-label={
                sandboxOnly
                  ? `Connect ${card.name} as a simulated sandbox ${card.kind === 'carrier' ? 'carrier' : 'store'}`
                  : `Connect ${card.name}`
              }
            >
              <Plug className="h-3.5 w-3.5" />
              {sandboxOnly ? 'Connect sandbox' : 'Connect'}
            </Button>
            {sandboxOnly ? (
              <span className="text-2xs leading-3 text-secondary" title={SANDBOX_ONLY[card.kind]}>
                No live connection yet · simulated {card.kind === 'carrier' ? 'carrier' : 'store'}
              </span>
            ) : null}
          </>
        )}
      </div>
    </article>
  );
}

export function IntegrationCatalogPage({ kind }: { readonly kind: 'channel' | 'carrier' }) {
  const params = useSearchParams();
  const perms = usePagePerms('integrations.integrations', CREATE_PERMS);
  const all = params.get('category') === 'all';
  const [q, setQ] = React.useState('');
  const data = useApiQuery<CatalogCard[]>(['integration-catalog'], '/api/channels/catalog', {
    staleTime: 15_000,
  });
  const cards = (data.data?.data ?? []).filter(
    (c) => (all || c.kind === kind) && c.name.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const sorted = [...cards].sort(
    (a, b) =>
      Number(b.connected > 0) - Number(a.connected > 0) ||
      Number(a.availability === 'coming-soon') - Number(b.availability === 'coming-soon'),
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Integration Management"
        tabs="integrations"
        helpHref="/integrations/help"
        helper={
          kind === 'carrier' && !all
            ? 'Connect carrier accounts to rate shop and buy or void labels.'
            : 'Connect stores and carriers. Every channel also offers a KitStak Sandbox store.'
        }
      />
      <div className="flex flex-1 gap-6 px-6 pb-6">
        <aside className="w-56 shrink-0">
          <VerticalNav
            ariaLabel="Integration categories"
            active={all ? 'all' : kind}
            items={[
              { key: 'all', label: 'All', href: `/integrations/channels?category=all` },
              { key: 'channel', label: 'Channel Integrations', href: '/integrations/channels' },
              { key: 'carrier', label: 'Carrier Integrations', href: '/integrations/carriers' },
            ]}
          />
        </aside>
        <section className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex items-center gap-3">
            <TextField
              aria-label="Search integrations"
              placeholder="Search integrations"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              leading={<Search className="h-4 w-4" />}
              wrapperClassName="w-72"
            />
            {data.isPending ? null : (
              <span className="text-xs text-secondary">
                {sorted.filter((c) => c.connected > 0).length} connected · {sorted.length} shown
              </span>
            )}
          </div>
          {data.isPending ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-48 w-full rounded-xl" />
              ))}
            </div>
          ) : data.isError ? (
            <EmptyState
              title="Couldn't load integrations"
              description={data.error.message}
              action={<Button onClick={() => void data.refetch()}>Retry</Button>}
            />
          ) : sorted.length === 0 ? (
            <EmptyState
              title="No integrations match"
              description={`Nothing matches “${q}”.`}
              action={
                <Button variant="secondary" onClick={() => setQ('')}>
                  Clear search
                </Button>
              }
            />
          ) : (
            <>
              {all ? <h2 className="text-xs font-semibold text-secondary">Channels &amp; carriers</h2> : null}
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {sorted.map((c) => (
                  <Card key={`${c.kind}-${c.key}`} card={c} canCreate={perms.create_setup} />
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
