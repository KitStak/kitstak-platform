'use client';
/**
 * Goals (OKRs): each goal with an owner, time frame, health and rolled-up progress. Progress
 * comes from key results (numbers you update at check-ins, or a project's task completion),
 * from linked projects, or is set by hand. Check-ins record health + a note + new numbers and
 * build a history. `/goals?goal=<id>` opens a goal's detail panel.
 */
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownRight,
  ChevronDown,
  CornerDownRight,
  FolderKanban,
  History,
  ListPlus,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Target,
  Trash2,
  X,
} from 'lucide-react';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Drawer,
  DrawerContent,
  EmptyState,
  IconButton,
  Input,
  ProgressBar,
  Select,
  Skeleton,
  Tooltip,
  cn,
  toast,
} from '@/components/ui';
import { DueDate, EntityIcon, PersonAvatar } from '@/components/pm';
import { Page } from '@/components/layout/page';
import { GOAL_HEALTHS, GOAL_HEALTH_LABELS, PROJECT_HEALTH_LABELS, type GoalHealth, type ProjectHealth } from '@/lib/constants';
import { healthProgressTone } from '@/lib/health';
import { ProjectHealthMark } from '@/features/projects/health';
import { formatRange } from '@/lib/dates';
import { useGoalCheckIns, useGoals, useProjects } from '@/lib/hooks/use-data';
import { usePeopleMap } from '@/lib/hooks/use-people';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import type { GoalDTO, KeyResultDTO, ProjectSummary } from '@/lib/types';
import { deleteGoalAction, deleteKeyResultAction, linkGoalProjectAction, restoreGoalAction, updateKeyResultAction } from '@/server/actions/goals';
import { useShell } from '@/features/shell/shell-context';
import { ProgressRing } from '@/features/dashboards/charts';
import { LocalTime } from '@/features/task/local-time';
import { CheckInDialog, GOAL_HEALTH_COLOR, GOAL_TONE, GoalDialog, KeyResultDialog, formatKrValue, krBarTone, krProgressFormula, krValueText } from './goal-dialogs';

type DialogState =
  | { kind: 'goal'; goal: GoalDTO | null; parentId?: string | null }
  | { kind: 'kr'; goal: GoalDTO; keyResult: KeyResultDTO | null }
  | { kind: 'checkin'; goal: GoalDTO }
  | null;

const MODE_TEXT = { key_results: 'from key results', projects: 'from linked projects', manual: 'set by hand' } as const;

// Progress is coloured by health, never by how full it is: neutral ink on track, amber at risk,
// red off track (the shared rule in @/lib/health).
const ringTone = (health: GoalHealth | ProjectHealth) => healthProgressTone(health);

const PROJECT_RANK = { on_track: 0, at_risk: 1, off_track: 2 } as const;

/**
 * One chip: the owner's call. When linked projects are in worse shape than the goal says (an On
 * track goal with an At risk project), the chip says so in its words ("On track, check") and its
 * tooltip, the same way project health chips flag numbers that disagree. Nothing sits on the pill.
 */
function GoalHealthBadge({ health, linked = [] }: { readonly health: GoalHealth; readonly linked?: readonly ProjectSummary[] }) {
  const worst = health === 'on_track' || health === 'at_risk'
    ? linked.reduce<ProjectSummary | null>((acc, p) => (p.status === 'completed' || p.status === 'archived' ? acc : !acc || PROJECT_RANK[p.health] > PROJECT_RANK[acc.health] ? p : acc), null)
    : null;
  const flagged = worst && PROJECT_RANK[worst.health] > PROJECT_RANK[health as 'on_track' | 'at_risk'] ? worst : null;
  if (!flagged) return <Badge tone={GOAL_TONE[health]}>{GOAL_HEALTH_LABELS[health]}</Badge>;
  const tip = `Linked project ${flagged.name} is ${PROJECT_HEALTH_LABELS[flagged.health]} · Check in to update`;
  return (
    <span className="inline-flex" title={tip} aria-label={`${GOAL_HEALTH_LABELS[health]}. ${tip}`} role="img" data-testid="goal-health-flag">
      <Badge tone={GOAL_TONE[health]}>
        {GOAL_HEALTH_LABELS[health]}
        <span className="font-normal">, check</span>
      </Badge>
    </span>
  );
}

