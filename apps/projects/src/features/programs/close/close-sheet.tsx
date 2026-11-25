'use client';
/**
 * Close {Month} (`?close=2026-10`, docs/programs/SPEC.md 5.20): the checklist from
 * `getCloseChecklist`, each row with a green check or a warning and a way to fix it, the month's
 * total and units, and "Close October" (on only when every required row passes). Closing locks
 * the month's output, prices and fees and saves the total.
 */
import { useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarCheck2, CheckCircle2, Info, Lock } from 'lucide-react';
import { addMonths, firstDayOfMonth, formatCents, shiftMonth, shortDate, unitLabel } from '@kitstak/programs-engine';
import { Badge, Button, Checkbox, ConfirmDialog, EmptyState, Field, Input, SidePanel, SidePanelContent, Skeleton, cn, toast } from '@/components/ui';
import { useServerAction } from '@/lib/hooks/use-action';
import { useCloseChecklist } from '@/lib/hooks/use-programs';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import type { CloseChecklistItemDTO, IsoMonth } from '@/lib/program-types';
import { cancelBuildsAction, closeShortAction, splitBuildAction } from '@/server/actions/builds';
import { closeMonthAction } from '@/server/actions/program-closes';
import { useCurrentProgram } from '../program-context';
import { qtyOfText } from '../kit/format';
import { monthLong, monthShortName } from '../overview/overview-model';
import { statementHref } from '../frame/program-menu';
import { ReopenMonthDialog } from './reopen-dialog';

type BulkAction = 'short' | 'move' | 'cancel';

function ItemRow({ item, children }: { readonly item: CloseChecklistItemDTO; readonly children?: React.ReactNode }) {
  const Icon = item.ok ? CheckCircle2 : item.required ? AlertTriangle : Info;
  return (
    <li className="flex gap-3 px-4 py-3" data-testid={`close-item-${item.key}`} data-ok={item.ok}>
      <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', item.ok ? 'text-success-text' : item.required ? 'text-warning-text' : 'text-info-text')} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="text-sm font-medium text-fg">
          {item.label}
          {!item.required ? <span className="ml-2 text-xs font-normal text-fg-muted">For your information</span> : null}
        </p>
        {item.detail ? <p className="text-xs text-fg-secondary">{item.detail}</p> : null}
        {children}
      </div>
      <span className="sr-only">{item.ok ? 'Done' : 'Needs a fix'}</span>
    </li>
  );
}

