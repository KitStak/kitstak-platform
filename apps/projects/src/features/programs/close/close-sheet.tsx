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
import { addMonths, firstDayOfMonth, formatCents, lastDayOfMonth, quantityToScaled, shiftMonth, shortDate, unitLabel } from '@kitstak/programs-engine';
import { Badge, Button, Checkbox, ConfirmDialog, EmptyState, Field, Input, SidePanel, SidePanelContent, Skeleton, cn, toast } from '@/components/ui';
import { useServerAction } from '@/lib/hooks/use-action';
import { useCloseChecklist } from '@/lib/hooks/use-programs';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import type { CloseChecklistDTO, CloseChecklistItemDTO, IsoMonth } from '@/lib/program-types';
import { cancelBuildsAction, closeShortAction, restoreBuildsAction, splitBuildAction, undoCreateBuildsAction, updateBuildAction } from '@/server/actions/builds';
import { closeMonthAction } from '@/server/actions/program-closes';
import { useCurrentProgram } from '../program-context';
import { qtyOfText } from '../kit/format';
import { monthLong, monthShortName } from '../overview/overview-model';
import { statementHref } from '../frame/program-menu';
import { ReopenMonthDialog } from './reopen-dialog';
import { BeforeStartNotice, monthBeforeStart } from './before-start';

type BulkAction = 'short' | 'move' | 'cancel';

/** Clicking Undo on a toast (it lives outside the panel) must not close the sheet. */
export function keepOpenForToasts(event: { readonly target: EventTarget | null; preventDefault: () => void }) {
  const target = event.target as Element | null;
  if (target?.closest?.('[data-sonner-toaster], [data-radix-popper-content-wrapper], [role="dialog"], [role="alertdialog"]')) event.preventDefault();
}
type OpenBuild = CloseChecklistDTO['openBuilds'][number];

