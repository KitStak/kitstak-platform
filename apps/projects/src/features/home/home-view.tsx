'use client';
/**
 * Home: a friendly greeting, four numbers that matter (due today, overdue, open, done this week),
 * the getting-started checklist for new people, your Today / Overdue / This week lists with
 * one-click complete, and a rail with the inbox, goals and recent projects.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';
import {
  AlarmClock,
  CalendarCheck2,
  CalendarDays,
  CheckCircle2,
  CircleCheckBig,
  FolderPlus,
  ListTodo,
  Plus,
  PartyPopper,
  Sun,
} from 'lucide-react';
import { Button, EmptyState, Tabs, TabsList, TabsTrigger, cn } from '@/components/ui';
import { TaskRow } from '@/components/pm';
import type { InboxPage } from '@/lib/hooks/use-data';
import { useGoals, useMyTasks, useNotifications, useProjects } from '@/lib/hooks/use-data';
import { todayIso } from '@/lib/dates';
import { routes } from '@/lib/routes';
import type { GoalDTO, ProjectSummary, TaskSummary } from '@/lib/types';
import { useShell } from '@/features/shell/shell-context';
import { useShellStore } from '@/features/shell/store';
import { CustomersCard } from './customers-card';
import { GettingStartedCard } from './getting-started';
import { GoalsSnapshot, InboxPreview, RecentProjects } from './home-rail';
import { greetingFor, homeBuckets, homeStats, summarySentence } from './home-model';

type Bucket = 'today' | 'overdue' | 'week';

const DATE = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

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
  const list = useMemo(() => tasks.data ?? [], [tasks.data]);

  // Tasks you finish while looking at Home stay in place (struck through) until you leave.
  const keepDone = useMemo(
    () =>
      new Set(
        list
          .filter((t) => t.statusCategory === 'done' && t.completedAt && t.completedAt >= sessionStart)
          .map((t) => t.id),
      ),
    [list, sessionStart],
  );
  const buckets = useMemo(() => homeBuckets(list, today, keepDone), [list, today, keepDone]);
  const stats = useMemo(() => homeStats(list, today), [list, today]);
  // Same rule as Dashboards: the big number counts tasks; subtasks are listed beside it.
  const openSubtasks = useMemo(
    () =>
      homeStats(
        list.filter((task) => task.parentTaskId !== null),
        today,
      ).open,
    [list, today],
  );
  const projectNames = useMemo(
    () => new Map((projects.data ?? []).map((p) => [p.id, p.name])),
    [projects.data],
  );
  const [bucketChoice, setBucket] = useState<Bucket | null>(null);
  const bucket: Bucket =
    bucketChoice ?? (buckets.today.length ? 'today' : buckets.overdue.length ? 'overdue' : 'week');
  const shown = buckets[bucket];
  const allDoneToday =
    bucket === 'today' && buckets.today.length > 0 && buckets.today.every((t) => keepDone.has(t.id));

  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-6 px-4 py-6 sm:px-6" data-testid="home">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-fg-muted" suppressHydrationWarning>
            {DATE.format(new Date())} · {org.name}
          </p>
          <h1
            className="mt-1 text-xl font-semibold tracking-[-0.01em] text-fg sm:text-2xl"
            suppressHydrationWarning
            data-testid="home-greeting"
          >
            {greetingFor(new Date())}, {firstName}
          </h1>
          <p className="mt-1 text-base text-fg-secondary">{summarySentence(stats)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('project:create') ? (
            <Button
              variant="secondary"
              leadingIcon={<FolderPlus aria-hidden />}
              onClick={() => router.push(routes.newProject())}
            >
              New project
            </Button>
          ) : null}
          <Button
            leadingIcon={<Plus aria-hidden />}
            onClick={() => openQuickAdd({ assigneeId: user.id })}
            data-testid="home-new-task"
          >
            New task
          </Button>
        </div>
      </header>

      <section
        aria-label="Your numbers"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        data-testid="home-stats"
      >
        <StatTile
          label="Due today"
          value={stats.dueToday}
          icon={<Sun aria-hidden />}
          tone={stats.dueToday ? 'warning' : 'neutral'}
          onClick={() => setBucket('today')}
          active={bucket === 'today'}
        />
        <StatTile
          label="Overdue"
          value={stats.overdue}
          icon={<AlarmClock aria-hidden />}
          tone={stats.overdue ? 'danger' : 'neutral'}
          onClick={() => setBucket('overdue')}
          active={bucket === 'overdue'}
        />
        <StatTile
          label={
            openSubtasks
              ? `open ${stats.open - openSubtasks === 1 ? 'task' : 'tasks'} and ${openSubtasks} ${openSubtasks === 1 ? 'subtask' : 'subtasks'}`
              : 'Open tasks'
          }
          value={stats.open - openSubtasks}
          icon={<ListTodo aria-hidden />}
          tone="primary"
          href={routes.myWork()}
        />
        <StatTile
          label="Done this week"
          value={stats.doneThisWeek}
          icon={<CircleCheckBig aria-hidden />}
          tone={stats.doneThisWeek ? 'success' : 'neutral'}
          href={routes.myWork()}
        />
      </section>

      <GettingStartedCard
        projectCount={(projects.data ?? []).length}
        createdTaskCount={createdTaskCount}
        tasks={list}
        dismissed={gettingStartedDismissed}
        force={forceGettingStarted}
      />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Left: your work, then your customers (CRM + warehouse). Right: inbox, goals, projects. */}
        <div className="flex min-w-0 flex-col gap-6">
          <section
            className="min-w-0 rounded-xl border border-border-subtle bg-panel shadow-xs"
            aria-labelledby="home-my-tasks"
            data-testid="home-my-tasks"
          >
            <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border-subtle px-4 pt-3">
              <h2 id="home-my-tasks" className="pb-2 text-base font-semibold text-fg">
                My tasks
              </h2>
              <Tabs value={bucket} onValueChange={(value) => setBucket(value as Bucket)}>
                <TabsList aria-label="When it’s due" className="gap-5 border-b-0">
                  <TabsTrigger value="today" count={buckets.today.length} data-testid="home-tab-today">
                    Today
                  </TabsTrigger>
                  <TabsTrigger
                    value="overdue"
                    count={buckets.overdue.length}
                    data-testid="home-tab-overdue"
                    className={
                      buckets.overdue.length
                        ? '[&>span:last-child]:bg-danger-subtle [&>span:last-child]:text-danger-text'
                        : undefined
                    }
                  >
                    Overdue
                  </TabsTrigger>
                  <TabsTrigger value="week" count={buckets.week.length} data-testid="home-tab-week">
                    This week
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </header>
            <div className="p-2">
              {list.length === 0 ? (
                <EmptyState
                  size="sm"
                  illustration="board"
                  title="Nothing assigned to you yet"
                  description="When someone gives you a task, it shows up here. You can also add one for yourself."
                  actions={
                    <Button
                      size="sm"
                      leadingIcon={<Plus aria-hidden />}
                      onClick={() => openQuickAdd({ assigneeId: user.id, dueDate: today })}
                    >
                      Add a task for today
                    </Button>
                  }
                />
              ) : shown.length === 0 ? (
                <BucketEmpty
                  bucket={bucket}
                  onAdd={() => openQuickAdd({ assigneeId: user.id, dueDate: today })}
                />
              ) : (
                <>
                  {allDoneToday ? (
                    <p
                      className="mx-2 mt-1 mb-2 flex items-center gap-2 rounded-lg bg-success-subtle px-3 py-2 text-sm font-medium text-success-text"
                      role="status"
                    >
                      <PartyPopper aria-hidden className="size-4" /> Everything due today is done. Great work!
                    </p>
                  ) : null}
                  <div className="flex flex-col" data-testid={`home-list-${bucket}`}>
                    {shown.slice(0, 12).map((task) => (
                      <TaskRow key={task.id} task={task} projectName={projectNames.get(task.projectId)} />
                    ))}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle px-2 pt-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      leadingIcon={<Plus aria-hidden />}
                      onClick={() =>
                        openQuickAdd({ assigneeId: user.id, dueDate: bucket === 'week' ? null : today })
                      }
                    >
                      {bucket === 'week' ? 'Add a task' : 'Add a task for today'}
                    </Button>
                    <Link
                      href={routes.myWork()}
                      className="px-2 text-sm font-medium text-fg-link hover:underline"
                    >
                      {shown.length > 12 ? `See all ${shown.length} in My work` : 'Open My work'}
                    </Link>
                  </div>
                </>
              )}
            </div>
          </section>
          <CustomersCard />
          <RecentProjects projects={projects.data ?? []} />
        </div>

        <aside aria-label="Inbox and goals" className="flex min-w-0 flex-col gap-6">
          <InboxPreview items={inbox.data?.items ?? []} unread={inbox.data?.unread ?? 0} />
          <GoalsSnapshot goals={goals.data ?? []} />
        </aside>
      </div>
    </div>
  );
}

