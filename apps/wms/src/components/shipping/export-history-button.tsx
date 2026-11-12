'use client';

/**
 * Per-grid Excel Export History (Logiwa "Export History" next to Export As Excel): the viewer's
 * export tasks for this grid, newest first, with download links and a per-viewer
 * "Clear completed". Cleared tasks stay in Reports → Excel Export History.
 */
import * as React from 'react';
import Link from 'next/link';
import { Download, History } from 'lucide-react';
import { useApiQuery } from '@/lib/query-client';
import { useFormat } from '@/lib/format';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { StatusPill } from '@/components/ui/status-pill';
import { Button } from '@/components/ui/button';

interface ExportTask {
  readonly id: string;
  readonly title: string;
  readonly gridKey: string | null;
  readonly status: 'queued' | 'started' | 'completed' | 'error';
  readonly progress: number;
  readonly rowCount: number | null;
  readonly errorMessage: string | null;
  readonly fileId: string | null;
  readonly fileName: string | null;
  readonly createdAt: string;
}

const STATUS_LABEL = {
  queued: 'Queued',
  started: 'Started',
  completed: 'Completed',
  error: 'Error',
} as const;
const storageKey = (gridKey: string) => `ks:ship-export-cleared:${gridKey}`;

export function isFinishedExport(t: Pick<ExportTask, 'status'>): boolean {
  return t.status === 'completed' || t.status === 'error';
}

/** Tasks for this grid that the viewer has not cleared (running ones are never hidden). */
export function visibleExports<T extends Pick<ExportTask, 'id' | 'gridKey' | 'status'>>(
  tasks: readonly T[],
  gridKey: string,
  cleared: ReadonlySet<string>,
): T[] {
  return tasks.filter((t) => t.gridKey === gridKey && (!cleared.has(t.id) || !isFinishedExport(t)));
}

function readCleared(gridKey: string): Set<string> {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(storageKey(gridKey)) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

export function ExportHistoryButton({ gridKey }: { readonly gridKey: string }) {
  const format = useFormat();
  const [open, setOpen] = React.useState(false);
  const [cleared, setCleared] = React.useState<ReadonlySet<string>>(new Set());
  React.useEffect(() => {
    setCleared(readCleared(gridKey));
  }, [gridKey]);
  const q = useApiQuery<ExportTask[]>(['background-tasks', 'export', gridKey], '/api/background-tasks', {
    query: { kind: 'export', ps: 100 },
    enabled: open,
    refetchInterval: (query) => (query.state.data?.data.some((t) => !isFinishedExport(t)) ? 4000 : false),
  });
  const tasks = visibleExports(q.data?.data ?? [], gridKey, cleared);
  const finished = tasks.filter(isFinishedExport);

  const clearCompleted = () => {
    const next = new Set([...cleared, ...finished.map((t) => t.id)]);
    setCleared(next);
    try {
      window.localStorage.setItem(storageKey(gridKey), JSON.stringify([...next].slice(-200)));
    } catch {
      /* storage blocked */
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm" aria-label="Export history" data-testid="export-history">
          <History className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden lg:inline">Export history</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <p className="text-sm font-semibold text-foreground">Excel export history</p>
          <Button
            variant="ghost"
            size="sm"
            disabled={finished.length === 0}
            title={finished.length === 0 ? 'No finished exports to clear' : undefined}
            onClick={clearCompleted}
            data-testid="export-history-clear"
          >
            Clear completed
          </Button>
        </div>
        {q.isLoading ? (
          <p className="px-3 py-4 text-xs text-secondary">Loading exports…</p>
        ) : tasks.length === 0 ? (
          <p className="px-3 py-4 text-xs text-secondary">
            No exports of this grid yet. Use Export As Excel to create one; files stay here for download.
          </p>
        ) : (
          <ul
            className="max-h-[320px] divide-y divide-border overflow-y-auto"
            data-testid="export-history-list"
          >
            {tasks.map((t) => (
              <li key={t.id} className="flex flex-col gap-1 px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{t.title}</p>
                    <p className="text-2xs text-faint">
                      {format.dateTime(t.createdAt)}
                      {t.rowCount !== null ? ` · ${t.rowCount} rows` : ''}
                      {!isFinishedExport(t) ? ` · ${t.progress}%` : ''}
                    </p>
                  </div>
                  <StatusPill status={STATUS_LABEL[t.status]} domain="export" size="sm" />
                </div>
                {t.status === 'error' && t.errorMessage ? (
                  <p className="text-2xs text-danger">{t.errorMessage}</p>
                ) : null}
                {t.status === 'completed' && t.fileId ? (
                  <a
                    href={`/api/files/${t.fileId}?download=1`}
                    className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-primary hover:underline"
                  >
                    <Download className="h-3 w-3" aria-hidden />
                    {t.fileName ?? 'Download'}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-border px-3 py-2 text-2xs text-secondary">
          Cleared exports stay in{' '}
          <Link href="/reports/export-history" className="font-semibold text-primary hover:underline">
            Reports → Excel export history
          </Link>
          .
        </div>
      </PopoverContent>
    </Popover>
  );
}