const buildsText = (count: number) => (count === 1 ? '1 build' : `${count} builds`);

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
  const { key, unit, program, today } = useCurrentProgram();
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const beforeStart = monthBeforeStart(month, program.startDate);
  const checklist = useCloseChecklist(key, month, { enabled: !beforeStart });
  const [reviewed, setReviewed] = useState(false);
  const [bulk, setBulk] = useState<BulkAction | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<BulkAction | null>(null);
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
    // The checklist first, so the sheet updates at once; the rest of the program refreshes behind it.
    await queryClient.invalidateQueries({ queryKey: qk.programClose(key, month) });
    void queryClient.invalidateQueries({ queryKey: qk.program(key), predicate: (query) => query.queryKey[2] !== 'close' });
    void queryClient.invalidateQueries({ queryKey: qk.projectTasks(key) });
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
  // Bulk fixes only touch builds dated before today: in a month that has not ended, the builds
  // still planned for later days are the schedule's output, not loose ends.
  const pastOpen = useMemo(() => (data?.openBuilds ?? []).filter((build) => build.buildDate < today), [data, today]);
  const laterOpen = (data?.openBuilds.length ?? 0) - pastOpen.length;
  const monthEnded = lastDayOfMonth(month) < today;
  const count = pastOpen.length;
  const undoMove = async (moved: readonly { build: OpenBuild; newId: string | null }[]) => {
    const created = moved.flatMap((entry) => (entry.newId ? [entry.newId] : []));
    if (created.length) {
      const back = await undoCreateBuildsAction({ ids: created });
      if (!back.ok) return toast.error("Couldn't undo the move", back.error.message);
    }
    for (const entry of moved) {
      if (entry.newId) continue;
      const back = await updateBuildAction({ taskId: entry.build.id, patch: { buildDate: entry.build.buildDate } });
      if (!back.ok) {
        await refresh();
        return toast.error(`Couldn't move ${entry.build.key} back`, back.error.message);
      }
    }
    toast.success(`Moved ${buildsText(moved.length)} back.`);
    await refresh();
  };
  const runBulk = async (action: BulkAction) => {
    if (!data || count === 0) return;
    setBusy(true);
    const ids = pastOpen.map((build) => build.id);
    try {
      if (action === 'cancel') {
        const result = await cancelBuildsAction({ ids });
        if (!result.ok) throw new Error(result.error.message);
        toast.undo(`Cancelled ${buildsText(result.data.changed)}.`, {
          description: 'Logged output stays. The batch fee stops.',
          onUndo: async () => {
            const back = await restoreBuildsAction({ ids });
            if (back.ok) toast.success(`Restored ${buildsText(back.data.changed)}.`);
            else toast.error("Couldn't restore the builds", back.error.message);
            await refresh();
          },
        });
      } else if (action === 'short') {
        let done = 0;
        for (const build of pastOpen) {
          const result = await closeShortAction({ taskId: build.id, reason: reason.trim() });
          if (!result.ok) throw new Error(done ? `Closed ${done} of ${count} short. ${build.key}: ${result.error.message}` : `${build.key}: ${result.error.message}`);
          done += 1;
        }
        toast.success(`Closed ${buildsText(count)} short.`);
      } else {
        // A build with no output moves whole (its date changes, so Undo puts it back); a build
        // with some output splits, so what was built stays in this month.
        const moved: { build: OpenBuild; newId: string | null }[] = [];
        for (const build of pastOpen) {
          const untouched = quantityToScaled(build.builtQty) === BigInt(0);
          const result = untouched ? await updateBuildAction({ taskId: build.id, patch: { buildDate: moveTo } }) : await splitBuildAction({ taskId: build.id, qty: null, toDate: moveTo });
          if (!result.ok) {
            await refresh();
            if (moved.length) {
              toast.undo(`Moved ${moved.length} of ${count} builds to ${shortDate(moveTo)}.`, { description: `${build.key}: ${result.error.message} The other ${count - moved.length} are still open.`, onUndo: () => void undoMove(moved) });
            } else toast.error(`Couldn't move ${build.key}`, result.error.message);
            return;
          }
          moved.push({ build, newId: untouched ? null : (result.data as { newBuildId: string }).newBuildId });
        }
        toast.undo(`Moved ${buildsText(count)} to ${shortDate(moveTo)}.`, {
          description: moved.some((entry) => entry.newId) ? 'Builds with output keep it here. The rest moved to a new build.' : undefined,
          onUndo: () => void undoMove(moved),
        });
      }
      setBulk(null);
      setReason('');
      setAsking(null);
      await refresh();
    } catch (error) {
      toast.error("Couldn't finish that", error instanceof Error ? error.message : 'Try again.');
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  const confirmCopy: Record<BulkAction, { title: string; description: string; label: string }> = {
    cancel: { title: `Cancel ${buildsText(count)}?`, description: `Builds dated before today in ${name} stop. Logged output stays and the batch fee stops. You can undo this right after.`, label: `Cancel ${buildsText(count)}` },
    move: { title: `Move ${buildsText(count)} to ${shortDate(moveTo)}?`, description: `What is left to build moves to ${shortDate(moveTo)}. Output already logged stays in ${name}. You can undo this right after.`, label: `Move ${buildsText(count)}` },
    short: { title: `Close ${buildsText(count)} short?`, description: `They close at what was built, with the reason "${reason.trim()}". The rest is not built.`, label: `Close ${buildsText(count)} short` },
  };
  return (
    <SidePanel open onOpenChange={(open) => (open ? null : dismiss())}>
      <SidePanelContent width={720} title={`Close ${monthLong(month)}`} description={`Check, lock and save ${name}'s total for ${program.name}.`} onPointerDownOutside={keepOpenForToasts}>
        <div className="flex flex-col gap-5 px-4 py-5 sm:px-6" data-testid="close-sheet">
          {beforeStart && program.startDate ? (
            <BeforeStartNotice programKey={key} month={month} startDate={program.startDate} what="close" />
          ) : checklist.isLoading ? (
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
                        {count === 0 ? (
                          <p className="text-xs text-fg-muted" data-testid="close-open-later">
                            {laterOpen === 1 ? 'This build is' : `These ${laterOpen} builds are`} planned for today or later in {name}. They close as the floor logs output.{monthEnded ? '' : ` Close ${name} after it ends.`}
                          </p>
                        ) : bulk === 'short' ? (
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                            <Field label="Why did they close short?" className="flex-1">
                              {({ inputId }) => <Input id={inputId} autoFocus value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="Ran out of liners" />}
                            </Field>
                            <Button size="sm" disabled={!reason.trim()} onClick={() => setAsking('short')}>
                              Close {buildsText(count)} short
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setBulk(null)}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2">
                            {laterOpen > 0 ? <p className="text-xs text-fg-muted">These fix the {buildsText(count)} dated before today. The {laterOpen} planned for today or later stay as they are.</p> : null}
                            <div className="flex flex-wrap gap-2" data-testid="close-bulk-actions">
                              <Button size="sm" variant="secondary" onClick={() => setBulk('short')}>
                                Close {buildsText(count)} short
                              </Button>
                              <Button size="sm" variant="secondary" onClick={() => setAsking('move')}>
                                Move {buildsText(count)} to {shortDate(moveTo)}
                              </Button>
                              <Button size="sm" variant="danger-ghost" onClick={() => setAsking('cancel')}>
                                Cancel {buildsText(count)}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : null}
                    {item.key === 'unpriced' && !item.ok ? (
                      <Button size="sm" variant="secondary" className="self-start" onClick={() => router.push(routes.programTab(key, 'price-card'))}>
                        Open price card
                      </Button>
                    ) : null}
                    {item.key === 'earlier_closed' && !item.ok && !monthBeforeStart(shiftMonth(month, -1), program.startDate) ? (
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
        <ConfirmDialog
          open={asking !== null}
          onOpenChange={(value) => (value || busy ? null : setAsking(null))}
          title={asking ? confirmCopy[asking].title : ''}
          description={asking ? confirmCopy[asking].description : undefined}
          confirmLabel={asking ? confirmCopy[asking].label : undefined}
          cancelLabel="Keep them"
          destructive={asking === 'cancel'}
          loading={busy}
          onConfirm={() => (asking ? void runBulk(asking) : undefined)}
        />
        {reopening ? <ReopenMonthDialog month={month} open={reopening} onOpenChange={setReopening} /> : null}
      </SidePanelContent>
    </SidePanel>
  );
}