/** "Started 97.2% · Now 98.6% · Target 99.5%", with the current value in bold. */
function KrNumbers({ start, now, target, lowerIsBetter, align = 'start' }: { readonly start: string; readonly now: string; readonly target: string; readonly lowerIsBetter: boolean; readonly align?: 'start' | 'end' }) {
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-x-1.5 text-fg-muted', align === 'end' && 'sm:justify-end')} data-testid="kr-numbers">
      <span>Started {start}</span>
      <span aria-hidden>·</span>
      <span className="text-fg-secondary">
        Now <strong className="font-semibold text-fg">{now}</strong>
      </span>
      <span aria-hidden>·</span>
      <span className="inline-flex items-center gap-0.5">
        {lowerIsBetter ? <ArrowDownRight aria-label="Lower is better" className="size-3" /> : null}
        Target {target}
      </span>
    </span>
  );
}

/** Tooltip body: the plain-words explanation, then the sum on its own line. */
function KrFormula({ kr }: { readonly kr: KeyResultDTO }) {
  const { text, steps } = krProgressFormula(kr);
  return (
    <span className="flex max-w-72 flex-col gap-1">
      <span>{text}</span>
      {steps ? <span className="font-medium whitespace-nowrap tabular-nums">{steps}</span> : null}
    </span>
  );
}

