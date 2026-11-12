'use client';
/**
 * Form view (builder). Three panes: question outline (drag to reorder, hide, branch icon) ·
 * live WYSIWYG canvas (desktop / mobile) · settings for the selected question, design or form.
 * Publishing mints a public link (/forms/<token>) that creates an item per response.
 */
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, Copy, EyeOff, GitBranch, GripVertical, Monitor, Plus, Share2, Smartphone } from 'lucide-react';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  Switch,
  Textarea,
  ToggleGroup,
  cn,
  toast,
} from '@/components/ui';
import { ColumnTypeIcon, columnTypeLabel } from '@/features/cells';
import { apiRequest } from '@/lib/api';
import { useCreateColumn, useOrgId } from '@/lib/hooks';
import { toastError } from '@/lib/hooks/cache';
import { queryKeys } from '@/lib/query-keys';
import type { ColumnType } from '@/server/db/schema/cell-values';
import type { BoardPayloadDto, ColumnDto, ViewDto } from '@/server/services/contracts/dto';
import {
  isFormColumn,
  NAME_QUESTION_KEY,
  parseFormSettings,
  SERVER_FORM_KEYS,
  toPublicForm,
  type FormQuestion,
  type FormSettings,
} from '@/server/services/board-views-form-model';
import { ViewCanvas, ViewError } from '../components/view-shell';
import { useViewConfig, useViewModel } from '../hooks';
import { todayIso } from '../lib/dates';
import type { BoardViewProps } from '../types';
import { DesignPanel, QuestionPanel, SettingsPanel } from './form-panels';
import { PublicForm } from './public-form';

type Tab = 'build' | 'design' | 'settings';

const FORM_CONFIG_OPTIONS = { serverOwned: SERVER_FORM_KEYS } as const;

function builderFields(settings: FormSettings): Record<string, unknown> {
  const owned = new Set<string>(SERVER_FORM_KEYS);
  return Object.fromEntries(Object.entries(settings).filter(([key]) => !owned.has(key)));
}

const NEW_FIELD_TYPES: readonly ColumnType[] = ['text', 'long_text', 'email', 'phone', 'number', 'date', 'status', 'dropdown', 'checkbox', 'rating', 'link'];

function OutlineRow({
  question,
  column,
  selected,
  onSelect,
}: {
  readonly question: FormQuestion;
  readonly column: ColumnDto;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: question.columnKey });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(isDragging && 'relative z-[var(--z-raised)]')}>
      <div
        className={cn(
          'group flex h-9 items-center gap-1.5 rounded-md pr-2 pl-1 text-sm transition-colors duration-[var(--duration-fast)]',
          selected ? 'bg-primary-selected text-primary-text' : 'text-fg hover:bg-hover',
          isDragging && 'bg-raised shadow-md',
        )}
      >
        <button type="button" aria-label={`Reorder ${question.label || column.title}`} className="inline-flex size-6 cursor-grab items-center justify-center rounded-xs text-icon opacity-50 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-focus active:cursor-grabbing" {...attributes} {...listeners}>
          <GripVertical aria-hidden className="size-3.5" />
        </button>
        <button type="button" onClick={onSelect} aria-pressed={selected} className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none" data-testid="form-outline-item">
          <ColumnTypeIcon type={column.type === 'name' ? 'text' : column.type} className={cn('size-4', selected && 'text-primary-text')} />
          <span className={cn('min-w-0 flex-1 truncate', question.hidden && 'text-fg-muted line-through')}>{question.label || column.title}</span>
          {question.required || question.columnKey === NAME_QUESTION_KEY ? <span className="text-danger-text" aria-label="required">*</span> : null}
          {question.condition ? <GitBranch aria-label="Conditional" className="size-3.5 shrink-0 text-icon" /> : null}
          {question.hidden ? <EyeOff aria-label="Hidden" className="size-3.5 shrink-0 text-icon" /> : null}
        </button>
      </div>
    </li>
  );
}

