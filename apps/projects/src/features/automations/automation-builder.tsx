'use client';
/**
 * Sentence-style automation builder: WHEN [trigger] → ONLY IF [conditions] → THEN [actions].
 * Every underlined word opens a picker; the plain-language sentence at the bottom updates as you
 * go. Works for one project (statuses, sections) or every project.
 */
import { useMemo, useState, type ReactNode } from 'react';
import {
  AlarmClock,
  ArrowRightLeft,
  Bell,
  CalendarClock,
  CalendarDays,
  CircleCheck,
  CirclePlus,
  CopyPlus,
  Eye,
  FolderInput,
  Handshake,
  Info,
  ListChecks,
  ListPlus,
  MessageSquare,
  Plus,
  Rows3,
  Signal,
  Sparkles,
  Tag,
  Tags as TagsIcon,
  Trash2,
  Truck,
  UserRound,
  Zap,
} from 'lucide-react';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  Field,
  IconButton,
  Input,
  Select,
  Switch,
  Textarea,
  cn,
  toast,
} from '@/components/ui';
import { EntityIcon } from '@/components/pm';
import {
  SCHEDULED_TRIGGER_TYPES,
  type AutomationAction,
  type AutomationCondition,
  type AutomationPersonTarget,
  type AutomationTrigger,
} from '@/lib/automation-types';
import { STATUS_CATEGORY_LABELS, type Priority, type StatusCategory } from '@/lib/constants';
import type { AutomationDTO, ProjectSummary } from '@/lib/types';
import { createAutomationAction, updateAutomationAction } from '@/server/actions/automations';
import { useShell } from '@/features/shell/shell-context';
import type { OptionItem } from '@/features/views/option-list';
import {
  ACTION_OPTIONS,
  CONDITION_OPTIONS,
  CRM_STAGE_SUGGESTIONS,
  MESSAGE_VARIABLES,
  TRIGGER_OPTIONS,
  actionOption,
  conditionOption,
  triggerOption,
} from './catalog';
import {
  PERSON_TARGET_OPTIONS,
  categoryOptions,
  dayOptions,
  labelOptions,
  personOptions,
  plainCategoryOptions,
  priorityOptions,
  projectOptions,
  sectionOptions,
  sentenceFor,
  statusOptions,
  useBuilderLookups,
  type BuilderLookups,
} from './lookups';
import { TokenChip, TokenGroupedSelect, TokenSelect, type GroupedOption } from './token';

export interface AutomationDraft {
  readonly id?: string;
  readonly name: string;
  readonly projectId: string | null;
  readonly enabled: boolean;
  readonly trigger: AutomationTrigger;
  readonly conditions: readonly AutomationCondition[];
  readonly actions: readonly AutomationAction[];
}

export function draftFromRule(rule: AutomationDTO): AutomationDraft {
  return {
    id: rule.id,
    name: rule.name,
    projectId: rule.projectId,
    enabled: rule.enabled,
    trigger: rule.trigger,
    conditions: rule.conditions,
    actions: rule.actions,
  };
}

export function blankDraft(projectId: string | null): AutomationDraft {
  return {
    name: '',
    projectId,
    enabled: true,
    trigger: { type: 'task_completed' },
    conditions: [],
    actions: [{ type: 'notify', target: 'project_owner' }],
  };
}

// --- Validation -------------------------------------------------------------------------------

type Problems = ReadonlyMap<string, string>;

function draftProblems(draft: AutomationDraft, lookups: BuilderLookups): Problems {
  const problems = new Map<string, string>();
  const statusIds = new Set(lookups.statuses.map((s) => s.id));
  const sectionIds = new Set(lookups.sections.map((s) => s.id));
  const labelIds = new Set(lookups.labels.map((l) => l.id));
  const projectIds = new Set(lookups.projects.map((p) => p.id));
  const t = draft.trigger;
  if (t.type === 'status_changed' && t.toStatusId && !statusIds.has(t.toStatusId))
    problems.set('trigger', 'Pick a status from this project.');
  if (t.type === 'section_changed' && t.toSectionId && !sectionIds.has(t.toSectionId))
    problems.set('trigger', 'Pick a section from this project.');
  if (t.type === 'label_added' && t.labelId && !labelIds.has(t.labelId))
    problems.set('trigger', 'Pick a label.');
  draft.conditions.forEach((condition, index) => {
    const key = `condition-${index}`;
    const value = typeof condition.value === 'string' ? condition.value : '';
    const needsValue = condition.op === 'is' || condition.op === 'is_not' || condition.op === 'contains';
    if (condition.field === 'isSubtask') return;
    if (needsValue && !value) problems.set(key, 'Finish this rule or remove it.');
    else if (condition.field === 'status' && value && !statusIds.has(value))
      problems.set(key, 'Pick a status from this project.');
    else if (condition.field === 'section' && value && !sectionIds.has(value))
      problems.set(key, 'Pick a section from this project.');
    else if (condition.field === 'label' && value && !labelIds.has(value)) problems.set(key, 'Pick a label.');
    else if (condition.field === 'project' && value && !projectIds.has(value))
      problems.set(key, 'Pick a project.');
  });
  if (draft.actions.length === 0) problems.set('actions', 'Add at least one thing for the automation to do.');
  draft.actions.forEach((action, index) => {
    const key = `action-${index}`;
    switch (action.type) {
      case 'set_status':
        if (!statusIds.has(action.statusId))
          problems.set(
            key,
            draft.projectId
              ? 'Pick a status.'
              : 'Statuses belong to one project. Pick a project at the top first.',
          );
        break;
      case 'move_to_section':
        if (!sectionIds.has(action.sectionId))
          problems.set(
            key,
            draft.projectId
              ? 'Pick a section.'
              : 'Sections belong to one project. Pick a project at the top first.',
          );
        break;
      case 'add_label':
      case 'remove_label':
        if (!labelIds.has(action.labelId)) problems.set(key, 'Pick a label.');
        break;
      case 'set_assignee':
        if (action.target === 'user' && !action.userId) problems.set(key, 'Pick who gets it.');
        break;
      case 'notify':
      case 'add_watcher':
        if (action.target === 'user' && !action.userId) problems.set(key, 'Pick a teammate.');
        break;
      case 'add_comment':
        if (!action.body.trim()) problems.set(key, 'Write the comment.');
        break;
      case 'create_subtask':
        if (!action.title.trim()) problems.set(key, 'Name the subtask.');
        break;
      case 'create_follow_up':
        if (!action.title.trim()) problems.set(key, 'Name the follow-up task.');
        else if (action.assignTo === 'user' && !action.userId)
          problems.set(key, 'Pick who gets the follow-up.');
        else if (action.projectId && !projectIds.has(action.projectId)) problems.set(key, 'Pick a project.');
        break;
      case 'move_to_project':
        if (!projectIds.has(action.projectId)) problems.set(key, 'Pick the project to move it to.');
        else if (action.projectId === draft.projectId)
          problems.set(key, 'Pick a different project than this one.');
        break;
      default:
        break;
    }
  });
  return problems;
}

