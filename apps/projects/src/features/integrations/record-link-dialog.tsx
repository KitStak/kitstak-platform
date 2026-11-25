'use client';
/**
 * "Link a record" for programs, builds and projects through the shared link graph
 * (`core.record_links`, docs/programs/SPEC.md 1.2, 5.8, 5.14). Tabs, each shown only when this
 * workspace can use it: Customer, CRM deal, CRM account, Pulse job (related, no money), Project,
 * Program, Build and WMS shipment order. Already linked records are marked and cannot be added
 * twice. Money links to a Pulse job use `LinkPulseJobDialog` instead.
 *
 *   <RecordLinkDialog open onOpenChange from={{ type: 'pm_program', id }} existing={links} onLinked={refresh} />
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Command } from 'cmdk';
import { Boxes, Briefcase, Check, FolderKanban, Link2, Repeat2, Search } from 'lucide-react';
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, Spinner, cn } from '@/components/ui';
import { EntityIcon, StatusIcon } from '@/components/pm';
import type { IntegrationTargetType } from '@/lib/constants';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import { useServerAction } from '@/lib/hooks/use-action';
import { useIntegrationSearch, useIntegrationStatus, useProjects, useSearch } from '@/lib/hooks/use-data';
import { usePrograms } from '@/lib/hooks/use-programs';
import type { LinkedRecordDTO, LinkedRecordType } from '@/lib/program-types';
import { routes } from '@/lib/routes';
import { programHref, taskAnyHref } from '@/features/programs/kit/live-pages';
import { linkRecordAction } from '@/server/actions/program-links';
import { ProgramIcon } from '@/features/programs/kit/chips';
import { RecordStatus, SiblingAppMark } from './record-chip';
import { usePulseJobSearch } from './link-pulse-job-dialog';

export type RecordLinkKind = 'core_customer' | 'crm_deal' | 'crm_account' | 'pulse_job' | 'pm_project' | 'pm_program' | 'pm_build' | 'wms_shipment_order';

export const RECORD_LINK_KIND_LABELS: Readonly<Record<RecordLinkKind, string>> = {
  core_customer: 'Customer',
  crm_deal: 'CRM deal',
  crm_account: 'CRM account',
  pulse_job: 'Pulse job',
  pm_project: 'Project',
  pm_program: 'Program',
  pm_build: 'Build',
  wms_shipment_order: 'WMS shipment order',
};

const HINT: Readonly<Record<RecordLinkKind, string>> = {
  core_customer: 'Search customers by name or code',
  crm_deal: 'Search deals by name',
  crm_account: 'Search accounts by name',
  pulse_job: 'Search jobs by number, name or client',
  pm_project: 'Search projects by name or key',
  pm_program: 'Search programs by name or key',
  pm_build: 'Search builds by title or key, like GLOVE-212',
  wms_shipment_order: 'Search orders by number or customer',
};

/** The link picker search type behind the CRM, customer and WMS tabs. */
const INTEGRATION_FOR: Partial<Record<RecordLinkKind, IntegrationTargetType>> = {
  core_customer: 'core_customer',
  crm_deal: 'crm_item',
  crm_account: 'crm_account',
  wms_shipment_order: 'wms_order',
};

interface Candidate {
  readonly type: LinkedRecordType;
  readonly id: string;
  readonly title: string;
  readonly meta: string | null;
  readonly status: string | null;
  readonly url: string | null;
  readonly icon: ReactNode;
}

export interface RecordLinkDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The record the link starts from. */
  readonly from: { readonly type: 'pm_program' | 'pm_build' | 'pm_project' | 'pm_task'; readonly id: string };
  /** Tabs to offer, in order. Defaults to every kind except the owner's own record. */
  readonly kinds?: readonly RecordLinkKind[];
  readonly existing?: readonly Pick<LinkedRecordDTO, 'type' | 'id'>[];
  readonly initialKind?: RecordLinkKind;
  readonly onLinked?: (link: LinkedRecordDTO) => void;
}

const DEFAULT_KINDS: readonly RecordLinkKind[] = ['core_customer', 'crm_deal', 'crm_account', 'pulse_job', 'pm_project', 'pm_program', 'pm_build', 'wms_shipment_order'];

/** Tabs this workspace can use: CRM and WMS need their app; Pulse jobs need Pulse (checked by the search). */
export function availableKinds(kinds: readonly RecordLinkKind[], integrationTypes: readonly IntegrationTargetType[]): RecordLinkKind[] {
  return kinds.filter((kind) => {
    const integration = INTEGRATION_FOR[kind];
    return integration ? integrationTypes.includes(integration) : true;
  });
}

