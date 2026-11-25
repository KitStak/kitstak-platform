'use client';
/**
 * "Link Pulse job" picker (docs/programs/SPEC.md 5.5, 5.8, 6.1). For a program or a build: pick an
 * ongoing per unit Pulse job so output and fees go to it (`bills_to`). Jobs that cannot take the
 * link stay in the list, greyed, with the reason from `canLinkJob` ("This job is already linked to
 * the program GLOVE."). With `purpose: 'related'` it links a job for reference only, with no money.
 *
 *   <LinkPulseJobDialog open onOpenChange target={{ kind: 'program', programKey, programId }} onLinked={refresh} />
 */
import { useState } from 'react';
import { Command } from 'cmdk';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, Check, Search } from 'lucide-react';
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, Spinner, cn } from '@/components/ui';
import { apiGet, apiPath } from '@/lib/api-client';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import { useServerAction } from '@/lib/hooks/use-action';
import { linkPulseJobAction, linkRecordAction } from '@/server/actions/program-links';

export interface PulseJobPick {
  readonly id: string;
  readonly number: string;
  readonly name: string;
  readonly status: string;
  readonly clientName: string | null;
  readonly unitLabel: string;
  readonly pricingModel: 'per_unit' | 'fixed' | 'hourly';
  readonly kind: 'ongoing' | 'one_time';
  readonly refusal: { readonly reason: string; readonly message: string } | null;
}

export type PulseJobSearchDTO = { readonly available: true; readonly jobs: readonly PulseJobPick[] } | { readonly available: false; readonly reason: string };

export type PulseLinkTarget =
  | { readonly kind: 'program'; readonly programKey: string; readonly programId: string }
  | { readonly kind: 'build'; readonly buildId: string; readonly programId: string | null };

/** Jobs for the picker: GET /api/v1/programs/pulse-jobs?q=&purpose=&program=|build= (no target for a plain related link). */
export function usePulseJobSearch(q: string, purpose: 'bills_to' | 'related', target: PulseLinkTarget | null, enabled: boolean) {
  const params: Record<string, string> = { q, purpose };
  if (target?.kind === 'program') {
    if (target.programKey) params.program = target.programKey;
    else params.programId = target.programId;
  }
  if (target?.kind === 'build') params.build = target.buildId;
  return useQuery({
    queryKey: ['pulse-jobs', params],
    queryFn: () => apiGet<PulseJobSearchDTO>(apiPath('programs/pulse-jobs', params)),
    enabled,
    retry: false,
    staleTime: 30_000,
  });
}

const MODEL_TEXT: Readonly<Record<PulseJobPick['pricingModel'], string>> = { per_unit: 'Per unit', fixed: 'Fixed price', hourly: 'Hourly' };

export interface LinkPulseJobDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly target: PulseLinkTarget;
  /** `bills_to` (default) sends output and fees to the job; `related` only links it. */
  readonly purpose?: 'bills_to' | 'related';
  readonly onLinked?: () => void;
}

