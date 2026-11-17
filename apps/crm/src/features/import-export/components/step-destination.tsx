'use client';
import { useMemo } from 'react';
import { Briefcase, LayoutGrid, Layers, Plus } from 'lucide-react';
import { Combobox, Field, Input, Skeleton, cn, labelColorStyle, type LabelColor } from '@/components/ui';
import { useBoards, useWorkspaces } from '@/lib/hooks';
import type { BoardKind, GroupDto } from '@/server/services/contracts/dto';
import { DESTINATION_ERRORS, destinationError, type Destination } from '../lib/destination';

const KINDS: readonly { id: BoardKind; label: string; color: LabelColor }[] = [
  { id: 'leads', label: 'Leads', color: 'orange' },
  { id: 'contacts', label: 'Contacts', color: 'blue' },
  { id: 'accounts', label: 'Accounts', color: 'purple' },
  { id: 'deals', label: 'Deals', color: 'green' },
  { id: 'custom', label: 'Something else', color: 'gray' },
];

export interface StepDestinationProps {
  /** Destination with derived defaults (first workspace) already applied. */
  readonly destination: Destination;
  readonly locked: boolean;
  readonly groups: readonly GroupDto[];
  readonly boardLoading: boolean;
  readonly boardName: string | null;
  readonly showErrors: boolean;
  readonly onChange: (destination: Destination) => void;
  /** Switch between new / existing; the other draft is remembered and restored. */
  readonly onTypeChange: (type: Destination['type']) => void;
}

export { destinationError };

