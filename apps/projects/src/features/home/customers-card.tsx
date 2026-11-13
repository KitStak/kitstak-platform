'use client';
/**
 * Home "Your customers today": the cross-app view only KitStak can show. One row per customer
 * behind your active projects: CRM deal stage and close date, warehouse late receipts and
 * exceptions, open tasks, and a one-click "Create task". Above the rows, a "Mismatches" strip calls
 * out what no single app sees on its own (deal won but a task still open, receipts late while work
 * waits). Hidden when neither CRM nor WMS is connected.
 */
import Link from 'next/link';
import { AlertTriangle, ArrowUpRight, Building2, Handshake, PackageX, Plus, Warehouse } from 'lucide-react';
import { Button, Skeleton, cn } from '@/components/ui';
import { useCustomerPulse } from '@/lib/hooks/use-data';
import { diffDays, formatDue, todayIso } from '@/lib/dates';
import type { CustomerPulseRowDTO } from '@/lib/types';
import { useShellStore } from '@/features/shell/store';

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
  if (data && !data.available.crm && !data.available.wms) return null;
  if (pulse.isError && !data) return null;
  return (
    <section className="min-w-0 rounded-xl border border-border-subtle bg-panel shadow-xs" aria-labelledby="home-customers" data-testid="home-customers">
      <header className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <div className="min-w-0">
          <h2 id="home-customers" className="text-base font-semibold text-fg">
            Your customers today
          </h2>
          <p className="text-xs text-fg-muted">Deals from CRM and orders from the warehouse, next to your project work</p>
        </div>
      </header>
      {!data ? (
        <div className="flex flex-col gap-3 p-4" aria-busy="true" aria-label="Loading customers">
          <Skeleton height={44} rounded="md" />
          <Skeleton height={44} rounded="md" />
        </div>
      ) : (
        <>
          {data.mismatches.length ? (
            <div className="border-b border-border-subtle bg-warning-subtle/60 px-4 py-2.5" data-testid="home-mismatches">
              <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-warning-text uppercase">
                <AlertTriangle aria-hidden className="size-3.5" />
                Mismatches
              </p>
              <ul className="mt-1 flex flex-col gap-1">
                {data.mismatches.map((item) => (
                  <li key={item.id}>
                    <Link href={item.href} className={cn('group inline-flex items-start gap-1.5 text-sm hover:underline', item.tone === 'danger' ? 'text-danger-text' : 'text-fg')}>
                      <span>{item.text}</span>
                      <ArrowUpRight aria-hidden className="mt-0.5 size-3.5 shrink-0 opacity-60 group-hover:opacity-100" />
                    </Link>
                  </li>
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
