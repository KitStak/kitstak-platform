'use client';
/**
 * Home: a friendly greeting, four numbers that matter (due today, overdue, open, done this week),
 * the getting-started checklist for new people, your Today / Overdue / This week lists with
 * one-click complete, and a rail with the inbox and goals. Built on the shared dashboard frame
 * (`@kitstak/ui/dashboard`, docs/design/UI-CLEANUP.md): every number and row is a link.
 */
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { FolderPlus, PartyPopper, Plus } from 'lucide-react';
import { Count, DashColumns, DashSection, DashboardFrame, DashboardHeader, EmptyNote, Pill, StatRow, StatTile, type DashAction } from '@kitstak/ui/dashboard';
import { Button, Tabs, TabsList, TabsTrigger, cn } from '@/components/ui';
import { TaskRow } from '@/components/pm';
import type { InboxPage } from '@/lib/hooks/use-data';
import { useGoals, useMyTasks, useNotifications, useProjects } from '@/lib/hooks/use-data';
import { todayIso } from '@/lib/dates';
import { routes } from '@/lib/routes';
import type { GoalDTO, ProjectSummary, TaskSummary } from '@/lib/types';
import { useShell } from '@/features/shell/shell-context';
import { useShellStore } from '@/features/shell/store';
import { CustomersCard } from './customers-card';
import { ProgramsTodayCard } from './programs-today-card';
import { GettingStartedCard } from './getting-started';
import { GoalsSnapshot, InboxPreview, RecentProjects } from './home-rail';
import { useGreeting } from '@kitstak/ui/text';
import { homeBuckets, homeStats, summarySentence } from './home-model';

type Bucket = 'today' | 'overdue' | 'week';

const DATE = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

/** The My work filter that shows the same tasks as each Home tab. */
const BUCKET_WHEN = { today: 'today', overdue: 'overdue', week: 'upcoming' } as const;

/** How many tasks a tab lists before "All N in My work" takes over. */
const LIST_LIMIT = 12;