function SharePopover({ view, settings, boardId }: { readonly view: ViewDto; readonly settings: FormSettings; readonly boardId: string }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<'link' | 'embed' | null>(null);
  const url = settings.token && typeof window !== 'undefined' ? `${window.location.origin}/forms/${settings.token}` : null;
  const embed = url ? `<iframe src="${url}" width="100%" height="900" style="border:0" title="${settings.title.replaceAll('"', '')}"></iframe>` : '';
  const publish = async (published: boolean) => {
    setBusy(true);
    try {
      const next = await apiRequest<ViewDto>(`/board-forms/${view.id}/publish`, { method: 'POST', orgId, body: { published } });
      queryClient.setQueryData<BoardPayloadDto>(queryKeys.boardPayload(orgId, boardId), (payload) =>
        payload ? { ...payload, views: payload.views.map((entry) => (entry.id === next.id ? next : entry)) } : payload,
      );
      toast.success(published ? 'Form published' : 'Form unpublished', published ? 'Anyone with the link can respond.' : 'The link stops accepting responses.');
    } catch (error) {
      toastError(error, published ? "Couldn't publish the form" : "Couldn't unpublish the form");
    } finally {
      setBusy(false);
    }
  };
  const copy = (kind: 'link' | 'embed', text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopied(kind);
    setTimeout(() => setCopied(null), 1600);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" leadingIcon={<Share2 aria-hidden />} data-testid="form-share">
          Share form
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(380px,calc(100vw-24px))]" aria-label="Share form">
        <div className="flex flex-col gap-3">
          <Switch
            label="Accept responses with a link"
            description="Anyone with the link can submit; they can't see your board."
            checked={settings.published}
            disabled={busy}
            onCheckedChange={(checked) => void publish(checked)}
            data-testid="form-publish"
          />
          {settings.published && url ? (
            <>
              <div className="flex items-center gap-2">
                <Input size="sm" readOnly value={url} aria-label="Form link" data-testid="form-link" onFocus={(event) => event.currentTarget.select()} />
                <Button size="sm" variant="secondary" leadingIcon={copied === 'link' ? <Check aria-hidden /> : <Copy aria-hidden />} onClick={() => copy('link', url)}>
                  {copied === 'link' ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-fg-muted ">Embed</span>
                <Textarea readOnly rows={3} value={embed} aria-label="Embed code" className="font-mono text-xs" />
                <Button size="xs" variant="ghost" className="self-end" onClick={() => copy('embed', embed)}>
                  {copied === 'embed' ? 'Copied' : 'Copy embed code'}
                </Button>
              </div>
              <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-fg-link hover:underline">
                Open the live form ↗
              </a>
            </>
          ) : (
            <p className="text-sm text-fg-muted">Turn on the link to get a shareable URL and embed code.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function FormSkeleton() {
  return (
    <div data-skeleton aria-busy="true" aria-label="Loading form" className="flex flex-1 gap-4 bg-sunken p-4">
      <div className="hidden w-64 flex-col gap-2 md:flex">
        {[0, 1, 2, 3, 4].map((row) => (
          <Skeleton key={row} height={32} rounded="md" />
        ))}
      </div>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 rounded-xl bg-panel p-8">
        <Skeleton height={28} width="60%" rounded="sm" />
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex flex-col gap-2">
            <Skeleton height={12} width="30%" rounded="full" />
            <Skeleton height={40} rounded="sm" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function FormView({ boardId, view, className }: BoardViewProps) {
  const model = useViewModel(boardId, view);
  const { columns, groups, noun, canEdit, board } = model;
  const { save } = useViewConfig<Record<string, unknown>>(boardId, view, 'form', FORM_CONFIG_OPTIONS);
  const createColumn = useCreateColumn(boardId);
  const [tab, setTab] = useState<Tab>('build');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [selected, setSelected] = useState<string>(NAME_QUESTION_KEY);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const formColumns = useMemo(() => columns.map((column) => ({ key: column.key, title: column.title, type: column.type, settings: column.settings })), [columns]);
  const boardName = board?.name;
  const formConfig = view.config.form;
  const settings = useMemo(() => parseFormSettings(formConfig, formColumns, boardName ? `${boardName} intake` : ''), [formConfig, formColumns, boardName]);
  const publicForm = useMemo(() => toPublicForm({ ...settings, questions: settings.questions.map((question) => ({ ...question, hidden: false, condition: null })) }, formColumns, todayIso()), [settings, formColumns]);
  const columnByKey = useMemo(() => new Map(columns.map((column) => [column.key, column])), [columns]);
  const used = new Set(settings.questions.map((question) => question.columnKey));
  const available = columns.filter((column) => isFormColumn(column) && !used.has(column.key));
  const selectedQuestion = settings.questions.find((question) => question.columnKey === selected) ?? settings.questions[0];
  const selectedColumn = selectedQuestion ? columnByKey.get(selectedQuestion.columnKey) : undefined;

  // Only send what the builder owns; token / published / responseCount stay server-owned.
  const update = (patch: Partial<FormSettings>) => save(builderFields({ ...settings, ...patch }));
  const updateQuestion = (columnKey: string, patch: Partial<FormQuestion>) =>
    update({ questions: settings.questions.map((question) => (question.columnKey === columnKey ? { ...question, ...patch } : question)) });
  const addQuestion = (columnKey: string) => {
    update({ questions: [...settings.questions, { columnKey, required: false, hidden: false }] });
    setSelected(columnKey);
    setTab('build');
  };
  const onDragEnd = (event: DragEndEvent) => {
    const keys = settings.questions.map((question) => question.columnKey);
    const from = keys.indexOf(String(event.active.id));
    const to = keys.indexOf(String(event.over?.id ?? ''));
    if (from < 0 || to < 0 || from === to) return;
    update({ questions: arrayMove([...settings.questions], from, to) });
  };

  if (model.query.isError && !model.query.data) return <ViewError onRetry={() => void model.query.refetch()} what="the form" />;
  if (!model.query.data) return <FormSkeleton />;

  const addMenu = (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" leadingIcon={<Plus aria-hidden />} disabled={!canEdit} className="w-full justify-start" data-testid="form-add-question">
          Add question
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-y-auto">
        {available.length ? <DropdownMenuLabel>From board columns</DropdownMenuLabel> : null}
        {available.map((column) => (
          <DropdownMenuItem key={column.key} icon={<ColumnTypeIcon type={column.type} />} onSelect={() => addQuestion(column.key)}>
            {column.title}
          </DropdownMenuItem>
        ))}
        {available.length ? <DropdownMenuSeparator /> : null}
        <DropdownMenuLabel>New field (adds a column)</DropdownMenuLabel>
        {NEW_FIELD_TYPES.map((type) => (
          <DropdownMenuItem
            key={type}
            icon={<ColumnTypeIcon type={type} />}
            onSelect={() =>
              createColumn.mutate(
                { title: columnTypeLabel(type), type },
                { onSuccess: (column) => addQuestion(column.key) },
              )
            }
          >
            {columnTypeLabel(type)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const decorate = (question: { key: string }, node: React.ReactNode) => (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected === question.key}
      aria-label={`Edit question ${columnByKey.get(question.key)?.title ?? ''}`}
      onClick={() => {
        setSelected(question.key);
        setTab('build');
      }}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          setSelected(question.key);
          setTab('build');
        }
      }}
      className={cn(
        'relative -m-3 cursor-pointer rounded-lg p-3 outline-none transition-[box-shadow,background-color] duration-[var(--duration-fast)]',
        selected === question.key ? 'shadow-[0_0_0_2px_var(--primary)]' : 'hover:bg-muted hover:shadow-[0_0_0_1px_var(--border-default)]',
        'focus-visible:shadow-[0_0_0_2px_var(--focus-ring)]',
        settings.questions.find((entry) => entry.columnKey === question.key)?.hidden && 'opacity-50',
      )}
      data-testid="form-canvas-question"
    >
      <div className="pointer-events-none">{node}</div>
    </div>
  );

  return (
    <ViewCanvas testId="form-view" className={className}>
      <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-border-subtle bg-panel px-4 py-2">
        <ToggleGroup
          size="sm"
          label="Form builder section"
          value={tab}
          onValueChange={setTab}
          options={[
            { value: 'build', label: 'Build' },
            { value: 'design', label: 'Design' },
            { value: 'settings', label: 'Settings' },
          ]}
        />
        {settings.published ? (
          <Badge tone="success" size="sm">
            Live
          </Badge>
        ) : (
          <Badge tone="neutral" size="sm">
            Draft
          </Badge>
        )}
        {settings.closed ? (
          <Badge tone="warning" size="sm">
            Closed
          </Badge>
        ) : null}
        <span className="flex-1" />
        <ToggleGroup
          size="sm"
          label="Preview device"
          value={device}
          onValueChange={setDevice}
          options={[
            { value: 'desktop', label: 'Desktop preview', icon: <Monitor aria-hidden />, iconOnly: true },
            { value: 'mobile', label: 'Mobile preview', icon: <Smartphone aria-hidden />, iconOnly: true },
          ]}
        />
        {canEdit ? <SharePopover view={view} settings={settings} boardId={boardId} /> : null}
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden max-[900px]:flex-col max-[900px]:overflow-y-auto">
        <aside aria-label="Questions" className="flex w-[260px] shrink-0 flex-col border-r border-border-subtle bg-panel max-[900px]:w-full max-[900px]:border-r-0 max-[900px]:border-b">
          <div className="flex h-10 items-center justify-between px-4">
            <h3 className="text-xs font-semibold text-fg-muted ">Questions</h3>
            <span className="text-xs text-fg-muted tabular-nums">{settings.questions.length}</span>
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={settings.questions.map((question) => question.columnKey)} strategy={verticalListSortingStrategy}>
              <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 max-[900px]:max-h-56" data-testid="form-outline">
                {settings.questions.map((question) => {
                  const column = columnByKey.get(question.columnKey);
                  return column ? (
                    <OutlineRow
                      key={question.columnKey}
                      question={question}
                      column={column}
                      selected={tab === 'build' && selectedQuestion?.columnKey === question.columnKey}
                      onSelect={() => {
                        setSelected(question.columnKey);
                        setTab('build');
                      }}
                    />
                  ) : null;
                })}
              </ul>
            </SortableContext>
          </DndContext>
          <div className="border-t border-border-subtle p-2">{addMenu}</div>
        </aside>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-sunken px-6 py-8 max-[900px]:flex-none max-[900px]:overflow-visible max-[480px]:px-3 max-[480px]:py-4" data-testid="form-canvas">
          <div className={cn('mx-auto transition-[max-width] duration-[var(--duration-slow)] ease-out', device === 'mobile' ? 'max-w-[390px]' : 'max-w-[680px]')}>
            <PublicForm
              form={publicForm}
              preview
              decorate={decorate}
              header={
                <header className="flex flex-col gap-2">
                  <Input
                    aria-label="Form title"
                    value={settings.title}
                    disabled={!canEdit}
                    onChange={(event) => update({ title: event.target.value })}
                    placeholder="Form title"
                    containerClassName="h-auto border-transparent bg-transparent px-0 shadow-none hover:border-border-subtle focus-within:px-2"
                    className="text-2xl font-semibold"
                    data-testid="form-title"
                  />
                  <Textarea
                    aria-label="Form description"
                    rows={2}
                    value={settings.description}
                    disabled={!canEdit}
                    onChange={(event) => update({ description: event.target.value })}
                    placeholder="Add a description (optional)"
                    className="resize-none border-transparent bg-transparent px-0 text-md text-fg-secondary hover:border-border-subtle focus:px-2"
                  />
                </header>
              }
            />
          </div>
        </div>
        <aside aria-label={tab === 'build' ? 'Question settings' : tab === 'design' ? 'Design' : 'Form settings'} className="w-[320px] shrink-0 overflow-y-auto max-[900px]:overflow-visible border-l border-border-subtle bg-panel p-4 max-[900px]:w-full max-[900px]:border-t max-[900px]:border-l-0">
          {!canEdit ? (
            <p className="text-sm text-fg-muted">You can view this form but not edit it.</p>
          ) : tab === 'design' ? (
            <DesignPanel settings={settings} onChange={update} />
          ) : tab === 'settings' ? (
            <SettingsPanel settings={settings} groups={groups} noun={noun} onChange={update} />
          ) : selectedQuestion && selectedColumn ? (
            <QuestionPanel
              key={selectedQuestion.columnKey}
              question={selectedQuestion}
              column={selectedColumn}
              questions={settings.questions}
              columns={columns}
              onChange={(patch) => updateQuestion(selectedQuestion.columnKey, patch)}
              onRemove={() => {
                update({ questions: settings.questions.filter((question) => question.columnKey !== selectedQuestion.columnKey) });
                setSelected(NAME_QUESTION_KEY);
              }}
            />
          ) : null}
        </aside>
      </div>
    </ViewCanvas>
  );
}
