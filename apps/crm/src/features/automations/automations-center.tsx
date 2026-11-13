'use client';
/**
 * Board automations center (`/[orgSlug]/boards/[boardId]/automations`):
 * Recipes · Board automations · Run history · Integrations, with URL state (`?tab=`,
 * `?automation=`) so every view is deep-linkable.
 */
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { ArrowLeft, History, LayoutGrid, Plug, Plus, Sparkles, Zap } from 'lucide-react';
import { Breadcrumbs, Button, EmptyState, Skeleton, Tooltip, buttonVariants, cn, toast } from '@/components/ui';
import { ApiClientError } from '@/lib/api';
import { useAutomationMutations, useAutomations, useBoard, useBoardStream, useBoards } from '@/lib/hooks';
import { useOrg } from '@/features/shell/org-context';
import { routes } from '@/features/shell/routes';
import type { CreateAutomationInput } from '@/server/automations-engine/recipes';
import type { AutomationDto } from '@/server/services/contracts/dto';
import { useAutomationUsage } from './api';
import { AutomationBuilder, type BuilderSeed } from './components/automation-builder';
import { AutomationList } from './components/automation-list';
import { Integrations } from './components/integrations';
import { RecipeGallery } from './components/recipe-gallery';
import { RunHistory, RunRowsSkeleton } from './components/run-history';
import { useDeferredDelete } from './components/use-deferred-delete';
import { UsageMeter } from './components/usage-meter';
import { prepareRecipeDraft, type Recipe } from './model/catalog';
import { draftFromAutomation, EMPTY_DRAFT } from './model/draft';
import type { BuilderContext } from './model/resolver';

export const CENTER_TABS = ['recipes', 'automations', 'runs', 'integrations'] as const;
export type CenterTab = (typeof CENTER_TABS)[number];

function isTab(value: string | null): value is CenterTab {
  return value !== null && (CENTER_TABS as readonly string[]).includes(value);
}

