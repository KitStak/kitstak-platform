'use client';
/**
 * Naming step of Create board: name (pre-selected), item terminology, privacy, workspace and
 * folder, sample data. A live mini preview shows the chosen noun ("+ New deal").
 */
import { useEffect, useMemo, useRef } from 'react';
import { Globe, Lock, Plus, Share2 } from 'lucide-react';
import { Field, Input, Select, Skeleton, Switch, cn, toLabelColor } from '@/components/ui';
import type { BoardPrivacy, WorkspaceDto } from '@/server/services/contracts/dto';
import type { TemplateGalleryEntry } from '@/server/services/wizards-gallery';
import { useWorkspaceTree } from '@/features/shell/api';
import {
  BOARD_NAME_MAX,
  MANAGING_OPTIONS,
  TERMINOLOGY_MAX,
  addItemLabel,
  terminologyFor,
  type BoardSetupErrors,
  type BoardSetupState,
  type ManagingId,
} from '../model/board-setup';
import { ChoiceChips, OptionCards } from './primitives';

const PRIVACY_OPTIONS = [
  {
    value: 'main' as const,
    title: 'Main',
    description: 'Everyone in the workspace can find and open it',
    icon: <Globe aria-hidden className="size-[18px] text-icon-strong" />,
  },
  {
    value: 'private' as const,
    title: 'Private',
    description: 'Only people you invite can see it',
    icon: <Lock aria-hidden className="size-[18px] text-icon-strong" />,
  },
  {
    value: 'shareable' as const,
    title: 'Shareable',
    description: 'Invite guests from outside your organization',
    icon: <Share2 aria-hidden className="size-[18px] text-icon-strong" />,
  },
];

export interface BoardSetupFormProps {
  readonly orgId: string;
  readonly state: BoardSetupState;
  readonly errors: BoardSetupErrors;
  readonly onChange: (patch: Partial<BoardSetupState>) => void;
  readonly workspaces: readonly WorkspaceDto[] | undefined;
  readonly workspacesLoading: boolean;
  /** Template the board is created from (null = blank start). */
  readonly template: TemplateGalleryEntry | null;
  /** Template that will actually be instantiated (blank start seeds CRM objects). */
  readonly previewEntry: TemplateGalleryEntry | null;
  /** Gallery still loading: reserve rows that depend on it so nothing shifts later. */
  readonly previewLoading?: boolean;
  readonly disabled?: boolean;
}

export function BoardSetupForm({
  orgId,
  state,
  errors,
  onChange,
  workspaces,
  workspacesLoading,
  template,
  previewEntry,
  previewLoading,
  disabled,
}: BoardSetupFormProps) {
  const nameRef = useRef<HTMLInputElement>(null);
  const tree = useWorkspaceTree(orgId, state.workspaceId);
  const term = terminologyFor(state);

  useEffect(() => {
    const node = nameRef.current;
    if (!node) return;
    node.focus();
    node.select();
  }, []);

  const folderOptions = useMemo(() => {
    const folders = tree.data?.folders ?? [];
    const depthOf = (id: string | null, guard = 0): number => {
      const folder = folders.find((item) => item.id === id);
      return folder?.parentId && guard < 8 ? 1 + depthOf(folder.parentId, guard + 1) : 0;
    };
    return [
      { value: 'none', label: 'No folder' },
      ...folders.map((folder) => ({
        value: folder.id,
        label: `${'  '.repeat(depthOf(folder.id))}${depthOf(folder.id) ? '↳ ' : ''}${folder.name}`,
      })),
    ];
  }, [tree.data]);

  const hasSample = Boolean(previewEntry?.boards[0]?.sampleItems.length);

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_280px]">
      <div className="flex min-w-0 flex-col gap-5">
        <Field label="Board name" required error={errors.name}>
          {({ inputId, describedBy, invalid }) => (
            <Input
              ref={nameRef}
              id={inputId}
              size="lg"
              data-testid="board-name-input"
              value={state.name}
              maxLength={BOARD_NAME_MAX}
              disabled={disabled}
              onChange={(event) => onChange({ name: event.target.value })}
              aria-describedby={describedBy}
              invalid={invalid}
            />
          )}
        </Field>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-semibold text-fg-secondary">
            {template ? 'What do you call each row?' : 'What are you managing in this board?'}
          </legend>
          <ChoiceChips<ManagingId>
            label="Item type"
            testId="managing-chips"
            options={MANAGING_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
            value={state.managing}
            onToggle={(managing) => onChange({ managing })}
          />
          {state.managing === 'custom' ? (
            <Field label="Custom name for one row" error={errors.customTerm} className="mt-2 animate-fade-in">
              {({ inputId, describedBy, invalid }) => (
                <Input
                  id={inputId}
                  autoFocus
                  value={state.customTerm}
                  maxLength={TERMINOLOGY_MAX + 5}
                  onChange={(event) => onChange({ customTerm: event.target.value })}
                  placeholder="e.g. Shipment, Opportunity, Client"
                  aria-describedby={describedBy}
                  invalid={invalid}
                  disabled={disabled}
                />
              )}
            </Field>
          ) : null}
          {!template ? (
            // Always rendered (one line reserved) so the dialog never jumps when the gallery loads.
            <p className="min-h-[18px] text-sm text-fg-muted" data-testid="terminology-helper">
              {previewLoading ? (
                <Skeleton height={12} width="70%" className="mt-[3px]" />
              ) : previewEntry && previewEntry.id !== 'blank' ? (
                <>
                  We’ll add {previewEntry.name.toLowerCase()} columns like{' '}
                  {previewEntry.boards[0]?.columns
                    .filter((column) => column.type !== 'name')
                    .slice(0, 3)
                    .map((column) => column.title)
                    .join(', ')}
                  .
                </>
              ) : (
                'Starts with a Name column, a Status and a Date. Add more any time.'
              )}
            </p>
          ) : null}
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-fg-secondary">Privacy</legend>
          <OptionCards<BoardPrivacy>
            label="Board privacy"
            testId="privacy-options"
            columns={1}
            compact
            value={state.privacy}
            onChange={(privacy) => onChange({ privacy })}
            options={PRIVACY_OPTIONS}
          />
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Workspace" required error={errors.workspaceId}>
            {({ inputId, describedBy, invalid }) =>
              workspacesLoading ? (
                <Skeleton height={40} className="w-full" />
              ) : (
                <Select
                  id={inputId}
                  size="lg"
                  value={state.workspaceId ?? undefined}
                  placeholder="Choose a workspace"
                  onValueChange={(workspaceId) => onChange({ workspaceId, folderId: null })}
                  options={(workspaces ?? []).map((workspace) => ({ value: workspace.id, label: workspace.name }))}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  disabled={disabled}
                />
              )
            }
          </Field>
          <Field label="Folder" hint={tree.isError ? 'Folders couldn’t load. The board goes to the workspace root.' : undefined}>
            {({ inputId, describedBy }) =>
              tree.isLoading && state.workspaceId ? (
                <Skeleton height={40} className="w-full" />
              ) : (
                <Select
                  id={inputId}
                  size="lg"
                  value={state.folderId ?? 'none'}
                  onValueChange={(value) => onChange({ folderId: value === 'none' ? null : value })}
                  options={folderOptions}
                  aria-describedby={describedBy}
                  disabled={disabled || !state.workspaceId || folderOptions.length <= 1}
                />
              )
            }
          </Field>
        </div>

        <div className="min-h-[44px]" data-testid="sample-data-row">
          {previewLoading ? (
            <div aria-hidden className="flex items-start gap-3">
              <Skeleton width={36} height={20} rounded="full" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton width="40%" height={14} />
                <Skeleton width="85%" height={12} />
              </div>
            </div>
          ) : (
            <Switch
              checked={hasSample && previewEntry?.id !== 'blank' ? state.withSampleData : true}
              onCheckedChange={(withSampleData) => onChange({ withSampleData })}
              label="Include sample data"
              description={
                hasSample && previewEntry?.id !== 'blank'
                  ? 'A few example rows so you can see how the board works. Delete them any time.'
                  : 'Blank boards start with a few placeholder rows to rename.'
              }
              disabled={disabled || !hasSample || previewEntry?.id === 'blank'}
            />
          )}
        </div>
      </div>

      <MiniPreview entry={previewEntry} name={state.name} term={term} privacy={state.privacy} />
    </div>
  );
}

