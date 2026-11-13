'use client';
/**
 * Board swimlanes by linked CRM / WMS data: "CRM customer" groups cards by the deal, account or
 * customer they are linked to; "WMS status" groups them by the live status of their linked WMS
 * record (Pending, Picking, Shipped, Shortage…). Lanes come from the task links the board
 * already loads, so they stay as fresh as the chips.
 *
 * The lane meta mirrors `GroupMeta` (src/features/views/group-meta.tsx): dragging between these
 * lanes only changes the status column (the link itself is not something a drag should edit).
 */
import { displayText } from '@kitstak/ui/text';
import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { NO_GROUP } from '@/lib/task-filters';
import type { IntegrationLinkDTO, TaskSummary } from '@/lib/types';
import type { GroupInfo, GroupMove } from '@/features/views/group-meta';
import { SiblingAppMark } from './record-chip';
import { TONE_COLOR, statusTone } from './status-tone';

export type LinkLane = 'crm' | 'wms';

const CRM_TYPES = new Set(['crm_item', 'crm_account', 'core_customer']);
const WMS_PREFIX = 'wms_';

/** Record titles from sibling apps can carry a long dash; show a middle dot instead. */
const clean = (title: string): string => displayText(title, '');

function crmKey(link: IntegrationLinkDTO): string {
  return `${link.targetType}:${link.targetId}`;
}

function wmsKey(link: IntegrationLinkDTO): string {
  return (link.status ?? 'No status').trim().toLowerCase() || 'no status';
}

export function linkLaneKeys(task: TaskSummary, lane: LinkLane, linksByTask: ReadonlyMap<string, readonly IntegrationLinkDTO[]>): string[] {
  const links = linksByTask.get(task.id) ?? [];
  const keys =
    lane === 'crm'
      ? links.filter((link) => CRM_TYPES.has(link.targetType)).map(crmKey)
      : links.filter((link) => link.targetType.startsWith(WMS_PREFIX)).map(wmsKey);
  return keys.length ? [...new Set(keys)] : [NO_GROUP];
}

/** True when any task of the project has a link for this lane kind (otherwise the option is hidden). */
export function hasLinkLane(lane: LinkLane, linksByTask: ReadonlyMap<string, readonly IntegrationLinkDTO[]>): boolean {
  for (const links of linksByTask.values()) {
    if (links.some((link) => (lane === 'crm' ? CRM_TYPES.has(link.targetType) : link.targetType.startsWith(WMS_PREFIX)))) return true;
  }
  return false;
}

const WMS_ORDER = ['shortage', 'exception', 'on hold', 'backordered', 'pending', 'open', 'started', 'receiving', 'in progress', 'picking', 'packing', 'ready', 'loaded', 'shipped', 'delivered', 'received', 'completed', 'closed', 'cancelled'];

function StatusDot({ status }: { readonly status: string }) {
  const color = TONE_COLOR[statusTone(status)];
  return <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: `var(--label-${color})` }} />;
}

export interface LinkLaneMeta {
  readonly order: readonly string[];
  info(key: string): GroupInfo;
  move(): GroupMove;
  createDefaults(): Record<string, never>;
}

