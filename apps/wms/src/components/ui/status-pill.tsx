import * as React from 'react';
import { ArrowUp, ChevronsUp, FileText, ShoppingBag, Store, Truck, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  differenceTone,
  isPartialStatus,
  pillClass,
  pillStyle,
  statusLabel,
  statusTone,
  type StatusTone,
  type StatusDomain,
} from '@/lib/status-colors';

/**
 * Status pill (BUILD_PLAN 0.5). Colours come from `@/lib/status-colors`; pass `domain`
 * for entity-specific semantics (e.g. "Open" is green for orders, teal for shipment
 * plans). Without a domain the generic map is used, so existing call sites keep working.
 */
export function StatusPill({
  status,
  domain = 'generic',
  partial,
  size = 'md',
  className,
}: {
  status: string;
  domain?: StatusDomain;
  /** Force/disable the half-filled "partial" dot; defaults to statuses starting with "Partially". */
  partial?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const tone = statusTone(status, domain);
  const showPartial = partial ?? isPartialStatus(status);
  return (
    <span data-status={status} style={pillStyle(tone)} className={cn(pillClass(size), className)}>
      <PillDot tone={tone} partial={showPartial} />
      <span className="truncate">{statusLabel(status)}</span>
    </span>
  );
}

/** Leading 6px dot. A partial status draws it half-filled instead of adding a second mark. */
export function PillDot({
  tone,
  partial = false,
}: {
  readonly tone: StatusTone;
  readonly partial?: boolean;
}) {
  if (partial) {
    return (
      <span
        role="img"
        aria-label="Partial"
        title="Partial"
        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full border"
        style={{
          borderColor: tone.dot,
          background: `linear-gradient(90deg, ${tone.dot} 50%, transparent 50%)`,
        }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ backgroundColor: tone.dot }}
    />
  );
}

/** One soft treatment for every priority; High gets an up arrow, Urgent a double arrow. */
export function PriorityFlag({ priority }: { priority: string | null }) {
  if (!priority || priority.toLowerCase() === 'none') {
    return <span className="text-xs text-fg-muted">—</span>;
  }
  const key = priority.toLowerCase();
  const tone = statusTone(priority, 'priority');
  const Icon = key === 'urgent' ? ChevronsUp : key === 'high' ? ArrowUp : null;
  return (
    <span data-priority={key} style={pillStyle(tone)} className={cn(pillClass(), 'gap-0.5')}>
      {Icon ? <Icon className="h-3 w-3" aria-hidden /> : null}
      {statusLabel(priority)}
    </span>
  );
}

/** Canonical name for the shared priority pill; every grid uses this one map. */
export const PriorityPill = PriorityFlag;

/** Receiving difference pill: "-3" red-orange, "+2" green, "0" grey. */
export function DifferencePill({ value, className }: { value: number; className?: string }) {
  const tone = differenceTone(value);
  return (
    <span
      style={pillStyle(tone)}
      className={cn('inline-flex rounded-full px-2 py-0.5 text-2xs font-semibold tabular-nums', className)}
    >
      {value > 0 ? `+${value}` : value}
    </span>
  );
}

/** Green Yes / grey No pill. */
export function YesNoPill({ value }: { value: boolean }) {
  return <StatusPill status={value ? 'Yes' : 'No'} domain="yesNo" />;
}

/** Sales-channel badge with brand-flavored icon tiles */
const CHANNEL_META: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; tile: string; label?: string }
> = {
  shopify: { icon: ShoppingBag, tile: 'bg-[#e8f5e2] text-[#5e8e3e]' },
  amazon: { icon: Store, tile: 'bg-[#fff3e0] text-[#e47911]' },
  'tiktok shop': { icon: Zap, tile: 'bg-[#111]/5 text-[#111]' },
  walmart: { icon: Store, tile: 'bg-[#e8f0fe] text-[var(--label-blue-text)]' },
  wholesale: { icon: Truck, tile: 'bg-info-soft text-info' },
  manual: { icon: FileText, tile: 'bg-success-soft text-success', label: 'Created Manually' },
};

export function ChannelBadge({ channel, store }: { channel: string; store?: string | null }) {
  const meta = CHANNEL_META[channel.toLowerCase()] ?? {
    icon: Store,
    tile: 'bg-neutral-soft text-neutral',
  };
  const Icon = meta.icon;
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded', meta.tile)}>
        <Icon className="h-3 w-3" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-xs font-medium text-body">{meta.label ?? channel}</span>
        {store ? <span className="truncate text-2xs text-faint">{store}</span> : null}
      </span>
    </span>
  );
}