export function AutomationsCenter({ boardId }: { readonly boardId: string }) {
  const { org, user, permissions } = useOrg();
  const pathname = usePathname();
  const params = useSearchParams();
  const tabParam = params.get('tab');
  const urlTab: CenterTab = isTab(tabParam) ? tabParam : 'recipes';
  // Tab + filter live in local state so switching is synchronous (no server round trip);
  // the URL is mirrored with history.replaceState, which Next keeps in sync with useSearchParams.
  const [tab, setTab] = useState<CenterTab>(urlTab);
  const [automationFilter, setAutomationFilter] = useState<string | null>(params.get('automation'));
  useEffect(() => {
    // Back/forward navigation: adopt the URL (our own replaceState calls never fire popstate).
    const onPop = () => {
      const search = new URLSearchParams(window.location.search);
      const next = search.get('tab');
      setTab(isTab(next) ? next : 'recipes');
      setAutomationFilter(search.get('automation'));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const board = useBoard(boardId);
  const boards = useBoards();
  const automations = useAutomations(boardId);
  // Realtime: other sessions' creates / toggles / edits / deletes refresh this page.
  useBoardStream({ boardId, currentUserId: user.id });
  const usage = useAutomationUsage();
  const { create, update } = useAutomationMutations(boardId);
  const [seed, setSeed] = useState<BuilderSeed | null>(null);
  const { pending: pendingDeletes, schedule: scheduleDelete } = useDeferredDelete(boardId);

  const tabListRef = useRef<HTMLDivElement>(null);
  const hasContext = Boolean(board.data);
  useEffect(() => {
    // Keep the active tab visible in the horizontally scrolling mobile rail.
    const frame = requestAnimationFrame(() => {
      const list = tabListRef.current;
      const active = list?.querySelector<HTMLElement>('[data-state="active"]');
      if (!list || !active || list.scrollWidth <= list.clientWidth) return;
      // Center-ish the active tab, clear of the edge fade (scrollIntoView would also scroll the page).
      const left = active.offsetLeft - (list.clientWidth - active.offsetWidth) / 2;
      list.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [tab, hasContext]);

  const boardName = board.data?.board.name;
  useEffect(() => {
    if (boardName) document.title = `Automations · ${boardName} · KitStak CRM`;
  }, [boardName]);

  const setQuery = useCallback(
    (next: Record<string, string | null>) => {
      if ('tab' in next) setTab(isTab(next.tab ?? null) ? (next.tab as CenterTab) : 'recipes');
      if ('automation' in next) setAutomationFilter(next.automation ?? null);
      const search = new URLSearchParams(window.location.search);
      for (const [key, value] of Object.entries(next)) {
        if (value === null) search.delete(key);
        else search.set(key, value);
      }
      const qs = search.toString();
      window.history.replaceState(window.history.state, '', qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname],
  );

  const context: BuilderContext | null = useMemo(() => {
    if (!board.data) return null;
    return {
      boardId,
      term: board.data.board.itemTerminology || 'Item',
      columns: board.data.columns,
      groups: board.data.groups,
      users: board.data.users,
      boards: boards.data ?? [],
    };
  }, [board.data, boards.data, boardId]);

  const canWriteAutomations = permissions.includes('automation:write');
  const canEdit = Boolean(board.data?.board.canEdit) && canWriteAutomations;
  const canManageWebhooks = permissions.includes('webhook:manage');
  const list = automations.data ?? [];
  const visibleCount = list.filter((automation) => !pendingDeletes.has(automation.id)).length;

  if (board.isError) {
    const notFound = board.error instanceof ApiClientError && board.error.status === 404;
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          illustration="error"
          title={notFound ? 'Board not found' : 'Automations couldn’t load'}
          description={
            notFound
              ? 'It may have been deleted, or you don’t have access to it.'
              : 'Check your connection and try again.'
          }
          actions={
            notFound ? (
              <Link href={routes.home(org.slug)} className={buttonVariants({ variant: 'primary' })}>
                Go home
              </Link>
            ) : (
              <Button onClick={() => void board.refetch()}>Try again</Button>
            )
          }
        />
      </div>
    );
  }

  const openRecipe = (recipe: Recipe) => {
    if (!context) return;
    setSeed({
      mode: 'sentence',
      draft: prepareRecipeDraft(recipe, context),
      title: 'Set up this automation',
      submitLabel: 'Create automation',
    });
  };
  const openCustom = () =>
    setSeed({
      mode: 'steps',
      draft: EMPTY_DRAFT,
      title: 'Build a custom automation',
      submitLabel: 'Create automation',
    });
  const openEdit = (automation: AutomationDto) =>
    setSeed({
      mode: 'steps',
      draft: draftFromAutomation(automation),
      title: 'Edit automation',
      name: automation.name,
      description: automation.description,
      enabled: automation.enabled,
      automationId: automation.id,
      submitLabel: 'Save changes',
    });

  const duplicate = (automation: AutomationDto) => {
    create.mutate(
      {
        name: `${automation.name} (copy)`.slice(0, 255),
        description: automation.description,
        enabled: false,
        trigger: automation.trigger as CreateAutomationInput['trigger'],
        conditions: automation.conditions as CreateAutomationInput['conditions'],
        actions: automation.actions as CreateAutomationInput['actions'],
      },
      {
        onSuccess: () =>
          toast.success(
            'Automation duplicated',
            'The copy is turned off so it doesn’t run twice. Turn it on when ready.',
          ),
      },
    );
  };

  const submit = async (input: CreateAutomationInput, automationId?: string) => {
    if (automationId) {
      await update.mutateAsync({
        automationId,
        input: {
          name: input.name,
          description: input.description,
          trigger: input.trigger,
          conditions: input.conditions,
          actions: input.actions,
        },
      });
      toast.success('Automation updated');
      return;
    }
    await create.mutateAsync(input);
    toast.success('Automation created', 'It’s on and will run the next time it’s triggered.');
    setQuery({ tab: 'automations' });
  };

  const navItems: { id: CenterTab; label: string; icon: typeof Zap; count?: number }[] = [
    { id: 'recipes', label: 'Recipes', icon: Sparkles },
    {
      id: 'automations',
      label: 'Board automations',
      icon: Zap,
      count: automations.data ? visibleCount : undefined,
    },
    { id: 'runs', label: 'Run history', icon: History },
    { id: 'integrations', label: 'Integrations', icon: Plug },
  ];

  return (
    <div className="h-full overflow-y-auto bg-app" data-testid="automations-center">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-6 px-4 py-5 sm:px-8 sm:py-7">
        <header className="flex flex-col gap-3">
          {board.data ? (
            <Breadcrumbs
              items={[
                {
                  label: board.data.board.name,
                  href: routes.board(org.slug, boardId),
                  icon: <ArrowLeft aria-hidden />,
                },
                { label: 'Automations' },
              ]}
            />
          ) : (
            <Skeleton width={180} height={16} />
          )}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span
                aria-hidden
                className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-fg shadow-sm"
              >
                <Zap className="size-5" />
              </span>
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-[-0.01em] text-fg">
                  Automations
                </h1>
                <p className="truncate text-base text-fg-secondary">
                  {board.data ? (
                    <>
                      Put the repetitive work on{' '}
                      <span className="font-medium text-fg">{board.data.board.name}</span> on autopilot.
                    </>
                  ) : (
                    <Skeleton width={260} height={16} className="mt-1" />
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link href={`/${org.slug}/automations`} className={buttonVariants({ variant: 'secondary' })}>
                All automations
              </Link>
              <Tooltip
                content={
                  !context ? 'Loading board…' : !canEdit ? 'You need edit access to create automations' : null
                }
              >
                <span
                  tabIndex={!context || !canEdit ? 0 : undefined}
                  className="inline-flex rounded-sm focus-visible:outline-2 focus-visible:outline-focus"
                >
                  <Button
                    leadingIcon={<Plus aria-hidden />}
                    onClick={openCustom}
                    disabled={!canEdit || !context}
                    data-testid="create-automation"
                  >
                    Create automation
                  </Button>
                </span>
              </Tooltip>
            </div>
          </div>
          {board.data && !canEdit ? (
            <p className="rounded-md border border-border-subtle bg-sunken px-3 py-2 text-sm text-fg-secondary">
              You have view-only access to this board’s automations.
            </p>
          ) : null}
        </header>

        <TabsPrimitive.Root
          value={tab}
          onValueChange={(value) => setQuery({ tab: value === 'recipes' ? null : value })}
          orientation="vertical"
          className="flex flex-col gap-6 lg:grid lg:grid-cols-[232px_minmax(0,1fr)] lg:items-start lg:gap-8"
        >
          <aside className="flex flex-col gap-4 lg:sticky lg:top-4">
            <TabsPrimitive.List
              ref={tabListRef}
              aria-label="Automations center"
              className="relative -mx-4 flex scroll-px-4 gap-1 overflow-x-auto border-b border-border-subtle px-4 pb-2 [mask-image:linear-gradient(to_right,transparent,black_16px,black_calc(100%-24px),transparent)] [scrollbar-width:none] sm:-mx-8 sm:px-8 lg:mx-0 lg:flex-col lg:overflow-visible lg:border-0 lg:px-0 lg:pb-0 lg:[mask-image:none]"
            >
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <TabsPrimitive.Trigger
                    key={item.id}
                    value={item.id}
                    data-testid={`center-tab-${item.id}`}
                    className={cn(
                      'group inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm whitespace-nowrap text-fg-secondary transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]',
                      'hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus active:bg-pressed',
                      'data-[state=active]:bg-primary-selected data-[state=active]:font-medium data-[state=active]:text-primary-text',
                      'lg:w-full',
                    )}
                  >
                    <Icon aria-hidden className="size-4 shrink-0" />
                    <span className="flex-1 text-left">{item.label}</span>
                    {item.count !== undefined ? (
                      <span className="rounded-full bg-muted px-1.5 text-xs font-semibold text-fg-secondary tabular-nums group-data-[state=active]:bg-panel group-data-[state=active]:text-primary-text">
                        {item.count}
                      </span>
                    ) : null}
                  </TabsPrimitive.Trigger>
                );
              })}
            </TabsPrimitive.List>
            <Link
              href={`/${org.slug}/automations`}
              className="hidden flex-col gap-2 rounded-lg border border-border-subtle bg-panel p-3 shadow-xs transition-[border-color,box-shadow] duration-[var(--duration-fast)] hover:border-primary hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus lg:flex"
            >
              <span className="flex items-center gap-1.5 text-xs font-semibold text-fg-muted ">
                <LayoutGrid aria-hidden className="size-3.5" />
                Usage this month
              </span>
              <UsageMeter usage={usage.data} compact />
            </Link>
          </aside>

          <div className="min-w-0">
            {/* Panels are always-mounted shells so the active tab's aria-controls resolves. */}
            <TabsPrimitive.Content value="recipes" className="outline-none">
              {context ? (
                <RecipeGallery
                  term={context.term}
                  columns={context.columns}
                  canEdit={canEdit}
                  onUse={openRecipe}
                  onCustom={openCustom}
                />
              ) : (
                <RecipesSkeleton />
              )}
            </TabsPrimitive.Content>
            <TabsPrimitive.Content value="automations" className="outline-none">
              {!context || automations.isPending ? (
                <ListSkeleton />
              ) : automations.isError ? (
                <EmptyState
                  illustration="error"
                  size="sm"
                  title="Automations couldn’t load"
                  description="Check your connection and try again."
                  actions={<Button onClick={() => void automations.refetch()}>Try again</Button>}
                />
              ) : (
                <AutomationList
                  automations={list}
                  context={context}
                  canEdit={canEdit}
                  onEdit={openEdit}
                  onDuplicate={duplicate}
                  onViewRuns={(automation) => setQuery({ tab: 'runs', automation: automation.id })}
                  onBrowse={() => setQuery({ tab: null })}
                  onCustom={openCustom}
                  pendingDeletes={pendingDeletes}
                  onDelete={scheduleDelete}
                />
              )}
            </TabsPrimitive.Content>
            <TabsPrimitive.Content value="runs" className="outline-none">
              {context ? (
                <RunHistory
                  orgSlug={org.slug}
                  context={context}
                  automations={list}
                  automationId={automationFilter}
                  onAutomationChange={(id) => setQuery({ automation: id })}
                  canEdit={canEdit}
                  onEditAutomation={openEdit}
                />
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="flex gap-2">
                    <Skeleton width={160} height={36} rounded="md" />
                    <Skeleton width={256} height={36} rounded="md" />
                    <Skeleton width={160} height={36} rounded="md" />
                  </div>
                  <div className="overflow-hidden rounded-lg border border-border-subtle bg-panel">
                    <RunRowsSkeleton />
                  </div>
                </div>
              )}
            </TabsPrimitive.Content>
            <TabsPrimitive.Content value="integrations" className="outline-none">
              <Integrations
                boardId={boardId}
                canManageWebhooks={canManageWebhooks}
                canEditBoard={Boolean(board.data?.board.canEdit)}
              />
            </TabsPrimitive.Content>
          </div>
        </TabsPrimitive.Root>
      </div>
      {context ? (
        <AutomationBuilder seed={seed} context={context} onClose={() => setSeed(null)} onSubmit={submit} />
      ) : null}
    </div>
  );
}

function Loading({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

function ListSkeleton() {
  return (
    <Loading label="Loading automations">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Skeleton width={288} height={36} rounded="md" />
          <Skeleton width={96} height={14} />
        </div>
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }, (_, index) => (
            <div
              key={index}
              className="flex items-center gap-3 rounded-lg border border-border-subtle bg-panel px-4 py-3.5"
            >
              <Skeleton width={36} height={20} rounded="full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton width="40%" height={16} />
                <Skeleton width="75%" height={14} />
                <Skeleton width="30%" height={10} />
              </div>
              <Skeleton width={64} height={28} rounded="md" />
            </div>
          ))}
        </div>
      </div>
    </Loading>
  );
}

function RecipesSkeleton() {
  return (
    <Loading label="Loading recipes">
      <div className="flex flex-col gap-5">
        <Skeleton width={320} height={36} rounded="md" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} width={96} height={32} rounded="full" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} height={152} rounded="lg" />
          ))}
        </div>
      </div>
    </Loading>
  );
}
