'use client';
/**
 * Programs directory (/programs, docs/programs/SPEC.md 5.3): every program you can see as cards, a
 * table with totals, or 12 months of trends. Search, Linear style filter chips, sort, saved views
 * (surface `programs`), a drafts strip, and every state (loading, empty org, no results, error,
 * permission limited, money hidden). Prefs are remembered under `ks-programs:directory`.
 */
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CalendarRange,
  ClipboardList,
  Copy,
  Factory,
  FileStack,
  Filter,
  Handshake,
  LayoutGrid,
  LayoutTemplate,
  Plus,
  Rows3,
  Search,
  Sparkles,
  TrendingUp,
  Zap,
} from 'lucide-react';
import {
  Button,
  Chip,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SplitButton,
  ToggleGroup,
  cn,
} from '@/components/ui';
import { Page } from '@/components/layout/page';
import { usePrograms, useProgramDrafts } from '@/lib/hooks/use-programs';
import { routes } from '@/lib/routes';
import type { ProgramListItemDTO, WizardDraftDTO } from '@/lib/program-types';
import type { SavedViewDTO } from '@/lib/types';
import { useShell } from '@/features/shell/shell-context';
import { ProgramIcon, floorTodayHref, logOutputHref } from '@/features/programs/kit';
import { TrendsView } from '@/features/programs/trends/trends-view';
import {
  DEFAULT_FILTERS,
  DEFAULT_PREFS,
  HEALTH_FILTERS,
  SORT_OPTIONS,
  STATUS_FILTERS,
  activeFilterCount,
  customerOptions,
  directorySubtitle,
  filterPrograms,
  ownerOptions,
  readFilters,
  readPrefs,
  sortPrograms,
  type DirectoryFilters,
  type DirectoryPrefs,
} from './directory-model';
import { DraftsStrip } from './drafts-strip';
import { HowProgramsWork } from './how-programs-work';
import { ProgramCard, ProgramCardSkeleton, type ProgramMenuAccess } from './program-card';
import { DeleteProgramConfirm, SaveProgramTemplate, useProgramOps } from './program-ops';
import { ProgramTable } from './program-table';
import { SavedProgramViews } from './saved-program-views';

const PREFS_KEY = 'ks-programs:directory';
const PREFS_EVENT = 'ks-programs:directory-prefs';

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(PREFS_KEY);
  } catch {
    return null;
  }
}

function subscribe(callback: () => void): () => void {
  window.addEventListener(PREFS_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(PREFS_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

function useDirectoryPrefs(): [DirectoryPrefs, (patch: Partial<DirectoryPrefs>) => void] {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  const prefs = useMemo(() => {
    if (!raw) return DEFAULT_PREFS;
    try {
      return readPrefs(JSON.parse(raw));
    } catch {
      return DEFAULT_PREFS;
    }
  }, [raw]);
  const set = (patch: Partial<DirectoryPrefs>) => {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs, ...patch }));
    } catch {
      // Private mode: the choice is not remembered.
    }
    window.dispatchEvent(new Event(PREFS_EVENT));
  };
  return [prefs, set];
}

const LAYOUTS: readonly DirectoryPrefs['layout'][] = ['cards', 'table', 'trends'];

/**
 * The layout lives in the URL (?view=table), so Table and Trends can be shared and bookmarked. With
 * no ?view the last layout this person used is kept. Other prefs stay in this browser only.
 */
function useDirectoryView(): [DirectoryPrefs, (patch: Partial<DirectoryPrefs>) => void] {
  const [stored, setStored] = useDirectoryPrefs();
  const router = useRouter();
  const pathname = usePathname() ?? '/programs';
  const params = useSearchParams();
  const fromUrl = LAYOUTS.find((layout) => layout === params?.get('view'));
  const prefs = useMemo(() => (fromUrl && fromUrl !== stored.layout ? { ...stored, layout: fromUrl } : stored), [fromUrl, stored]);
  const set = useCallback(
    (patch: Partial<DirectoryPrefs>) => {
      setStored(patch);
      if (patch.layout && patch.layout !== fromUrl) {
        const next = new URLSearchParams(params?.toString() ?? '');
        next.set('view', patch.layout);
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
      }
    },
    [fromUrl, params, pathname, router, setStored],
  );
  return [prefs, set];
}

