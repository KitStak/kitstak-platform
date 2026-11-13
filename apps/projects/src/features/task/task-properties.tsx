'use client';
/**
 * Task properties panel: status, assignee, reporter, priority, start/due dates, estimate,
 * labels, milestone and every custom field. Each value is a ghost button that opens the same
 * pickers the board/list/table use; edits are optimistic through the task context.
 */
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  CalendarDays,
  CircleDashed,
  CircleUserRound,
  Diamond,
  Gauge,
  Plus,
  CircleChevronDown,
  CircleDollarSign,
  Hash,
  Link as LinkIcon,
  ListChecks,
  SquareCheckBig,
  Type,
  UserRound,
  Signal,
  Tag,
  UserRoundPen,
  UserPlus,
} from 'lucide-react';
import { Button, Popover, PopoverContent, PopoverTrigger, Tooltip, toast } from '@/components/ui';
import { DueDate, LabelPill, PersonAvatar, PriorityIcon, StatusIcon } from '@/components/pm';
import { CUSTOM_FIELD_TYPE_LABELS, PRIORITY_LABELS, type CustomFieldType } from '@/lib/constants';
import { formatDue, formatMinutes } from '@/lib/dates';
import { setDateWithUndo } from './task-keys';
import { usePeopleMap } from '@/lib/hooks/use-people';
import { qk } from '@/lib/query-keys';
import type { TaskDetail } from '@/lib/types';
import { setTaskLabelsAction } from '@/server/actions/tasks';
import {
  AssigneePicker,
  DuePicker,
  LabelsPicker,
  PriorityPicker,
  StatusPicker,
} from '@/features/views/field-pickers';
import { OptionList } from '@/features/views/option-list';
import { useShell } from '@/features/shell/shell-context';
import { CustomFieldEditor } from './custom-field-editor';
import { PROPERTY_TRIGGER, PropertyRow } from './property-row';
import { useTaskContext } from './task-context';
import { datePatch, parseDuration } from './task-utils';
import { LocalTime } from './local-time';

const EMPTY = 'text-fg-muted';

function FieldTypeIcon({ type }: { readonly type: CustomFieldType }) {
  switch (type) {
    case 'number':
      return <Hash aria-hidden />;
    case 'currency':
      return <CircleDollarSign aria-hidden />;
    case 'select':
      return <CircleChevronDown aria-hidden />;
    case 'multiselect':
      return <ListChecks aria-hidden />;
    case 'date':
      return <CalendarDays aria-hidden />;
    case 'person':
      return <UserRound aria-hidden />;
    case 'checkbox':
      return <SquareCheckBig aria-hidden />;
    case 'url':
      return <LinkIcon aria-hidden />;
    default:
      return <Type aria-hidden />;
  }
}

const POINTS_HELP = 'Type a number of points like 3, or a time like 2h in the box below.';