/** Strips empty optional fields so saved rules stay tidy. */
function cleanAction(action: AutomationAction): AutomationAction {
  if (action.type === 'notify' && !action.message?.trim()) {
    const rest = { ...action };
    delete rest.message;
    return rest;
  }
  if (action.type === 'create_follow_up' && !action.projectId) {
    const rest = { ...action };
    delete rest.projectId;
    return rest;
  }
  return action;
}

function suggestName(draft: AutomationDraft, lookups: BuilderLookups): string {
  const sentence = sentenceFor(draft, lookups.describe)
    .replace(/^When /, '')
    .replace(/\.$/, '');
  const first = sentence.split(', ')[1] ?? sentence;
  const words = first.charAt(0).toUpperCase() + first.slice(1);
  return words.length > 80 ? `${words.slice(0, 77)}…` : words;
}

// --- Small pieces -------------------------------------------------------------------------------

function StepCard({
  step,
  title,
  hint,
  children,
}: {
  readonly step: string;
  readonly title: string;
  readonly hint?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="relative flex gap-3">
      <div className="flex flex-col items-center">
        <span className="inline-flex h-6 min-w-12 items-center justify-center rounded-full bg-primary-subtle px-2 text-2xs font-bold tracking-wide text-primary-text uppercase">
          {step}
        </span>
        <span aria-hidden className="mt-1 w-px flex-1 bg-border-subtle group-last/steps:hidden" />
      </div>
      <div className="min-w-0 flex-1 pb-5">
        <h3 className="sr-only">{title}</h3>
        {hint ? <p className="mb-2 text-xs text-fg-muted">{hint}</p> : null}
        {children}
      </div>
    </section>
  );
}