/** Lane meta for CRM customer / WMS status swimlanes, or null for any other lane. */
export function useLinkLaneMeta(lane: string, linksByTask: ReadonlyMap<string, readonly IntegrationLinkDTO[]>): LinkLaneMeta | null {
  return useMemo(() => {
    if (lane !== 'crm' && lane !== 'wms') return null;
    const titles = new Map<string, string>();
    const counts = new Map<string, number>();
    for (const links of linksByTask.values()) {
      for (const link of links) {
        if (lane === 'crm' && CRM_TYPES.has(link.targetType)) {
          const key = crmKey(link);
          titles.set(key, clean(link.title ?? 'CRM record'));
          counts.set(key, (counts.get(key) ?? 0) + 1);
        } else if (lane === 'wms' && link.targetType.startsWith(WMS_PREFIX)) {
          const key = wmsKey(link);
          titles.set(key, link.status?.trim() || 'No status');
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
    }
    const keys = [...titles.keys()];
    if (lane === 'crm') keys.sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || (titles.get(a) ?? '').localeCompare(titles.get(b) ?? ''));
    else
      keys.sort((a, b) => {
        const ia = WMS_ORDER.indexOf(a);
        const ib = WMS_ORDER.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
      });
    const order = [...keys, NO_GROUP];
    return {
      order,
      info(key: string): GroupInfo {
        if (key === NO_GROUP) return { key, title: lane === 'crm' ? 'No CRM link' : 'No WMS link' };
        const title = titles.get(key) ?? key;
        return {
          key,
          title,
          icon: lane === 'crm' ? <SiblingAppMark app="crm" size={14} /> : <StatusDot status={title} />,
        };
      },
      move: () => ({ patch: {} }),
      createDefaults: () => ({}),
    };
  }, [lane, linksByTask]);
}

/**
 * `?linked=crm:<type>:<id>` or `?linked=wms:<status>` narrows a view to tasks linked to one CRM
 * record or WMS status (Customer 360, Portal and lane headers link here). URL is the source of
 * truth, written with history.replaceState like the rest of the view state.
 */
export interface LinkFilter {
  readonly key: string | null;
  readonly lane: LinkLane | null;
  readonly label: string | null;
  matches(task: TaskSummary): boolean;
  set(lane: LinkLane, key: string | null): void;
}

export function useLinkFilter(linksByTask: ReadonlyMap<string, readonly IntegrationLinkDTO[]>): LinkFilter {
  const params = useSearchParams();
  const raw = params.get('linked');
  return useMemo(() => {
    const lane: LinkLane | null = raw?.startsWith('crm:') ? 'crm' : raw?.startsWith('wms:') ? 'wms' : null;
    const key = lane && raw ? raw.slice(4).toLowerCase() : null;
    let label: string | null = null;
    if (lane && key) {
      outer: for (const links of linksByTask.values()) {
        for (const link of links) {
          if (lane === 'crm' && CRM_TYPES.has(link.targetType) && crmKey(link).toLowerCase() === key) {
            label = clean(link.title ?? 'CRM record');
            break outer;
          }
          if (lane === 'wms' && link.targetType.startsWith(WMS_PREFIX) && wmsKey(link) === key) {
            label = `WMS status ${link.status ?? key}`;
            break outer;
          }
        }
      }
      label = label ?? (lane === 'crm' ? 'a CRM record' : `WMS status ${key}`);
    }
    return {
      key,
      lane,
      label,
      matches(task: TaskSummary) {
        if (!lane || !key) return true;
        return linkLaneKeys(task, lane, linksByTask).some((entry) => entry.toLowerCase() === key);
      },
      set(nextLane: LinkLane, nextKey: string | null) {
        const search = new URLSearchParams(window.location.search);
        if (nextKey && nextKey !== NO_GROUP) search.set('linked', `${nextLane}:${nextKey}`);
        else search.delete('linked');
        const query = search.toString();
        window.history.replaceState(null, '', query ? `${window.location.pathname}?${query}` : window.location.pathname);
      },
    };
  }, [linksByTask, raw]);
}

/** "Showing tasks linked to Orion Fulfillment · Show all" bar for an active link filter. */
export function LinkFilterBar({ filter, shown }: { readonly filter: LinkFilter; readonly shown: number }) {
  if (!filter.lane || !filter.key) return null;
  return (
    <div
      className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle bg-panel px-3 py-2 text-sm sm:mx-6"
      data-testid="link-filter-bar"
      role="status"
    >
      <SiblingAppMark app={filter.lane} size={14} />
      <span className="min-w-0 flex-1 text-fg-secondary">
        Showing {shown} {shown === 1 ? 'task' : 'tasks'} linked to <span className="font-semibold text-fg">{filter.label}</span>
      </span>
      <button
        type="button"
        onClick={() => filter.set(filter.lane as LinkLane, null)}
        className="rounded-md px-2 py-1 text-sm font-semibold text-fg-link hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"
      >
        Show all tasks
      </button>
    </div>
  );
}
