'use client';

import * as React from 'react';
import { Boxes, Plus, Upload } from 'lucide-react';
import { Delta, StatRow, StatTile } from '@kitstak/ui/dashboard';
import { STATUS_DOMAINS, type StatusDomain } from '@/lib/status-colors';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Barcode } from '@/components/ui/barcode';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { EmptyState } from '@/components/ui/empty-state';
import { Kbd, KeyCombo } from '@/components/ui/kbd';
import { FilterChip } from '@/components/ui/filter-chip';
import { ProgressBar } from '@/components/ui/progress-bar';
import { ProgressRing } from '@/components/ui/progress-ring';
import { Skeleton, SkeletonTable } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import {
  ChannelBadge,
  DifferencePill,
  PriorityFlag,
  StatusPill,
  YesNoPill,
} from '@/components/ui/status-pill';
import { ShowcaseSection, Specimen } from './showcase-section';

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (c) => c.toUpperCase());
}

const DOMAIN_LABELS: Readonly<Record<string, string>> = {
  shipmentOrder: 'Shipment order',
  purchaseOrder: 'Purchase order',
  shipmentPlan: 'Shipment plan',
  workOrder: 'Work order',
  labelType: 'Label type',
  yesNo: 'Yes / No',
  eod: 'End of day',
};

function StatusMaps() {
  const domains = Object.keys(STATUS_DOMAINS) as StatusDomain[];
  return (
    // CSS columns pack the cards by height, so short maps never leave holes beside long ones.
    <div className="w-full gap-3 md:columns-2 xl:columns-3">
      {domains.map((domain) => (
        <div key={domain} className="mb-3 break-inside-avoid rounded-lg border border-border p-3">
          <p className="mb-2 text-2xs font-semibold text-secondary">
            {DOMAIN_LABELS[domain] ?? titleCase(domain)}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {Object.keys(STATUS_DOMAINS[domain as keyof typeof STATUS_DOMAINS]).map((status) => (
              <StatusPill key={status} status={status} domain={domain} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function DisplayShowcase() {
  return (
    <ShowcaseSection
      id="display"
      title="Display"
      description="Buttons, badges, the 0.5 status maps, progress, tiles, callouts, barcodes and empty states."
    >
      <Specimen label="Buttons">
        <Button variant="primary">
          <Plus className="h-4 w-4" aria-hidden />
          Create order
        </Button>
        <Button>Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Delete</Button>
        <Button variant="success-outline">Export As Excel</Button>
        <Button variant="primary" disabled>
          Disabled
        </Button>
        <Button size="sm">Small</Button>
        <Button size="lg" variant="primary">
          Large
        </Button>
        <Button size="icon" aria-label="Upload">
          <Upload className="h-4 w-4" aria-hidden />
        </Button>
      </Specimen>
      <Specimen label="Badges">
        {(['neutral', 'success', 'warning', 'danger', 'info', 'outline'] as const).map((tone) => (
          <Badge key={tone} tone={tone}>
            {tone}
          </Badge>
        ))}
        <Badge tone="info" icon={Boxes}>
          Kit
        </Badge>
      </Specimen>
      <Specimen label="Status pills">
        <StatusMaps />
      </Specimen>
      <Specimen label="Priority, difference, yes/no, channel">
        <PriorityFlag priority="Urgent" />
        <PriorityFlag priority="High" />
        <PriorityFlag priority="Medium" />
        <DifferencePill value={-4} />
        <DifferencePill value={3} />
        <YesNoPill value />
        <YesNoPill value={false} />
        <ChannelBadge channel="shopify" store="Apex Threads" />
        <ChannelBadge channel="amazon" />
      </Specimen>
      <Specimen label="Avatars & keys">
        <Avatar name="Mike Lunsford" size="sm" />
        <Avatar name="Dana Ortiz" />
        <Avatar name="Jade Okafor" size="lg" />
        <Kbd>Esc</Kbd>
        <KeyCombo combo="mod+k" />
      </Specimen>
      <Specimen label="Progress">
        <ProgressRing value={68} />
        <ProgressRing value={100} tone="success" center="truck" />
        <ProgressRing value={25} tone="warning" size={48} />
        <div className="w-60 space-y-2">
          <ProgressBar value={42} showValue />
          <ProgressBar value={90} tone="success" size="sm" />
        </div>
        <Spinner />
      </Specimen>
      <Specimen label="Stat tiles & filter chips">
        <div className="w-full">
          <StatRow label="Example totals">
            <StatTile
              label="Orders to ship"
              value="1,284"
              href="/orders"
              delta={{ text: '+12%', direction: 'up', tone: 'neutral' }}
              deltaLabel="vs yesterday"
            />
            <StatTile label="Units picked" value="18,402" href="/inventory" caption="Last 24 h" />
            <StatTile
              label="Shortages"
              value="7"
              href="/orders?f.status=in%3AShortage"
              delta={{ text: '-30%', direction: 'down', tone: 'good' }}
            />
          </StatRow>
        </div>
        <Delta text="+4" direction="up" tone="bad" />
        <FilterChip label="All" count="412" active onClick={() => undefined} />
        <FilterChip
          label="Ready to pick"
          count="86"
          dot="var(--info)"
          active={false}
          onClick={() => undefined}
        />
        <FilterChip
          label="Shortage"
          count="7"
          dot="var(--warning)"
          active={false}
          onClick={() => undefined}
        />
      </Specimen>
      <Specimen label="Callouts">
        <div className="grid w-full gap-2 md:grid-cols-2">
          <Callout variant="attention" title="Attention">
            Two orders have unverified addresses.
          </Callout>
          <Callout variant="info" title="Info">
            Wave rules run every 15 minutes.
          </Callout>
          <Callout variant="error" title="Error">
            Carrier rate call failed for SBX_2DAY.
          </Callout>
          <Callout variant="success" title="Done">
            Inventory snapshot completed.
          </Callout>
        </div>
      </Specimen>
      <Specimen label="Barcodes">
        <Barcode value="SO010421" aria-label="Order barcode SO010421" />
        <Barcode value="LP000123" type="code128" height={10} />
      </Specimen>
      <Specimen label="Skeletons">
        <div className="w-full space-y-2">
          <Skeleton className="h-4 w-48" />
          <SkeletonTable rows={3} columns={5} />
        </div>
      </Specimen>
      <Specimen label="Empty state">
        <div className="w-full rounded-lg border border-dashed border-border-strong">
          <EmptyState
            title="No orders yet"
            description="Create your first shipment order or import a file."
            cards={[
              { title: 'Create order', description: 'Single order wizard', icon: Plus, href: '/orders/new' },
              {
                title: 'Import file',
                description: 'Bulk upload from Excel',
                icon: Upload,
                href: '/imports/shipment-orders',
              },
            ]}
          />
        </div>
      </Specimen>
    </ShowcaseSection>
  );
}