function MiniPreview({
  entry,
  name,
  term,
  privacy,
}: {
  readonly entry: TemplateGalleryEntry | null;
  readonly name: string;
  readonly term: string;
  readonly privacy: BoardPrivacy;
}) {
  const board = entry?.boards[0];
  const columns = board?.columns.filter((column) => column.type !== 'name').slice(0, 2) ?? [];
  const group = board?.groups[0];
  const color = toLabelColor(group?.color ?? 'blue');
  const PrivacyIcon = privacy === 'private' ? Lock : privacy === 'shareable' ? Share2 : Globe;
  return (
    <aside aria-label="Board preview" className="hidden flex-col gap-2 md:flex" data-testid="board-mini-preview">
      <span className="text-sm font-semibold text-fg-secondary">Preview</span>
      <div className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-sunken p-4">
        <div className="flex items-center gap-1.5">
          <PrivacyIcon aria-hidden className="size-3.5 shrink-0 text-icon" />
          <span className="truncate font-heading text-md font-semibold text-fg">{name.trim() || 'New board'}</span>
        </div>
        {!board ? (
          <div aria-busy="true" className="flex flex-col gap-2">
            <Skeleton height={12} width="40%" />
            <Skeleton height={28} />
            <Skeleton height={28} />
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold" style={{ color: `var(--label-${color}-text)` }}>
              {group?.title}
            </span>
            <div className="overflow-hidden rounded-md border border-border-subtle bg-raised" style={{ borderLeft: `4px solid var(--label-${color})` }}>
              <div className="grid grid-cols-[1fr_64px_64px] border-b border-border-subtle text-2xs text-fg-muted">
                <span className="truncate px-2 py-1">{term || 'Item'}</span>
                {columns.map((column) => (
                  <span key={column.key} className="truncate border-l border-border-subtle px-1 py-1 text-center">
                    {column.title}
                  </span>
                ))}
              </div>
              {[0, 1].map((row) => (
                <div key={row} className="grid h-7 grid-cols-[1fr_64px_64px] border-b border-border-subtle">
                  <span className="my-auto ml-2 h-1.5 w-3/4 rounded-full bg-border-default" />
                  {columns.map((column, index) => {
                    const label = column.labels?.[(row + index) % Math.max(1, column.labels.length)];
                    return (
                      <span key={column.key} className="border-l border-border-subtle p-[3px]">
                        <span
                          className={cn('block h-full rounded-[2px]', !label && 'bg-muted')}
                          style={label ? { background: `var(--label-${label.color})` } : undefined}
                        />
                      </span>
                    );
                  })}
                </div>
              ))}
              <div className="flex h-7 items-center gap-1 px-2 text-xs text-fg-muted" data-testid="mini-preview-add">
                <Plus aria-hidden className="size-3" />
                {addItemLabel(term || 'Item')}
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
