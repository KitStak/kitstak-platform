'use client';
/** Picker bodies for each token kind (rendered inside the token chip's popover). */
import { useMemo, useRef, useState } from 'react';
import { CornerDownLeft, UserRound, Users } from 'lucide-react';
import { Avatar, Button, Input, Kbd, Select, StatusPill, cn, toLabelColor } from '@/components/ui';
import { useBoards } from '@/lib/hooks';
import { useTargetGroups } from '../api';
import type { ClauseDef } from '../model/clauses';
import type { ClauseDraft } from '../model/draft';
import { columnLabels, type BuilderContext } from '../model/resolver';
import {
  ANY,
  columnTypeMatches,
  describeRelativeDays,
  isPeopleValue,
  OPERATORS,
  type PeopleValue,
  type TokenSpec,
  type TokenValue,
} from '../model/tokens';
import { templateVarLabel } from '../model/template';
import { ColumnTypeIcon } from './icons';
import { TemplateEditor, type TemplateEditorHandle } from './template-editor';
import { PickerList, type PickerOption } from './picker-list';

export interface TokenPickerProps {
  readonly def: ClauseDef;
  readonly clause: ClauseDraft;
  readonly token: string;
  readonly spec: TokenSpec;
  readonly value: TokenValue | undefined;
  readonly context: BuilderContext;
  /** Commit a value; `close` closes the popover and advances to the next unset token. */
  readonly onCommit: (value: TokenValue, close?: boolean) => void;
}

function Hint({ children }: { readonly children: React.ReactNode }) {
  return <p className="w-[min(320px,calc(100vw-32px))] px-4 py-5 text-sm text-fg-secondary">{children}</p>;
}

export function TokenPicker(props: TokenPickerProps) {
  const { spec } = props;
  switch (spec.kind) {
    case 'column':
      return <ColumnPicker {...props} spec={spec} />;
    case 'label':
    case 'labels':
      return <LabelPicker {...props} spec={spec} />;
    case 'group':
      return <GroupPicker {...props} />;
    case 'people':
      return <PeoplePicker {...props} spec={spec} />;
    case 'user':
      return <UserPicker {...props} spec={spec} />;
    case 'text':
      return <TextPicker {...props} spec={spec} />;
    case 'relativeDays':
      return <DaysPicker {...props} spec={spec} />;
    case 'number':
      return <NumberPicker {...props} />;
    case 'operator':
      return (
        <PickerList
          label="Comparison"
          options={OPERATORS.map((operator) => ({ value: operator.value, label: operator.label }))}
          selected={typeof props.value === 'string' ? [props.value] : []}
          onSelect={(value) => props.onCommit(value, true)}
        />
      );
    case 'board':
      return <BoardPicker {...props} />;
    case 'targetGroup':
      return <TargetGroupPicker {...props} spec={spec} />;
    default:
      return null;
  }
}

function ColumnPicker({
  spec,
  value,
  context,
  onCommit,
}: TokenPickerProps & { spec: Extract<TokenSpec, { kind: 'column' }> }) {
  const options: PickerOption[] = context.columns
    .filter((column) => columnTypeMatches(spec, column.type))
    .map((column) => ({
      value: column.key,
      label: column.title,
      icon: <ColumnTypeIcon type={column.type} />,
      description: column.hidden ? 'Hidden column' : undefined,
    }));
  if (options.length === 0) {
    const kind = spec.types === 'editable' ? 'editable' : spec.types.join(' or ');
    return (
      <Hint>
        This board has no {kind} column yet. Add one from the board’s “+” column menu, then come back.
      </Hint>
    );
  }
  return (
    <PickerList
      label="Columns"
      searchPlaceholder="Search columns"
      options={options}
      selected={typeof value === 'string' ? [value] : []}
      onSelect={(key) => onCommit(key, true)}
    />
  );
}

