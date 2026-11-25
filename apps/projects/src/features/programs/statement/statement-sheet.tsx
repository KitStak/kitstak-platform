'use client';
/**
 * Statement sheet (`?statement=2026-11`, docs/programs/SPEC.md 5.6 and 5.20): a 720px side panel
 * with the month's lines (date, line, qty, rate, amount), group subtotals and the total, read
 * from `/statement` (the posted ledger and the per unit snapshots). Export CSV, Download PDF and
 * Print. Owners close an ended month from here; a closed month shows who closed it and Reopen.
 */
import { useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck2, FileSpreadsheet, FileText, Lock, Plus, Printer, Trash2 } from 'lucide-react';
import { firstDayOfMonth, formatCents, formatQty, formatUnitPrice, lastDayOfMonth, minDate, shortDate, unitLabel } from '@kitstak/programs-engine';
import { Badge, Button, ConfirmDialog, EmptyState, IconButton, SidePanel, SidePanelContent, Skeleton, buttonVariants, cn } from '@/components/ui';
import { apiGet, apiPath } from '@/lib/api-client';
import { useServerAction } from '@/lib/hooks/use-action';
import { usePeopleMap } from '@/lib/hooks/use-people';
import { useCloseChecklist, useOneTimeCharges } from '@/lib/hooks/use-programs';
import { qk } from '@/lib/query-keys';
import type { IsoMonth, StatementDTO } from '@/lib/program-types';
import { deleteOneTimeChargeAction } from '@/server/actions/price-cards';
import { useCurrentProgram } from '../program-context';
import { MoneyHiddenNote } from '../kit';
import { statementFileHref } from '../frame/program-menu';
import { AdjustmentDialog } from '../adjustments/adjustment-dialog';
import { ReopenMonthDialog } from '../close/reopen-dialog';
import { BeforeStartNotice, monthBeforeStart } from '../close/before-start';
import { keepOpenForToasts } from '../close/close-sheet';
import { CHARGE_GROUP_ORDER, chargeGroupOf, groupLabel, monthLong, monthShortName, type ChargeGroup } from '../overview/overview-model';

export const statementKey = (key: string, month: IsoMonth) => [...qk.program(key), 'statement', month] as const;

export function useStatement(key: string, month: IsoMonth, enabled = true) {
  return useQuery({ queryKey: statementKey(key, month), queryFn: () => apiGet<StatementDTO>(apiPath(`programs/${encodeURIComponent(key)}/statement`, { month })), enabled, staleTime: 15_000 });
}

interface Row {
  readonly id: string;
  readonly date: string;
  readonly line: string;
  readonly note: string | null;
  readonly qty: string | null;
  readonly rate: string | null;
  readonly cents: string;
  readonly chargeId: string | null;
}

/** "Oct 2026", for the short title on small screens. */
const monthShortYear = (month: IsoMonth) => `${monthShortName(month).slice(0, 3)} ${month.slice(0, 4)}`;

/**
 * A shared statement link opened by someone who does not see money: the panel still opens, so the
 * link does not look broken, and says who to ask.
 */