function EstimateEditor() {
  const { task, canEdit, patch } = useTaskContext();
  const [open, setOpen] = useState(false);
  const [points, setPoints] = useState('');
  const [time, setTime] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const timeRef = useRef<HTMLInputElement>(null);
  const parts = [
    task.estimatePoints !== null
      ? `${task.estimatePoints} ${task.estimatePoints === 1 ? 'point' : 'points'}`
      : null,
    task.estimateMinutes !== null ? formatMinutes(task.estimateMinutes) : null,
  ].filter(Boolean);

  const save = async () => {
    const rawPoints = points.trim();
    // Only a plain whole number counts: "QZGL-1" or "3 pts?" is not quietly read as a number.
    if (rawPoints !== '' && !/^\d+$/.test(rawPoints)) {
      setError(POINTS_HELP);
      return;
    }
    const nextPoints = rawPoints === '' ? null : Number(rawPoints);
    if (nextPoints !== null && nextPoints > 1000) {
      setError('Points must be a whole number from 0 to 1000.');
      return;
    }
    const nextMinutes = time.trim() === '' ? null : parseDuration(time);
    if (time.trim() !== '' && nextMinutes === null) {
      setError('Try a time like 45m, 2h or 1h 30m.');
      return;
    }
    setOpen(false);
    const changes: { estimatePoints?: number | null; estimateMinutes?: number | null } = {};
    if (nextPoints !== task.estimatePoints) changes.estimatePoints = nextPoints;
    if (nextMinutes !== task.estimateMinutes) changes.estimateMinutes = nextMinutes;
    if (Object.keys(changes).length) await patch(changes);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setPoints(task.estimatePoints === null ? '' : String(task.estimatePoints));
          setTime(task.estimateMinutes === null ? '' : formatMinutes(task.estimateMinutes));
          setError(null);
          setHint(null);
        }
      }}
    >
      <PopoverTrigger asChild disabled={!canEdit}>
        <button type="button" className={PROPERTY_TRIGGER} disabled={!canEdit} data-task-estimate-trigger="">
          {parts.length ? (
            <span className="truncate tabular-nums">{parts.join(' · ')}</span>
          ) : (
            <span className={EMPTY}>Add estimate</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72" aria-label="Estimate">
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="task-estimate-points" className="text-xs font-semibold text-fg-secondary">
              Story points
            </label>
            <input
              id="task-estimate-points"
              autoFocus
              onFocus={(event) => event.currentTarget.select()}
              inputMode="numeric"
              value={points}
              onChange={(event) => {
                const raw = event.target.value;
                setError(null);
                setHint(null);
                if (/^\s*\d+(\.\d+)?\s*(h|m|:)/i.test(raw)) {
                  // "2h" is a time, not 2 points: move it to the time box and keep typing there.
                  setPoints(task.estimatePoints === null ? '' : String(task.estimatePoints));
                  setTime(raw.trim());
                  setHint(`Moved “${raw.trim()}” to Time it should take.`);
                  requestAnimationFrame(() => {
                    const input = timeRef.current;
                    if (!input) return;
                    input.focus();
                    input.setSelectionRange(input.value.length, input.value.length);
                  });
                  return;
                }
                // Keep what was typed (no silent digit picking) and say why it can't be saved.
                if (raw.trim() !== '' && !/^\s*\d+\s*$/.test(raw)) setError(POINTS_HELP);
                setPoints(raw);
              }}
              aria-invalid={error ? true : undefined}
              placeholder="e.g. 3"
              className="h-8 rounded-sm border border-border-input bg-panel px-2.5 text-sm text-fg outline-none placeholder:text-fg-placeholder focus:border-primary focus:shadow-[0_0_0_3px_var(--focus-ring-soft)]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="task-estimate-time" className="text-xs font-semibold text-fg-secondary">
              Time it should take
            </label>
            <input
              id="task-estimate-time"
              ref={timeRef}
              value={time}
              onChange={(event) => {
                setTime(event.target.value);
                setError(null);
              }}
              placeholder="e.g. 2h 30m"
              className="h-8 rounded-sm border border-border-input bg-panel px-2.5 text-sm text-fg outline-none placeholder:text-fg-placeholder focus:border-primary focus:shadow-[0_0_0_3px_var(--focus-ring-soft)]"
            />
          </div>
          {error ? (
            <p role="alert" className="text-xs text-danger-text">
              {error}
            </p>
          ) : (
            <p className="text-xs text-fg-muted" aria-live="polite">{hint ?? 'Leave a box empty to clear it.'}</p>
          )}
          <div className="flex justify-end gap-1.5">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm">
              Save
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function LabelsRow() {
  const { task, taskRef, project, canEdit, refresh } = useTaskContext();
  const queryClient = useQueryClient();
  const labels = task.labelIds
    .map((id) => project.labels.find((label) => label.id === id))
    .filter((label) => label !== undefined);

  const setLabels = async (labelIds: string[]) => {
    const key = qk.task(taskRef);
    const before = queryClient.getQueryData<TaskDetail>(key);
    if (before) queryClient.setQueryData<TaskDetail>(key, { ...before, labelIds });
    const result = await setTaskLabelsAction({ taskId: task.id, labelIds });
    if (!result.ok) {
      if (before) queryClient.setQueryData(key, before);
      toast.error("Couldn't change the labels", result.error.message);
      return;
    }
    refresh();
  };

  return (
    <LabelsPicker
      value={task.labelIds}
      onChange={(next) => void setLabels(next)}
      disabled={!canEdit}
      align="start"
    >
      <button
        type="button"
        className={`${PROPERTY_TRIGGER} h-auto min-h-8 flex-wrap py-1`}
        disabled={!canEdit}
        aria-label={labels.length ? `Labels: ${labels.map((l) => l.name).join(', ')}` : 'Add labels'}
      >
        {labels.length ? (
          labels.map((label) => <LabelPill key={label.id} name={label.name} color={label.color} />)
        ) : (
          <span className={EMPTY}>Add labels</span>
        )}
        {labels.length && canEdit ? <Plus aria-hidden className="size-3.5 text-icon" /> : null}
      </button>
    </LabelsPicker>
  );
}

function MilestoneRow() {
  const { task, project, canEdit, patch } = useTaskContext();
  const [open, setOpen] = useState(false);
  const milestone = project.milestones.find((entry) => entry.id === task.milestoneId);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={!canEdit}>
        <button type="button" className={PROPERTY_TRIGGER} disabled={!canEdit}>
          {milestone ? (
            <>
              <Diamond aria-hidden className="size-3.5 shrink-0 text-primary-text" />
              <span className="truncate">{milestone.name}</span>
              {milestone.dueDate ? (
                <span className="shrink-0 text-xs text-fg-muted">{formatDue(milestone.dueDate)}</span>
              ) : null}
            </>
          ) : (
            <span className={EMPTY}>No milestone</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent flush align="start" className="w-64">
        <OptionList
          multiple={false}
          searchable={project.milestones.length > 6}
          options={project.milestones.map((entry) => ({
            value: entry.id,
            label: entry.name,
            icon: <Diamond aria-hidden className="size-3.5 text-icon" />,
            hint: entry.dueDate ? formatDue(entry.dueDate) : undefined,
          }))}
          selected={task.milestoneId ? [task.milestoneId] : []}
          onToggle={(id) => {
            setOpen(false);
            void patch({ milestoneId: id === task.milestoneId ? null : id });
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function TaskProperties({ compact = false }: { readonly compact?: boolean }) {
  const { task, project, statusById, canEdit, patch } = useTaskContext();
  const { user } = useShell();
  const peopleMap = usePeopleMap();
  const status = statusById.get(task.statusId);
  const done = task.statusCategory === 'done' || task.statusCategory === 'cancelled';
  const datesBackwards = Boolean(task.startDate && task.dueDate && task.startDate > task.dueDate);
  /** Never saves backwards dates: the other date moves along, and the toast says so with Undo. */
  const changeDate = (field: 'startDate' | 'dueDate', value: string | null) => {
    const { patch: next, moved } = datePatch(task, field, value);
    if (moved) void setDateWithUndo({ task, field, value, save: patch });
    else void patch(next);
  };
  const creator = task.createdBy ? peopleMap.get(task.createdBy) : undefined;

  return (
    <div
      className={compact ? 'grid grid-cols-1 gap-x-6 @min-[640px]:grid-cols-2' : 'flex flex-col'}
      data-testid="task-properties"
    >
      <PropertyRow icon={<CircleDashed aria-hidden />} label="Status">
        <StatusPicker
          value={task.statusId}
          onChange={(statusId) => void patch({ statusId })}
          disabled={!canEdit}
          align="start"
        >
          <button
            type="button"
            className={PROPERTY_TRIGGER}
            disabled={!canEdit}
            data-testid="task-status-trigger"
          >
            <StatusIcon category={task.statusCategory} color={status?.color} />
            <span className="truncate font-medium">{status?.name ?? 'Unknown'}</span>
          </button>
        </StatusPicker>
      </PropertyRow>

      <PropertyRow icon={<CircleUserRound aria-hidden />} label="Assignee">
        {/* One line in every layout: the narrow page sidebar gets an icon button instead of the words. */}
        <div className="@container flex min-w-0 flex-1 flex-nowrap items-center">
          <AssigneePicker
            value={task.assigneeId}
            onChange={(assigneeId) => void patch({ assigneeId })}
            disabled={!canEdit}
            align="start"
          >
            <button
              type="button"
              className={PROPERTY_TRIGGER}
              disabled={!canEdit}
              data-testid="task-assignee-trigger"
            >
              {task.assigneeId ? (
                <PersonAvatar userId={task.assigneeId} size="xs" showName />
              ) : (
                <span className={EMPTY}>No one yet</span>
              )}
            </button>
          </AssigneePicker>
          {!task.assigneeId && canEdit ? (
            <Tooltip content="Assign to me">
              <button
                type="button"
                onClick={() => void patch({ assigneeId: user.id })}
                aria-label="Assign to me"
                data-testid="task-assign-me"
                className="ml-1 inline-flex h-7 shrink-0 items-center gap-1 rounded-sm px-1.5 text-xs font-medium whitespace-nowrap text-fg-link hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"
              >
                <UserPlus aria-hidden className="size-4 @min-[13rem]:hidden" />
                <span className="hidden @min-[13rem]:inline">Assign to me</span>
              </button>
            </Tooltip>
          ) : null}
        </div>
      </PropertyRow>

      <PropertyRow icon={<UserRoundPen aria-hidden />} label="Reporter">
        <AssigneePicker
          value={task.reporterId}
          onChange={(reporterId) => void patch({ reporterId })}
          disabled={!canEdit}
          align="start"
        >
          <button type="button" className={PROPERTY_TRIGGER} disabled={!canEdit}>
            {task.reporterId ? (
              <PersonAvatar userId={task.reporterId} size="xs" showName />
            ) : (
              <span className={EMPTY}>Not set</span>
            )}
          </button>
        </AssigneePicker>
      </PropertyRow>

      <PropertyRow icon={<Signal aria-hidden />} label="Priority">
        <PriorityPicker
          value={task.priority}
          onChange={(priority) => void patch({ priority })}
          disabled={!canEdit}
          align="start"
        >
          <button type="button" className={PROPERTY_TRIGGER} disabled={!canEdit}>
            <PriorityIcon priority={task.priority} />
            <span className={task.priority === 'none' ? EMPTY : 'truncate'}>
              {PRIORITY_LABELS[task.priority]}
            </span>
          </button>
        </PriorityPicker>
      </PropertyRow>

      <PropertyRow icon={<CalendarClock aria-hidden />} label="Start date">
        <DuePicker
          value={task.startDate}
          onChange={(startDate) => changeDate('startDate', startDate)}
          disabled={!canEdit}
          align="start"
          title="Start date"
        >
          <button type="button" className={PROPERTY_TRIGGER} disabled={!canEdit}>
            {task.startDate ? (
              <span className="tabular-nums">{formatDue(task.startDate)}</span>
            ) : (
              <span className={EMPTY}>No start date</span>
            )}
          </button>
        </DuePicker>
      </PropertyRow>

      <PropertyRow icon={<CalendarDays aria-hidden />} label="Due date">
        <DuePicker
          value={task.dueDate}
          onChange={(dueDate) => changeDate('dueDate', dueDate)}
          disabled={!canEdit}
          align="start"
        >
          <button
            type="button"
            className={PROPERTY_TRIGGER}
            disabled={!canEdit}
            data-testid="task-due-trigger"
          >
            {task.dueDate ? (
              <DueDate date={task.dueDate} done={done} className="text-sm" />
            ) : (
              <span className={EMPTY}>No due date</span>
            )}
          </button>
        </DuePicker>
        {datesBackwards ? (
          <Tooltip content="The start date is after the due date.">
            <span className="ml-1 shrink-0 rounded-sm bg-warning-subtle px-1.5 py-0.5 text-2xs font-medium text-warning-text">
              Check dates
            </span>
          </Tooltip>
        ) : null}
      </PropertyRow>

      <PropertyRow icon={<Gauge aria-hidden />} label="Estimate">
        <EstimateEditor />
      </PropertyRow>

      <PropertyRow
        icon={<Tag aria-hidden />}
        label="Labels"
        className={compact ? '@min-[640px]:col-span-2' : undefined}
      >
        <LabelsRow />
      </PropertyRow>

      {project.milestones.length ? (
        <PropertyRow icon={<Diamond aria-hidden />} label="Milestone">
          <MilestoneRow />
        </PropertyRow>
      ) : null}

      {project.customFields.map((field) => (
        <PropertyRow key={field.id} icon={<FieldTypeIcon type={field.type} />} label={field.name}>
          <Tooltip
            content={field.description ?? CUSTOM_FIELD_TYPE_LABELS[field.type]}
            side="left"
            disabled={!field.description}
          >
            <div className="min-w-0 flex-1">
              <CustomFieldEditor
                field={field}
                value={task.customFields[field.id]}
                disabled={!canEdit}
                onChange={(value) =>
                  void patch({
                    customFields: { [field.id]: value === undefined ? null : value } as Record<
                      string,
                      unknown
                    >,
                  })
                }
              />
            </div>
          </Tooltip>
        </PropertyRow>
      ))}

      <p className={`mt-2 px-0.5 text-xs text-fg-muted ${compact ? '@min-[640px]:col-span-2' : ''}`}>
        Created {creator ? `by ${creator.name} ` : ''}
        <LocalTime iso={task.createdAt} />
        {' · '}Updated <LocalTime iso={task.updatedAt} />
      </p>
    </div>
  );
}
