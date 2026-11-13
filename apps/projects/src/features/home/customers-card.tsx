'use client';
/**
 * Home "Your customers today": the cross-app view only KitStak can show. One row per customer
 * behind your active projects: CRM deal stage and close date, warehouse late receipts and
 * exceptions, open tasks, and a one-click "Create task". Above the rows, a "Mismatches" strip calls
 * out what no single app sees on its own (deal won but a task still open, receipts late while work
 * waits). Hidden when neither CRM nor WMS is connected.
 */
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BellOff, Building2, Check, ExternalLink, Handshake, PackageX, Plus, Warehouse } from 'lucide-react';
import { Button, Skeleton, cn, toast } from '@/components/ui';
import { useCustomerPulse } from '@/lib/hooks/use-data';
import { diffDays, formatDue, todayIso } from '@/lib/dates';
import { qk } from '@/lib/query-keys';
import type { CustomerMismatchDTO, CustomerPulseDTO, CustomerPulseRowDTO } from '@/lib/types';
import { setTaskDoneAction } from '@/server/actions/tasks';
import { useShellStore } from '@/features/shell/store';

/** The subtitle promises only what this org has: CRM deals, warehouse orders, or both. */
export function customersSubtitle(sources: CustomerPulseDTO['sources']): string {
  if (sources.deals && sources.warehouse) return 'Deal stages from CRM and receipts and exceptions from the warehouse, next to your project work';
  if (sources.deals) return 'Deal stages and values from CRM, next to your project work';
  if (sources.warehouse) return 'Receipts and exceptions from the warehouse, next to your project work';
  return 'Customers linked to your projects, next to your project work';
}