export function HomeView({
  initialTasks,
  initialProjects,
  initialInbox,
  initialGoals,
  createdTaskCount,
  gettingStartedDismissed,
  forceGettingStarted,
}: {
  readonly initialTasks: TaskSummary[];
  readonly initialProjects: ProjectSummary[];
  readonly initialInbox: InboxPage;
  readonly initialGoals: GoalDTO[];
  readonly createdTaskCount: number;
  readonly gettingStartedDismissed: boolean;
  readonly forceGettingStarted: boolean;
}) {
  const router = useRouter();
  const { user, org, can } = useShell();
  const openQuickAdd = useShellStore((state) => state.openQuickAdd);
  const tasks = useMyTasks('assigned', undefined, { initialData: initialTasks });
  const projects = useProjects({}, { initialData: initialProjects });
  const inbox = useNotifications('unread', { initialData: initialInbox });
  const goals = useGoals({ initialData: initialGoals });
  const [sessionStart] = useState(() => new Date(Date.now() - 1000).toISOString());
  const today = todayIso();
  const firstName = user.name.trim().split(/\s+/)[0] || 'there';
  const greeting = useGreeting();
  const list = useMemo(() => tasks.data ?? [], [tasks.data]);

  // Tasks you finish while looking at Home stay in place (struck through) until you leave.
  const keepDone = useMemo(
    () => new Set(list.filter((t) => t.statusCategory === 'done' && t.completedAt && t.completedAt >= sessionStart).map((t) => t.id)),
    [list, sessionStart],
  );
  const buckets = useMemo(() => homeBuckets(list, today, keepDone), [list, today, keepDone]);
  const stats = useMemo(() => homeStats(list, today), [list, today]);
  // Same rule as Dashboards: the big number counts tasks; subtasks are listed beside it.
  const openSubtasks = useMemo(() => homeStats(list.filter((task) => task.parentTaskId !== null), today).open, [list, today]);
  const projectNames = useMemo(() => new Map((projects.data ?? []).map((p) => [p.id, p.name])), [projects.data]);
  const [bucketChoice, setBucket] = useState<Bucket | null>(null);
  const bucket: Bucket = bucketChoice ?? (buckets.today.length ? 'today' : buckets.overdue.length ? 'overdue' : 'week');
  const shown = buckets[bucket];
  const allDoneToday = bucket === 'today' && buckets.today.length > 0 && buckets.today.every((t) => keepDone.has(t.id));
  const addForToday = () => openQuickAdd({ assigneeId: user.id, dueDate: bucket === 'week' ? null : today });
  const listAction: DashAction = {
    label: shown.length > LIST_LIMIT ? `All ${shown.length} in My work` : 'Open My work',
    href: routes.myWork(BUCKET_WHEN[bucket]),
  };

  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 py-6 sm:px-6" data-testid="home">
      <DashboardFrame app="projects">
        <DashboardHeader
          eyebrow={
            <span suppressHydrationWarning>
              {DATE.format(new Date())} · {org.name}
            </span>
          }
          title={
            <span className={cn('transition-opacity', greeting ? 'opacity-100' : 'opacity-0')} data-testid="home-greeting">
              {greeting ?? 'Good morning'}, {firstName}
            </span>
          }
          subtitle={summarySentence(stats)}
          actions={
            <>
              {can('project:create') ? (
                <Button
                  variant="secondary"
                  leadingIcon={<FolderPlus aria-hidden />}
                  // In view only this press opens the "view only" dialog instead (see ViewOnlyGuard).
                  data-plan-write
                  onClick={() => router.push(routes.newProject())}
                >
                  New project
                </Button>
              ) : null}
              <Button leadingIcon={<Plus aria-hidden />} onClick={() => openQuickAdd({ assigneeId: user.id })} data-testid="home-new-task">
                New task
              </Button>
            </>
          }
        />

        <StatRow label="Your numbers" data-testid="home-stats">
          <StatTile label="Due today" value={stats.dueToday} href={routes.myWork('today')} data-testid="home-stat" />
          <StatTile label="Overdue" value={stats.overdue} href={routes.myWork('overdue')} data-testid="home-stat" />
          <StatTile
            label="Open"
            value={stats.open - openSubtasks}
            caption={openSubtasks ? `Plus ${openSubtasks} ${openSubtasks === 1 ? 'subtask' : 'subtasks'}` : undefined}
            href={routes.myWork()}
            help="Open tasks assigned to you. Subtasks are counted on their own."
            data-testid="home-stat"
          />
          <StatTile label="Done this week" value={stats.doneThisWeek} href={routes.myWork('done')} data-testid="home-stat" />
        </StatRow>

        <GettingStartedCard
          projectCount={(projects.data ?? []).length}
          createdTaskCount={createdTaskCount}
          tasks={list}
          dismissed={gettingStartedDismissed}
          force={forceGettingStarted}
        />

        <DashColumns
          main={
            <>
              <DashSection
                title="My tasks"
                action={listAction}
                flush
                data-testid="home-my-tasks"
                aside={
                  <Tabs value={bucket} onValueChange={(value) => setBucket(value as Bucket)}>
                    <TabsList aria-label="When it’s due" className="gap-5 border-b-0">
                      <TabsTrigger value="today" data-testid="home-tab-today">
                        Today <Count value={buckets.today.length} label="tasks" />
                      </TabsTrigger>
                      <TabsTrigger value="overdue" data-testid="home-tab-overdue">
                        Overdue <Count value={buckets.overdue.length} tone="critical" label="tasks" />
                      </TabsTrigger>
                      <TabsTrigger value="week" data-testid="home-tab-week">
                        This week <Count value={buckets.week.length} label="tasks" />
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                }
                footer={
                  <Button variant="ghost" size="sm" leadingIcon={<Plus aria-hidden />} onClick={addForToday} className="-ml-2">
                    {bucket === 'week' ? 'Add a task' : 'Add a task for today'}
                  </Button>
                }
              >
                {list.length === 0 ? (
                  <EmptyNote action={can('project:create') ? { label: 'Start a project', href: routes.newProject() } : { label: 'Browse projects', href: routes.projects() }}>
                    Nothing is assigned to you yet. Add a task below, or find work in a project.
                  </EmptyNote>
                ) : shown.length === 0 ? (
                  <BucketEmpty bucket={bucket} />
                ) : (
                  <div className="p-2">
                    {allDoneToday ? (
                      <p className="flex items-center px-2 pt-1 pb-2" role="status">
                        <Pill tone="positive" icon={<PartyPopper />}>
                          Everything due today is done. Great work!
                        </Pill>
                      </p>
                    ) : null}
                    <div className="flex flex-col" data-testid={`home-list-${bucket}`}>
                      {shown.slice(0, LIST_LIMIT).map((task) => (
                        <TaskRow key={task.id} task={task} projectName={projectNames.get(task.projectId)} />
                      ))}
                    </div>
                  </div>
                )}
              </DashSection>
              <ProgramsTodayCard />
              <CustomersCard />
              <RecentProjects projects={projects.data ?? []} />
            </>
          }
          rail={
            <>
              <InboxPreview items={inbox.data?.items ?? []} unread={inbox.data?.unread ?? 0} />
              <GoalsSnapshot goals={goals.data ?? []} />
            </>
          }
        />
      </DashboardFrame>
    </div>
  );
}

const BUCKET_EMPTY: Readonly<Record<Bucket, { readonly text: string; readonly action: DashAction }>> = {
  today: { text: 'Nothing is due today. Plan something for today, or pull in work that is coming up.', action: { label: 'See the next 7 days', href: routes.myWork('upcoming') } },
  overdue: { text: 'Nothing is overdue. You’re on top of things.', action: { label: 'See what is due today', href: routes.myWork('today') } },
  week: { text: 'Nothing is due in the next 7 days. Tasks with a due date this week show up here.', action: { label: 'See all your work', href: routes.myWork() } },
};

function BucketEmpty({ bucket }: { readonly bucket: Bucket }) {
  const copy = BUCKET_EMPTY[bucket];
  return <EmptyNote action={copy.action}>{copy.text}</EmptyNote>;
}
