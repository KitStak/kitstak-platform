'use client';
/**
 * Link a job to a record in another KitStak app: a CRM deal, a warehouse work order or a
 * project. Pick the kind, search by name, pick a record. Only the apps this workspace is
 * connected to are offered. Linking shows an Undo.
 *
 *   <LinkRecordDialog open={open} onOpenChange={setOpen} job={{ id, number, name }} connected={integrations} onLinked={refresh} />
 *
 * Leave `job` out to let the person pick the job first (the Connected apps page does this).
 */
import { useMemo, useRef, useState } from 'react';
import { Link2, SearchX } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { AppIcon } from '@kitstak/ui/app-icon';
import {
  Button,
  Checkbox,
  Combobox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  SearchInput,
  Skeleton,
  ToggleGroup,
  cn,
  toast,
} from '@/components/ui';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import { useJobs } from '@/lib/hooks/use-data';
import { qk } from '@/lib/query-keys';
import { addJobLinkAction, removeJobLinkAction } from '@/server/actions/jobs';
import { integrationKeys, useRecordSearch } from './api';
import { RecordStatus } from './record-chip';
import {
  LINKABLE_TYPES,
  SIBLING_APP_NAMES,
  TARGET_WORDS,
  appOfTarget,
  type LinkableType,
  type RecordOptionDTO,
  type SiblingApp,
} from './types';

export interface LinkRecordJob {
  readonly id: string;
  readonly number: string;
  readonly name: string;
}

export interface LinkRecordDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The job to link. Leave out to pick one in the dialog. */
  readonly job?: LinkRecordJob | null;
  /** Which sibling apps can be read for this workspace. */
  readonly connected: Readonly<Record<SiblingApp, boolean>>;
  /** Start on this kind of record. */
  readonly initialType?: LinkableType;
  /** Records already linked to the job (`type:id`), shown as linked. */
  readonly linkedKeys?: readonly string[];
  readonly onLinked?: () => void | Promise<void>;
}

const SEARCH_WORDS: Readonly<Record<LinkableType, string>> = {
  crm_deal: 'Search deals by name or account',
  wms_work_order: 'Search work orders by code, client or kit',
  pm_project: 'Search projects by name or key',
};

export function LinkRecordDialog(props: LinkRecordDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="md" data-testid="link-record-dialog">
        {/* Mounted fresh each time the dialog opens, so it always starts empty. */}
        <LinkRecordForm {...props} />
      </DialogContent>
    </Dialog>
  );
}