export function StatementHiddenSheet({ month }: { readonly month: IsoMonth }) {
  const { key, program } = useCurrentProgram();
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const params = useSearchParams();
  const dismiss = () => {
    const next = new URLSearchParams(params?.toString() ?? '');
    next.delete('statement');
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
  return (
    <SidePanel open onOpenChange={(open) => (open ? null : dismiss())}>
      <SidePanelContent
        width={600}
        title={
          <>
            <span className="sm:hidden">Statement · {monthShortYear(month)}</span>
            <span className="hidden sm:inline">
              {key} statement · {monthLong(month)}
            </span>
          </>
        }
        description={program.name}
      >
        <div className="flex flex-col items-start gap-3 px-4 py-5 sm:px-6" data-testid="statement-hidden">
          <div className="flex w-full flex-col gap-1 rounded-xl border border-border-subtle bg-sunken px-4 py-4">
            <MoneyHiddenNote className="text-sm font-medium text-fg" />
            <p className="text-xs text-fg-muted">Ask an owner for the {monthLong(month)} statement. You can still see units built on the Overview and Builds tabs.</p>
          </div>
          <Button size="sm" variant="secondary" onClick={dismiss}>
            Back to Overview
          </Button>
        </div>
      </SidePanelContent>
    </SidePanel>
  );
}

/** Close date in plain words: "Dec 2". */
function closedOn(iso: string | null): string {
  if (!iso) return '';
  return shortDate(iso.slice(0, 10));
}

export function StatementSheet({ month }: { readonly month: IsoMonth }) {
  const { key, program, unit, capabilities, today, variants } = useCurrentProgram();
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const people = usePeopleMap();
  const beforeStart = monthBeforeStart(month, program.startDate);
  const statement = useStatement(key, month, !beforeStart);
  const close = useCloseChecklist(key, month, { enabled: !beforeStart });
  const charges = useOneTimeCharges(key, month, { enabled: !beforeStart });
  const [adding, setAdding] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const remove = useServerAction(deleteOneTimeChargeAction, {
    successMessage: 'Adjustment removed.',
    errorTitle: "Couldn't remove the adjustment",
    onSuccess: async () => {
      setRemoving(null);
      await queryClient.invalidateQueries({ queryKey: qk.program(key) });
    },
  });
  const dismiss = () => {
    const next = new URLSearchParams(params?.toString() ?? '');
    next.delete('statement');
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
  const data = statement.data;
  const chargeByRef = useMemo(() => new Map((charges.data ?? []).map((charge) => [charge.id, charge])), [charges.data]);
  const groups = useMemo(() => {
    if (!data) return [] as { group: ChargeGroup; rows: Row[]; cents: bigint }[];
    const through = minDate(lastDayOfMonth(month), data.asOf);
    const from = program.startDate && program.startDate > firstDayOfMonth(month) ? program.startDate : firstDayOfMonth(month);
    const period = from >= through ? shortDate(through) : `${shortDate(from)} to ${shortDate(through)}`;
    const order = new Map(variants.map((variant, index) => [variant.id, index]));
    const map = new Map<ChargeGroup, Row[]>();
    map.set(
      'per_unit',
      [...data.byVariant]
        .sort((a, b) => (order.get(a.variantId ?? '') ?? 999) - (order.get(b.variantId ?? '') ?? 999))
        .filter((row) => BigInt(row.cents) !== BigInt(0) || Number(row.units) > 0)
        .map((row) => ({ id: `v:${row.variantId ?? 'none'}`, date: period, line: row.name, note: null, qty: row.units, rate: row.avgUnitPrice, cents: row.cents, chargeId: null })),
    );
    for (const fee of data.fees) {
      const group = chargeGroupOf(fee.kind);
      const chargeId = fee.ref.split(':').at(-1) ?? null;
      const charge = chargeId ? chargeByRef.get(chargeId) : undefined;
      const rows = map.get(group) ?? [];
      rows.push({ id: fee.ref, date: shortDate(fee.date), line: fee.variantName ? `${fee.label} · ${fee.variantName}` : fee.label, note: charge?.reason ?? null, qty: fee.quantity, rate: fee.unitPrice, cents: fee.cents, chargeId: charge && !charge.locked && group === 'adjustment' ? charge.id : null });
      map.set(group, rows);
    }
    return CHARGE_GROUP_ORDER.filter((group) => (map.get(group) ?? []).length > 0).map((group) => {
      const rows = map.get(group) ?? [];
      return { group, rows, cents: rows.reduce((sum, row) => sum + BigInt(row.cents), BigInt(0)) };
    });
  }, [data, month, chargeByRef, program.startDate, variants]);
  const monthName = monthShortName(month);
  const ended = lastDayOfMonth(month) < today;
  const closed = close.data?.closed ?? data?.closed ?? false;
  const canAdjust = (capabilities.canPropose || capabilities.canManage) && !closed;
  return (
    <SidePanel open onOpenChange={(open) => (open ? null : dismiss())}>
      <SidePanelContent
        width={720}
        onPointerDownOutside={keepOpenForToasts}
        title={
          <>
            <span className="sm:hidden">Statement · {monthShortYear(month)}</span>
            <span className="hidden sm:inline">
              {key} statement · {monthLong(month)}
            </span>
          </>
        }
        description={program.customer ? `${program.name} · ${program.customer.name}` : program.name}
      >
        <style>{'@media print { body * { visibility: hidden !important; } [data-statement-print], [data-statement-print] * { visibility: visible !important; } [data-statement-print] { position: absolute; inset: 0; padding: 24px; } }'}</style>
        <div className="flex flex-col gap-5 px-4 py-5 sm:px-6" data-statement-print data-testid="statement-sheet">
          <div className={cn('-mt-1 flex flex-wrap items-center justify-end gap-1 print:hidden', beforeStart && 'hidden')}>
            <a href={statementFileHref(key, month, 'csv')} download className={buttonVariants({ variant: 'secondary', size: 'sm' })} data-testid="statement-csv">
              <FileSpreadsheet aria-hidden />
              Export CSV
            </a>
            <a href={statementFileHref(key, month, 'pdf')} download className={buttonVariants({ variant: 'secondary', size: 'sm' })} data-testid="statement-pdf">
              <FileText aria-hidden />
              Download PDF
            </a>
            <Button size="sm" variant="ghost" onClick={() => window.print()}>
              <Printer aria-hidden />
              Print
            </Button>
          </div>
          {closed && close.data ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle bg-sunken px-3 py-2.5 text-sm" data-testid="statement-closed">
              <Lock aria-hidden className="size-4 text-icon" />
              <span className="min-w-0 flex-1 text-fg">
                Closed{close.data.closedBy ? ` by ${people.get(close.data.closedBy)?.name.split(' ')[0] ?? 'an owner'}` : ''}
                {close.data.closedAt ? ` on ${closedOn(close.data.closedAt)}` : ''} · {formatCents(close.data.totalCents, { cents: true })}
              </span>
              {close.data.canReopen ? (
                <Button size="sm" variant="secondary" onClick={() => setReopening(true)} className="print:hidden">
                  Reopen
                </Button>
              ) : null}
            </div>
          ) : ended && capabilities.canClose && !beforeStart ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary-subtle/40 px-3 py-2.5 text-sm print:hidden">
              <CalendarCheck2 aria-hidden className="size-4 text-primary-text" />
              <span className="min-w-0 flex-1 text-fg">{monthName} has ended. Close it to lock its numbers and save the total.</span>
              <Button size="sm" onClick={() => router.push(`${pathname}?close=${month}`, { scroll: false })} data-testid="statement-close-month">
                Close {monthName}
              </Button>
            </div>
          ) : null}
          {beforeStart && program.startDate ? (
            <BeforeStartNotice programKey={key} month={month} startDate={program.startDate} what="bill" />
          ) : statement.isLoading ? (
            <div className="flex flex-col gap-3">
              <Skeleton height={64} rounded="lg" />
              <Skeleton height={220} rounded="lg" />
            </div>
          ) : statement.isError || !data ? (
            <EmptyState illustration="error" size="sm" title="We couldn't load this statement" description={statement.error?.message ?? 'Try again in a moment.'} actions={<Button variant="secondary" onClick={() => void statement.refetch()}>Try again</Button>} />
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(
                  [
                    ['Built', unitLabel(data.totals.units, unit)],
                    ['Work charges', formatCents(data.totals.workCents, { cents: true })],
                    ['Fees and adjustments', formatCents(String(BigInt(data.totals.feesCents) + BigInt(data.totals.adjustmentsCents)), { cents: true })],
                    ['Total', formatCents(data.totals.totalCents, { cents: true })],
                  ] as const
                ).map(([label, value], index) => (
                  <div key={label} className={cn('rounded-lg border border-border-subtle px-3 py-2.5', index === 3 && 'bg-sunken')}>
                    <dt className="text-xs text-fg-muted">{label}</dt>
                    <dd className={cn('mt-0.5 text-lg font-semibold text-fg tabular-nums', index === 3 && 'text-xl')} data-testid={index === 3 ? 'statement-total' : undefined}>
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="overflow-x-auto rounded-lg border border-border-subtle">
                <table className="w-full min-w-[400px] text-sm sm:min-w-[560px]" data-testid="statement-lines">
                  <thead>
                    <tr className="border-b border-border-subtle bg-sunken/60 text-left text-xs text-fg-muted">
                      <th scope="col" className="px-3 py-2 font-medium max-sm:hidden">Date</th>
                      <th scope="col" className="px-3 py-2 font-medium">Line</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Qty</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Rate</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  {groups.map(({ group, rows, cents }) => (
                    <tbody key={group} data-group={group}>
                      <tr className="border-b border-border-subtle">
                        <th scope="rowgroup" colSpan={5} className="px-3 pt-3 pb-1 text-left text-xs font-semibold tracking-wide text-fg-secondary uppercase">
                          {groupLabel(group, unit)}
                        </th>
                      </tr>
                      {rows.map((row) => (
                        <tr key={row.id} className="group/row border-b border-border-subtle">
                          <td className="px-3 py-1.5 whitespace-nowrap text-fg-muted tabular-nums max-sm:hidden">{row.date}</td>
                          <td className="px-3 py-1.5 text-fg">
                            <span className="flex items-center gap-1.5">
                              <span className="min-w-0">
                                {row.line}
                                {row.note ? <span className="block text-xs text-fg-muted">{row.note}</span> : null}
                              </span>
                              {row.chargeId ? <IconButton label={`Remove ${row.line}`} icon={<Trash2 aria-hidden />} size="xs" variant="danger" className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 print:hidden" onClick={() => setRemoving(row.chargeId)} /> : null}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-right text-fg-secondary tabular-nums">{row.qty ? formatQty(row.qty) : ''}</td>
                          <td className="px-3 py-1.5 text-right text-fg-secondary tabular-nums">{row.rate ? formatUnitPrice(row.rate) : ''}</td>
                          <td className={cn('px-3 py-1.5 text-right tabular-nums', BigInt(row.cents) < BigInt(0) ? 'text-success-text' : 'text-fg')}>{formatCents(row.cents, { cents: true })}</td>
                        </tr>
                      ))}
                      <tr className="border-b border-border-default">
                        <td colSpan={4} className="px-3 py-1.5 text-right text-xs font-medium text-fg-muted">
                          {groupLabel(group, unit)} subtotal
                        </td>
                        <td className="px-3 py-1.5 text-right font-medium text-fg tabular-nums">{formatCents(cents, { cents: true })}</td>
                      </tr>
                    </tbody>
                  ))}
                  <tfoot>
                    <tr className="bg-sunken/60">
                      <th scope="row" colSpan={4} className="px-3 py-2.5 text-right text-sm font-semibold text-fg">
                        Total
                      </th>
                      <td className="px-3 py-2.5 text-right text-base font-semibold text-fg tabular-nums">{formatCents(data.totals.totalCents, { cents: true })}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="flex flex-col gap-1 text-xs text-fg-muted">
                {data.minimum.status !== 'none' ? (
                  <p>
                    Monthly minimum {formatCents(data.minimum.minimumCents, { cents: true })} · {data.minimum.statusText}
                    {BigInt(data.totals.topUpCents) > BigInt(0) ? ` · Minimum top up ${formatCents(data.totals.topUpCents, { cents: true })}` : ''}
                  </p>
                ) : null}
                {!ended ? <p>The minimum top up is added after the month ends.</p> : null}
                <p>Prices are the ones in force on each day. Closed days never change.</p>
              </div>
              {canAdjust ? (
                <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-4 print:hidden">
                  <Button size="sm" variant="secondary" onClick={() => setAdding(true)} data-testid="statement-add-adjustment">
                    <Plus aria-hidden />
                    Add adjustment
                  </Button>
                  <span className="text-xs text-fg-muted">Setup fees and adjustments are dated charges outside the price card.</span>
                </div>
              ) : closed ? <Badge tone="neutral">This month is closed, so its charges cannot change.</Badge> : null}
            </>
          )}
        </div>
        {adding ? <AdjustmentDialog open={adding} onOpenChange={setAdding} defaultDate={minDate(lastDayOfMonth(month), today)} /> : null}
        {reopening ? <ReopenMonthDialog month={month} open={reopening} onOpenChange={setReopening} /> : null}
        <ConfirmDialog
          open={removing !== null}
          onOpenChange={(open) => (open ? null : setRemoving(null))}
          title="Remove this adjustment?"
          description="The statement and the minimum update right away. This is saved in Activity."
          confirmLabel="Remove"
          destructive
          loading={remove.pending}
          onConfirm={() => removing && void remove.run({ id: removing })}
        />
      </SidePanelContent>
    </SidePanel>
  );
}