const TONE: Record<'neutral' | 'primary' | 'warning' | 'danger' | 'success', string> = {
  neutral: 'bg-sunken text-icon',
  primary: 'bg-primary-subtle text-primary-text',
  warning: 'bg-warning-subtle text-warning-text',
  danger: 'bg-danger-subtle text-danger-text',
  success: 'bg-success-subtle text-success-text',
};

function StatTile({
  label,
  value,
  icon,
  tone,
  onClick,
  href,
  active,
  hint,
}: {
  readonly label: string;
  readonly value: number;
  readonly hint?: string;
  readonly icon: ReactNode;
  readonly tone: keyof typeof TONE;
  readonly onClick?: () => void;
  readonly href?: string;
  readonly active?: boolean;
}) {
  const body = (
    <>
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-lg max-sm:hidden [&_svg]:size-[18px]',
          TONE[tone],
        )}
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-2xl leading-7 font-semibold tracking-[-0.02em] text-fg tabular-nums">
          {value}
        </span>
        <span className="line-clamp-2 text-sm text-fg-muted">
          {label}
          {hint ? <span className="text-xs"> · {hint}</span> : null}
        </span>
      </span>
    </>
  );
  const className = cn(
    'flex items-center gap-3 rounded-xl border bg-panel p-4 text-left shadow-xs outline-none transition-[border-color,box-shadow] duration-[var(--duration-fast)]',
    'hover:border-border-strong focus-visible:ring-2 focus-visible:ring-focus',
    active ? 'border-border-strong ring-1 ring-[color:var(--color-border-strong)]' : 'border-border-subtle',
  );
  if (href) {
    return (
      <Link href={href} className={className} data-testid="home-stat">
        {body}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={className}
      aria-pressed={active}
      data-testid="home-stat"
    >
      {body}
    </button>
  );
}

function BucketEmpty({ bucket, onAdd }: { readonly bucket: Bucket; readonly onAdd: () => void }) {
  const copy = {
    today: {
      icon: <CalendarCheck2 aria-hidden className="size-5" />,
      title: 'Nothing due today',
      body: 'Enjoy the breathing room, or plan something for today.',
    },
    overdue: {
      icon: <CheckCircle2 aria-hidden className="size-5" />,
      title: 'Nothing overdue',
      body: 'You’re on top of things. Nice work.',
    },
    week: {
      icon: <CalendarDays aria-hidden className="size-5" />,
      title: 'Nothing due in the next 7 days',
      body: 'Tasks with a due date this week show up here.',
    },
  }[bucket];
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-success-subtle text-success-text">
        {copy.icon}
      </span>
      <p className="text-sm font-semibold text-fg">{copy.title}</p>
      <p className="max-w-80 text-sm text-fg-muted">{copy.body}</p>
      {bucket === 'today' ? (
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Plus aria-hidden />}
          onClick={onAdd}
          className="mt-1"
        >
          Add a task for today
        </Button>
      ) : null}
    </div>
  );
}