export function StepDestination({
  destination,
  locked,
  groups,
  boardLoading,
  boardName,
  showErrors,
  onChange,
  onTypeChange,
}: StepDestinationProps) {
  const workspaces = useWorkspaces();
  const boards = useBoards({ state: 'active' });
  const error = showErrors ? destinationError(destination) : null;

  const workspaceName = useMemo(() => new Map((workspaces.data ?? []).map((ws) => [ws.id, ws.name])), [workspaces.data]);
  const boardOptions = useMemo(
    () =>
      (boards.data ?? []).map((board) => ({
        value: board.id,
        label: board.name,
        description: workspaceName.get(board.workspaceId) ?? undefined,
        icon: <LayoutGrid aria-hidden />,
      })),
    [boards.data, workspaceName],
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold text-balance text-fg outline-none">Where should the rows go?</h2>
      </div>

      {locked ? null : (
        <div role="radiogroup" aria-label="Destination" className="grid gap-3 sm:grid-cols-2">
          {(
            [
              { type: 'new', title: 'New board', body: 'Columns are created from your file.' },
              { type: 'existing', title: 'Existing board', body: 'Map onto its columns and add to a group.' },
            ] as const
          ).map((option) => {
            const selected = destination.type === option.type;
            return (
              <button
                key={option.type}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`import-destination-${option.type}`}
                onClick={() => !selected && onTypeChange(option.type)}
                onKeyDown={(event) => {
                  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
                    event.preventDefault();
                    onTypeChange(option.type === 'new' ? 'existing' : 'new');
                    const sibling = (event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])[option.type === 'new' ? 1 : 0];
                    sibling?.focus();
                  }
                }}
                tabIndex={selected ? 0 : -1}
                className={cn(
                  'flex items-start gap-3 rounded-lg border p-4 text-left transition-[border-color,background-color,box-shadow] duration-[var(--duration-fast)] ease-out',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:bg-pressed',
                  selected ? 'border-primary bg-primary-subtle ring-1 ring-primary' : 'border-border-subtle bg-panel hover:border-border-input-hover hover:bg-muted',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border-2',
                    selected ? 'border-primary' : 'border-border-input',
                  )}
                >
                  {selected ? <span className="size-2 rounded-full bg-primary" /> : null}
                </span>
                <span>
                  <span className="block text-base font-semibold text-fg">{option.title}</span>
                  <span className="block text-sm text-fg-secondary">{option.body}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {destination.type === 'new' ? (
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Board name" required error={error === DESTINATION_ERRORS.name ? error : null}>
            {({ inputId, describedBy, invalid }) => (
              <Input
                id={inputId}
                aria-describedby={describedBy}
                invalid={invalid}
                data-testid="import-board-name"
                value={destination.name}
                maxLength={255}
                placeholder="e.g. Contacts"
                onChange={(event) => onChange({ ...destination, name: event.target.value, touched: true })}
              />
            )}
          </Field>
          <Field label="Workspace" required error={error === DESTINATION_ERRORS.workspace ? error : null}>
            {({ inputId, invalid }) =>
              workspaces.isPending ? (
                <Skeleton height={32} rounded="sm" />
              ) : (
                <Combobox
                  id={inputId}
                  invalid={invalid}
                  value={destination.workspaceId}
                  onValueChange={(value) => value && onChange({ ...destination, workspaceId: value })}
                  options={(workspaces.data ?? []).map((ws) => ({ value: ws.id, label: ws.name, icon: <Briefcase aria-hidden /> }))}
                  placeholder={workspaces.isError ? "Couldn't load workspaces" : 'Choose a workspace'}
                  searchPlaceholder="Search workspaces"
                  emptyMessage="No workspaces match"
                />
              )
            }
          </Field>
          <fieldset className="sm:col-span-2">
            <legend className="mb-2 text-sm font-semibold text-fg">What are you importing?</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="What are you importing">
              {KINDS.map((kind) => {
                const selected = destination.kind === kind.id;
                return (
                  <button
                    key={kind.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    data-testid={`import-kind-${kind.id}`}
                    style={labelColorStyle(kind.color)}
                    onClick={() => onChange({ ...destination, kind: kind.id, touched: true })}
                    className={cn(
                      'inline-flex h-8 items-center gap-2 rounded-pill border px-3 text-sm transition-colors duration-[var(--duration-fast)] ease-out',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:bg-pressed',
                      selected ? 'border-primary bg-primary-selected font-semibold text-primary-text' : 'border-border-input bg-panel text-fg hover:bg-muted',
                    )}
                  >
                    <span aria-hidden className="size-2 rounded-full bg-[var(--lc-bg)]" />
                    {kind.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-sm text-fg-muted">
              {destination.touched ? 'Sets' : 'Picked from your file’s columns. Sets'} the board&apos;s CRM type and the word used for its rows (Lead, Deal…).
            </p>
          </fieldset>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Board" required error={error === DESTINATION_ERRORS.board ? error : null}>
            {({ inputId, invalid }) =>
              locked ? (
                <div className="flex h-8 items-center gap-2 rounded-sm border border-border-subtle bg-sunken px-3 text-base text-fg">
                  <LayoutGrid aria-hidden className="size-4 text-icon" />
                  {boardLoading ? <Skeleton width={120} height={12} /> : <span className="truncate">{boardName}</span>}
                </div>
              ) : boards.isPending ? (
                <Skeleton height={32} rounded="sm" />
              ) : (
                <Combobox
                  id={inputId}
                  invalid={invalid}
                  value={destination.boardId}
                  onValueChange={(value) => value && onChange({ ...destination, boardId: value, groupId: null })}
                  options={boardOptions}
                  placeholder="Choose a board"
                  searchPlaceholder="Search boards"
                  emptyMessage="No boards match"
                />
              )
            }
          </Field>
          <Field label="Group" error={error === DESTINATION_ERRORS.group ? error : null}>
            {({ inputId }) =>
              destination.boardId && boardLoading ? (
                <Skeleton height={32} rounded="sm" />
              ) : (
                <Combobox
                  id={inputId}
                  disabled={!destination.boardId}
                  value={destination.boardId ? (destination.groupId ?? groups[0]?.id ?? '__new__') : null}
                  onValueChange={(value) => value && onChange({ ...destination, groupId: value })}
                  options={[
                    ...groups.map((group) => ({ value: group.id, label: group.title || 'Untitled group', icon: <Layers aria-hidden /> })),
                    { value: '__new__', label: 'New group…', icon: <Plus aria-hidden /> },
                  ]}
                  placeholder="Choose a board first"
                  searchPlaceholder="Search groups"
                  emptyMessage="No groups match"
                />
              )
            }
          </Field>
          {destination.groupId === '__new__' || (destination.boardId && !boardLoading && groups.length === 0) ? (
            <Field label="New group name" className="sm:col-span-2" error={error === DESTINATION_ERRORS.group ? error : null}>
              {({ inputId, describedBy, invalid }) => (
                <Input
                  id={inputId}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={destination.newGroupTitle}
                  placeholder="Imported"
                  maxLength={255}
                  onChange={(event) => onChange({ ...destination, groupId: '__new__', newGroupTitle: event.target.value })}
                />
              )}
            </Field>
          ) : null}
        </div>
      )}
    </div>
  );
}