function Line({
  children,
  problem,
  onRemove,
  removeLabel,
}: {
  readonly children: ReactNode;
  readonly problem?: string;
  readonly onRemove?: () => void;
  readonly removeLabel?: string;
}) {
  return (
    <div
      className={cn(
        'group/line rounded-lg border bg-panel px-3 py-2.5',
        problem ? 'border-danger/50' : 'border-border-subtle',
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 text-[15px] leading-8 text-fg">{children}</div>
        {onRemove ? (
          <IconButton
            size="sm"
            label={removeLabel ?? 'Remove'}
            icon={<Trash2 aria-hidden />}
            onClick={onRemove}
            className="mt-0.5 opacity-70 group-hover/line:opacity-100"
          />
        ) : null}
      </div>
      {problem ? (
        <p className="mt-1 text-xs text-danger-text" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

function VariableHints({ onInsert }: { readonly onInsert: (token: string) => void }) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-fg-muted">
      <span>Insert:</span>
      {MESSAGE_VARIABLES.map((variable) => (
        <button
          key={variable.token}
          type="button"
          onClick={() => onInsert(variable.token)}
          className="rounded-sm bg-muted px-1.5 py-0.5 font-medium text-fg-secondary hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
        >
          {variable.label}
        </button>
      ))}
    </div>
  );
}

const DUE_SOON_DAYS = [0, 1, 2, 3, 5, 7, 14];
const dueSoonWords = (days: number) =>
  days === 0 ? 'due today' : days === 1 ? 'due tomorrow' : `due in ${days} days or less`;
const OFFSET_DAYS = [0, 1, 2, 3, 5, 7, 14, 30];
const offsetWords = (days: number) => (days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`);

const GLYPH = 'size-4 shrink-0 text-icon';

function TriggerGlyph({ type }: { readonly type: AutomationTrigger['type'] }) {
  const Icon = {
    task_created: CirclePlus,
    status_changed: ArrowRightLeft,
    task_completed: CircleCheck,
    assignee_changed: UserRound,
    priority_changed: Signal,
    due_date_changed: CalendarDays,
    label_added: Tag,
    comment_added: MessageSquare,
    section_changed: Rows3,
    subtasks_completed: ListChecks,
    due_date_approaching: CalendarClock,
    task_overdue: AlarmClock,
    crm_stage_changed: Handshake,
    wms_order_shipped: Truck,
  }[type];
  return <Icon aria-hidden className={GLYPH} />;
}

function ActionGlyph({ type }: { readonly type: AutomationAction['type'] }) {
  const Icon = {
    set_status: ArrowRightLeft,
    set_assignee: UserRound,
    set_priority: Signal,
    set_due_date: CalendarDays,
    add_label: Tag,
    remove_label: TagsIcon,
    move_to_section: Rows3,
    move_to_project: FolderInput,
    complete_parent: CircleCheck,
    notify: Bell,
    add_comment: MessageSquare,
    add_watcher: Eye,
    create_subtask: ListPlus,
    create_follow_up: CopyPlus,
  }[type];
  return <Icon aria-hidden className={GLYPH} />;
}

// --- Trigger -----------------------------------------------------------------------------------

function TriggerSentence({
  trigger,
  onChange,
  lookups,
  problem,
  integrations,
}: {
  readonly trigger: AutomationTrigger;
  readonly onChange: (trigger: AutomationTrigger) => void;
  readonly lookups: BuilderLookups;
  readonly problem?: string;
  readonly integrations: { readonly crm: boolean; readonly wms: boolean };
}) {
  const options: GroupedOption[] = TRIGGER_OPTIONS.map((option) => ({
    value: option.type,
    label: option.label,
    group: option.group,
    keywords: option.group,
    icon: <TriggerGlyph type={option.type} />,
    note: option.needs && !integrations[option.needs] ? 'Not connected' : undefined,
  }));
  const people = personOptions(lookups);
  return (
    <Line problem={problem}>
      <span className="text-fg-secondary">When</span>
      <TokenGroupedSelect
        label="Trigger"
        testId="trigger-token"
        value={trigger.type}
        options={options}
        placeholder="something happens"
        onChange={(type) => onChange(triggerOption(type as AutomationTrigger['type']).make())}
      />
      {trigger.type === 'status_changed' ? (
        <>
          <span className="text-fg-secondary">to</span>
          <TokenSelect
            label="New status"
            value={trigger.toStatusId ?? (trigger.toCategory ? `category:${trigger.toCategory}` : 'any')}
            options={[{ value: 'any', label: 'any status' }, ...statusOptions(lookups), ...categoryOptions()]}
            placeholder="any status"
            heading={lookups.projectId ? undefined : 'Pick a project at the top to use its exact statuses'}
            onChange={(value) =>
              onChange(
                value === 'any'
                  ? { type: 'status_changed' }
                  : value.startsWith('category:')
                    ? { type: 'status_changed', toCategory: value.slice(9) as StatusCategory }
                    : { type: 'status_changed', toStatusId: value },
              )
            }
            display={
              trigger.toCategory
                ? `any “${STATUS_CATEGORY_LABELS[trigger.toCategory]}” status`
                : trigger.toStatusId
                  ? (lookups.describe.status?.(trigger.toStatusId) ?? 'a status')
                  : undefined
            }
          />
        </>
      ) : null}
      {trigger.type === 'assignee_changed' ? (
        <>
          <span className="text-fg-secondary">to</span>
          <TokenSelect
            label="New assignee"
            value={
              trigger.toUserId === undefined ? 'any' : trigger.toUserId === null ? 'none' : trigger.toUserId
            }
            options={[
              { value: 'any', label: 'anyone' },
              { value: 'none', label: 'nobody (unassigned)' },
              ...people,
            ]}
            placeholder="anyone"
            onChange={(value) =>
              onChange(
                value === 'any'
                  ? { type: 'assignee_changed' }
                  : { type: 'assignee_changed', toUserId: value === 'none' ? null : value },
              )
            }
          />
        </>
      ) : null}
      {trigger.type === 'priority_changed' ? (
        <>
          <span className="text-fg-secondary">to</span>
          <TokenSelect
            label="New priority"
            value={trigger.to ?? 'any'}
            options={[{ value: 'any', label: 'any priority' }, ...priorityOptions()]}
            placeholder="any priority"
            onChange={(value) =>
              onChange(
                value === 'any'
                  ? { type: 'priority_changed' }
                  : { type: 'priority_changed', to: value as Priority },
              )
            }
          />
        </>
      ) : null}
      {trigger.type === 'label_added' ? (
        <>
          <span className="text-fg-secondary">and it is</span>
          <TokenSelect
            label="Label"
            value={trigger.labelId ?? 'any'}
            options={[{ value: 'any', label: 'any label' }, ...labelOptions(lookups)]}
            placeholder="any label"
            onChange={(value) =>
              onChange(value === 'any' ? { type: 'label_added' } : { type: 'label_added', labelId: value })
            }
          />
        </>
      ) : null}
      {trigger.type === 'section_changed' ? (
        <>
          <span className="text-fg-secondary">called</span>
          <TokenSelect
            label="Section"
            value={trigger.toSectionId ?? 'any'}
            options={[{ value: 'any', label: 'any section' }, ...sectionOptions(lookups)]}
            placeholder="any section"
            heading={lookups.projectId ? undefined : 'Pick a project at the top to choose a section'}
            onChange={(value) =>
              onChange(
                value === 'any'
                  ? { type: 'section_changed' }
                  : { type: 'section_changed', toSectionId: value },
              )
            }
          />
        </>
      ) : null}
      {trigger.type === 'due_date_approaching' ? (
        <>
          <span className="text-fg-secondary">and the task is</span>
          <TokenSelect
            label="How soon"
            value={String(trigger.days)}
            options={dayOptions(DUE_SOON_DAYS, dueSoonWords)}
            placeholder="due tomorrow"
            onChange={(value) => onChange({ type: 'due_date_approaching', days: Number(value) })}
          />
        </>
      ) : null}
      {trigger.type === 'crm_stage_changed' ? <CrmStageToken trigger={trigger} onChange={onChange} /> : null}
    </Line>
  );
}

function CrmStageToken({
  trigger,
  onChange,
}: {
  readonly trigger: Extract<AutomationTrigger, { type: 'crm_stage_changed' }>;
  readonly onChange: (trigger: AutomationTrigger) => void;
}) {
  const [custom, setCustom] = useState('');
  return (
    <>
      <span className="text-fg-secondary">to</span>
      <TokenChip text={trigger.toStage ? `“${trigger.toStage}”` : 'any stage'} label="Deal stage" width={260}>
        {(close) => (
          <div className="flex flex-col p-1">
            {['any', ...CRM_STAGE_SUGGESTIONS].map((stage) => (
              <button
                key={stage}
                type="button"
                className="ks-menu-item w-full"
                data-checked={(stage === 'any' ? !trigger.toStage : trigger.toStage === stage) || undefined}
                onClick={() => {
                  onChange(
                    stage === 'any'
                      ? { type: 'crm_stage_changed' }
                      : { type: 'crm_stage_changed', toStage: stage },
                  );
                  close();
                }}
              >
                {stage === 'any' ? 'any stage' : stage}
              </button>
            ))}
            <form
              className="mt-1 flex gap-1.5 border-t border-border-subtle p-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!custom.trim()) return;
                onChange({ type: 'crm_stage_changed', toStage: custom.trim() });
                setCustom('');
                close();
              }}
            >
              <Input
                size="sm"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="Another stage name"
                aria-label="Another stage name"
              />
              <Button size="sm" type="submit" variant="secondary" disabled={!custom.trim()}>
                Use
              </Button>
            </form>
          </div>
        )}
      </TokenChip>
    </>
  );
}

// --- Conditions --------------------------------------------------------------------------------

function ConditionSentence({
  condition,
  onChange,
  onRemove,
  lookups,
  problem,
}: {
  readonly condition: AutomationCondition;
  readonly onChange: (condition: AutomationCondition) => void;
  readonly onRemove: () => void;
  readonly lookups: BuilderLookups;
  readonly problem?: string;
}) {
  const fieldOptions: OptionItem[] = CONDITION_OPTIONS.map((option) => ({
    value: option.field,
    label: option.label,
    hint: option.needsProject && !lookups.projectId ? 'Needs a project' : undefined,
  }));
  const value = typeof condition.value === 'string' ? condition.value : '';
  const opToken = (labels: { is: string; is_not: string }) => (
    <TokenSelect
      label="Match"
      value={condition.op}
      options={[
        { value: 'is', label: labels.is },
        { value: 'is_not', label: labels.is_not },
      ]}
      placeholder={labels.is}
      onChange={(op) => onChange({ ...condition, op: op as AutomationCondition['op'] })}
    />
  );
  const valueToken = (label: string, options: OptionItem[], placeholder: string, heading?: string) => (
    <TokenSelect
      label={label}
      value={value || null}
      options={options}
      placeholder={placeholder}
      invalid={Boolean(problem)}
      heading={heading}
      onChange={(next) => onChange({ ...condition, value: next })}
    />
  );
  let rest: ReactNode = null;
  switch (condition.field) {
    case 'project':
      rest = (
        <>
          {opToken({ is: 'is', is_not: 'is not' })}
          {valueToken('Project', projectOptions(lookups), 'pick a project')}
        </>
      );
      break;
    case 'priority':
      rest = (
        <>
          {opToken({ is: 'is', is_not: 'is not' })}
          {valueToken('Priority', priorityOptions(), 'pick a priority')}
        </>
      );
      break;
    case 'label':
      rest = (
        <>
          {opToken({ is: 'include', is_not: 'don’t include' })}
          {valueToken('Label', labelOptions(lookups), 'pick a label')}
        </>
      );
      break;
    case 'assignee':
      rest = (
        <TokenSelect
          label="Assignee rule"
          value={
            condition.op === 'empty'
              ? 'empty'
              : condition.op === 'not_empty'
                ? 'not_empty'
                : value
                  ? `${condition.op}:${value}`
                  : condition.op
          }
          options={[
            { value: 'empty', label: 'is nobody' },
            { value: 'not_empty', label: 'is someone' },
            ...lookups.people.map((person) => ({ value: `is:${person.id}`, label: `is ${person.name}` })),
            ...lookups.people.map((person) => ({
              value: `is_not:${person.id}`,
              label: `is not ${person.name}`,
            })),
          ]}
          placeholder="is nobody"
          onChange={(next) => {
            if (next === 'empty' || next === 'not_empty') onChange({ field: 'assignee', op: next });
            else {
              const [op, id] = next.split(':');
              onChange({ field: 'assignee', op: op as 'is' | 'is_not', value: id });
            }
          }}
        />
      );
      break;
    case 'statusCategory':
      rest = (
        <>
          {opToken({ is: 'is', is_not: 'is not' })}
          {valueToken('Kind of status', plainCategoryOptions(), 'pick one')}
        </>
      );
      break;
    case 'status':
      rest = (
        <>
          {opToken({ is: 'is', is_not: 'is not' })}
          {valueToken(
            'Status',
            statusOptions(lookups),
            'pick a status',
            lookups.projectId ? undefined : 'Pick a project at the top first',
          )}
        </>
      );
      break;
    case 'section':
      rest = (
        <>
          {opToken({ is: 'is', is_not: 'is not' })}
          {valueToken(
            'Section',
            sectionOptions(lookups),
            'pick a section',
            lookups.projectId ? undefined : 'Pick a project at the top first',
          )}
        </>
      );
      break;
    case 'dueDate':
      rest = (
        <TokenSelect
          label="Due date rule"
          value={condition.op}
          options={[
            { value: 'overdue', label: 'has passed (overdue)' },
            { value: 'empty', label: 'is not set' },
            { value: 'not_empty', label: 'is set' },
          ]}
          placeholder="has passed"
          onChange={(op) => onChange({ field: 'dueDate', op: op as AutomationCondition['op'] })}
        />
      );
      break;
    case 'title':
      rest = (
        <>
          <span className="text-fg-secondary">contains</span>
          <Input
            size="sm"
            value={value}
            onChange={(event) => onChange({ ...condition, value: event.target.value })}
            placeholder="a word, like “invoice”"
            aria-label="Words the task name contains"
            invalid={Boolean(problem)}
            containerClassName="ml-1 inline-flex w-56 max-w-full align-middle"
          />
        </>
      );
      break;
    case 'isSubtask':
      rest = (
        <TokenSelect
          label="Subtask rule"
          value={condition.value === true ? 'yes' : 'no'}
          options={[
            { value: 'no', label: 'are skipped (top-level tasks only)' },
            { value: 'yes', label: 'only (it must be a subtask)' },
          ]}
          placeholder="are skipped"
          onChange={(next) => onChange({ field: 'isSubtask', op: 'is', value: next === 'yes' })}
        />
      );
      break;
  }
  return (
    <Line problem={problem} onRemove={onRemove} removeLabel="Remove this rule">
      <span className="text-fg-secondary">and</span>
      <TokenSelect
        label="Check"
        value={condition.field}
        options={fieldOptions}
        placeholder="pick what to check"
        onChange={(field) => onChange(conditionOption(field as AutomationCondition['field']).make())}
      />
      {rest}
    </Line>
  );
}

// --- Actions -----------------------------------------------------------------------------------

function PersonTargetToken({
  label,
  target,
  userId,
  lookups,
  onChange,
  allow = ['assignee', 'reporter', 'project_owner', 'watchers', 'actor'],
  invalid,
}: {
  readonly label: string;
  readonly target: AutomationPersonTarget;
  readonly userId?: string;
  readonly lookups: BuilderLookups;
  readonly onChange: (target: AutomationPersonTarget, userId?: string) => void;
  readonly allow?: readonly AutomationPersonTarget[];
  readonly invalid?: boolean;
}) {
  const options: OptionItem[] = [
    ...PERSON_TARGET_OPTIONS.filter((option) => allow.includes(option.value as AutomationPersonTarget)),
    ...personOptions(lookups).map((option) => ({
      ...option,
      value: `user:${option.value}`,
      hint: 'Teammate',
    })),
  ];
  return (
    <TokenSelect
      label={label}
      value={target === 'user' ? (userId ? `user:${userId}` : null) : target}
      options={options}
      placeholder="pick someone"
      invalid={invalid}
      onChange={(value) =>
        value.startsWith('user:')
          ? onChange('user', value.slice(5))
          : onChange(value as AutomationPersonTarget)
      }
    />
  );
}

function insertAt(value: string, token: string): string {
  return value ? `${value.trimEnd()} ${token}` : token;
}

function ActionSentence({
  action,
  onChange,
  onRemove,
  lookups,
  problem,
  first,
}: {
  readonly action: AutomationAction;
  readonly onChange: (action: AutomationAction) => void;
  readonly onRemove?: () => void;
  readonly lookups: BuilderLookups;
  readonly problem?: string;
  readonly first: boolean;
}) {
  const typeOptions: GroupedOption[] = ACTION_OPTIONS.map((option) => ({
    value: option.type,
    label: option.label,
    group: option.group,
    keywords: option.group,
    icon: <ActionGlyph type={option.type} />,
    note: option.needsProject && !lookups.projectId ? 'Needs a project' : undefined,
  }));
  const invalid = Boolean(problem);
  let rest: ReactNode = null;
  let below: ReactNode = null;
  switch (action.type) {
    case 'set_status':
      rest = (
        <TokenSelect
          label="Status"
          value={action.statusId || null}
          options={statusOptions(lookups)}
          placeholder="pick a status"
          invalid={invalid}
          heading={lookups.projectId ? undefined : 'Pick a project at the top first'}
          onChange={(statusId) => onChange({ type: 'set_status', statusId })}
        />
      );
      break;
    case 'set_assignee':
      rest = (
        <>
          <span className="text-fg-secondary">to</span>
          <TokenSelect
            label="Assign to"
            value={
              action.target === 'user' ? (action.userId ? `user:${action.userId}` : null) : action.target
            }
            options={[
              { value: 'reporter', label: 'the person who created it' },
              { value: 'actor', label: 'the person who made the change' },
              { value: 'none', label: 'nobody (unassign it)' },
              ...personOptions(lookups).map((option) => ({
                ...option,
                value: `user:${option.value}`,
                hint: 'Teammate',
              })),
            ]}
            placeholder="pick someone"
            invalid={invalid}
            onChange={(value) =>
              onChange(
                value.startsWith('user:')
                  ? { type: 'set_assignee', target: 'user', userId: value.slice(5) }
                  : { type: 'set_assignee', target: value as 'reporter' | 'actor' | 'none' },
              )
            }
          />
        </>
      );
      break;
    case 'set_priority':
      rest = (
        <>
          <span className="text-fg-secondary">to</span>
          <TokenSelect
            label="Priority"
            value={action.priority}
            options={priorityOptions()}
            placeholder="high"
            onChange={(priority) => onChange({ type: 'set_priority', priority: priority as Priority })}
          />
        </>
      );
      break;
    case 'set_due_date':
      rest = (
        <>
          <span className="text-fg-secondary">to</span>
          <TokenSelect
            label="Due"
            value={String(action.offsetDays)}
            options={dayOptions(OFFSET_DAYS, offsetWords)}
            placeholder="in 2 days"
            onChange={(days) => onChange({ type: 'set_due_date', offsetDays: Number(days) })}
          />
        </>
      );
      break;
    case 'add_label':
    case 'remove_label':
      rest = (
        <TokenSelect
          label="Label"
          value={action.labelId || null}
          options={labelOptions(lookups)}
          placeholder="pick a label"
          invalid={invalid}
          onChange={(labelId) => onChange({ type: action.type, labelId })}
        />
      );
      break;
    case 'move_to_section':
      rest = (
        <TokenSelect
          label="Section"
          value={action.sectionId || null}
          options={sectionOptions(lookups)}
          placeholder="pick a section"
          invalid={invalid}
          heading={lookups.projectId ? undefined : 'Pick a project at the top first'}
          onChange={(sectionId) => onChange({ type: 'move_to_section', sectionId })}
        />
      );
      break;
    case 'move_to_project':
      rest = (
        <TokenSelect
          label="Project"
          value={action.projectId || null}
          options={projectOptions(lookups, { exclude: lookups.projectId, editableOnly: true })}
          placeholder="pick a project"
          invalid={invalid}
          onChange={(projectId) => onChange({ type: 'move_to_project', projectId })}
        />
      );
      break;
    case 'notify':
      rest = (
        <>
          <span className="text-fg-secondary">to</span>
          <PersonTargetToken
            label="Who hears about it"
            target={action.target}
            userId={action.userId}
            lookups={lookups}
            invalid={invalid}
            onChange={(target, userId) => onChange({ ...action, target, userId })}
          />
        </>
      );
      below = (
        <div className="mt-2">
          <Input
            size="sm"
            value={action.message ?? ''}
            onChange={(event) => onChange({ ...action, message: event.target.value })}
            placeholder="Message (optional). Leave empty for “Automation name: task”"
            aria-label="Notification message"
            maxLength={300}
          />
          <VariableHints
            onInsert={(token) => onChange({ ...action, message: insertAt(action.message ?? '', token) })}
          />
        </div>
      );
      break;
    case 'add_comment':
      below = (
        <div className="mt-2">
          <Textarea
            rows={2}
            value={action.body}
            onChange={(event) => onChange({ ...action, body: event.target.value })}
            placeholder="What should the comment say?"
            aria-label="Comment text"
            maxLength={2000}
            aria-invalid={invalid || undefined}
          />
          <VariableHints onInsert={(token) => onChange({ ...action, body: insertAt(action.body, token) })} />
        </div>
      );
      break;
    case 'add_watcher':
      rest = (
        <>
          <span className="text-fg-secondary">:</span>
          <PersonTargetToken
            label="Follower"
            target={action.target}
            userId={action.userId}
            lookups={lookups}
            invalid={invalid}
            onChange={(target, userId) => onChange({ ...action, target, userId })}
          />
        </>
      );
      break;
    case 'create_subtask':
      below = (
        <Input
          size="sm"
          value={action.title}
          onChange={(event) => onChange({ ...action, title: event.target.value })}
          placeholder="Subtask name, like “Get sign-off”"
          aria-label="Subtask name"
          maxLength={200}
          invalid={invalid}
          containerClassName="mt-2"
        />
      );
      break;
    case 'create_follow_up':
      rest = (
        <>
          <span className="text-fg-secondary">for</span>
          <TokenSelect
            label="Follow-up goes to"
            value={
              action.assignTo === 'user'
                ? action.userId
                  ? `user:${action.userId}`
                  : null
                : (action.assignTo ?? 'assignee')
            }
            options={[
              { value: 'assignee', label: 'the same assignee' },
              { value: 'reporter', label: 'the person who created it' },
              { value: 'none', label: 'nobody yet' },
              ...personOptions(lookups).map((option) => ({
                ...option,
                value: `user:${option.value}`,
                hint: 'Teammate',
              })),
            ]}
            placeholder="the same assignee"
            onChange={(value) =>
              onChange(
                value.startsWith('user:')
                  ? { ...action, assignTo: 'user', userId: value.slice(5) }
                  : { ...action, assignTo: value as 'assignee' | 'reporter' | 'none', userId: undefined },
              )
            }
          />
          <span className="text-fg-secondary">, due</span>
          <TokenSelect
            label="Follow-up due"
            value={action.dueInDays === undefined ? 'none' : String(action.dueInDays)}
            options={[
              { value: 'none', label: 'whenever (no date)' },
              ...dayOptions(OFFSET_DAYS, offsetWords),
            ]}
            placeholder="in 2 days"
            onChange={(value) =>
              onChange({ ...action, dueInDays: value === 'none' ? undefined : Number(value) })
            }
          />
          <span className="text-fg-secondary">, in</span>
          <TokenSelect
            label="Follow-up project"
            value={action.projectId ?? 'same'}
            options={[
              { value: 'same', label: 'the same project' },
              ...projectOptions(lookups, { editableOnly: true }),
            ]}
            placeholder="the same project"
            invalid={invalid && Boolean(action.projectId)}
            onChange={(value) => onChange({ ...action, projectId: value === 'same' ? undefined : value })}
          />
        </>
      );
      below = (
        <div className="mt-2">
          <Input
            size="sm"
            value={action.title}
            onChange={(event) => onChange({ ...action, title: event.target.value })}
            placeholder="Follow-up task name"
            aria-label="Follow-up task name"
            maxLength={200}
            invalid={invalid && !action.title.trim()}
          />
          <VariableHints
            onInsert={(token) => onChange({ ...action, title: insertAt(action.title, token) })}
          />
        </div>
      );
      break;
    case 'complete_parent':
      break;
  }
  return (
    <Line problem={problem} onRemove={onRemove} removeLabel="Remove this step">
      <span className="text-fg-secondary">{first ? 'Then' : 'and'}</span>
      <TokenGroupedSelect
        label="Action"
        testId="action-token"
        value={action.type}
        options={typeOptions}
        placeholder="do something"
        onChange={(type) => onChange(actionOption(type as AutomationAction['type']).make())}
      />
      {rest}
      {below}
    </Line>
  );
}

// --- Dialog -------------------------------------------------------------------------------------

export interface AutomationBuilderProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly initial: AutomationDraft;
  readonly projects: readonly ProjectSummary[];
  /** Projects the person may add rules to; `canManageGlobal` allows "Every project". */
  readonly canManageGlobal: boolean;
  readonly onSaved: (rule: AutomationDTO, created: boolean) => void;
  /** Shown above the form when the draft came from a recipe. */
  readonly recipeName?: string;
}

export function AutomationBuilder({
  open,
  onOpenChange,
  initial,
  projects,
  canManageGlobal,
  onSaved,
  recipeName,
}: AutomationBuilderProps) {
  const { integrations } = useShell();
  const [draft, setDraft] = useState<AutomationDraft>(initial);
  const [showProblems, setShowProblems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nameTouched, setNameTouched] = useState(Boolean(initial.name));
  // Start fresh whenever a new draft is handed in (adjusting state during render, not in an effect).
  const [loaded, setLoaded] = useState(initial);
  if (open && loaded !== initial) {
    setLoaded(initial);
    setDraft(initial);
    setShowProblems(false);
    setNameTouched(Boolean(initial.name));
  }

  const editable = useMemo(
    () => projects.filter((p) => !p.archivedAt && (p.role === 'owner' || p.role === 'editor')),
    [projects],
  );
  const lookups = useBuilderLookups(draft.projectId, projects);
  const problems = useMemo(() => draftProblems(draft, lookups), [draft, lookups]);
  const sentence = useMemo(() => sentenceFor(draft, lookups.describe), [draft, lookups.describe]);
  const scheduled = SCHEDULED_TRIGGER_TYPES.includes(draft.trigger.type);
  const need = triggerOption(draft.trigger.type).needs;
  const missingApp = need && !integrations[need];
  const visibleProblem = (key: string) => (showProblems || key === 'trigger' ? problems.get(key) : undefined);

  const update = (patch: Partial<AutomationDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const scopeOptions = [
    ...(canManageGlobal || draft.projectId === null
      ? [{ value: 'all', label: 'Every project', description: 'Runs on tasks in all projects' }]
      : []),
    ...editable.map((project) => ({
      value: project.id,
      label: project.name,
      icon: <EntityIcon icon={project.icon} color={project.color} size={16} />,
    })),
  ];

  const save = async () => {
    setShowProblems(true);
    if (problems.size > 0) {
      toast.error('Almost there', problems.values().next().value ?? 'Finish the highlighted parts first.');
      return;
    }
    const name = draft.name.trim() || suggestName(draft, lookups);
    const body = {
      name,
      enabled: draft.enabled,
      trigger: draft.trigger,
      conditions: [...draft.conditions],
      actions: draft.actions.map(cleanAction),
    };
    setSaving(true);
    const result = draft.id
      ? await updateAutomationAction({ automationId: draft.id, patch: body })
      : await createAutomationAction({ projectId: draft.projectId, ...body });
    setSaving(false);
    if (!result.ok) {
      toast.error("Couldn't save the automation", result.error.message);
      return;
    }
    onSaved(result.data, !draft.id);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" data-testid="automation-builder" aria-describedby={undefined}>
        <DialogHeader
          icon={
            <span className="inline-flex size-9 items-center justify-center rounded-lg bg-warning-subtle text-warning-text">
              <Zap aria-hidden className="size-5" />
            </span>
          }
          title={draft.id ? 'Edit automation' : recipeName ? `Set up “${recipeName}”` : 'New automation'}
          description="Click any underlined words to change them."
        />
        <DialogBody className="pb-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,240px)]">
            <Field
              label="Name"
              hint={nameTouched ? undefined : 'We’ll name it for you if you leave this empty.'}
            >
              {({ inputId, describedBy }) => (
                <Input
                  id={inputId}
                  aria-describedby={describedBy}
                  value={draft.name}
                  maxLength={120}
                  onChange={(event) => {
                    setNameTouched(true);
                    update({ name: event.target.value });
                  }}
                  placeholder={suggestName(draft, lookups)}
                  data-testid="automation-name"
                />
              )}
            </Field>
            <Field label="Works in">
              {({ inputId }) => (
                <Select
                  id={inputId}
                  value={draft.projectId ?? 'all'}
                  options={scopeOptions}
                  disabled={Boolean(draft.id)}
                  onValueChange={(value) => update({ projectId: value === 'all' ? null : value })}
                  aria-label="Works in"
                />
              )}
            </Field>
          </div>

          <div className="group/steps mt-5">
            <StepCard step="When" title="When this happens">
              <TriggerSentence
                trigger={draft.trigger}
                onChange={(trigger) => update({ trigger })}
                lookups={lookups}
                problem={visibleProblem('trigger')}
                integrations={integrations}
              />
              {scheduled ? (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-fg-muted">
                  <CalendarClock aria-hidden className="mt-px size-3.5 shrink-0" />
                  {draft.trigger.type === 'crm_stage_changed' || draft.trigger.type === 'wms_order_shipped'
                    ? 'Works on tasks linked to a CRM deal or WMS order. KitStak checks every few minutes and right away when someone opens the task.'
                    : 'KitStak checks every few minutes. Each task triggers this once per due date, and done tasks are skipped.'}
                </p>
              ) : null}
              {missingApp ? (
                <p className="mt-2 flex items-start gap-1.5 rounded-md bg-warning-subtle px-2.5 py-2 text-xs text-warning-text">
                  <Info aria-hidden className="mt-px size-3.5 shrink-0" />
                  {need === 'crm'
                    ? 'KitStak CRM isn’t connected to this workspace yet, so this won’t run until it is.'
                    : 'KitStak WMS isn’t connected to this workspace yet, so this won’t run until it is.'}
                </p>
              ) : null}
            </StepCard>
            <StepCard
              step="If"
              title="Only if"
              hint={
                draft.conditions.length
                  ? 'Every rule must be true.'
                  : 'Optional. Leave empty to run every time.'
              }
            >
              <div className="flex flex-col gap-2">
                {draft.conditions.map((condition, index) => (
                  <ConditionSentence
                    key={index}
                    condition={condition}
                    lookups={lookups}
                    problem={visibleProblem(`condition-${index}`)}
                    onChange={(next) =>
                      update({ conditions: draft.conditions.map((c, i) => (i === index ? next : c)) })
                    }
                    onRemove={() => update({ conditions: draft.conditions.filter((_, i) => i !== index) })}
                  />
                ))}
                <div>
                  <Button
                    size="sm"
                    variant="ghost"
                    leadingIcon={<Plus aria-hidden />}
                    disabled={draft.conditions.length >= 10}
                    onClick={() =>
                      update({
                        conditions: [...draft.conditions, { field: 'priority', op: 'is', value: 'high' }],
                      })
                    }
                    data-testid="add-condition"
                  >
                    {draft.conditions.length ? 'Add another rule' : 'Add a rule'}
                  </Button>
                </div>
              </div>
            </StepCard>
            <StepCard step="Then" title="Then do this">
              <div className="flex flex-col gap-2">
                {draft.actions.map((action, index) => (
                  <ActionSentence
                    key={index}
                    first={index === 0}
                    action={action}
                    lookups={lookups}
                    problem={visibleProblem(`action-${index}`)}
                    onChange={(next) =>
                      update({ actions: draft.actions.map((a, i) => (i === index ? next : a)) })
                    }
                    onRemove={
                      draft.actions.length > 1
                        ? () => update({ actions: draft.actions.filter((_, i) => i !== index) })
                        : undefined
                    }
                  />
                ))}
                {visibleProblem('actions') ? (
                  <p className="text-xs text-danger-text">{problems.get('actions')}</p>
                ) : null}
                <div>
                  <Button
                    size="sm"
                    variant="ghost"
                    leadingIcon={<Plus aria-hidden />}
                    disabled={draft.actions.length >= 10}
                    onClick={() =>
                      update({ actions: [...draft.actions, { type: 'notify', target: 'assignee' }] })
                    }
                    data-testid="add-action"
                  >
                    Add another step
                  </Button>
                </div>
              </div>
            </StepCard>
          </div>

          <div
            className="rounded-lg border border-border-subtle bg-sunken px-4 py-3"
            aria-live="polite"
            data-testid="automation-preview"
          >
            <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-fg-muted uppercase">
              <Sparkles aria-hidden className="size-3.5" /> In plain words
            </p>
            <p className="mt-1 text-sm text-fg">{sentence}</p>
            <p className="mt-1 text-xs text-fg-muted">
              {draft.projectId
                ? `Only in ${projects.find((p) => p.id === draft.projectId)?.name ?? 'this project'}.`
                : 'In every project.'}{' '}
              Changes made by automations never set off the same automation again in a loop.
            </p>
          </div>
        </DialogBody>
        <DialogFooter className="justify-between">
          <label className="flex items-center gap-2 text-sm text-fg">
            <Switch
              checked={draft.enabled}
              onCheckedChange={(enabled) => update({ enabled })}
              aria-label="Turn on"
            />
            {draft.enabled ? 'On' : 'Off'}
          </label>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={() => void save()} loading={saving} data-testid="automation-save">
              {draft.id ? 'Save changes' : 'Create automation'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
