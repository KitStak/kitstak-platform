'use client';

/**
 * Allocation Dry Run (beyond Logiwa): pick an open order and see which buckets the algorithm
 * would reserve and which rule matched — run on the real engine, then rolled back.
 */
import * as React from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { Boxes, FlaskConical } from 'lucide-react';
import { apiFetch, apiRequest, isApiError } from '@/lib/api-client';
import type { AlgorithmRuleInput } from '@/lib/grid-defs/integrations/algorithms';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Combobox } from '@/components/ui/combobox';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import { StatusPill } from '@/components/ui/status-pill';
import type { DryRunResult } from '@/server/repositories/algorithms';

export interface DryRunTarget {
  readonly algorithmId: string | null;
  readonly name: string;
  readonly warehouseId: string;
  readonly draftRules?: readonly AlgorithmRuleInput[];
}

const orderOption = z.array(z.object({ id: z.string(), code: z.string(), label: z.string() }));

export function DryRunDialog({
  target,
  onOpenChange,
}: {
  readonly target: DryRunTarget | null;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const [orderId, setOrderId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<DryRunResult | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  const warehouseId = target?.warehouseId ?? '';
  const load = React.useCallback(
    async (q: string, signal: AbortSignal) => {
      const data = await apiFetch<unknown>('/api/algorithms/dry-run-orders', {
        query: { warehouseId, q },
        signal,
      });
      const parsed = orderOption.safeParse(data);
      return parsed.success ? parsed.data.map((o) => ({ value: o.id, label: o.label })) : [];
    },
    [warehouseId],
  );

  React.useEffect(() => {
    if (!target) {
      setResult(null);
      setFailure(null);
      setError(null);
    }
  }, [target]);

  const run = async () => {
    if (!target) return;
    if (!orderId) {
      setError('Choose an open order');
      document.getElementById('dr-order')?.focus();
      return;
    }
    setPending(true);
    setFailure(null);
    try {
      const body = {
        orderId,
        ...(target.draftRules
          ? { draft: { warehouseId: target.warehouseId, rules: target.draftRules } }
          : {}),
      };
      const { data } = await apiRequest<DryRunResult>(
        target.algorithmId && !target.draftRules
          ? `/api/algorithms/${target.algorithmId}/dry-run`
          : '/api/algorithms/dry-run',
        { method: 'POST', body },
      );
      setResult(data);
    } catch (e) {
      setResult(null);
      setFailure(isApiError(e) ? e.message : 'The dry run could not complete');
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader
          title="Dry run for order"
          description={target ? `${target.name} · nothing is reserved; results are rolled back` : undefined}
        />
        <DialogBody className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="dr-order" className="text-xs font-medium text-body">
              Shipment order <span className="text-danger">*</span>
            </label>
            <Combobox
              id="dr-order"
              aria-label="Shipment order"
              loadOptions={load}
              minChars={0}
              value={orderId}
              onChange={(v) => {
                setOrderId(v);
                setError(null);
              }}
              placeholder="Search open orders by code or customer"
              invalid={Boolean(error)}
              clearable
            />
            {error ? (
              <p role="alert" className="text-xs text-danger">
                {error}
              </p>
            ) : null}
          </div>
          {failure ? (
            <Callout variant="error" title="Dry run failed">
              {failure}
            </Callout>
          ) : null}
          {pending ? (
            <div className="flex items-center gap-2 py-6 text-sm text-secondary">
              <Spinner className="h-4 w-4" />
              Allocating in a sandbox…
            </div>
          ) : result ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold text-foreground">{result.orderCode}</span>
                <StatusPill
                  status={
                    result.outcome === 'Allocated'
                      ? 'Ready to Pick'
                      : result.outcome === 'Shortage'
                        ? 'Shortage'
                        : 'Cancelled'
                  }
                  domain="shipmentOrder"
                />
                <span className="text-secondary">
                  {result.outcome === 'Allocated'
                    ? 'would be fully allocated'
                    : result.outcome === 'Shortage'
                      ? 'would be short'
                      : 'would fail'}
                </span>
                {result.rule ? <Badge tone="info">Rule · {result.rule}</Badge> : null}
              </div>
              {result.message ? <Callout variant="attention">{result.message}</Callout> : null}
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-surface-sunken text-2xs text-secondary">
                    <tr>
                      <th className="px-3 py-2 text-left">SKU</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-left">Buckets chosen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {result.lines.map((l) => (
                      <tr key={l.sku} className="align-top">
                        <td className="px-3 py-2 font-medium">{l.sku}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {l.allocated}/{l.quantity}
                        </td>
                        <td className="px-3 py-2">
                          {l.buckets.length === 0 ? (
                            <span className="text-danger">Nothing eligible</span>
                          ) : (
                            <ul className="flex flex-col gap-0.5">
                              {l.buckets.map((b, i) => (
                                <li key={i} className="flex flex-wrap gap-x-2">
                                  <span className="font-medium">{b.location}</span>
                                  {b.areaType ? <span className="text-faint">{b.areaType}</span> : null}
                                  {b.lp ? <span>LP {b.lp}</span> : null}
                                  {b.lot ? <span>Lot {b.lot}</span> : null}
                                  {b.expiry ? <span>Exp {b.expiry.slice(0, 10)}</span> : null}
                                  <span className="tabular-nums">× {b.qty}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.exceptions.length > 0 ? (
                <Callout variant="attention" title="Allocation exceptions">
                  {result.exceptions.join(' · ')}
                </Callout>
              ) : null}
              <p className="text-2xs text-faint">
                Want to commit it? Allocate the order from{' '}
                <Link className="text-primary hover:underline" href="/jobs">
                  Jobs
                </Link>{' '}
                or the order backlog.
              </p>
            </div>
          ) : (
            <EmptyState
              compact
              icon={Boxes}
              title="Pick an order"
              description="The dry run shows which locations, LPs and lots would be reserved and the rule that matched."
            />
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button variant="primary" onClick={() => void run()} disabled={pending}>
            <FlaskConical className="h-4 w-4" />
            Run dry run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
