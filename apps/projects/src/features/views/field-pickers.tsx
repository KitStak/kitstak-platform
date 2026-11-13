'use client';
/**
 * Inline editors for task fields (status, priority, assignee, due date, labels) used by board
 * cards, list rows, table cells and the bulk bar. Each wraps a trigger element (`children`,
 * rendered asChild) and opens a small popover. Values come from the current project.
 */
import { useState, type ReactElement, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { addDays, nextMonday, startOfToday } from 'date-fns';
import { Button, Calendar, LABEL_COLORS, Popover, PopoverContent, PopoverTrigger, UserPicker, labelColorStyle, toLabelColor, toast } from '@/components/ui';
import { PriorityIcon, StatusIcon } from '@/components/pm';
import { PRIORITIES, PRIORITY_LABELS, type Priority } from '@/lib/constants';
import { parseIsoDate, toIsoDate } from '@/lib/dates';
import { usePeople } from '@/lib/hooks/use-data';
import { qk } from '@/lib/query-keys';
import { createLabelAction } from '@/server/actions/structure';
import { useCurrentProject } from '@/features/projects/project-context';
import { useShell } from '@/features/shell/shell-context';
import { OptionList } from './option-list';

interface PickerBase {
  readonly children: ReactElement;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly align?: 'start' | 'center' | 'end';
  readonly disabled?: boolean;
}

function useControlled(open: boolean | undefined, onOpenChange: ((open: boolean) => void) | undefined) {
  const [inner, setInner] = useState(false);
  return [open ?? inner, (next: boolean) => {
    setInner(next);
    onOpenChange?.(next);
  }] as const;
}

export function StatusPicker({ value, onChange, children, align, disabled, ...rest }: PickerBase & { readonly value: string | null; readonly onChange: (statusId: string) => void }) {
  const { statuses } = useCurrentProject();
  const [open, setOpen] = useControlled(rest.open, rest.onOpenChange);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        {children}
      </PopoverTrigger>
      <PopoverContent flush align={align} className="w-60">
        <OptionList
          multiple={false}
          searchable={statuses.length > 6}
          placeholder="Change status…"
          options={statuses.map((status) => ({ value: status.id, label: status.name, icon: <StatusIcon category={status.category} color={status.color} /> }))}
          selected={value ? [value] : []}
          onToggle={(id) => {
            setOpen(false);
            if (id !== value) onChange(id);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function PriorityPicker({ value, onChange, children, align, disabled, ...rest }: PickerBase & { readonly value: Priority | null; readonly onChange: (priority: Priority) => void }) {
  const [open, setOpen] = useControlled(rest.open, rest.onOpenChange);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        {children}
      </PopoverTrigger>
      <PopoverContent flush align={align} className="w-52">
        <OptionList
          multiple={false}
          searchable={false}
          options={PRIORITIES.map((priority) => ({ value: priority, label: PRIORITY_LABELS[priority], icon: <PriorityIcon priority={priority} /> }))}
          selected={value ? [value] : []}
          onToggle={(next) => {
            setOpen(false);
            if (next !== value) onChange(next as Priority);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function AssigneePicker({ value, onChange, children, align, disabled, ...rest }: PickerBase & { readonly value: string | null; readonly onChange: (userId: string | null) => void }) {
  const people = usePeople();
  const { user } = useShell();
  return (
    <UserPicker
      people={people.data ?? []}
      meId={user.id}
      value={value}
      onChange={(next) => {
        if (next !== value) onChange(next);
      }}
      trigger={children}
      align={align}
      disabled={disabled}
      open={rest.open}
      onOpenChange={rest.onOpenChange}
    />
  );
}

const QUICK_DATES: readonly { label: string; date: () => Date }[] = [
  { label: 'Today', date: () => startOfToday() },
  { label: 'Tomorrow', date: () => addDays(startOfToday(), 1) },
  { label: 'Next week', date: () => nextMonday(startOfToday()) },
  { label: 'In 2 weeks', date: () => addDays(startOfToday(), 14) },
];

export function DuePicker({
  value,
  onChange,
  children,
  align,
  disabled,
  title = 'Due date',
  shade,
  ...rest
}: PickerBase & {
  readonly value: string | null;
  readonly onChange: (date: string | null) => void;
  readonly title?: string;
  /**
   * Days that also move the task's other date (a due date before the start date): shaded in the
   * grid, quick picks show `hint` ("Moves start too") and `note` explains it under the grid.
   */
  readonly shade?: { readonly before?: string | null; readonly after?: string | null; readonly hint: string; readonly note: string };
}) {
  const [open, setOpen] = useControlled(rest.open, rest.onOpenChange);
  const choose = (date: Date | null) => {
    setOpen(false);
    const iso = date ? toIsoDate(date) : null;
    if (iso !== value) onChange(iso);
  };
  const shaded = (iso: string) => Boolean(shade && ((shade.before && iso < shade.before) || (shade.after && iso > shade.after)));
  const shadeMatchers = shade
    ? [
        ...(shade.before ? [{ before: parseIsoDate(shade.before) }] : []),
        ...(shade.after ? [{ after: parseIsoDate(shade.after) }] : []),
      ]
    : [];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        {children}
      </PopoverTrigger>
      <PopoverContent flush align={align} className="flex max-sm:flex-col" onClick={(event) => event.stopPropagation()} aria-label={title}>
        <div className={`flex ${shadeMatchers.length ? 'w-36' : 'w-32'} flex-col gap-0.5 border-r border-border-subtle p-2 max-sm:w-full max-sm:flex-row max-sm:flex-wrap max-sm:border-r-0 max-sm:border-b`}>
          {QUICK_DATES.map((pick) => {
            const moves = shaded(toIsoDate(pick.date()));
            return (
              <Button
                key={pick.label}
                variant="ghost"
                size="sm"
                className={moves ? 'h-auto min-h-7 justify-start py-1 text-left' : 'justify-start'}
                onClick={() => choose(pick.date())}
                data-moves-other={moves ? '' : undefined}
              >
                {moves && shade ? (
                  <span className="flex flex-col items-start">
                    <span>{pick.label}</span>
                    <span className="text-2xs font-normal text-fg-muted">{shade.hint}</span>
                  </span>
                ) : (
                  pick.label
                )}
              </Button>
            );
          })}
          {value ? (
            <Button variant="danger-ghost" size="sm" className="mt-auto justify-start" onClick={() => choose(null)}>
              Remove date
            </Button>
          ) : null}
        </div>
        <div className="p-3">
          <Calendar
            selected={value ? parseIsoDate(value) : undefined}
            onSelect={(date) => choose(date ?? null)}
            modifiers={shadeMatchers.length ? { movesOther: shadeMatchers } : undefined}
            modifiersClassNames={{ movesOther: 'ks-moves-other [&>button]:bg-sunken/70 [&>button]:text-fg-muted' }}
            footer={
              shadeMatchers.length && shade ? (
                <p className="mt-2 flex max-w-[252px] items-center gap-1.5 text-xs text-fg-muted">
                  <span aria-hidden className="inline-block size-3 shrink-0 rounded-xs bg-sunken ring-1 ring-border-subtle" />
                  {shade.note}
                </p>
              ) : undefined
            }
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Small round swatch in a label's palette color. */
export function LabelDot({ color, className }: { readonly color: string; readonly className?: string }) {
  return <span aria-hidden style={labelColorStyle(toLabelColor(color))} className={`inline-block size-2.5 shrink-0 rounded-full bg-[var(--lc-bg)] ${className ?? ''}`} />;
}

export function LabelsPicker({
  value,
  onChange,
  children,
  align,
  disabled,
  heading,
  ...rest
}: PickerBase & { readonly value: readonly string[]; readonly onChange: (labelIds: string[]) => void; readonly heading?: ReactNode }) {
  const { project, capabilities } = useCurrentProject();
  const queryClient = useQueryClient();
  const [open, setOpen] = useControlled(rest.open, rest.onOpenChange);
  const create = async (name: string) => {
    const color = LABEL_COLORS[project.labels.length % LABEL_COLORS.length];
    const result = await createLabelAction({ projectId: project.id, name, color });
    if (!result.ok) {
      toast.error("Couldn't create that label", result.error.message);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: qk.project(project.key) });
    onChange([...value, result.data.id]);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        {children}
      </PopoverTrigger>
      <PopoverContent flush align={align} className="w-64">
        <OptionList
          heading={heading}
          placeholder={capabilities['structure:manage'] ? 'Find or create a label…' : 'Find a label…'}
          emptyText={capabilities['structure:manage'] ? 'Type a name to create a label' : 'No labels match'}
          options={project.labels.map((label) => ({ value: label.id, label: label.name, icon: <LabelDot color={label.color} /> }))}
          selected={value}
          onToggle={(id) => onChange(value.includes(id) ? value.filter((entry) => entry !== id) : [...value, id])}
          onCreate={capabilities['structure:manage'] ? (text) => void create(text) : undefined}
          createLabel={(text) => `Create label “${text}”`}
        />
      </PopoverContent>
    </Popover>
  );
}