function KeyResultRow({
  kr,
  health,
  projects,
  canEdit,
  onSaved,
  onEdit,
}: {
  readonly kr: KeyResultDTO;
  readonly health: GoalHealth;
  readonly projects: ReadonlyMap<string, ProjectSummary>;
  readonly canEdit: boolean;
  readonly onSaved: (goal: GoalDTO) => void;
  readonly onEdit: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(kr.currentValue));
  const project = kr.projectId ? projects.get(kr.projectId) : undefined;
  const queryClient = useQueryClient();

  const save = async () => {
    setEditing(false);
    const next = Number(value);
    if (!Number.isFinite(next) || next === kr.currentValue) {
      setValue(String(kr.currentValue));
      return;
    }
    const result = await updateKeyResultAction({ keyResultId: kr.id, patch: { currentValue: next } });
    if (!result.ok) {
      toast.error("Couldn't update the number", result.error.message);
      setValue(String(kr.currentValue));
      return;
    }
    onSaved(result.data);
    toast.success(`${kr.name}: ${formatKrValue(kr, next)}`);
  };
  const remove = async () => {
    const result = await deleteKeyResultAction({ keyResultId: kr.id });
    if (!result.ok) {
      toast.error("Couldn't remove the key result", result.error.message);
      return;
    }
    onSaved(result.data);
    void queryClient.invalidateQueries({ queryKey: qk.goals() });
    toast.success(`Removed ${kr.name}`);
  };

  return (
    <li className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(140px,auto)_120px_auto]" data-testid="key-result">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        {kr.kind === 'project' ? <FolderKanban aria-hidden className="size-4 shrink-0 text-icon" /> : <Target aria-hidden className="size-4 shrink-0 text-icon" />}
        <span className="truncate text-fg">{kr.name}</span>
      </div>
      <div className="order-3 col-span-2 flex items-center gap-2 sm:order-none sm:col-span-1 sm:justify-end">
        {kr.kind === 'project' ? (
          project ? (
            <Link href={routes.project(project.key)} title={`Open ${project.name}`} aria-label={`Open ${project.name}`} className="inline-flex min-w-0 items-center gap-1.5 truncate text-xs text-fg-link hover:underline">
              <EntityIcon icon={project.icon} color={project.color} size={16} />
              <span className="truncate">{kr.name.trim().toLowerCase() === project.name.trim().toLowerCase() ? `${project.key} · ${project.progress.done} of ${project.progress.total} tasks done` : project.name}</span>
            </Link>
          ) : (
            <span className="text-xs text-fg-muted">Project not available</span>
          )
        ) : editing ? (
          <Input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => void save()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setValue(String(kr.currentValue));
                setEditing(false);
              }
            }}
            inputMode="decimal"
            size="sm"
            aria-label={`New value for ${kr.name}`}
            containerClassName="w-24"
          />
        ) : (
          <Tooltip content={canEdit ? 'Click to update the number' : undefined} disabled={!canEdit || kr.kind === 'boolean'}>
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => {
                if (kr.kind === 'boolean') {
                  setValue(kr.currentValue >= 1 ? '0' : '1');
                  void updateKeyResultAction({ keyResultId: kr.id, patch: { currentValue: kr.currentValue >= 1 ? 0 : 1 } }).then((result) => {
                    if (result.ok) onSaved(result.data);
                    else toast.error("Couldn't update", result.error.message);
                  });
                } else setEditing(true);
              }}
              className="rounded-sm px-1 text-xs text-fg-secondary tabular-nums outline-none hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-focus disabled:hover:bg-transparent"
              data-testid="kr-value"
            >
              {(() => {
                if (kr.kind === 'boolean') return <strong className="font-semibold text-fg">{formatKrValue(kr, kr.currentValue)}</strong>;
                const text = krValueText(kr);
                return <KrNumbers {...text} align="end" />;
              })()}
            </button>
          </Tooltip>
        )}
      </div>
      <div className="order-4 col-span-2 flex items-center gap-2 sm:order-none sm:col-span-1">
        <ProgressBar value={kr.progress} size="sm" label={`${kr.name} progress`} tone={krBarTone(kr.progress, health)} className="flex-1" />
        <Tooltip content={<KrFormula kr={kr} />}>
          <span tabIndex={0} className="w-9 cursor-help rounded-sm text-right text-xs font-medium text-fg tabular-nums underline decoration-border-strong decoration-dotted underline-offset-2 outline-none focus-visible:outline-2 focus-visible:outline-focus" data-testid="kr-percent">
            {kr.progress}%
          </span>
        </Tooltip>
      </div>
      <div className="flex items-center justify-end">
        {canEdit ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label={`More for ${kr.name}`} icon={<MoreHorizontal aria-hidden />} size="sm" className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem icon={<Pencil aria-hidden />} onSelect={onEdit}>
                Edit key result
              </DropdownMenuItem>
              <DropdownMenuItem icon={<Trash2 aria-hidden />} variant="danger" onSelect={() => void remove()}>
                Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </li>
  );
}

