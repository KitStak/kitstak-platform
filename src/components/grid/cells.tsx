"use client";

/**
 * Grid cell library (BUILD_PLAN F4.3). All formatting follows user preferences via
 * `useFormat()`; empty values render the shared em dash.
 */
import * as React from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { EMPTY_VALUE } from "@/lib/format";
import { useFormat } from "@/lib/format";
import { findIntegration, svgDataUri } from "@/lib/channel-catalog";
import { serializeGridQuery, type GridFilter } from "@/server/query/grid-query";
import { Avatar } from "@/components/ui/avatar";
import { YesNoPill } from "@/components/ui/status-pill";

export { YesNoPill };

const Empty = () => <span className="text-faint">{EMPTY_VALUE}</span>;

/** Primary-key / hyperlink cell. Stops row-click propagation. */
export function LinkCell({ href, children, className }: { readonly href: string; readonly children: React.ReactNode; readonly className?: string }) {
  return (
    <Link href={href} onClick={(e) => e.stopPropagation()} className={cn("font-medium text-primary underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/30", className)}>
      {children}
    </Link>
  );
}

/** Builds `/path?f.x=...` deep links for pre-filtered lists. */
export function filteredListHref(path: string, filters: readonly GridFilter[]): string {
  const qs = serializeGridQuery({ filters });
  return qs ? `${path}?${qs}` : path;
}

/** Opens a pre-filtered list in a new tab (e.g. "12 orders" → Orders filtered by SKU). */
export function ExternalFilterLink({ path, filters, children, label }: { readonly path: string; readonly filters: readonly GridFilter[]; readonly children: React.ReactNode; readonly label?: string }) {
  return (
    <a
      href={filteredListHref(path, filters)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      aria-label={label ? `${label} (opens in a new tab)` : undefined}
      className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/30"
    >
      {children}
      <ExternalLink className="h-3 w-3 opacity-70" aria-hidden />
    </a>
  );
}

/**
 * Column width that fits `fmt.gridDateTime` with a two-digit hour ("11/04/2026 11:02 AM"
 * is 166px at 13px) plus cell padding. Use as `size` and `minSize` for date-time columns.
 */
export const DATE_TIME_COLUMN_WIDTH = 172;
/** Fits the widest priority pill ("⇈ Urgent") plus padding. */
export const PRIORITY_COLUMN_WIDTH = 104;

export function DateCell({ value, dateOnly = false }: { readonly value: string | Date | null | undefined; readonly dateOnly?: boolean }) {
  const fmt = useFormat();
  if (!value) return <Empty />;
  const text = dateOnly ? fmt.date(value) : fmt.gridDateTime(value);
  const full = dateOnly ? undefined : fmt.dateTime(value);
  return <span title={full} className="whitespace-nowrap tabular-nums text-body">{text || EMPTY_VALUE}</span>;
}

export function MoneyCell({ value, currency = "USD" }: { readonly value: number | null | undefined; readonly currency?: string }) {
  const fmt = useFormat();
  if (value === null || value === undefined) return <Empty />;
  return <span className="block whitespace-nowrap text-right tabular-nums text-body">{fmt.money(value, currency, "grid")}</span>;
}

export function QtyCell({ value, muteZero = false, unit }: { readonly value: number | null | undefined; readonly muteZero?: boolean; readonly unit?: string }) {
  const fmt = useFormat();
  if (value === null || value === undefined) return <Empty />;
  return (
    <span className={cn("tabular-nums", muteZero && value === 0 ? "text-faint" : "text-body", value < 0 && "text-danger")}>
      {fmt.quantity(value)}
      {unit ? <span className="ml-1 text-[11px] text-faint">{unit}</span> : null}
    </span>
  );
}

export interface TagChip {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

export function TagsCell({ tags, max = 2 }: { readonly tags: readonly TagChip[] | null | undefined; readonly max?: number }) {
  if (!tags || tags.length === 0) return <Empty />;
  const shown = tags.slice(0, max);
  const hidden = tags.length - shown.length;
  return (
    <span className="inline-flex items-center gap-1" title={tags.map((t) => t.name).join(", ")}>
      {shown.map((t) => (
        <span key={t.id} className="inline-flex max-w-[110px] items-center gap-1 truncate rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-body">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: t.color }} aria-hidden />
          <span className="truncate">{t.name}</span>
        </span>
      ))}
      {hidden > 0 ? <span className="text-[11px] font-semibold text-faint">+{hidden}</span> : null}
    </span>
  );
}

/** Channel or carrier logo + name (falls back to the catalog monogram). */
export function ChannelCell({ channel, kind = "channel", store }: { readonly channel: string | null | undefined; readonly kind?: "channel" | "carrier"; readonly store?: string | null }) {
  if (!channel) return <Empty />;
  const entry = findIntegration(kind, channel.toLowerCase());
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {entry ? (
        // eslint-disable-next-line @next/next/no-img-element -- tiny inline data-URI logo
        <img src={svgDataUri(entry.logoSvg)} alt="" width={20} height={20} className="h-5 w-5 shrink-0 rounded" />
      ) : (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-neutral-soft text-[9px] font-bold text-neutral" aria-hidden>
          {channel.slice(0, 2).toUpperCase()}
        </span>
      )}
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-[12px] font-medium text-body">{entry?.name ?? channel}</span>
        {store ? <span className="truncate text-[11px] text-faint">{store}</span> : null}
      </span>
    </span>
  );
}

export function UserCell({ name, email }: { readonly name: string | null | undefined; readonly email?: string | null }) {
  if (!name && !email) return <Empty />;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={email ?? undefined}>
      <Avatar name={name ?? email} size="xs" />
      <span className="truncate text-body">{name ?? email}</span>
    </span>
  );
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const SOON_MS = 4 * HOUR_MS;

/** "2d 4h" / "3h 12m" / "45m"; negative values are overdue. */
export function formatCountdown(ms: number): string {
  const abs = Math.abs(ms);
  const d = Math.floor(abs / DAY_MS);
  const h = Math.floor((abs % DAY_MS) / HOUR_MS);
  const m = Math.floor((abs % HOUR_MS) / MINUTE_MS);
  const text = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  return ms < 0 ? `${text} overdue` : text;
}

function useNow(intervalMs: number): number | null {
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Live countdown to a deadline (ship-by, SLA). Renders nothing until mounted to avoid hydration drift. */
export function CountdownCell({ deadline }: { readonly deadline: string | Date | null | undefined }) {
  const now = useNow(MINUTE_MS);
  if (!deadline) return <Empty />;
  const target = new Date(deadline).getTime();
  if (Number.isNaN(target)) return <Empty />;
  if (now === null) return <span className="text-faint">…</span>;
  const remaining = target - now;
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", remaining < 0 ? "bg-danger-soft text-danger" : remaining < SOON_MS ? "bg-warning-soft text-warning" : "bg-neutral-soft text-secondary")}>
      {formatCountdown(remaining)}
    </span>
  );
}
