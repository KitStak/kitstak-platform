'use client';

/**
 * Change Log drawer (BUILD_PLAN F4.4): TYPE icon, MESSAGE, OPERATION DATE, SOURCE.
 * Field labels are human ("Received Qty"), line entries are prefixed with their SKU,
 * and the list is paged through `GET /api/change-log?entityType&entityId&page&ps`.
 */
import * as React from 'react';
import { ChevronLeft, ChevronRight, FilePlus2, PencilLine, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFormat } from '@/lib/format';
import { formatInZone, localizeIsoInText } from '@/lib/format-zone';
import { statusLabel } from '@/lib/status-colors';
import { useApiQuery } from '@/lib/query-client';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonTable } from '@/components/ui/skeleton';
import { changeLogEntrySchema, parseList, type ChangeLogEntry } from './contracts';

export const CHANGE_LOG_PAGE_SIZE = 20;

const TYPE_META = {
  Create: { icon: FilePlus2, tile: 'bg-success-soft text-success', label: 'Created' },
  Update: { icon: PencilLine, tile: 'bg-info-soft text-info', label: 'Updated' },
  Delete: { icon: Trash2, tile: 'bg-danger-soft text-danger', label: 'Deleted' },
} as const;

export interface ChangeLogMessageOptions {
  /** Renders ISO date-times found in the message (viewer or warehouse zone). Raw ISO when omitted. */
  readonly formatIso?: (iso: string) => string;
}

function side(value: string | null | undefined, isStatus: boolean): string {
  if (value === null || value === undefined || value.trim() === '') return '—';
  return isStatus ? statusLabel(value) : value;
}

/**
 * "MLT-WIDGET-01 -> Received Qty is modified. 0 --> 24". The stored message wins whenever it
 * is present (modules store readable sentences); it is rebuilt only when empty. ISO date-times
 * are localised through `formatIso`, and status values read like the pills ("Ready to Count").
 */
export function changeLogMessage(entry: ChangeLogEntry, options: ChangeLogMessageOptions = {}): string {
  const prefix = entry.lineLabel ? `${entry.lineLabel} -> ` : '';
  const isStatus = (entry.field ?? '').toLowerCase() === 'status';
  let text: string;
  if (entry.message.trim() === '' && entry.type === 'Update' && entry.fieldLabel) {
    text = `${prefix}${entry.fieldLabel} is modified. ${side(entry.fromValue, isStatus)} --> ${side(entry.toValue, isStatus)}`;
  } else {
    text = entry.message.startsWith(prefix) ? entry.message : `${prefix}${entry.message}`;
    // Legacy rows: an empty from-side left a double space before the arrow.
    text = text.replace(/ is modified\.\s{2,}-->/, ' is modified. — -->').replace(/-->\s*$/, '--> —');
    if (isStatus) {
      for (const v of [entry.fromValue, entry.toValue])
        if (v && statusLabel(v) !== v) text = text.split(v).join(statusLabel(v));
    }
  }
  return options.formatIso ? localizeIsoInText(text, options.formatIso) : text;
}

/** Operation date: the record's warehouse zone with a suffix when given, else the viewer's format. */
export function useChangeLogTime(timeZone?: string | null): (at: string) => string {
  const fmt = useFormat();
  return React.useCallback(
    (at: string) => (timeZone ? formatInZone(at, timeZone) : fmt.dateTime(at)),
    [fmt, timeZone],
  );
}

export interface ChangeLogDrawerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly entityType: string;
  readonly entityId: string;
  /** Record code shown in the title, e.g. "SO000123". */
  readonly entityCode?: string;
  /** IANA zone (e.g. the record's warehouse): dates render there with a zone suffix. */
  readonly timeZone?: string | null;
}

/** React Query key of the drawer's list, so a page can warm or invalidate it. */
export function changeLogQueryKey(entityType: string, entityId: string): readonly unknown[] {
  return ['change-log', entityType, entityId];
}

/** After this long pending, the drawer says so and offers Retry. */
const SLOW_MS = 8000;

export function ChangeLogDrawer({
  open,
  onOpenChange,
  entityType,
  entityId,
  entityCode,
  timeZone,
}: ChangeLogDrawerProps) {
  const fmt = useFormat();
  const timeOf = useChangeLogTime(timeZone);
  const [slow, setSlow] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const query = useApiQuery<unknown>(
    [...changeLogQueryKey(entityType, entityId)],
    open ? '/api/change-log' : null,
    {
      query: { entityType, entityId, page, ps: CHANGE_LOG_PAGE_SIZE },
      placeholderData: (prev) => prev,
    },
  );
  const entries = parseList(changeLogEntrySchema, query.data?.data);
  const total = query.data?.meta?.total ?? entries.length;
  const pageCount = Math.max(1, Math.ceil(total / CHANGE_LOG_PAGE_SIZE));
  const pending = open && query.isPending;
  React.useEffect(() => {
    if (!pending) return undefined;
    const t = window.setTimeout(() => setSlow(true), SLOW_MS);
    return () => {
      window.clearTimeout(t);
      setSlow(false);
    };
  }, [pending]);

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      width={60}
      title={entityCode ? `Change log · ${entityCode}` : 'Change log'}
      description="Every change to this record, newest first."
    >
      {query.isPending ? (
        <div className="flex flex-col gap-3">
          {slow ? (
            <div role="status" className="flex items-center gap-3 text-xs text-secondary">
              <span>Taking longer than usual.</span>
              <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>
                Retry
              </Button>
            </div>
          ) : null}
          <SkeletonTable rows={8} columns={4} />
        </div>
      ) : query.error ? (
        <EmptyState
          title="Could not load the change log"
          description={query.error.message}
          action={<Button onClick={() => void query.refetch()}>Retry</Button>}
          compact
        />
      ) : entries.length === 0 ? (
        <EmptyState
          title="No changes recorded yet"
          description="Creates, edits and deletes will appear here."
          compact
        />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-surface-sunken text-left text-2xs font-semibold text-faint">
                <tr>
                  <th scope="col" className="w-14 px-3 py-2">
                    Type
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Message
                  </th>
                  <th scope="col" className="w-44 px-3 py-2">
                    Operation date
                  </th>
                  <th scope="col" className="w-48 px-3 py-2">
                    Source
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const meta = TYPE_META[entry.type];
                  const Icon = meta.icon;
                  return (
                    <tr key={entry.id} className="border-t border-border align-top">
                      <td className="px-3 py-2.5">
                        <span
                          title={meta.label}
                          className={cn('flex h-7 w-7 items-center justify-center rounded-md', meta.tile)}
                        >
                          <Icon className="h-3.5 w-3.5" aria-hidden />
                          <span className="sr-only">{meta.label}</span>
                        </span>
                      </td>
                      <td className="break-words px-3 py-2.5 text-body">
                        {changeLogMessage(entry, { formatIso: timeOf })}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-secondary">
                        {timeOf(entry.at)}
                      </td>
                      <td className="truncate px-3 py-2.5 text-secondary" title={entry.source}>
                        {entry.userName || entry.source}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-xs text-secondary">
            <span>
              {fmt.number((page - 1) * CHANGE_LOG_PAGE_SIZE + 1)}–
              {fmt.number(Math.min(page * CHANGE_LOG_PAGE_SIZE, total))} of {fmt.number(total)}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Previous page"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              </Button>
              <span className="tabular-nums">
                {page} / {pageCount}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Next page"
                disabled={page >= pageCount}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
}