/** "$120,000" or "120,000 EUR"; null when there is no value. */
export function dealValueText(amount: number | null, currency: string | null): string | null {
  if (amount === null || !Number.isFinite(amount)) return null;
  const code = (currency ?? 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${Math.round(amount).toLocaleString('en-US')} ${code}`;
  }
}

const SNOOZE_KEY = 'kitstak.projects.home.snoozedMismatches';

function readSnoozed(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(SNOOZE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    if (!parsed || typeof parsed !== 'object') return {};
    const now = Date.now();
    return Object.fromEntries(Object.entries(parsed as Record<string, number>).filter(([, until]) => typeof until === 'number' && until > now));
  } catch {
    return {};
  }
}

/** Snoozes last until tomorrow morning, per viewer and browser. */
function useSnoozed() {
  const [snoozed, setSnoozed] = useState<Record<string, number>>(() => (typeof window === 'undefined' ? {} : readSnoozed()));
  const snooze = useCallback((id: string) => {
    const until = new Date();
    until.setDate(until.getDate() + 1);
    until.setHours(6, 0, 0, 0);
    setSnoozed((current) => {
      const next = { ...current, [id]: until.getTime() };
      try {
        window.localStorage.setItem(SNOOZE_KEY, JSON.stringify(next));
      } catch {
        /* storage blocked: snooze holds for this visit only */
      }
      return next;
    });
  }, []);
  const unsnooze = useCallback((id: string) => {
    setSnoozed((current) => {
      const next = { ...current };
      delete next[id];
      try {
        window.localStorage.setItem(SNOOZE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  return { snoozed, snooze, unsnooze };
}

function MismatchRow({
  item,
  onSnooze,
}: {
  readonly item: CustomerMismatchDTO;
  readonly onSnooze: (item: CustomerMismatchDTO) => void;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: qk.customerPulse() });
    void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'my-tasks' || (q.queryKey[0] === 'project' && q.queryKey[2] === 'tasks') });
  };
  const markDone = async () => {
    if (!item.task) return;
    const task = item.task;
    setBusy(true);
    const result = await setTaskDoneAction({ taskId: task.id, done: true });
    setBusy(false);
    if (!result.ok) {
      toast.error("Couldn't update that task", result.error.message);
      return;
    }
    refresh();
    toast.undo(`Done: ${task.ref} ${task.title}`, {
      onUndo: async () => {
        const undo = await setTaskDoneAction({ taskId: task.id, done: false });
        if (!undo.ok) throw new Error(undo.error.message);
        refresh();
      },
    });
  };
  return (
    <li className="flex flex-col gap-1.5 py-2 sm:flex-row sm:items-center sm:gap-3" data-testid="home-mismatch" aria-label={item.text}>
      <p className={cn('min-w-0 flex-1 text-sm', item.tone === 'danger' ? 'text-danger-text' : 'text-fg')}>
        {item.customer ? <span className="font-semibold">{item.customer}</span> : null}
        {item.customer ? <span aria-hidden className="text-fg-muted"> · </span> : null}
        <span>{item.fact}</span>
        <span aria-hidden className="text-fg-muted"> · </span>
        {item.task ? (
          <Link href={item.task.href} className="hover:underline">
            <span className="font-key font-medium text-fg-secondary">{item.task.ref}</span> {item.task.title}
          </Link>
        ) : (
          <Link href={item.projectHref} className="hover:underline">
            {item.work}
          </Link>
        )}
      </p>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5" data-testid="home-mismatch-actions">
        {item.task ? (
          <Button size="sm" variant="secondary" leadingIcon={<Check aria-hidden />} loading={busy} onClick={() => void markDone()}>
            Mark {item.task.ref} done
          </Button>
        ) : null}
        {item.dealUrl ? (
          <Button size="sm" variant="ghost" leadingIcon={<ExternalLink aria-hidden />} onClick={() => window.location.assign(item.dealUrl ?? '')}>
            Open deal
          </Button>
        ) : null}
        {item.receiptsUrl ? (
          <Button size="sm" variant="ghost" leadingIcon={<ExternalLink aria-hidden />} onClick={() => window.location.assign(item.receiptsUrl ?? '')}>
            Open receipts
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" leadingIcon={<BellOff aria-hidden />} onClick={() => onSnooze(item)} aria-label={`Snooze until tomorrow: ${item.text}`}>
          Snooze
        </Button>
      </div>
    </li>
  );
}

function closeText(closeDate: string | null, outcome: 'won' | 'lost' | 'open', today: string): string | null {
  if (outcome !== 'open' || !closeDate) return null;
  const delta = diffDays(today, closeDate);
  if (delta < 0) return `close date passed (${formatDue(closeDate, today)})`;
  return `closes ${formatDue(closeDate, today)}`;
}

function CustomerRow({ row, today }: { readonly row: CustomerPulseRowDTO; readonly today: string }) {
  const openQuickAdd = useShellStore((state) => state.openQuickAdd);
  const openTasks = row.projects.reduce((sum, project) => sum + project.openTasks, 0);
  const overdue = row.projects.reduce((sum, project) => sum + project.overdue, 0);
  const close = row.deal ? closeText(row.deal.closeDate, row.deal.outcome, today) : null;
  const value = row.deal ? dealValueText(row.deal.amount, row.deal.currency) : null;
  const mainProject = row.projects[0];
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-4" data-testid="home-customer-row">
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-fg">
          <Building2 aria-hidden className="size-4 shrink-0 text-icon" />
          {row.customerUrl ? (
            <a href={row.customerUrl} className="truncate hover:underline">
              {row.customerName}
            </a>
          ) : (
            <span className="truncate">{row.customerName}</span>
          )}
        </p>
        <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-secondary">
          {row.deal ? (
            <li className="inline-flex min-w-0 items-center gap-1.5">
              <Handshake aria-hidden className="size-3.5 shrink-0 text-icon" />
              <a href={row.deal.url} className="truncate hover:underline">
                {row.deal.name}
              </a>
              <span className={cn('shrink-0 font-medium', row.deal.outcome === 'won' ? 'text-success-text' : row.deal.outcome === 'lost' ? 'text-danger-text' : 'text-fg')}>
                {row.deal.stage ?? (row.deal.outcome === 'open' ? 'Open' : row.deal.outcome === 'won' ? 'Won' : 'Lost')}
              </span>
              {value ? <span className="shrink-0 font-medium text-fg">· {value}</span> : null}
              {close ? <span className={cn('shrink-0', close.startsWith('close date passed') ? 'text-danger-text' : 'text-fg-muted')}>· {close}</span> : null}
            </li>
          ) : null}
          {row.lateReceipts > 0 ? (
            <li>
              <a href={row.receiptsUrl ?? '#'} className="inline-flex items-center gap-1.5 font-medium text-danger-text hover:underline">
                <Warehouse aria-hidden className="size-3.5" />
                {row.lateReceipts} {row.lateReceipts === 1 ? 'receipt late' : 'receipts late'}
              </a>
            </li>
          ) : null}
          {row.exceptions > 0 ? (
            <li>
              <a href={row.exceptionsUrl ?? '#'} className="inline-flex items-center gap-1.5 font-medium text-warning-text hover:underline">
                <PackageX aria-hidden className="size-3.5" />
                {row.exceptions} warehouse {row.exceptions === 1 ? 'exception' : 'exceptions'}
              </a>
            </li>
          ) : null}
          {row.lateReceipts === 0 && row.exceptions === 0 && row.deal === null ? <li className="text-fg-muted">No open deal or warehouse issues</li> : null}
        </ul>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
          <span className={cn('font-medium', openTasks ? 'text-fg-secondary' : '')}>
            {openTasks} open {openTasks === 1 ? 'task' : 'tasks'}
            {overdue ? <span className="text-danger-text"> ({overdue} overdue)</span> : null}
          </span>
          <span aria-hidden>·</span>
          {row.projects.map((project, index) => (
            <span key={project.id}>
              <Link href={`/p/${project.key}`} className="text-fg-link hover:underline">
                {project.name}
              </Link>
              {index < row.projects.length - 1 ? ',' : ''}
            </span>
          ))}
        </p>
      </div>
      {mainProject ? (
        <Button size="sm" variant="secondary" leadingIcon={<Plus aria-hidden />} onClick={() => openQuickAdd({ projectId: mainProject.id })} className="shrink-0 self-start" aria-label={`Create a task for ${row.customerName}`}>
          Create task
        </Button>
      ) : null}
    </li>
  );
}

export function CustomersCard() {
  const pulse = useCustomerPulse();
  const today = todayIso();
  const data = pulse.data;
  const { snoozed, snooze, unsnooze } = useSnoozed();
  const onSnooze = useCallback(
    (item: CustomerMismatchDTO) => {
      snooze(item.id);
      toast.undo('Snoozed until tomorrow', { onUndo: () => unsnooze(item.id) });
    },
    [snooze, unsnooze],
  );
  const mismatches = data ? data.mismatches.filter((item) => !snoozed[item.id]) : [];
  if (data && !data.available.crm && !data.available.wms) return null;
  if (pulse.isError && !data) return null;
  return (
    <section className="min-w-0 rounded-xl border border-border-subtle bg-panel shadow-xs" aria-labelledby="home-customers" data-testid="home-customers">
      <header className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <div className="min-w-0">
          <h2 id="home-customers" className="text-base font-semibold text-fg">
            Your customers today
          </h2>
          {data?.sources ? (
            <p className="text-xs text-fg-muted" data-testid="home-customers-subtitle">
              {customersSubtitle(data.sources)}
            </p>
          ) : null}
        </div>
      </header>
      {!data ? (
        <div className="flex flex-col gap-3 p-4" aria-busy="true" aria-label="Loading customers">
          <Skeleton height={44} rounded="md" />
          <Skeleton height={44} rounded="md" />
        </div>
      ) : (
        <>
          {mismatches.length ? (
            <div className="border-b border-border-subtle bg-warning-subtle/60 px-4 py-2.5" data-testid="home-mismatches">
              <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-warning-text uppercase">
                <AlertTriangle aria-hidden className="size-3.5" />
                Mismatches
              </p>
              <ul className="mt-0.5 flex flex-col divide-y divide-border-subtle/70">
                {mismatches.map((item) => (
                  <MismatchRow key={item.id} item={item} onSnooze={onSnooze} />
                ))}
              </ul>
            </div>
          ) : null}
          {data.rows.length ? (
            <ul className="divide-y divide-border-subtle">
              {data.rows.slice(0, 6).map((row) => (
                <CustomerRow key={row.key} row={row} today={today} />
              ))}
            </ul>
          ) : (
            <p className="px-4 py-6 text-center text-sm text-fg-muted">Link a customer or a CRM deal to a project, and its deal and warehouse activity show up here.</p>
          )}
        </>
      )}
    </section>
  );
}