function GoalCard({
  goal,
  all,
  projects,
  canEdit,
  depth,
  onDialog,
  onSaved,
  onOpen,
  onDelete,
}: {
  readonly goal: GoalDTO;
  readonly all: readonly GoalDTO[];
  readonly projects: ReadonlyMap<string, ProjectSummary>;
  readonly canEdit: boolean;
  readonly depth: number;
  readonly onDialog: (state: DialogState) => void;
  readonly onSaved: (goal: GoalDTO) => void;
  readonly onOpen: (goal: GoalDTO) => void;
  readonly onDelete: (goal: GoalDTO) => void;
}) {
  const [open, setOpen] = useState(depth === 0);
  const children = all.filter((g) => g.parentGoalId === goal.id);
  const linked = goal.projectIds.map((id) => projects.get(id)).filter((p): p is ProjectSummary => Boolean(p));
  const detailCount = goal.keyResults.length + linked.length + children.length;

  const unlink = async (projectId: string) => {
    const result = await linkGoalProjectAction({ goalId: goal.id, projectId, linked: false });
    if (!result.ok) {
      toast.error("Couldn't unlink the project", result.error.message);
      return;
    }
    onSaved(result.data);
  };

  return (
    <li className={cn(depth > 0 && 'border-t border-border-subtle')} data-testid={depth === 0 ? 'goal-card' : 'child-goal'} id={`goal-${goal.id}`}>
      <div className={cn('flex flex-col gap-3', depth === 0 ? 'p-4' : 'py-3 pr-4 pl-4')}>
        <div className="flex items-start gap-3">
          {depth > 0 ? <CornerDownRight aria-hidden className="mt-3 size-4 shrink-0 text-icon" /> : null}
          <ProgressRing percent={goal.progress} size={depth === 0 ? 48 : 40} strokeWidth={depth === 0 ? 4.5 : 4} tone={ringTone(goal.health)} label={`${goal.name} progress`} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <button
                type="button"
                onClick={() => onOpen(goal)}
                className="min-w-0 truncate rounded-sm text-left text-base font-semibold text-fg outline-none hover:underline focus-visible:outline-2 focus-visible:outline-focus"
                data-testid="goal-title"
              >

                {goal.name}
              </button>
              <GoalHealthBadge health={goal.health} linked={linked} />
              {goal.period ? <Badge tone="outline">{goal.period}</Badge> : null}
            </div>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-muted">
              <PersonAvatar userId={goal.ownerId} size="xs" showName />
              <span aria-hidden>·</span>
              <span>{goal.progress}% {MODE_TEXT[goal.progressMode]}</span>
              {goal.dueDate ? (
                <>
                  <span aria-hidden>·</span>
                  <DueDate date={goal.dueDate} done={goal.health === 'achieved'} />
                </>
              ) : null}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {canEdit ? (
              <Button size="sm" variant="secondary" leadingIcon={<MessageSquareText aria-hidden />} onClick={() => onDialog({ kind: 'checkin', goal })} data-testid="check-in" className="hidden sm:inline-flex">
                Check in
              </Button>
            ) : null}
            {canEdit ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton label={`More for ${goal.name}`} icon={<MoreHorizontal aria-hidden />} size="sm" data-testid="goal-menu" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem icon={<MessageSquareText aria-hidden />} onSelect={() => onDialog({ kind: 'checkin', goal })}>
                    Check in
                  </DropdownMenuItem>
                  <DropdownMenuItem icon={<History aria-hidden />} onSelect={() => onOpen(goal)}>
                    Details and history
                  </DropdownMenuItem>
                  <DropdownMenuItem icon={<Pencil aria-hidden />} onSelect={() => onDialog({ kind: 'goal', goal })}>
                    Edit goal
                  </DropdownMenuItem>
                  <DropdownMenuItem icon={<ListPlus aria-hidden />} onSelect={() => onDialog({ kind: 'kr', goal, keyResult: null })}>
                    Add key result
                  </DropdownMenuItem>
                  <DropdownMenuItem icon={<Plus aria-hidden />} onSelect={() => onDialog({ kind: 'goal', goal: null, parentId: goal.id })}>
                    Add a smaller goal
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem icon={<Trash2 aria-hidden />} variant="danger" onSelect={() => onDelete(goal)}>
                    Delete goal
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {detailCount ? (
              <IconButton
                label={open ? `Hide details of ${goal.name}` : `Show details of ${goal.name}`}
                icon={<ChevronDown aria-hidden className={cn('transition-transform duration-[var(--duration-fast)]', !open && '-rotate-90')} />}
                size="sm"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
              />
            ) : null}
          </div>
        </div>

        {open ? (
          <div className={cn('flex flex-col gap-2', depth === 0 ? 'sm:pl-[60px]' : 'sm:pl-[80px]')}>
            {goal.keyResults.length ? (
              <ul className="flex flex-col divide-y divide-border-subtle" aria-label={`Key results for ${goal.name}`}>
                {goal.keyResults.map((kr) => (
                  <KeyResultRow key={`${kr.id}-${kr.currentValue}`} kr={kr} health={goal.health} projects={projects} canEdit={canEdit} onSaved={onSaved} onEdit={() => onDialog({ kind: 'kr', goal, keyResult: kr })} />
                ))}
              </ul>
            ) : goal.progressMode === 'key_results' && canEdit ? (
              <button
                type="button"
                onClick={() => onDialog({ kind: 'kr', goal, keyResult: null })}
                className="flex items-center gap-2 rounded-md border border-dashed border-border-default px-3 py-2 text-left text-sm text-fg-muted outline-none hover:border-border-strong hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
              >
                <ListPlus aria-hidden className="size-4" />
                Add a key result so progress can fill in
              </button>
            ) : null}
            {linked.length ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-fg-muted">Projects:</span>
                {linked.map((project) => (
                  <span key={project.id} className="inline-flex items-center gap-1.5 rounded-full bg-muted py-0.5 pr-2 pl-1 text-xs">
                    <ProgressRing percent={project.progress.percent} size={18} strokeWidth={2.5} showLabel={false} label={`${project.name} progress`} tone={ringTone(project.health)} />
                    <Link href={routes.project(project.key)} className="max-w-48 truncate font-medium text-fg hover:underline">
                      {project.name}
                    </Link>
                    <span className="text-fg-muted tabular-nums">{project.progress.percent}%</span>
                    <ProjectHealthMark project={project} />
                    {canEdit ? (
                      <button type="button" aria-label={`Unlink ${project.name}`} onClick={() => void unlink(project.id)} className="inline-flex size-4 items-center justify-center rounded-full text-icon outline-none hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-focus">
                        <X aria-hidden className="size-3" />
                      </button>
                    ) : null}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {open && children.length ? (
        <ul className="border-t border-border-subtle bg-sunken/30">
          {children.map((child) => (
            <GoalCard key={child.id} goal={child} all={all} projects={projects} canEdit={canEdit} depth={depth + 1} onDialog={onDialog} onSaved={onSaved} onOpen={onOpen} onDelete={onDelete} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function GoalPanel({ goal, all, projects, canEdit, onClose, onDialog }: { readonly goal: GoalDTO; readonly all: readonly GoalDTO[]; readonly projects: ReadonlyMap<string, ProjectSummary>; readonly canEdit: boolean; readonly onClose: () => void; readonly onDialog: (state: DialogState) => void }) {
  const checkIns = useGoalCheckIns(goal.id);
  const people = usePeopleMap();
  const parent = goal.parentGoalId ? all.find((g) => g.id === goal.parentGoalId) : undefined;
  return (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <DrawerContent
        width={520}
        onOpenAutoFocus={(event) => {
          // Focus the panel itself (not the first button) so a tooltip doesn't pop up on open.
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus();
        }}
        title={goal.name}
        description={[goal.period, formatRange(goal.startDate, goal.dueDate)].filter(Boolean).join(' · ') || 'No time frame'}
        actions={
          canEdit ? (
            <>
              <IconButton label="Edit goal" icon={<Pencil aria-hidden />} onClick={() => onDialog({ kind: 'goal', goal })} />
              <Button size="sm" leadingIcon={<MessageSquareText aria-hidden />} onClick={() => onDialog({ kind: 'checkin', goal })}>
                Check in
              </Button>
            </>
          ) : null
        }
      >
        <div className="flex flex-col gap-6 px-6 py-5" data-testid="goal-panel">
          <div className="flex items-center gap-4">
            <ProgressRing percent={goal.progress} size={72} strokeWidth={6} tone={ringTone(goal.health)} label="Goal progress" />
            <div className="flex min-w-0 flex-col items-start gap-1.5">
              <GoalHealthBadge health={goal.health} />
              <p className="text-sm text-fg-secondary">
                Owned by <PersonAvatar userId={goal.ownerId} size="xs" showName className="align-middle" />
              </p>
              <p className="text-xs text-fg-muted">Progress is {MODE_TEXT[goal.progressMode]}.</p>
            </div>
          </div>
          {goal.description ? <p className="text-sm whitespace-pre-wrap text-fg">{goal.description}</p> : null}
          {parent ? (
            <p className="text-sm text-fg-secondary">
              Part of <strong className="font-medium text-fg">{parent.name}</strong> ({parent.progress}%)
            </p>
          ) : null}
          {goal.keyResults.length ? (
            <section>
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-fg-muted uppercase">Key results</h3>
              <ul className="flex flex-col gap-2.5">
                {goal.keyResults.map((kr) => (
                  <li key={kr.id}>
                    <p className="truncate text-sm text-fg">{kr.name}</p>
                    <p className="mt-0.5 text-xs text-fg-muted tabular-nums">
                      {kr.kind === 'project' ? (
                        kr.projectId ? (projects.get(kr.projectId)?.name ?? 'Project') : 'Project'
                      ) : kr.kind === 'boolean' ? (
                        formatKrValue(kr, kr.currentValue)
                      ) : (
                        <KrNumbers {...krValueText(kr)} />
                      )}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <ProgressBar value={kr.progress} size="sm" label={`${kr.name} progress`} className="flex-1" tone={krBarTone(kr.progress, goal.health)} />
                      <Tooltip content={<KrFormula kr={kr} />}>
                        <span tabIndex={0} className="w-9 cursor-help text-right text-xs font-medium text-fg tabular-nums underline decoration-border-strong decoration-dotted underline-offset-2 outline-none focus-visible:outline-2 focus-visible:outline-focus">
                          {kr.progress}%
                        </span>
                      </Tooltip>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section>
            <h3 className="mb-3 text-xs font-semibold tracking-wide text-fg-muted uppercase">Check-ins</h3>
            {checkIns.isPending ? (
              <Skeleton height={64} rounded="md" />
            ) : (checkIns.data ?? []).length === 0 ? (
              <p className="text-sm text-fg-muted">No check-ins yet.</p>
            ) : (
              <ol className="flex flex-col gap-4" data-testid="checkin-history">
                {(checkIns.data ?? []).map((checkIn) => (
                  <li key={checkIn.id} className="flex gap-3">
                    <span aria-hidden className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: GOAL_HEALTH_COLOR[checkIn.health] }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-fg-secondary">
                        <span className="font-semibold text-fg">{checkIn.authorId ? (people.get(checkIn.authorId)?.name ?? 'Former member') : 'Someone'}</span> · {GOAL_HEALTH_LABELS[checkIn.health]} · {checkIn.progress}% ·{' '}
                        <LocalTime iso={checkIn.createdAt} className="text-fg-muted" />
                      </p>
                      {checkIn.note ? <p className="mt-0.5 text-sm whitespace-pre-wrap text-fg">{checkIn.note}</p> : null}
                      {checkIn.keyResults.length ? (
                        <ul className="mt-1 flex flex-col gap-0.5 text-xs text-fg-muted">
                          {checkIn.keyResults.map((kr) => (
                            <li key={kr.id}>
                              {kr.name}: {kr.before} → <strong className="font-semibold text-fg">{kr.after}</strong>
                              {kr.unit ? ` ${kr.unit}` : ''}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

export function GoalsView({ initialGoals, initialProjects }: { readonly initialGoals: GoalDTO[]; readonly initialProjects: ProjectSummary[] }) {
  const { can, user } = useShell();
  const canEdit = can('goal:manage');
  const queryClient = useQueryClient();
  const pathname = usePathname() ?? '/goals';
  const searchParams = useSearchParams();
  const goals = useGoals({ initialData: initialGoals });
  const projects = useProjects({}, { initialData: initialProjects });
  const [dialog, setDialog] = useState<DialogState>(null);
  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState('all');
  const [health, setHealth] = useState<'all' | GoalHealth>('all');
  const [mine, setMine] = useState(false);
  const [openId, setOpenId] = useState<string | null>(searchParams?.get('goal') ?? null);

  const list = useMemo(() => goals.data ?? [], [goals.data]);
  const projectList = useMemo(() => (projects.data ?? []).filter((p) => !p.archivedAt && !p.isTemplate), [projects.data]);
  const projectById = useMemo(() => new Map((projects.data ?? []).map((p) => [p.id, p])), [projects.data]);
  const periods = useMemo(() => [...new Set(list.map((g) => g.period).filter((p): p is string => Boolean(p)))].sort(), [list]);
  const filtersOn = query.trim() !== '' || period !== 'all' || health !== 'all' || mine;
  const matches = (goal: GoalDTO) =>
    (!query.trim() || goal.name.toLowerCase().includes(query.trim().toLowerCase())) && (period === 'all' || goal.period === period) && (health === 'all' || goal.health === health) && (!mine || goal.ownerId === user.id);
  // With filters on, show every matching goal flat; otherwise the tree from the top goals down.
  const roots = filtersOn ? list.filter(matches) : list.filter((g) => !g.parentGoalId);
  const tree = filtersOn ? [] : list;
  const open = openId ? list.find((g) => g.id === openId) : undefined;

  const counts = useMemo(() => {
    const top = list.filter((g) => !g.parentGoalId);
    const average = top.length ? Math.round(top.reduce((sum, g) => sum + g.progress, 0) / top.length) : 0;
    return { total: list.length, average, byHealth: GOAL_HEALTHS.map((h) => ({ health: h, count: list.filter((g) => g.health === h).length })) };
  }, [list]);

  const onSaved = (goal: GoalDTO) => {
    queryClient.setQueryData<GoalDTO[]>(qk.goals(), (old) => (old ? (old.some((g) => g.id === goal.id) ? old.map((g) => (g.id === goal.id ? goal : g)) : [...old, goal]) : old));
    void queryClient.invalidateQueries({ queryKey: qk.goals() });
    void queryClient.invalidateQueries({ queryKey: qk.goalCheckIns(goal.id) });
  };

  const openGoal = (goal: GoalDTO | null) => {
    setOpenId(goal?.id ?? null);
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (goal) params.set('goal', goal.id);
    else params.delete('goal');
    const next = params.toString();
    window.history.replaceState(null, '', next ? `${pathname}?${next}` : pathname);
  };

  const remove = async (goal: GoalDTO) => {
    const result = await deleteGoalAction({ goalId: goal.id });
    if (!result.ok) {
      toast.error("Couldn't delete the goal", result.error.message);
      return;
    }
    if (openId === goal.id) openGoal(null);
    void queryClient.invalidateQueries({ queryKey: qk.goals() });
    toast.undo(`Deleted “${goal.name}”`, {
      onUndo: async () => {
        const undo = await restoreGoalAction({ goalId: goal.id });
        if (!undo.ok) throw new Error(undo.error.message);
        void queryClient.invalidateQueries({ queryKey: qk.goals() });
      },
    });
  };

  return (
    <Page
      title="Goals"
      actions={
        canEdit ? (
          <Button leadingIcon={<Plus aria-hidden />} onClick={() => setDialog({ kind: 'goal', goal: null })} data-testid="new-goal">
            New goal
          </Button>
        ) : null
      }
    >
      {list.length > 0 ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="goal-summary">
            <div className="flex items-center gap-3 rounded-xl border border-border-subtle bg-panel p-4 shadow-xs">
              <ProgressRing percent={counts.average} size={44} strokeWidth={4} label="Average progress of top goals" />
              <div className="min-w-0">
                <p className="text-xs text-fg-muted">Average progress</p>
                <p className="text-sm font-semibold text-fg">{counts.total} {counts.total === 1 ? 'goal' : 'goals'}</p>
              </div>
            </div>
            {(['on_track', 'at_risk', 'off_track'] as const).map((h) => {
              const count = counts.byHealth.find((c) => c.health === h)?.count ?? 0;
              return (
                <button
                  key={h}
                  type="button"
                  aria-pressed={health === h}
                  onClick={() => setHealth(health === h ? 'all' : h)}
                  className={cn(
                    'flex flex-col items-start rounded-xl border bg-panel p-4 text-left shadow-xs outline-none transition-colors focus-visible:outline-2 focus-visible:outline-focus',
                    health === h ? 'border-primary' : 'border-border-subtle hover:border-border-default',
                  )}
                >
                  <span className="flex items-center gap-1.5 text-xs text-fg-muted">
                    <span aria-hidden className="size-2 rounded-full" style={{ background: GOAL_HEALTH_COLOR[h] }} />
                    {GOAL_HEALTH_LABELS[h]}
                  </span>
                  <span className="text-2xl font-semibold text-fg tabular-nums">{count}</span>
                </button>
              );
            })}
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="goal-filters">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a goal" aria-label="Find a goal" leadingIcon={<Search aria-hidden />} containerClassName="w-full sm:w-60" />
            <Select aria-label="Time frame" value={period} onValueChange={setPeriod} options={[{ value: 'all', label: 'Any time frame' }, ...periods.map((p) => ({ value: p, label: p }))]} className="w-[calc(50%-4px)] sm:w-40" />
            <Select aria-label="Health" value={health} onValueChange={(v) => setHealth(v as 'all' | GoalHealth)} options={[{ value: 'all', label: 'Any health' }, ...GOAL_HEALTHS.map((h) => ({ value: h, label: GOAL_HEALTH_LABELS[h] }))]} className="w-[calc(50%-4px)] sm:w-36" />
            <Button variant={mine ? 'secondary' : 'ghost'} aria-pressed={mine} onClick={() => setMine(!mine)}>
              My goals
            </Button>
            {filtersOn ? (
              <Button variant="ghost" onClick={() => { setQuery(''); setPeriod('all'); setHealth('all'); setMine(false); }}>
                Clear filters
              </Button>
            ) : null}
          </div>
        </>
      ) : null}

      {list.length === 0 ? (
        <EmptyState
          visual={<Target aria-hidden className="size-10 text-icon" />}
          title="Set your first goal"
          description="Add a few numbers to track and link the projects behind it."
          actions={canEdit ? <Button leadingIcon={<Plus aria-hidden />} onClick={() => setDialog({ kind: 'goal', goal: null })}>Create a goal</Button> : null}
        />
      ) : roots.length === 0 ? (
        <EmptyState illustration="search" size="sm" title="No goals match" description="Try another search or clear the filters." />
      ) : (
        <ul className="flex flex-col gap-3" data-testid="goals-list">
          {roots.map((goal) => (
            <li key={goal.id} className="overflow-hidden rounded-xl border border-border-subtle bg-panel shadow-xs">
              <ul>
                <GoalCard goal={goal} all={tree} projects={projectById} canEdit={canEdit} depth={0} onDialog={setDialog} onSaved={onSaved} onOpen={openGoal} onDelete={(g) => void remove(g)} />
              </ul>
            </li>
          ))}
        </ul>
      )}

      {open ? <GoalPanel goal={open} all={list} projects={projectById} canEdit={canEdit} onClose={() => openGoal(null)} onDialog={setDialog} /> : null}
      {dialog?.kind === 'goal' ? (
        <GoalDialog key={dialog.goal?.id ?? `new-${dialog.parentId ?? ''}`} goal={dialog.goal} goals={list} projects={projectList} defaultParentId={dialog.parentId} open onOpenChange={(o) => !o && setDialog(null)} onSaved={onSaved} />
      ) : null}
      {dialog?.kind === 'kr' ? (
        <KeyResultDialog key={dialog.keyResult?.id ?? 'new'} goal={dialog.goal} keyResult={dialog.keyResult} projects={projectList} open onOpenChange={(o) => !o && setDialog(null)} onSaved={onSaved} />
      ) : null}
      {dialog?.kind === 'checkin' ? <CheckInDialog key={dialog.goal.id} goal={dialog.goal} open onOpenChange={(o) => !o && setDialog(null)} onSaved={onSaved} /> : null}
    </Page>
  );
}