function LabelPicker({
  spec,
  clause,
  value,
  context,
  onCommit,
}: TokenPickerProps & { spec: Extract<TokenSpec, { kind: 'label' | 'labels' }> }) {
  const columnKey = clause.values[spec.columnToken];
  const column = context.columns.find((entry) => entry.key === columnKey);
  const labels = columnLabels(column);
  const multiple = spec.kind === 'labels';
  const selected = multiple
    ? Array.isArray(value)
      ? (value as readonly string[])
      : []
    : typeof value === 'string'
      ? [value]
      : [];
  if (!column) return <Hint>Choose the status column first, then pick its label.</Hint>;
  const options: PickerOption[] = [
    ...(spec.kind === 'label' && spec.anyLabel
      ? [
          {
            value: ANY,
            label: spec.anyLabel,
            render: <span className="font-medium">Any label ({spec.anyLabel})</span>,
          },
        ]
      : []),
    ...labels.map((label) => ({
      value: label.id,
      label: label.name,
      keywords: [label.color],
      render: (
        <StatusPill
          label={label.name}
          color={toLabelColor(label.color)}
          className="h-6 w-full max-w-48 justify-center"
        />
      ),
    })),
  ];
  return (
    <PickerList
      label={`${column.title} labels`}
      searchPlaceholder="Search labels"
      options={options}
      multiple={multiple}
      selected={selected}
      onSelect={(id) => {
        if (!multiple) return onCommit(id, true);
        const next = selected.includes(id) ? selected.filter((entry) => entry !== id) : [...selected, id];
        onCommit(next, false);
      }}
      footer={
        multiple ? (
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-fg-secondary">{selected.length} selected</span>
            <Button size="sm" onClick={() => onCommit(selected, true)} disabled={selected.length === 0}>
              Done
            </Button>
          </div>
        ) : undefined
      }
    />
  );
}

function GroupPicker({ value, context, onCommit }: TokenPickerProps) {
  return (
    <PickerList
      label="Groups"
      searchPlaceholder="Search groups"
      emptyMessage="This board has no groups"
      options={context.groups
        .filter((group) => !group.archivedAt)
        .map((group) => ({
          value: group.id,
          label: group.title,
          icon: (
            <span
              className="block size-3 rounded-full"
              style={{ background: `var(--label-${toLabelColor(group.color, 'blue')})` }}
            />
          ),
        }))}
      selected={typeof value === 'string' ? [value] : []}
      onSelect={(id) => onCommit(id, true)}
    />
  );
}

function PeoplePicker({
  spec,
  value,
  context,
  onCommit,
}: TokenPickerProps & { spec: Extract<TokenSpec, { kind: 'people' }> }) {
  const current: PeopleValue = isPeopleValue(value) ? value : { userIds: [], columnKey: null, actor: false };
  const peopleColumns = context.columns.filter((column) => column.type === 'people');
  const options: PickerOption[] = [
    ...(spec.allowActor
      ? [
          {
            value: 'actor',
            label: 'Whoever triggered it',
            icon: <UserRound />,
            section: 'Dynamic',
            description: 'Whoever made the change',
          },
        ]
      : []),
    ...(spec.allowColumn
      ? peopleColumns.map((column) => ({
          value: `column:${column.key}`,
          label: `People in ${column.title}`,
          icon: <Users />,
          section: 'Dynamic',
          description: 'Everyone assigned in this column',
        }))
      : []),
    ...context.users.map((user) => ({
      value: `user:${user.id}`,
      label: user.name,
      keywords: [user.email],
      description: user.title ?? user.email,
      section: 'Members',
      icon: <Avatar name={user.name} src={user.image} size="xs" colorKey={user.id} />,
    })),
  ];
  const selected = [
    ...(current.actor ? ['actor'] : []),
    ...(current.columnKey ? [`column:${current.columnKey}`] : []),
    ...current.userIds.map((id) => `user:${id}`),
  ];
  const toggle = (option: string): PeopleValue => {
    if (option === 'actor') return { ...current, actor: !current.actor };
    if (option.startsWith('column:')) {
      const key = option.slice(7);
      return { ...current, columnKey: current.columnKey === key ? null : key };
    }
    const id = option.slice(5);
    return {
      ...current,
      userIds: current.userIds.includes(id)
        ? current.userIds.filter((entry) => entry !== id)
        : [...current.userIds, id],
    };
  };
  const count = selected.length;
  return (
    <PickerList
      label="People"
      searchPlaceholder="Search people"
      options={options}
      multiple
      selected={selected}
      onSelect={(option) => onCommit(toggle(option), false)}
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-fg-secondary">
            {count === 0 ? 'Pick at least one' : `${count} selected`}
          </span>
          <Button size="sm" onClick={() => onCommit(current, true)} disabled={count === 0}>
            Done
          </Button>
        </div>
      }
    />
  );
}

