'use client';

/**
 * AI Count Plan (Create New Count › 2.Tasks › Suggest): asks `/api/counts/suggest` for the
 * riskiest locations / SKUs of the warehouse (never or long ago counted, fast moving, past
 * variances, ABC class), shows the score and the reasons for each, and adds the checked ones.
 * The plan is then saved with AI Count Plan = Yes.
 */
import * as React from 'react';
import { Sparkles } from 'lucide-react';
import { useApiQuery } from '@/lib/query-client';
import { COUNT_QUERY_TIMEOUT_MS } from './counts-client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { FieldLabel } from '@/components/ui/form';
import { NumberInput } from '@/components/ui/number-input';
import { SkeletonText } from '@/components/ui/skeleton';
import { DisabledReason } from '@/components/ui/tooltip';

export interface CountSuggestion {
  readonly id: string;
  readonly label: string;
  readonly sub1: string | null;
  readonly sub2: string | null;
  readonly onHand: number;
  readonly score: number;
  readonly reasons: readonly string[];
}

export interface CountSuggestDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly warehouseId: string;
  readonly countType: 'Location' | 'SKU';
  readonly exclude: readonly string[];
  readonly onAdd: (rows: readonly CountSuggestion[]) => void;
}

export function CountSuggestDialog(props: CountSuggestDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="lg">{props.open ? <Body {...props} /> : null}</DialogContent>
    </Dialog>
  );
}

function Body({
  onOpenChange,
  warehouseId,
  countType,
  exclude,
  onAdd,
}: Omit<CountSuggestDialogProps, 'open'>) {
  const [limit, setLimit] = React.useState<number | null>(20);
  const size = Math.min(200, Math.max(1, limit ?? 20));
  const q = useApiQuery<CountSuggestion[]>(
    ['count-suggest', warehouseId, countType, size],
    '/api/counts/suggest',
    { query: { warehouseId, countType, limit: size }, staleTime: 0, timeoutMs: COUNT_QUERY_TIMEOUT_MS },
  );
  const excluded = React.useMemo(() => new Set(exclude), [exclude]);
  const rows = (q.data?.data ?? []).filter((r) => !excluded.has(r.id));
  const [unchecked, setUnchecked] = React.useState<ReadonlySet<string>>(new Set());
  const picked = rows.filter((r) => !unchecked.has(r.id));
  const noun = countType === 'Location' ? ['location', 'locations'] : ['SKU', 'SKUs'];
  const toggle = (id: string) => {
    const n = new Set(unchecked);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setUnchecked(n);
  };
  const reason = q.isPending ? 'Ranking…' : picked.length === 0 ? `Select at least one ${noun[0]}` : null;

  return (
    <>
      <DialogHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            AI Count Plan
          </span>
        }
        description={`Ranks the warehouse's stocked ${countType === 'Location' ? 'storage and pick locations' : noun[1]} by count risk: never or long ago counted, fast moving, past count variances${countType === 'Location' ? ' and ABC class' : ''}. ${noun[1][0]?.toUpperCase()}${noun[1].slice(1)} already in an open count are left out.`}
      />
      <DialogBody>
        <div className="flex flex-col gap-3">
          <div className="flex items-end gap-3">
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="ai-limit">How many {noun[1]}</FieldLabel>
              <NumberInput
                id="ai-limit"
                aria-label={`How many ${noun[1]}`}
                min={1}
                max={200}
                value={limit}
                onChange={setLimit}
                className="w-[120px]"
              />
            </div>
            <p className="pb-1.5 text-xs text-secondary">
              {q.isPending ? 'Ranking…' : `${rows.length} suggested · ${picked.length} selected`}
            </p>
          </div>
          {q.error ? (
            <Callout
              variant="error"
              title="Suggestions unavailable"
              action={
                <Button size="sm" variant="secondary" onClick={() => void q.refetch()}>
                  Retry
                </Button>
              }
            >
              {q.error.message}
            </Callout>
          ) : null}
          {q.isPending ? (
            <SkeletonText lines={6} />
          ) : rows.length === 0 && !q.error ? (
            <p className="rounded-lg border border-dashed border-border-strong px-4 py-8 text-center text-sm text-secondary">
              No stocked {noun[1]} are left to suggest. Everything with stock is already in an open count or
              in this plan.
            </p>
          ) : (
            <div className="ks-scroll max-h-[46vh] overflow-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-surface-sunken text-left text-2xs font-semibold text-faint">
                  <tr>
                    <th scope="col" className="w-10 px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label="Select all suggestions"
                        checked={unchecked.size === 0 && rows.length > 0}
                        onChange={() =>
                          setUnchecked(unchecked.size === 0 ? new Set(rows.map((r) => r.id)) : new Set())
                        }
                        className="accent-[var(--color-primary)]"
                      />
                    </th>
                    <th scope="col" className="px-3 py-2">
                      {countType === 'Location' ? 'Location' : 'Product Code'}
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Why
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      On hand
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Risk
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className={cn(
                        'cursor-pointer border-t border-border',
                        !unchecked.has(r.id) && 'bg-primary-soft/40',
                      )}
                      onClick={() => toggle(r.id)}
                    >
                      <td className="px-3 py-1.5">
                        <input
                          type="checkbox"
                          aria-label={`Select ${r.label}`}
                          checked={!unchecked.has(r.id)}
                          onChange={() => toggle(r.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="accent-[var(--color-primary)]"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <span className="flex flex-col leading-tight">
                          <span className="font-semibold text-foreground">{r.label}</span>
                          <span className="text-2xs text-secondary">
                            {[r.sub1, r.sub2].filter(Boolean).join(' · ') || 'None'}
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-xs text-secondary">
                        {r.reasons.join(' · ') || 'Routine coverage'}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.onHand.toLocaleString()}</td>
                      <td className="px-3 py-1.5 text-right">
                        <RiskBadge score={r.score} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <span className="mr-auto text-xs text-secondary">The plan is saved as an AI Count Plan.</span>
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <DisabledReason reason={reason}>
          <Button
            variant="primary"
            disabled={Boolean(reason)}
            onClick={() => {
              onAdd(picked);
              onOpenChange(false);
            }}
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Add {picked.length || ''} {picked.length === 1 ? noun[0] : noun[1]}
          </Button>
        </DisabledReason>
      </DialogFooter>
    </>
  );
}

function RiskBadge({ score }: { readonly score: number }) {
  const tone =
    score >= 70
      ? 'bg-danger-soft text-danger'
      : score >= 40
        ? 'bg-warning-soft text-warning'
        : 'bg-surface-sunken text-secondary';
  return (
    <span
      className={cn(
        'inline-flex min-w-[36px] justify-center rounded-full px-2 py-0.5 text-2xs font-semibold tabular-nums',
        tone,
      )}
      title="Count risk score (0–100)"
    >
      {score}
    </span>
  );
}