export interface ProgramsDirectoryProps {
  readonly initialPrograms: readonly ProgramListItemDTO[];
  readonly initialDrafts: readonly WizardDraftDTO[];
  readonly savedViews: readonly SavedViewDTO[];
  readonly loadedAt: number;
}

export function ProgramsDirectory({ initialPrograms, initialDrafts, savedViews, loadedAt }: ProgramsDirectoryProps) {
  const router = useRouter();
  const { can, modules, user, orgRole } = useShell();
  const programsQuery = usePrograms({ archived: true }, { initialData: [...initialPrograms], initialDataUpdatedAt: loadedAt, staleTime: 30_000 });
  const drafts = useProgramDrafts({ initialData: [...initialDrafts], initialDataUpdatedAt: loadedAt });
  const ops = useProgramOps();
  const [prefs, setPrefs] = useDirectoryView();
  const defaultView = savedViews.find((view) => view.isDefault) ?? null;
  const [activeViewId, setActiveViewId] = useState<string | null>(defaultView?.id ?? null);
  const [filters, setFilters] = useState<DirectoryFilters>(() => (defaultView ? readFilters((defaultView.config as Record<string, unknown>).filters) : DEFAULT_FILTERS));
  const [deleting, setDeleting] = useState<ProgramListItemDTO | null>(null);
  const [templating, setTemplating] = useState<ProgramListItemDTO | null>(null);
  const searchParams = useSearchParams();
  const pathname = usePathname() ?? '/programs';
  // ?saveTemplate=GLOVE (from the deal won recipe) opens "Save as template" once, then the param goes.
  const saveTemplateKey = searchParams?.get('saveTemplate') ?? null;
  const [handledSaveTemplate, setHandledSaveTemplate] = useState<string | null>(null);
  if (saveTemplateKey && saveTemplateKey !== handledSaveTemplate) {
    const target = initialPrograms.find((program) => program.key === saveTemplateKey.toUpperCase());
    setHandledSaveTemplate(saveTemplateKey);
    if (target) setTemplating(target);
  }
  useEffect(() => {
    if (!saveTemplateKey) return;
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    next.delete('saveTemplate');
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [saveTemplateKey, searchParams, pathname, router]);
  const [explainer, setExplainer] = useState(false);

  const all = useMemo(() => programsQuery.data ?? [], [programsQuery.data]);
  const activeId = savedViews.some((view) => view.id === activeViewId) ? activeViewId : null;
  const canCreate = can('project:create');
  const isAdmin = orgRole === 'owner' || orgRole === 'admin';
  const accessFor = (program: ProgramListItemDTO): ProgramMenuAccess => ({ canCreate, canEdit: canCreate, canDelete: isAdmin || program.owner?.id === user.id });
  const visible = useMemo(() => sortPrograms(filterPrograms(all, filters), prefs.sort, prefs.dir), [all, filters, prefs.sort, prefs.dir]);
  const moneyHidden = all.length > 0 && all.every((program) => program.moneyHidden);
  const anyMoneyHidden = all.some((program) => program.moneyHidden);
  const filterCount = activeFilterCount(filters);
  const customers = useMemo(() => customerOptions(all), [all]);
  const owners = useMemo(() => ownerOptions(all), [all]);
  const month = all[0]?.month.month ?? new Date().toISOString().slice(0, 7);
  const draftList = drafts.data ?? [];
  const floor = floorTodayHref();
  const running = all.filter((program) => program.status === 'active' && !program.archivedAt);
  const logPrograms = running.filter((program) => logOutputHref(program.key, program.today.date) !== null);

  const toggleIn = <T extends string>(list: readonly T[], value: T): T[] => (list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]);
  const update = (patch: Partial<DirectoryFilters>) => setFilters((old) => ({ ...old, ...patch }));
  const clearFilters = () => setFilters({ ...DEFAULT_FILTERS, q: filters.q });

  const newMenu = (
    <DropdownMenuContent align="end" className="w-72">
      <DropdownMenuLabel>Start a program</DropdownMenuLabel>
      <DropdownMenuItem icon={<Sparkles aria-hidden />} description="Set up variants, rates and a schedule" onSelect={() => router.push(routes.newProgram({ mode: 'scratch' }))}>
        From scratch
      </DropdownMenuItem>
      <DropdownMenuItem icon={<Zap aria-hidden />} description="Name, kits and one rate on one page" onSelect={() => router.push(routes.newProgram({ mode: 'quick' }))}>
        Quick setup · one page
      </DropdownMenuItem>
      {modules.crm ? (
        <DropdownMenuItem icon={<Handshake aria-hidden />} description="Use the deal's customer, value and rates" onSelect={() => router.push(routes.newProgram({ mode: 'deal' }))}>
          From a won CRM deal
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem icon={<LayoutTemplate aria-hidden />} description="Start from a saved program template" onSelect={() => router.push(routes.newProgram({ mode: 'template' }))}>
        From a template
      </DropdownMenuItem>
      {all.length > 0 ? (
        <DropdownMenuItem icon={<Copy aria-hidden />} description="Copy variants, rates and schedules" onSelect={() => router.push(routes.newProgram({ mode: 'copy' }))}>
          Copy a program
        </DropdownMenuItem>
      ) : null}
      {draftList.length > 0 ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem icon={<FileStack aria-hidden />} description={`${draftList.length} ${draftList.length === 1 ? 'draft' : 'drafts'} saved`} onSelect={() => router.push(routes.newProgram({ draft: draftList[0]!.id }))}>
            Resume a draft
          </DropdownMenuItem>
        </>
      ) : null}
    </DropdownMenuContent>
  );

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {floor && running.length > 0 ? (
        <Button variant="secondary" leadingIcon={<Factory aria-hidden />} onClick={() => router.push(floor)}>
          Floor today
        </Button>
      ) : null}
      {logPrograms.length > 0 ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary" leadingIcon={<ClipboardList aria-hidden />}>Log output</Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-1.5">
            <p className="px-2 pt-1 pb-2 text-xs text-fg-muted">Log today&apos;s output for</p>
            {logPrograms.map((program) => (
              <button
                key={program.id}
                type="button"
                onClick={() => router.push(logOutputHref(program.key, program.today.date)!)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-hover focus-visible:bg-hover"
              >
                <ProgramIcon icon={program.icon} color={program.color} size={18} />
                <span className="min-w-0 flex-1 truncate text-fg">{program.name}</span>
                <span className="shrink-0 text-xs text-fg-muted tabular-nums">{program.today.done} of {program.today.builds}</span>
              </button>
            ))}
          </PopoverContent>
        </Popover>
      ) : null}
      {canCreate ? (
        <SplitButton
          leadingIcon={<Plus aria-hidden />}
          onClick={() => router.push(routes.newProgram())}
          menuLabel="More ways to start a program"
          renderMenu={(trigger) => (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
              {newMenu}
            </DropdownMenu>
          )}
        >
          New program
        </SplitButton>
      ) : null}
    </div>
  );

  const subtitle = (
    <span className="flex flex-col gap-0.5">
      <span className="tabular-nums" data-testid="programs-subtitle">{directorySubtitle(all)}</span>
      {!canCreate ? <span className="text-xs text-fg-muted">You can view programs. Ask an admin to make you a member to create one.</span> : null}
      {anyMoneyHidden ? <span className="text-xs text-fg-muted">Money is hidden for your role.</span> : null}
    </span>
  );

  if (programsQuery.isError && all.length === 0) {
    return (
      <Page title="Programs" subtitle="Repeat work for your customers, each with one price card">
        <EmptyState illustration="error" title="Programs did not load" description={programsQuery.error.message} actions={<Button onClick={() => void programsQuery.refetch()}>Try again</Button>} />
      </Page>
    );
  }

  const empty = all.length === 0;

  return (
    <Page title="Programs" subtitle={empty ? 'Repeat work for your customers, each with one price card' : subtitle} actions={empty ? undefined : actions}>
      {draftList.length > 0 ? <DraftsStrip drafts={draftList} className="mb-4" /> : null}

      {programsQuery.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <ProgramCardSkeleton key={index} />)}</div>
      ) : empty ? (
        <div className="rounded-xl border border-border-subtle bg-panel shadow-xs">
          <EmptyState
            size="lg"
            illustration="workspace"
            title="Run repeat work as programs"
            description="A program holds the kits you build again and again for one customer, with one price card for all of them."
            actions={
              <div className="flex flex-wrap justify-center gap-2">
                {canCreate ? <Button leadingIcon={<Plus aria-hidden />} onClick={() => router.push(routes.newProgram())}>New program</Button> : null}
                <Button variant="secondary" onClick={() => setExplainer(true)}>How programs work</Button>
              </div>
            }
          />
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="programs-filter-row">
            <SavedProgramViews
              views={savedViews}
              activeId={activeId}
              filters={filters}
              prefs={prefs}
              canShare={canCreate}
              onApply={(view) => {
                setActiveViewId(view?.id ?? null);
                if (!view) {
                  setFilters(DEFAULT_FILTERS);
                  return;
                }
                const config = view.config as Record<string, unknown>;
                setFilters(readFilters(config.filters));
                if (config.prefs) setPrefs(readPrefs(config.prefs));
              }}
            />
            <Input
              value={filters.q}
              onChange={(event) => update({ q: event.target.value })}
              aria-label="Search programs"
              placeholder="Search programs"
              leadingIcon={<Search aria-hidden />}
              containerClassName="w-full sm:w-64"
              size="sm"
              data-testid="programs-search"
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant={filterCount ? 'secondary' : 'ghost'} size="sm" leadingIcon={<Filter aria-hidden />} data-testid="programs-filter">
                  Filter{filterCount ? ` · ${filterCount}` : ''}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-[70vh] w-64 overflow-y-auto">
                <DropdownMenuLabel>Status</DropdownMenuLabel>
                {STATUS_FILTERS.map((status) => (
                  <DropdownMenuCheckboxItem key={status.value} checked={filters.statuses.includes(status.value)} onSelect={(event) => event.preventDefault()} onCheckedChange={() => update({ statuses: toggleIn(filters.statuses, status.value) })}>
                    {status.label}
                  </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Health</DropdownMenuLabel>
                {HEALTH_FILTERS.map((health) => (
                  <DropdownMenuCheckboxItem key={health.value} checked={filters.health.includes(health.value)} onSelect={(event) => event.preventDefault()} onCheckedChange={() => update({ health: toggleIn(filters.health, health.value) })}>
                    {health.label}
                  </DropdownMenuCheckboxItem>
                ))}
                {customers.length > 0 ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Customer</DropdownMenuLabel>
                    {customers.map((customer) => (
                      <DropdownMenuCheckboxItem key={customer.id} checked={filters.customers.includes(customer.id)} onSelect={(event) => event.preventDefault()} onCheckedChange={() => update({ customers: toggleIn(filters.customers, customer.id) })}>
                        {customer.name}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </>
                ) : null}
                {owners.length > 0 ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Owner</DropdownMenuLabel>
                    {owners.map((owner) => (
                      <DropdownMenuCheckboxItem key={owner.id} checked={filters.owners.includes(owner.id)} onSelect={(event) => event.preventDefault()} onCheckedChange={() => update({ owners: toggleIn(filters.owners, owner.id) })}>
                        {owner.id === user.id ? `${owner.name} (you)` : owner.name}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem checked={filters.starred} onSelect={(event) => event.preventDefault()} onCheckedChange={(checked) => update({ starred: Boolean(checked) })}>
                  Starred only
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <ToggleGroup
                label="Layout"
                size="sm"
                value={prefs.layout}
                onValueChange={(layout) => setPrefs({ layout })}
                options={[
                  { value: 'cards', label: 'Cards', icon: <LayoutGrid aria-hidden /> },
                  { value: 'table', label: 'Table', icon: <Rows3 aria-hidden /> },
                  { value: 'trends', label: 'Trends', icon: <TrendingUp aria-hidden /> },
                ]}
              />
              {prefs.layout !== 'trends' ? (
                <>
                  <Select
                    size="sm"
                    aria-label="Sort by"
                    value={prefs.sort}
                    onValueChange={(sort) => setPrefs({ sort: sort as DirectoryPrefs['sort'] })}
                    options={SORT_OPTIONS.filter((option) => !(option.money && moneyHidden)).map((option) => ({ value: option.value, label: option.label }))}
                    className="w-44"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={prefs.dir === 'asc' ? 'Sorted low to high. Switch to high to low.' : 'Sorted high to low. Switch to low to high.'}
                    onClick={() => setPrefs({ dir: prefs.dir === 'asc' ? 'desc' : 'asc' })}
                    leadingIcon={prefs.dir === 'asc' ? <ArrowUp aria-hidden /> : <ArrowDown aria-hidden />}
                  >
                    {prefs.dir === 'asc' ? 'Low to high' : 'High to low'}
                  </Button>
                </>
              ) : null}
            </div>
          </div>

          {filterCount > 0 ? (
            <div className="-mt-2 mb-4 flex flex-wrap items-center gap-1.5" data-testid="programs-filter-chips">
              {filters.statuses.length !== 3 || !filters.statuses.every((status) => DEFAULT_FILTERS.statuses.includes(status)) ? (
                <Chip size="sm" onRemove={() => update({ statuses: DEFAULT_FILTERS.statuses })} removeLabel="Reset the status filter">
                  Status: {filters.statuses.length ? filters.statuses.map((status) => STATUS_FILTERS.find((entry) => entry.value === status)?.label).join(', ') : 'Any'}
                </Chip>
              ) : null}
              {filters.health.length ? <Chip size="sm" onRemove={() => update({ health: [] })} removeLabel="Remove the health filter">Health: {filters.health.map((h) => HEALTH_FILTERS.find((entry) => entry.value === h)?.label).join(', ')}</Chip> : null}
              {filters.customers.length ? <Chip size="sm" onRemove={() => update({ customers: [] })} removeLabel="Remove the customer filter">Customer: {filters.customers.map((id) => customers.find((entry) => entry.id === id)?.name ?? 'Unknown').join(', ')}</Chip> : null}
              {filters.owners.length ? <Chip size="sm" onRemove={() => update({ owners: [] })} removeLabel="Remove the owner filter">Owner: {filters.owners.map((id) => owners.find((entry) => entry.id === id)?.name ?? 'Unknown').join(', ')}</Chip> : null}
              {filters.starred ? <Chip size="sm" onRemove={() => update({ starred: false })} removeLabel="Remove the starred filter">Starred</Chip> : null}
              <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>
            </div>
          ) : null}

          {visible.length === 0 ? (
            <div className="rounded-xl border border-border-subtle bg-panel shadow-xs">
              <EmptyState size="sm" illustration="search" title="No programs match these filters" description="Try other words or show more statuses." actions={<Button variant="secondary" onClick={() => setFilters(DEFAULT_FILTERS)}>Clear filters</Button>} />
            </div>
          ) : prefs.layout === 'table' ? (
            <ProgramTable
              programs={visible}
              ops={ops}
              access={{ canCreate, canEdit: canCreate, canDelete: isAdmin }}
              sort={prefs.sort}
              dir={prefs.dir}
              onSort={(sort) => setPrefs(sort === prefs.sort ? { dir: prefs.dir === 'asc' ? 'desc' : 'asc' } : { sort, dir: sort === 'name' ? 'asc' : 'desc' })}
              hidden={prefs.hidden}
              onHiddenChange={(hidden) => setPrefs({ hidden })}
              onDelete={setDeleting}
              onTemplate={setTemplating}
            />
          ) : prefs.layout === 'trends' ? (
            <TrendsView programs={visible} month={month} metric={prefs.trendsMetric} onMetricChange={(trendsMetric) => setPrefs({ trendsMetric })} />
          ) : (
            <div className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-3')} data-testid="programs-grid">
              {visible.map((program) => (
                <ProgramCard key={program.id} program={program} ops={ops} access={accessFor(program)} onDelete={() => setDeleting(program)} onTemplate={() => setTemplating(program)} />
              ))}
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
            <span className="inline-flex items-center gap-1.5">
              <CalendarRange aria-hidden className="size-3.5" />
              Numbers are this month to date in each program&apos;s time zone.
            </span>
            <button type="button" onClick={() => setExplainer(true)} className="rounded-sm text-fg-secondary underline-offset-2 outline-none hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-focus">
              How programs work
            </button>
          </div>
        </>
      )}

      <HowProgramsWork open={explainer} onOpenChange={setExplainer} canCreate={canCreate} />
      <DeleteProgramConfirm program={deleting} onClose={() => setDeleting(null)} ops={ops} />
      <SaveProgramTemplate program={templating} onClose={() => setTemplating(null)} />
    </Page>
  );
}