export function RecordLinkDialog(props: RecordLinkDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="md" data-testid="record-link-dialog">
        <RecordLinkBody {...props} />
      </DialogContent>
    </Dialog>
  );
}

function useCandidates(kind: RecordLinkKind, q: string, from: RecordLinkDialogProps['from'], enabled: boolean): { list: Candidate[]; fetching: boolean; unavailable: boolean } {
  const integrationType = INTEGRATION_FOR[kind] ?? 'core_customer';
  const integration = useIntegrationSearch(integrationType, q, { enabled: enabled && INTEGRATION_FOR[kind] !== undefined });
  const projects = useProjects({}, { enabled: enabled && kind === 'pm_project' });
  const programs = usePrograms({ q: q || undefined }, { enabled: enabled && kind === 'pm_program' });
  const search = useSearch(q, { enabled: enabled && kind === 'pm_build' && q.length > 0 });
  const jobs = usePulseJobSearch(q, 'related', from.type === 'pm_program' ? { kind: 'program', programKey: '', programId: from.id } : from.type === 'pm_build' ? { kind: 'build', buildId: from.id, programId: null } : null, enabled && kind === 'pulse_job');

  if (INTEGRATION_FOR[kind]) {
    return {
      fetching: integration.isFetching,
      unavailable: false,
      list: (integration.data ?? []).map((record) => ({ type: kind as LinkedRecordType, id: record.id, title: record.title, meta: null, status: record.status, url: record.url, icon: <SiblingAppMark app={kind === 'wms_shipment_order' ? 'wms' : 'crm'} size={14} /> })),
    };
  }
  if (kind === 'pm_project') {
    const term = q.trim().toLowerCase();
    return {
      fetching: projects.isFetching,
      unavailable: false,
      list: (projects.data ?? [])
        .filter((project) => !project.archivedAt && project.id !== from.id && (!term || project.name.toLowerCase().includes(term) || project.key.toLowerCase().includes(term)))
        .slice(0, 25)
        .map((project) => ({ type: 'pm_project', id: project.id, title: project.name, meta: project.key, status: null, url: routes.project(project.key), icon: <EntityIcon icon={project.icon} color={project.color} size={18} /> })),
    };
  }
  if (kind === 'pm_program') {
    return {
      fetching: programs.isFetching,
      unavailable: false,
      list: (programs.data ?? [])
        .filter((program) => program.id !== from.id)
        .slice(0, 25)
        .map((program) => ({ type: 'pm_program', id: program.id, title: program.name, meta: program.key, status: null, url: programHref(program.key), icon: <ProgramIcon icon={program.icon} color={program.color} size={18} /> })),
    };
  }
  if (kind === 'pm_build') {
    return {
      fetching: search.isFetching,
      unavailable: false,
      list: (search.data?.tasks ?? [])
        .filter((task) => task.kind === 'build' && task.id !== from.id)
        .map((task) => ({ type: 'pm_build', id: task.id, title: task.title, meta: `${task.key} · ${task.projectName}`, status: null, url: taskAnyHref(task.projectKind, task.projectKey, task.number), icon: <StatusIcon category={task.statusCategory} size={16} /> })),
    };
  }
  const data = jobs.data;
  return {
    fetching: jobs.isFetching,
    unavailable: jobs.isError || (data !== undefined && !data.available),
    list: data && data.available ? data.jobs.map((job) => ({ type: 'pulse_job', id: job.id, title: `${job.number} ${job.name}`, meta: job.clientName, status: job.status, url: null, icon: <Briefcase aria-hidden className="size-4 text-icon" /> })) : [],
  };
}

const KIND_ICON: Readonly<Record<RecordLinkKind, ReactNode>> = {
  core_customer: <SiblingAppMark app="crm" size={12} />,
  crm_deal: <SiblingAppMark app="crm" size={12} />,
  crm_account: <SiblingAppMark app="crm" size={12} />,
  pulse_job: <Briefcase aria-hidden className="size-3" />,
  pm_project: <FolderKanban aria-hidden className="size-3" />,
  pm_program: <Repeat2 aria-hidden className="size-3" />,
  pm_build: <Boxes aria-hidden className="size-3" />,
  wms_shipment_order: <SiblingAppMark app="wms" size={12} />,
};