function LinkRecordForm({
  open,
  onOpenChange,
  job,
  connected,
  initialType,
  linkedKeys = [],
  onLinked,
}: LinkRecordDialogProps) {
  const queryClient = useQueryClient();
  const types = useMemo(() => LINKABLE_TYPES.filter((type) => connected[appOfTarget(type)]), [connected]);
  const [type, setType] = useState<LinkableType>(
    initialType && types.includes(initialType) ? initialType : (types[0] ?? 'crm_deal'),
  );
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<RecordOptionDTO | null>(null);
  const [jobId, setJobId] = useState<string | null>(job?.id ?? null);
  const [importsTime, setImportsTime] = useState(true);
  const [saving, setSaving] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const query = useDebouncedValue(text.trim(), 200);
  const search = useRecordSearch(type, query, open && types.length > 0);
  const jobs = useJobs({ tab: 'all', limit: 200 }, { enabled: open && !job });
  const options = search.data ?? [];

  const chosenJob = job ?? jobs.data?.find((item) => item.id === jobId) ?? null;
  const isLinkedHere = (option: RecordOptionDTO): boolean =>
    linkedKeys.includes(`${option.type}:${option.id}`) ||
    (chosenJob !== null && option.linkedJobNumber === chosenJob.number);

  const submit = async () => {
    if (!picked || !chosenJob) return;
    setSaving(true);
    try {
      const result = await addJobLinkAction({
        jobId: chosenJob.id,
        link: {
          targetType: picked.type,
          targetId: picked.id,
          importsTime: picked.type === 'pm_project' ? importsTime : false,
          title: picked.title,
          status: picked.status,
          url: picked.path,
        },
      });
      if (!result.ok) {
        toast.error("Couldn't link the record", result.error.message);
        return;
      }
      const made = result.data.find((link) => link.targetType === picked.type && link.targetId === picked.id);
      const refresh = async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: integrationKeys.root() }),
          queryClient.invalidateQueries({ queryKey: qk.jobsRoot() }),
        ]);
        await onLinked?.();
      };
      await refresh();
      onOpenChange(false);
      toast.undo(`Linked ${picked.title} to ${chosenJob.number}`, {
        onUndo: async () => {
          if (!made) return;
          const gone = await removeJobLinkAction({ linkId: made.id });
          if (!gone.ok) throw new Error(gone.error.message);
          await refresh();
        },
      });
    } catch {
      toast.error("Couldn't link the record", 'Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const onListKey = (event: React.KeyboardEvent) => {
    if (options.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = (active + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      setActive(next);
      listRef.current
        ?.querySelector<HTMLElement>(`[data-index="${next}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      const option = options[active];
      if (option && !isLinkedHere(option)) {
        event.preventDefault();
        setPicked(option);
      }
    }
  };

  return (
    <>
      <DialogHeader
        icon={<Link2 aria-hidden className="size-5 text-icon" />}
        title="Link a record"
        description={
          job
            ? `Tie ${job.number} to a record in another KitStak app. Its status shows on the job, and you can jump between them.`
            : 'Tie a job to a record in another KitStak app. Its status shows on the job, and you can jump between them.'
        }
      />
      <DialogBody className="flex flex-col gap-4 pb-5">
        {types.length === 0 ? (
          <p
            className="rounded-lg border border-dashed border-border-default px-4 py-6 text-center text-sm text-fg-secondary"
            data-testid="link-no-apps"
          >
            No other KitStak app is connected to this workspace, so there is nothing to link to. Pulse works
            fine on its own: every kind of data can come in from a spreadsheet.
          </p>
        ) : (
          <>
            {job ? null : (
              <div className="flex flex-col gap-1.5">
                <span aria-hidden className="text-sm font-medium text-fg">
                  Job
                </span>
                <Combobox
                  aria-label="Job"
                  value={jobId}
                  onValueChange={setJobId}
                  options={(jobs.data ?? []).map((item) => ({
                    value: item.id,
                    label: `${item.number} ${item.name}`,
                    description: item.clientName ?? undefined,
                    keywords: [item.number],
                  }))}
                  placeholder={jobs.isPending ? 'Loading jobs' : 'Pick a job'}
                  searchPlaceholder="Search jobs"
                  emptyMessage={jobs.isPending ? 'Loading jobs' : 'No job matches'}
                />
              </div>
            )}
            <div className="flex flex-col gap-2">
              {types.length > 1 ? (
                <ToggleGroup
                  label="Kind of record"
                  size="sm"
                  value={type}
                  onValueChange={(value) => {
                    setType(value);
                    setPicked(null);
                    setActive(0);
                  }}
                  options={types.map((item) => ({ value: item, label: TARGET_WORDS[item] }))}
                />
              ) : (
                <p className="text-sm font-medium text-fg">{TARGET_WORDS[type]}</p>
              )}
              <SearchInput
                value={text}
                onValueChange={(value) => {
                  setText(value);
                  setPicked(null);
                  setActive(0);
                }}
                placeholder={SEARCH_WORDS[type]}
                aria-label={SEARCH_WORDS[type]}
                aria-controls="link-record-results"
                aria-activedescendant={options[active] ? `link-record-option-${active}` : undefined}
                onKeyDown={onListKey}
                autoFocus={Boolean(job)}
                data-testid="link-record-search"
              />
            </div>
            <div className="min-h-[220px]">
              {search.isPending ? (
                <div role="status" aria-label="Searching" className="flex flex-col gap-2">
                  {[0, 1, 2, 3].map((index) => (
                    <Skeleton key={index} height={44} rounded="md" />
                  ))}
                </div>
              ) : search.isError ? (
                <div
                  className="flex flex-col items-center gap-2 py-8 text-center text-sm text-fg-secondary"
                  role="alert"
                >
                  <p>The search did not load.</p>
                  <Button size="sm" variant="secondary" onClick={() => void search.refetch()}>
                    Try again
                  </Button>
                </div>
              ) : options.length === 0 ? (
                <div
                  className="flex flex-col items-center gap-2 py-8 text-center text-sm text-fg-secondary"
                  data-testid="link-record-empty"
                >
                  <SearchX aria-hidden className="size-5 text-icon" />
                  <p>
                    {query
                      ? `Nothing in ${SIBLING_APP_NAMES[appOfTarget(type)]} matches "${query}".`
                      : `${SIBLING_APP_NAMES[appOfTarget(type)]} has nothing to link yet.`}
                  </p>
                </div>
              ) : (
                <ul
                  ref={listRef}
                  id="link-record-results"
                  role="listbox"
                  aria-label={`${TARGET_WORDS[type]} results`}
                  className="flex max-h-[280px] flex-col gap-1 overflow-y-auto"
                >
                  {options.map((option, index) => {
                    const here = isLinkedHere(option);
                    const selected = picked?.id === option.id;
                    return (
                      <li key={option.id} role="presentation">
                        <button
                          type="button"
                          role="option"
                          id={`link-record-option-${index}`}
                          data-index={index}
                          aria-selected={selected}
                          disabled={here}
                          onClick={() => setPicked(option)}
                          onMouseEnter={() => setActive(index)}
                          className={cn(
                            'flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left',
                            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60',
                            selected
                              ? 'border-primary bg-selected'
                              : index === active
                                ? 'border-border-default bg-hover'
                                : 'border-transparent hover:bg-hover',
                          )}
                          data-testid="link-record-option"
                        >
                          <AppIcon app={appOfTarget(option.type)} size={20} />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-sm font-medium text-fg">{option.title}</span>
                            <span className="truncate text-xs text-fg-muted">
                              {[
                                option.subtitle,
                                here
                                  ? 'Already linked to this job'
                                  : option.linkedJobNumber
                                    ? `Also on job ${option.linkedJobNumber}`
                                    : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          </span>
                          {option.status ? (
                            <RecordStatus status={option.status} tone={option.tone} live />
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {picked?.type === 'pm_project' ? (
              <Checkbox
                checked={importsTime}
                onCheckedChange={(value) => setImportsTime(value === true)}
                label="Count this project's logged time as labor hours on the job"
                description={
                  picked.linkedJobNumber
                    ? `Job ${picked.linkedJobNumber} is linked to this project too. A project's time counts on one job only, the first one that asked.`
                    : 'Pulse costs the hours with your own labor rate. Time is never counted twice.'
                }
                data-testid="link-imports-time"
              />
            ) : null}
          </>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          {types.length === 0 ? 'Close' : 'Cancel'}
        </Button>
        {types.length === 0 ? null : (
          <Button
            onClick={() => void submit()}
            loading={saving}
            disabled={!picked || !chosenJob}
            leadingIcon={<Link2 aria-hidden />}
            data-testid="link-record-submit"
          >
            {picked ? `Link ${TARGET_WORDS[picked.type].toLowerCase()}` : 'Link record'}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
