'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CircleAlert, UserPlus } from 'lucide-react';
import type { BillingManagerRow } from '@kitstak/billing/server';
import { Badge, Button, Field, Select } from '@/components/ui';
import { addBillingManagerAction, removeBillingManagerAction } from '@/server/billing-actions';

export interface TeamManagerProps {
  readonly holders: readonly (Omit<BillingManagerRow, 'addedAt'> & { readonly addedLabel: string | null })[];
  /** Active members who do not hold billing yet. */
  readonly candidates: readonly { readonly userId: string; readonly name: string; readonly email: string }[];
  readonly canAssign: boolean;
  readonly selfId: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase() || '?';
}

/** Who can manage billing (SPEC 6.7). Owners are fixed. An owner adds or removes billing managers. */
export function TeamManager({ holders, candidates, canAssign, selfId }: TeamManagerProps) {
  const router = useRouter();
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const run = async (key: string, work: () => Promise<{ ok: true } | { ok: false; error: { message: string } }>, doneText: string) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    setDone(null);
    try {
      const result = await work();
      if (result.ok) {
        setDone(doneText);
        setPicked('');
        router.refresh();
      } else setError(result.error.message);
    } catch {
      setError('We could not reach KitStak. Check your connection and try again.');
    }
    setBusy(null);
  };

  return (
    <div className="flex flex-col">
      <ul className="divide-y divide-border-subtle">
        {holders.map((holder) => (
          <li key={holder.userId} data-testid={`team-row-${holder.userId}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 sm:px-6">
            <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-sunken text-sm font-semibold text-fg-secondary">
              {initials(holder.name)}
            </span>
            <div className="min-w-0 flex-1 basis-40">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
                <span className="truncate">{holder.name}</span>
                {holder.userId === selfId ? <span className="font-normal text-fg-muted">You</span> : null}
                <Badge tone={holder.kind === 'owner' ? 'neutral' : 'info'}>{holder.kind === 'owner' ? 'Owner' : 'Billing manager'}</Badge>
              </p>
              <p className="truncate text-sm text-fg-secondary">{holder.email}</p>
              {holder.addedLabel ? <p className="text-xs text-fg-muted">Billing manager since {holder.addedLabel}</p> : null}
            </div>
            {holder.kind === 'manager' && canAssign ? (
              <Button
                variant="secondary"
                size="lg"
                loading={busy === `remove-${holder.userId}`}
                disabled={busy !== null && busy !== `remove-${holder.userId}`}
                aria-label={`Remove ${holder.name} as billing manager`}
                onClick={() =>
                  run(`remove-${holder.userId}`, () => removeBillingManagerAction({ userId: holder.userId }), `${holder.name} can no longer manage billing.`)
                }
              >
                Remove
              </Button>
            ) : holder.kind === 'owner' ? (
              <span className="text-xs text-fg-muted">Owners always manage billing</span>
            ) : null}
          </li>
        ))}
      </ul>

      {canAssign ? (
        <form
          className="flex flex-col gap-3 border-t border-border-subtle px-5 py-5 sm:flex-row sm:items-end sm:px-6"
          onSubmit={(event) => {
            event.preventDefault();
            const person = candidates.find((candidate) => candidate.userId === picked);
            if (!person) {
              setError('Pick a person first.');
              return;
            }
            void run('add', () => addBillingManagerAction({ userId: person.userId }), `${person.name} can now manage billing.`);
          }}
        >
          <div className="min-w-0 flex-1">
            <Field label="Add a billing manager" hint={candidates.length === 0 ? 'Everyone on your team already manages billing. Invite someone new in Organization.' : 'Pick anyone on your team.'}>
              {({ inputId, describedBy }) => (
                <Select id={inputId} size="lg" value={picked} disabled={candidates.length === 0} aria-describedby={describedBy} onChange={(event) => { setPicked(event.target.value); setError(null); }}>
                  <option value="">Pick a person</option>
                  {candidates.map((candidate) => (
                    <option key={candidate.userId} value={candidate.userId}>
                      {candidate.name} ({candidate.email})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Button type="submit" size="xl" data-testid="team-add" loading={busy === 'add'} disabled={candidates.length === 0 || (busy !== null && busy !== 'add')} leadingIcon={<UserPlus aria-hidden />} className="sm:mb-[22px]">
            Add
          </Button>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="flex items-start gap-1.5 px-5 pb-5 text-sm font-medium text-danger-text sm:px-6">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="px-5 pb-5 text-sm font-medium text-success-text sm:px-6">
          {done}
        </p>
      ) : null}
    </div>
  );
}