function RecordLinkBody({ open, onOpenChange, from, kinds = DEFAULT_KINDS, existing = [], initialKind, onLinked }: RecordLinkDialogProps) {
  const status = useIntegrationStatus({ enabled: open, staleTime: 60_000 });
  const offered = useMemo(() => availableKinds(kinds, status.data?.targetTypes ?? []), [kinds, status.data]);
  const [kind, setKind] = useState<RecordLinkKind | null>(initialKind ?? null);
  const active = kind && offered.includes(kind) ? kind : (offered[0] ?? null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Candidate | null>(null);
  const debounced = useDebouncedValue(query, 200);
  const candidates = useCandidates(active ?? 'pm_project', debounced, from, open && active !== null);
  const link = useServerAction(linkRecordAction, {
    successMessage: (dto) => `Linked ${dto.title}`,
    errorTitle: "Couldn't link that record",
    onSuccess: (dto) => {
      onLinked?.(dto);
      onOpenChange(false);
    },
  });
  const already = (candidate: Candidate) => existing.some((entry) => entry.type === candidate.type && entry.id === candidate.id);
  const submit = () => {
    if (!picked) return;
    void link.run({
      from: { type: from.type, id: from.id },
      to: { type: picked.type, id: picked.id },
      relation: 'related',
      cache: { title: picked.title, status: picked.status ?? undefined, url: picked.url ?? undefined },
    });
  };

  return (
    <>
      <DialogHeader
        icon={
          <span className="flex size-9 items-center justify-center rounded-lg bg-sunken">
            <Link2 aria-hidden className="size-4 text-icon" />
          </span>
        }
        title="Link a record"
        description="Connect a customer, deal, job, project, program, build or order. Links never move money."
      />
      <DialogBody className="flex flex-col gap-3 pb-4">
        {status.isPending ? (
          <div className="flex justify-center py-10">
            <Spinner label="Checking connected apps" />
          </div>
        ) : (
          <>
            <div role="radiogroup" aria-label="Kind of record" className="flex flex-wrap gap-1.5">
              {offered.map((option) => {
                const checked = option === active;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    onClick={() => {
                      setKind(option);
                      setPicked(null);
                    }}
                    data-testid={`record-link-kind-${option}`}
                    className={cn(
                      'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors',
                      'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
                      checked ? 'border-primary bg-primary-subtle text-primary-text' : 'border-border-default bg-panel text-fg-secondary hover:border-border-strong hover:text-fg',
                    )}
                  >
                    {KIND_ICON[option]}
                    {RECORD_LINK_KIND_LABELS[option]}
                  </button>
                );
              })}
            </div>
            {active ? (
              <Command shouldFilter={false} loop className="overflow-hidden rounded-lg border border-border-default bg-panel">
                <div className="flex items-center gap-2 border-b border-border-subtle px-3">
                  <Search aria-hidden className="size-4 shrink-0 text-icon" />
                  <Command.Input autoFocus value={query} onValueChange={setQuery} placeholder={HINT[active]} aria-label={HINT[active]} className="h-10 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-placeholder" />
                  {candidates.fetching ? <Spinner size="sm" label={null} /> : null}
                </div>
                <Command.List className="max-h-72 overflow-y-auto p-1">
                  {candidates.unavailable ? (
                    <p className="px-3 py-8 text-center text-sm text-fg-muted">Pulse jobs cannot be listed right now. Pulse may not be part of this workspace.</p>
                  ) : !candidates.fetching && candidates.list.length === 0 ? (
                    <p className="px-3 py-8 text-center text-sm text-fg-muted">
                      {active === 'pm_build' && !debounced ? 'Type a build title or key to search.' : debounced ? `Nothing matches "${debounced}".` : `No ${RECORD_LINK_KIND_LABELS[active].toLowerCase()}s yet.`}
                    </p>
                  ) : null}
                  {candidates.list.map((candidate) => {
                    const linked = already(candidate);
                    const selected = picked?.id === candidate.id && picked.type === candidate.type;
                    return (
                      <Command.Item key={`${candidate.type}:${candidate.id}`} value={`${candidate.type}:${candidate.id}`} disabled={linked} onSelect={() => setPicked(candidate)} className={cn('ks-menu-item', selected && 'bg-selected', linked && 'opacity-60')}>
                        <span className="inline-flex size-5 shrink-0 items-center justify-center">{candidate.icon}</span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate">{candidate.title}</span>
                          {linked ? <span className="text-2xs text-fg-muted">Already linked</span> : candidate.meta ? <span className="truncate text-2xs text-fg-muted">{candidate.meta}</span> : null}
                        </span>
                        <RecordStatus status={candidate.status} />
                        {selected ? <Check aria-hidden className="size-4 shrink-0 text-primary-text" /> : null}
                      </Command.Item>
                    );
                  })}
                </Command.List>
              </Command>
            ) : null}
          </>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!picked} loading={link.pending} leadingIcon={<Link2 aria-hidden />} data-testid="record-link-submit">
          Link record
        </Button>
      </DialogFooter>
    </>
  );
}