function UserPicker({
  spec,
  value,
  context,
  onCommit,
}: TokenPickerProps & { spec: Extract<TokenSpec, { kind: 'user' }> }) {
  return (
    <PickerList
      label="People"
      searchPlaceholder="Search people"
      options={[
        ...(spec.anyLabel ? [{ value: ANY, label: `Anyone (${spec.anyLabel})`, icon: <Users /> }] : []),
        ...context.users.map((user) => ({
          value: user.id,
          label: user.name,
          keywords: [user.email],
          description: user.title ?? user.email,
          icon: <Avatar name={user.name} src={user.image} size="xs" colorKey={user.id} />,
        })),
      ]}
      selected={typeof value === 'string' ? [value] : []}
      onSelect={(id) => onCommit(id, true)}
    />
  );
}

const DYNAMIC_VALUES = ['name', 'board'] as const;

function TextPicker({
  spec,
  value,
  context,
  onCommit,
}: TokenPickerProps & { spec: Extract<TokenSpec, { kind: 'text' }> }) {
  const [text, setText] = useState(typeof value === 'string' ? value : '');
  const ref = useRef<TemplateEditorHandle>(null);
  const trimmed = text.trim();
  const tooLong = text.length > spec.maxLength;
  const save = () => {
    if (trimmed && !tooLong) onCommit(trimmed, true);
  };
  return (
    <div className="flex w-[min(360px,calc(100vw-32px))] flex-col gap-3 p-3">
      <TemplateEditor
        ref={ref}
        initialValue={typeof value === 'string' ? value : ''}
        term={context.term}
        maxLength={spec.maxLength}
        aria-label="Message"
        placeholder="Write the message…"
        onChange={setText}
        onSubmit={save}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-fg-secondary">Insert:</span>
        {DYNAMIC_VALUES.map((entry) => (
          <button
            key={entry}
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => ref.current?.insertVar(entry)}
            className="inline-flex h-6 items-center rounded-sm border border-border-subtle bg-primary-subtle px-2 text-xs font-medium text-primary-text transition-colors duration-[var(--duration-fast)] hover:border-primary hover:bg-primary-selected focus-visible:outline-2 focus-visible:outline-focus active:bg-primary-selected-hover"
          >
            + {templateVarLabel(entry, context.term)}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className={cn('text-xs tabular-nums', tooLong ? 'text-danger-text' : 'text-fg-muted')}>
          {text.length}/{spec.maxLength}
        </span>
        <span className="flex items-center gap-2">
          <span className="hidden items-center gap-1 text-xs text-fg-muted sm:flex">
            <Kbd>Ctrl</Kbd>
            <Kbd>
              <CornerDownLeft className="size-3" aria-label="Enter" />
            </Kbd>
          </span>
          <Button size="sm" onClick={save} disabled={!trimmed || tooLong}>
            Save
          </Button>
        </span>
      </div>
    </div>
  );
}

const TRIGGER_PRESETS = [0, -1, -3, -7, 1] as const;
const ACTION_PRESETS = [0, 1, 7, 30] as const;

function DaysPicker({
  spec,
  value,
  onCommit,
}: TokenPickerProps & { spec: Extract<TokenSpec, { kind: 'relativeDays' }> }) {
  const current = typeof value === 'number' ? value : 0;
  const [amount, setAmount] = useState(String(Math.abs(current) || 2));
  const before = spec.style === 'trigger' ? 'before' : 'ago';
  const after = spec.style === 'trigger' ? 'after' : 'from today';
  const [direction, setDirection] = useState<'before' | 'after'>(
    current < 0 ? 'before' : spec.style === 'trigger' && current === 0 ? 'before' : 'after',
  );
  const presets = spec.style === 'trigger' ? TRIGGER_PRESETS : ACTION_PRESETS;
  const parsed = Number.parseInt(amount, 10);
  const valid = Number.isFinite(parsed) && parsed >= 0 && parsed <= 365;
  const custom = valid ? (direction === 'before' ? -parsed : parsed) : null;
  return (
    <div className="w-[min(300px,calc(100vw-32px))]">
      <PickerList
        label="When"
        options={presets.map((days) => ({
          value: String(days),
          label: describeRelativeDays(days, spec.style),
        }))}
        selected={[String(current)]}
        onSelect={(days) => onCommit(Number(days), true)}
      />
      <form
        className="flex items-center gap-2 border-t border-border-subtle p-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (custom !== null) onCommit(custom, true);
        }}
      >
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          max={365}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          aria-label="Number of days"
          size="sm"
          containerClassName="w-16"
          invalid={!valid}
        />
        <span className="text-sm text-fg-secondary">days</span>
        <Select
          aria-label="Direction"
          size="sm"
          value={direction}
          onValueChange={(next) => setDirection(next === 'after' ? 'after' : 'before')}
          options={[
            { value: 'before', label: before },
            { value: 'after', label: after },
          ]}
          className="w-auto min-w-[96px]"
        />
        <Button size="sm" type="submit" disabled={custom === null} className="ml-auto">
          Apply
        </Button>
      </form>
    </div>
  );
}