export function LinkPulseJobDialog({ open, onOpenChange, target, purpose = 'bills_to', onLinked }: LinkPulseJobDialogProps) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<PulseJobPick | null>(null);
  const debounced = useDebouncedValue(query, 200);
  const jobs = usePulseJobSearch(debounced, purpose, target, open);
  const done = () => {
    onLinked?.();
    onOpenChange(false);
  };
  const billTo = useServerAction(linkPulseJobAction, {
    errorTitle: "Couldn't link the Pulse job",
    successMessage: (result) => (result.repostedRows > 0 ? `Linked ${picked?.number ?? 'the job'}. Revenue on ${result.repostedRows} open days now goes to it.` : `Linked ${picked?.number ?? 'the job'}.`),
    onSuccess: done,
  });
  const relate = useServerAction(linkRecordAction, {
    errorTitle: "Couldn't link the Pulse job",
    successMessage: `Linked ${picked?.number ?? 'the job'} as related work.`,
    onSuccess: done,
  });

  const submit = () => {
    if (!picked) return;
    if (purpose === 'related') {
      void relate.run({
        from: target.kind === 'program' ? { type: 'pm_program', id: target.programId } : { type: 'pm_build', id: target.buildId },
        to: { type: 'pulse_job', id: picked.id },
        relation: 'related',
        cache: { title: `${picked.number} ${picked.name}`, status: picked.status },
      });
      return;
    }
    void billTo.run(target.kind === 'program' ? { programKey: target.programKey, jobId: picked.id } : { buildId: target.buildId, jobId: picked.id });
  };

  const data = jobs.data;
  const unavailable = jobs.isError || (data && !data.available);
  const list = data && data.available ? data.jobs : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="link-pulse-job-dialog">
        <DialogHeader
          icon={
            <span className="flex size-9 items-center justify-center rounded-lg bg-sunken">
              <Briefcase aria-hidden className="size-4 text-icon" />
            </span>
          }
          title={purpose === 'related' ? 'Link a related Pulse job' : target.kind === 'program' ? 'Link a Pulse job' : 'Bill this build to a Pulse job'}
          description={purpose === 'related' ? 'For reference only. Its revenue shows under All linked work, never in this total.' : 'Build output and fees go to this job, so Pulse can show cost and margin.'}
        />
        <DialogBody className="pb-4">
          {unavailable ? (
            <p className="rounded-lg border border-dashed border-border-default bg-sunken px-4 py-6 text-center text-sm text-fg-secondary">
              Pulse jobs cannot be listed right now. Pulse may not be part of this workspace, or you may not have access to its jobs.
            </p>
          ) : (
            <Command shouldFilter={false} loop className="overflow-hidden rounded-lg border border-border-default bg-panel">
              <div className="flex items-center gap-2 border-b border-border-subtle px-3">
                <Search aria-hidden className="size-4 shrink-0 text-icon" />
                <Command.Input autoFocus value={query} onValueChange={setQuery} placeholder="Search jobs by number, name or client" aria-label="Search Pulse jobs" className="h-10 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-placeholder" />
                {jobs.isFetching ? <Spinner size="sm" label={null} /> : null}
              </div>
              <Command.List className="max-h-80 overflow-y-auto p-1">
                {!jobs.isFetching && list.length === 0 ? <p className="px-3 py-8 text-center text-sm text-fg-muted">{debounced ? `No open jobs match "${debounced}".` : 'No open Pulse jobs yet.'}</p> : null}
                {list.map((job) => {
                  const refused = purpose === 'bills_to' && job.refusal !== null;
                  const selected = picked?.id === job.id;
                  return (
                    <Command.Item key={job.id} value={job.id} disabled={refused} onSelect={() => setPicked(job)} className={cn('ks-menu-item items-start py-2', selected && 'bg-selected', refused && 'opacity-60')} data-testid={`pulse-job-${job.number}`}>
                      <Briefcase aria-hidden className="mt-0.5 size-4 shrink-0 text-icon" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="font-key text-xs text-fg-secondary">{job.number}</span>
                          <span className="truncate font-medium">{job.name}</span>
                        </span>
                        <span className="truncate text-xs text-fg-muted">
                          {[job.clientName, job.kind === 'ongoing' ? 'Ongoing' : 'One time', MODEL_TEXT[job.pricingModel], `counts ${job.unitLabel}`].filter(Boolean).join(' · ')}
                        </span>
                        {refused && job.refusal ? <span className="mt-0.5 text-xs text-warning-text">{job.refusal.message}</span> : null}
                      </span>
                      {selected ? <Check aria-hidden className="size-4 shrink-0 text-primary-text" /> : null}
                    </Command.Item>
                  );
                })}
              </Command.List>
            </Command>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!picked} loading={billTo.pending || relate.pending} data-testid="link-pulse-job-submit">
            {purpose === 'related' ? 'Link job' : 'Link and send revenue'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
