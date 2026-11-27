import * as React from 'react';
import { ArrowUp, ChevronsUp, FileText, ShoppingBag, Store, Truck, Zap } from 'lucide-react';
import { Pill } from '@kitstak/ui/dashboard';
import { cn } from '@/lib/utils';
import {
  differenceTone,
  isPartialStatus,
  statusLabel,
  statusTone,
  type StatusTone,
  type StatusDomain,
} from '@/lib/status-colors';

/**
 * Status pill (BUILD_PLAN 0.5), drawn with the shared `Pill` (docs/design/UI-CLEANUP.md "Pills"):
 * one of five flat tones, one dot, sentence case, one size. Tones come from `@/lib/status-colors`;
 * pass `domain` for entity-specific semantics. Without a domain the generic map is used, so
 * existing call sites keep working.
 *
 * The `data-status` wrapper is `display: contents`, so it adds no box around the pill.
 */
export function StatusPill({
  status,
  domain = 'generic',
  partial,
  className,
}: {
  status: string;
  domain?: StatusDomain;
  /** Force/disable the half-filled "partial" dot; defaults to statuses starting with "Partially". */
  partial?: boolean;
  /** @deprecated Pills have one size; kept so existing call sites compile. */
  size?: 'sm' | 'md';
  className?: string;
}) {
  const tone = statusTone(status, domain);
  return (
    <TonePill status={status} tone={tone} partial={partial ?? isPartialStatus(status)} className={className}>
      {statusLabel(status)}
    </TonePill>
  );
}

/**
 * A status `Pill` for a tone you already have (order, work order, inventory pills), with the
 * `data-status` attribute tests and e2e specs look for. A partial status gets the half-filled dot.
 */
export function TonePill({
  status,
  tone,
  partial = false,
  className,
  children,
}: {
  readonly status: string;
  readonly tone: StatusTone;
  readonly partial?: boolean;
  readonly className?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <span data-status={status} className="contents">
      {partial ? (
        <Pill tone={tone.pill} icon={<PartialDot />} className={className}>
          {children}
        </Pill>
      ) : (
        <Pill tone={tone.pill} dot className={className}>
          {children}
        </Pill>
      )}
    </span>
  );
}

/**
 * The half-filled "partial" dot: a 6 px SVG in the pill's own mark colour (`--pill-mark`), so a
 * partial status keeps one marker instead of adding a second mark. No gradients.
 */
export function PartialDot() {
  return (
    <svg
      role="img"
      aria-label="Partial"
      viewBox="0 0 6 6"
      style={{ width: 6, height: 6 }}
      fill="none"
      stroke="var(--pill-mark, currentColor)"
    >
      <title>Partial</title>
      <circle cx="3" cy="3" r="2.5" strokeWidth="1" />
      <path d="M3 0.5a2.5 2.5 0 0 0 0 5z" fill="var(--pill-mark, currentColor)" stroke="none" />
    </svg>
  );
}

/** Leading 6px dot in a tone's colour, for status marks drawn outside a Pill (chips, timelines). */
export function PillDot({
  tone,
  partial = false,
}: {
  readonly tone: StatusTone;
  readonly partial?: boolean;
}) {
  if (partial) {
    return (
      <span className="inline-flex shrink-0" style={{ ['--pill-mark' as string]: tone.dot }}>
        <PartialDot />
      </span>
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

/** One treatment for every priority: a caution pill; High gets an up arrow, Urgent a double arrow. */
export function PriorityFlag({ priority }: { priority: string | null }) {
  if (!priority || priority.toLowerCase() === 'none') {
    return <span className="text-xs text-fg-muted">None</span>;
  }
  const key = priority.toLowerCase();
  const tone = statusTone(priority, 'priority');
  const Icon = key === 'urgent' ? ChevronsUp : key === 'high' ? ArrowUp : null;
  return (
    <span data-priority={key} className="contents">
      {Icon ? (
        <Pill tone={tone.pill} icon={<Icon aria-hidden />}>
          {statusLabel(priority)}
        </Pill>
      ) : (
        <Pill tone={tone.pill}>{statusLabel(priority)}</Pill>
      )}
    </span>
  );
}

/** Canonical name for the shared priority pill; every grid uses this one map. */
export const PriorityPill = PriorityFlag;

/** Text colour for each difference sign (a number is colored text, not a pill). */
const DIFFERENCE_TEXT = {
  critical: 'text-danger-text',
  positive: 'text-success-text',
  neutral: 'text-fg-muted',
} as const;

/** Receiving difference: "−3" critical, "+2" positive, "0" muted. Signed tabular text, not a pill. */
export function DifferencePill({ value, className }: { value: number; className?: string }) {
  const tone = differenceTone(value).pill;
  const text = value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '0';
  return (
    <span
      data-difference={value}
      className={cn(
        'whitespace-nowrap text-xs font-medium tabular-nums',
        DIFFERENCE_TEXT[tone === 'critical' || tone === 'positive' ? tone : 'neutral'],
        className,
      )}
    >
      {text}
    </span>
  );
}

/** Yes / No pill (positive / neutral). */
export function YesNoPill({ value }: { value: boolean }) {
  return <StatusPill status={value ? 'Yes' : 'No'} domain="yesNo" />;
}

/** Sales-channel badge: a neutral icon and the channel name (no brand-tinted icon squares). */
const CHANNEL_META: Record<string, { icon: React.ComponentType<{ className?: string }>; label?: string }> = {
  shopify: { icon: ShoppingBag },
  amazon: { icon: Store },
  'tiktok shop': { icon: Zap },
  walmart: { icon: Store },
  wholesale: { icon: Truck },
  manual: { icon: FileText, label: 'Created manually' },
};

export function ChannelBadge({ channel, store }: { channel: string; store?: string | null }) {
  const meta = CHANNEL_META[channel.toLowerCase()] ?? { icon: Store };
  const Icon = meta.icon;
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <Icon className="h-3.5 w-3.5 shrink-0 text-icon" aria-hidden />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-xs font-medium text-body">{meta.label ?? channel}</span>
        {store ? <span className="truncate text-2xs text-faint">{store}</span> : null}
      </span>
    </span>
  );
}