function NumberPicker({ value, onCommit }: TokenPickerProps) {
  const [text, setText] = useState(typeof value === 'number' ? String(value) : '');
  const parsed = Number(text);
  const valid = text.trim() !== '' && Number.isFinite(parsed);
  return (
    <form
      className="flex w-[min(260px,calc(100vw-32px))] items-center gap-2 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onCommit(parsed, true);
      }}
    >
      <Input
        autoFocus
        type="number"
        inputMode="decimal"
        value={text}
        onChange={(event) => setText(event.target.value)}
        aria-label="Value"
        placeholder="0"
        size="sm"
        containerClassName="flex-1"
      />
      <Button size="sm" type="submit" disabled={!valid}>
        Apply
      </Button>
    </form>
  );
}

function BoardPicker({ value, context, onCommit }: TokenPickerProps) {
  const boards = useBoards();
  const list = boards.data ?? context.boards;
  const options = useMemo(
    () =>
      list
        .filter((board) => !board.archivedAt && !board.deletedAt)
        .map((board) => ({
          value: board.id,
          label: board.name,
          description: board.id === context.boardId ? 'This board' : `${board.itemTerminology} board`,
        })),
    [list, context.boardId],
  );
  if (boards.isPending && list.length === 0) return <Hint>Loading boards…</Hint>;
  return (
    <PickerList
      label="Boards"
      searchPlaceholder="Search boards"
      options={options}
      selected={typeof value === 'string' ? [value] : []}
      onSelect={(id) => onCommit(id, true)}
    />
  );
}

function TargetGroupPicker({
  spec,
  clause,
  value,
  context,
  onCommit,
}: TokenPickerProps & { spec: Extract<TokenSpec, { kind: 'targetGroup' }> }) {
  const boardId = clause.values[spec.boardToken];
  const target = typeof boardId === 'string' ? boardId : null;
  const remote = useTargetGroups(target && target !== context.boardId ? target : null);
  if (!target) return <Hint>Choose the board first.</Hint>;
  const groups = target === context.boardId ? context.groups : (remote.data ?? []);
  if (target !== context.boardId && remote.isPending) return <Hint>Loading groups…</Hint>;
  if (remote.isError) return <Hint>Couldn’t load that board’s groups. Close and try again.</Hint>;
  return (
    <PickerList
      label="Groups"
      options={[
        { value: ANY, label: 'The top group', description: 'Default' },
        ...groups
          .filter((group) => !group.archivedAt)
          .map((group) => ({
            value: group.id,
            label: group.title,
            icon: (
              <span
                className={cn('block size-3 rounded-full')}
                style={{ background: `var(--label-${toLabelColor(group.color, 'blue')})` }}
              />
            ),
          })),
      ]}
      selected={typeof value === 'string' ? [value] : [ANY]}
      onSelect={(id) => onCommit(id === ANY ? null : id, true)}
    />
  );
}
