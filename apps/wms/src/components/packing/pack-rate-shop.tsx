'use client';

/**
 * Rate shopping on the pack screen: quote every carrier account and service the order's client
 * may use, for the current packages, and pick the cheapest, the fastest or any row. Picking a
 * row selects that carrier account + service and keeps its quote (no second Get rate).
 */
import { ArrowDownWideNarrow, Check, Rabbit, Scale } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useFormat } from '@/lib/format';
import { cn } from '@/lib/utils';
import { shopPicks } from './pack-model';
import type { RateQuote } from './pack-types';

export function RateShopCard({
  quotes,
  errors,
  stale,
  shopping,
  disabledReason,
  accounts,
  selectedServiceId,
  onShop,
  onPick,
}: {
  readonly quotes: readonly RateQuote[] | null;
  readonly errors: readonly string[];
  /** The packages changed since these quotes were fetched. */
  readonly stale: boolean;
  readonly shopping: boolean;
  readonly disabledReason: string | null;
  /** Carrier accounts the shop will query. */
  readonly accounts: number;
  readonly selectedServiceId: string | null;
  readonly onShop: () => void;
  readonly onPick: (q: RateQuote) => void;
}) {
  const fmt = useFormat();
  const { cheapest, fastest } = shopPicks(quotes ?? []);
  const sorted = [...(quotes ?? [])].sort((a, b) => a.price - b.price || a.transitDays - b.transitDays);
  const money = (q: RateQuote) => fmt.money(q.price, q.currency, 'summary');
  const days = (q: RateQuote) => `${q.transitDays} day${q.transitDays === 1 ? '' : 's'}`;
  return (
    <div data-testid="pack-rate-shop">
      <Card className="space-y-2 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <Scale className="h-4 w-4 text-secondary" aria-hidden />
              Rate shop
            </p>
            <p className="text-2xs text-secondary">
              Compare every service across {accounts} carrier account{accounts === 1 ? '' : 's'} for these
              packages.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={onShop}
            disabled={shopping || Boolean(disabledReason) || accounts === 0}
            title={disabledReason ?? undefined}
            data-testid="pack-rate-shop-run"
          >
            {shopping ? (
              <Spinner className="h-3.5 w-3.5" label="Comparing rates" />
            ) : (
              <ArrowDownWideNarrow className="h-3.5 w-3.5" aria-hidden />
            )}
            {quotes ? 'Compare again' : 'Compare rates'}
          </Button>
        </div>
        {disabledReason && !quotes ? <p className="text-2xs text-secondary">{disabledReason}</p> : null}
        {quotes && stale ? (
          <p className="text-2xs font-medium text-warning">
            The packages changed since this comparison. Compare again for current rates.
          </p>
        ) : null}
        {quotes && quotes.length > 0 ? (
          <>
            <div className="flex flex-wrap gap-2">
              {cheapest ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={stale}
                  onClick={() => onPick(cheapest)}
                  data-testid="pack-rate-cheapest"
                >
                  <Check className="h-3.5 w-3.5" aria-hidden />
                  Cheapest: {cheapest.carrierCode} {cheapest.serviceName} · {money(cheapest)}
                </Button>
              ) : null}
              {fastest && fastest !== cheapest ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={stale}
                  onClick={() => onPick(fastest)}
                  data-testid="pack-rate-fastest"
                >
                  <Rabbit className="h-3.5 w-3.5" aria-hidden />
                  Fastest: {fastest.carrierCode} {fastest.serviceName} · {days(fastest)}
                </Button>
              ) : null}
            </div>
            <div className="max-h-56 overflow-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface-sunken text-left text-2xs text-secondary">
                  <tr>
                    <th className="px-2 py-1.5 font-semibold">Service</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Rate</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Transit</th>
                    <th className="px-2 py-1.5">
                      <span className="sr-only">Choose</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((q) => {
                    const selected = q.carrierServiceId === selectedServiceId;
                    return (
                      <tr
                        key={`${q.carrierConnectionId}-${q.carrierServiceId}`}
                        className={cn('border-t border-border', selected && 'bg-success-soft/60')}
                      >
                        <td className="px-2 py-1.5">
                          <span className="font-medium">
                            {q.carrierCode} {q.serviceName}
                          </span>
                          {q === cheapest ? (
                            <span className="ml-1.5 rounded bg-success-soft px-1 text-2xs font-semibold text-success">
                              Cheapest
                            </span>
                          ) : null}
                          {q === fastest ? (
                            <span className="ml-1.5 rounded bg-info-soft px-1 text-2xs font-semibold text-info">
                              Fastest
                            </span>
                          ) : null}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{money(q)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{days(q)}</td>
                        <td className="px-2 py-1.5 text-right">
                          {selected ? (
                            <span className="inline-flex items-center gap-1 text-2xs font-semibold text-success">
                              <Check className="h-3 w-3" aria-hidden />
                              Selected
                            </span>
                          ) : (
                            <Button size="sm" variant="ghost" disabled={stale} onClick={() => onPick(q)}>
                              Use
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : quotes ? (
          <p className="text-xs text-secondary">No carrier returned a rate for these packages.</p>
        ) : null}
        {errors.length ? (
          <ul className="text-2xs text-secondary" aria-label="Accounts not quoted">
            {errors.map((e) => (
              <li key={e}>Not quoted: {e}</li>
            ))}
          </ul>
        ) : null}
      </Card>
    </div>
  );
}