export function CloseSheet({ month }: { readonly month: IsoMonth }) {
  const { key, unit, program } = useCurrentProgram();
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const checklist = useCloseChecklist(key, month);
  const [reviewed, setReviewed] = useState(false);
  const [bulk, setBulk] = useState<BulkAction | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reopening, setReopening] = useState(false);
  const name = monthShortName(month);
  const data = checklist.data;
  const nextMonthFirst = firstDayOfMonth(shiftMonth(month, 1));
  const moveTo = program.calendar.nextWorkDay > nextMonthFirst ? program.calendar.nextWorkDay : nextMonthFirst;
  const dismiss = () => {
    const next = new URLSearchParams(params?.toString() ?? '');
    next.delete('close');
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: qk.program(key) });
    await queryClient.invalidateQueries({ queryKey: qk.projectTasks(key) });
  };
  const close = useServerAction(closeMonthAction, {
    errorTitle: `Couldn't close ${name}`,
    onSuccess: async () => {
      toast.success(`${name} is closed for ${key}.`);
      setConfirming(false);
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ['programs'] });
      router.push(statementHref(key, month), { scroll: false });
    },
  });
  const adjustmentsItem = data?.items.find((item) => item.key === 'adjustments');
  const needsReview = Boolean(data && data.adjustments.length > 0 && adjustmentsItem && !adjustmentsItem.ok);
  const ready = useMemo(() => {
    if (!data) return false;
    return data.items.every((item) => !item.required || item.ok || (item.key === 'adjustments' && reviewed));
  }, [data, reviewed]);
  const runBulk = async (action: BulkAction) => {
    if (!data) return;
    setBusy(true);
    try {
      const ids = data.openBuilds.map((build) => build.id);
      if (action === 'cancel') {
        const result = await cancelBuildsAction({ ids });
        if (!result.ok) throw new Error(result.error.message);
      } else {
        for (const build of data.openBuilds) {
          const result = action === 'short' ? await closeShortAction({ taskId: build.id, reason: reason.trim() }) : await splitBuildAction({ taskId: build.id, qty: null, toDate: moveTo });
          if (!result.ok) throw new Error(`${build.key}: ${result.error.message}`);
        }
      }
      toast.success(action === 'cancel' ? `Cancelled ${ids.length === 1 ? '1 build' : `${ids.length} builds`}.` : action === 'short' ? `Closed ${ids.length === 1 ? '1 build' : `${ids.length} builds`} short.` : `Moved the rest of ${ids.length === 1 ? '1 build' : `${ids.length} builds`} to ${shortDate(moveTo)}.`);
      setBulk(null);
      setReason('');
      await refresh();
    } catch (error) {
      toast.error("Couldn't finish that", error instanceof Error ? error.message : 'Try again.');
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <SidePanel open onOpenChange={(open) => (open ? null : dismiss())}>
      <SidePanelContent width={720} title={`Close ${monthLong(month)}`} description={`Check, lock and save ${name}'s total for ${program.name}.`}>
        <div className="flex flex-col gap-5 px-4 py-5 sm:px-6" data-testid="close-sheet">
          {checklist.isLoading ? (
            <div className="flex flex-col gap-3">
              {[0, 1, 2, 3, 4].map((index) => (
                <Skeleton key={index} height={44} rounded="md" />
              ))}
            </div>
          ) : checklist.isError || !data ? (
            <EmptyState illustration="error" size="sm" title="We couldn't load the checklist" description={checklist.error?.message ?? 'Try again in a moment.'} actions={<Button variant="secondary" onClick={() => void checklist.refetch()}>Try again</Button>} />
          ) : data.closed ? (
            <div className="flex flex-col items-start gap-3 rounded-lg border border-border-subtle bg-sunken p-4">
              <p className="inline-flex items-center gap-2 text-sm font-medium text-fg">
                <Lock aria-hidden className="size-4" />
                {name} is closed · {formatCents(data.totalCents, { cents: true })} · {unitLabel(data.units, unit)}
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => router.push(statementHref(key, month), { scroll: false })}>
                  View statement
                </Button>
                {data.canReopen ? (
                  <Button size="sm" variant="ghost" onClick={() => setReopening(true)}>
                    Reopen
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              <ol className="flex flex-col divide-y divide-border-subtle rounded-xl border border-border-subtle bg-panel">
                {data.items.map((item) => (
                  <ItemRow key={item.key} item={item.key === 'adjustments' && reviewed ? { ...item, ok: true } : item}>
                    {item.key === 'open_builds' && data.openBuilds.length > 0 ? (
                      <div className="flex flex-col gap-2">
                        <ul className="flex flex-col gap-1 rounded-md bg-sunken p-2 text-xs">
                          {data.openBuilds.slice(0, 8).map((build) => (
                            <li key={build.id} className="flex items-center justify-between gap-2">
                              <span className="min-w-0 truncate text-fg">
                                <span className="font-key text-fg-secondary">{build.key}</span> {build.title}
                              </span>
                              <span className="shrink-0 text-fg-muted tabular-nums">
                                {shortDate(build.buildDate)} · {qtyOfText(build.builtQty, build.plannedQty, unit)}
                              </span>
                            </li>
                          ))}
                          {data.openBuilds.length > 8 ? <li className="text-fg-muted">and {data.openBuilds.length - 8} more</li> : null}
                        </ul>
                        {bulk === 'short' ? (
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                            <Field label="Why did they close short?" className="flex-1">
                              {({ inputId }) => <Input id={inputId} autoFocus value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="Ran out of liners" />}
                            </Field>
                            <Button size="sm" loading={busy} disabled={!reason.trim()} onClick={() => void runBulk('short')}>
                              Close {data.openBuilds.length === 1 ? 'it' : 'all'} short
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setBulk(null)}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="secondary" onClick={() => setBulk('short')}>
                              Close short
                            </Button>
                            <Button size="sm" variant="secondary" loading={busy && bulk === 'move'} onClick={() => { setBulk('move'); void runBulk('move'); }}>
                              Move the rest to {shortDate(moveTo)}
                            </Button>
                            <Button size="sm" variant="danger-ghost" loading={busy && bulk === 'cancel'} onClick={() => { setBulk('cancel'); void runBulk('cancel'); }}>
                              Cancel {data.openBuilds.length === 1 ? 'it' : 'them'}
                            </Button>
                          </div>
                        )}
                      </div>
                    ) : null}
                    {item.key === 'unpriced' && !item.ok ? (
                      <Button size="sm" variant="secondary" className="self-start" onClick={() => router.push(routes.programTab(key, 'price-card'))}>
                        Open price card
                      </Button>
                    ) : null}
                    {item.key === 'earlier_closed' && !item.ok ? (
                      <Button size="sm" variant="secondary" className="self-start" onClick={() => router.push(`${pathname}?close=${shiftMonth(month, -1)}`, { scroll: false })}>
                        Close {monthShortName(shiftMonth(month, -1))}
                      </Button>
                    ) : null}
                    {item.key === 'adjustments' && data.adjustments.length > 0 ? (
                      <div className="flex flex-col gap-2">
                        <ul className="flex flex-col gap-1 rounded-md bg-sunken p-2 text-xs">
                          {data.adjustments.map((adjustment) => (
                            <li key={adjustment.id} className="flex items-center justify-between gap-2">
                              <span className="min-w-0 truncate text-fg">
                                {shortDate(adjustment.chargeOn)} · {adjustment.label}
                                {adjustment.countsTowardMinimum ? <Badge tone="info" size="sm" className="ml-1.5">Counts toward minimum</Badge> : null}
                              </span>
                              <span className="shrink-0 text-fg tabular-nums">{formatCents(adjustment.amountCents, { cents: true })}</span>
                            </li>
                          ))}
                        </ul>
                        {needsReview ? <Checkbox checked={reviewed} onCheckedChange={(value) => setReviewed(value === true)} label="I checked these adjustments" /> : null}
                      </div>
                    ) : null}
                  </ItemRow>
                ))}
              </ol>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-subtle bg-sunken px-4 py-3">
                <div>
                  <p className="text-xs text-fg-muted">{name} total</p>
                  <p className="text-xl font-semibold text-fg tabular-nums" data-testid="close-total">
                    {formatCents(data.totalCents, { cents: true })}
                  </p>
                  <p className="text-xs text-fg-muted tabular-nums">{unitLabel(data.units, unit)} built</p>
                </div>
                <Button onClick={() => setConfirming(true)} disabled={!ready || !data.canClose} data-testid="close-month-confirm">
                  <CalendarCheck2 aria-hidden />
                  Close {name}
                </Button>
              </div>
              {!ready ? <p className="text-xs text-fg-muted">Fix the rows with a warning first. Some fix themselves, like monthly charges a few minutes after the month ends.</p> : null}
            </>
          )}
        </div>
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={`Close ${name} for ${key}?`}
          description={`This locks output, prices and fees from ${shortDate(firstDayOfMonth(month))} to the end of ${name} and saves ${formatCents(data?.totalCents ?? '0', { cents: true })} as the total. An owner can reopen it with a reason. Next month starts ${shortDate(addMonths(firstDayOfMonth(month), 1))}.`}
          confirmLabel={`Close ${name}`}
          loading={close.pending}
          onConfirm={() => void close.run({ key, month, adjustmentsReviewed: reviewed || !needsReview })}
        />
        {reopening ? <ReopenMonthDialog month={month} open={reopening} onOpenChange={setReopening} /> : null}
      </SidePanelContent>
    </SidePanel>
  );
}
