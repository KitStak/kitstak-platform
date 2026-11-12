'use client';

/**
 * Workflow builder (`/automation/workflows/new|[id]`, KitStak-designed): trigger + scope,
 * Match All/Any conditions (order fields), ordered actions with params, stop processing,
 * Test against order (dry run, rolled back) and the Run history tab.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { z } from 'zod';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  CheckCircle2,
  ChevronLeft,
  CircleSlash,
  FlaskConical,
  GripVertical,
  ListTree,
  Pencil,
  Plus,
  Trash2,
  XCircle,
  Zap,
} from 'lucide-react';
import { apiFetch, apiRequest, isApiError } from '@/lib/api-client';
import { useApiQuery } from '@/lib/query-client';
import { cn } from '@/lib/utils';
import {
  isConditionGroup,
  type RuleCondition,
  type RuleConditionGroup,
  type RuleConditionNode,
} from '@/lib/domain-types';
import { MATCH_MODES, WORKFLOW_TRIGGERS } from '@/lib/enums';
import { describeCondition, fieldDef } from '@/lib/grid-defs/integrations/rule-fields';
import {
  ACTION_COPY,
  ACTION_PARAMS,
  TRIGGER_COPY,
  WORKFLOW_DEFAULTS,
  WORKFLOW_RUN_FIELDS,
  WORKFLOW_RUNS_GRID_KEY,
  actionsForTrigger,
  conditionCatalogForTrigger,
  workflowSaveSchema,
  type WorkflowActionName,
  type WorkflowSaveInput,
} from '@/lib/grid-defs/integrations/workflows';
import { DataGrid, GridToolbar, useLocalGrid, type GridColumnDef } from '@/components/grid';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox } from '@/components/ui/combobox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { UnderlineTabs } from '@/components/ui/tabs';
import { TextField } from '@/components/ui/text-field';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FieldError } from '@/components/ui/form/form-field';
import { toast } from '@/components/ui/toast';
import { DisabledReason } from '@/components/ui/tooltip';
import { UnsavedChangesGuard } from '@/components/ui/unsaved-changes';
import {
  DateTimeText,
  Muted,
  NO_PERMISSION,
  toFilterFields,
  useClientOptions,
  usePagePerms,
  useWarehouseOptions,
} from '@/components/integrations/shared/shared';
import type { WorkflowDetail, WorkflowRunRow, WorkflowTestResult } from '@/server/repositories/workflows';
import { ConditionModal, type ConditionModalState } from '../rules/rule-modals';
import { useRuleNames } from '../rules/rule-names';
import { ActionParamField } from './workflow-action-params';

type Form = Required<
  Pick<WorkflowSaveInput, 'name' | 'trigger' | 'match' | 'conditions' | 'isActive' | 'stopProcessing'>
> & {
  description: string;
  warehouseId: string | null;
  clientId: string | null;
  actions: { key: string; action: WorkflowActionName; params: Record<string, unknown> }[];
};
type Errors = Record<string, string>;
const key = () => Math.random().toString(36).slice(2);
/** Condition modal target: a top-level slot, a slot inside group `group`, or a new group (`group: "new"`). */
type CondTarget = { readonly group: number | 'new' | null; readonly index: number; readonly insert: boolean };
const MATCH_WORD = { All: 'AND', Any: 'OR' } as const;

function toForm(d: WorkflowDetail | null): Form {
  if (!d)
    return {
      ...WORKFLOW_DEFAULTS,
      description: '',
      warehouseId: null,
      clientId: null,
      conditions: [],
      actions: [],
      trigger: 'Shipment Order Created',
      match: 'All',
      isActive: true,
      stopProcessing: false,
      name: '',
    };
  return {
    name: d.name,
    description: d.description ?? '',
    trigger: d.trigger,
    warehouseId: d.warehouseId,
    clientId: d.clientId,
    match: d.match,
    conditions: d.conditions,
    isActive: d.isActive,
    stopProcessing: d.stopProcessing,
    actions: d.actionList.map((a) => ({ key: key(), action: a.action, params: a.params })),
  };
}
const payload = (f: Form) => ({
  ...f,
  description: f.description || null,
  actions: f.actions.map(({ action, params }) => ({ action, params })),
});

function SortableAction({
  id,
  index,
  children,
  readOnly,
  onDelete,
  label,
}: {
  readonly id: string;
  readonly index: number;
  readonly children: React.ReactNode;
  readonly readOnly: boolean;
  readonly onDelete: () => void;
  readonly label: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: readOnly,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('rounded-lg border border-border bg-surface p-3', isDragging && 'z-10 shadow-lg')}
    >
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-success-soft text-2xs font-bold text-success">
          {index + 1}
        </span>
        <p className="flex-1 text-sm font-semibold text-foreground">{label}</p>
        {!readOnly ? (
          <button
            type="button"
            aria-label={`Remove ${label}`}
            onClick={onDelete}
            className="rounded p-1 text-secondary hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          aria-label={`Reorder ${label}`}
          disabled={readOnly}
          {...attributes}
          {...listeners}
          className="cursor-grab rounded p-1 text-faint hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      </div>
      {children}
    </li>
  );
}

export function WorkflowBuilder({ id }: { readonly id: string | null }) {
  const detail = useApiQuery<WorkflowDetail>(['workflow', id ?? 'new'], id ? `/api/workflows/${id}` : null, {
    staleTime: 0,
  });
  if (id && detail.isPending)
    return (
      <div className="flex flex-col gap-3 p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-[480px] w-full" />
      </div>
    );
  if (id && (detail.isError || !detail.data)) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <EmptyState
          title={detail.error?.status === 404 ? 'Workflow not found' : "Couldn't load this workflow"}
          description={
            detail.error?.status === 404
              ? "It may have been deleted, or it is scoped to a warehouse or client you can't access."
              : detail.error?.message
          }
          action={
            <div className="flex gap-2">
              <Button onClick={() => void detail.refetch()}>Retry</Button>
              <Link href="/automation/workflows">
                <Button variant="secondary">Back to workflows</Button>
              </Link>
            </div>
          }
        />
      </div>
    );
  }
  return (
    <Body key={`${id ?? 'new'}-${detail.dataUpdatedAt}`} detail={id ? (detail.data?.data ?? null) : null} />
  );
}

function Body({ detail }: { readonly detail: WorkflowDetail | null }) {
  const router = useRouter();
  const params = useSearchParams();
  const names = useRuleNames();
  const warehouses = useWarehouseOptions();
  const clients = useClientOptions();
  const perms = usePagePerms('automation.workflows', ['create', 'edit'] as const);
  const isEdit = detail !== null;
  const readOnly = isEdit ? !perms.edit : !perms.create;
  const [form, setForm] = React.useState<Form>(() => toForm(detail));
  const [baseline, setBaseline] = React.useState(() => JSON.stringify(payload(toForm(detail))));
  const [errors, setErrors] = React.useState<Errors>({});
  const [tab, setTab] = React.useState(params.get('tab') === 'runs' && isEdit ? 'runs' : 'builder');
  const [cond, setCond] = React.useState<CondTarget | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [opening, setOpening] = React.useState(false);
  const [conflict, setConflict] = React.useState(false);
  const [confirmBroad, setConfirmBroad] = React.useState(false);
  // An active workflow with no conditions in every warehouse and client runs on every single order.
  const broad = form.isActive && form.conditions.length === 0 && !form.warehouseId && !form.clientId;
  const dirty = JSON.stringify(payload(form)) !== baseline;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [String(k)]: '' }));
  };
  const allowed = actionsForTrigger(form.trigger);
  const catalog = conditionCatalogForTrigger(form.trigger);
  /** Switching trigger drops actions and conditions the new trigger can't use, and says so. */
  const changeTrigger = (next: Form['trigger']) => {
    const nextActions = actionsForTrigger(next);
    const nextCatalog = conditionCatalogForTrigger(next);
    const keptActions = form.actions.filter((a) => nextActions.includes(a.action));
    const fits = (c: RuleCondition) => fieldDef(nextCatalog, c.field) !== undefined;
    const keptConditions: RuleConditionNode[] = form.conditions.flatMap((c): RuleConditionNode[] => {
      if (!isConditionGroup(c)) return fits(c) ? [c] : [];
      const inner = c.conditions.filter(fits);
      return inner.length > 0 ? [{ ...c, conditions: inner }] : [];
    });
    const leaves = (list: readonly RuleConditionNode[]) =>
      list.reduce((n, c) => n + (isConditionGroup(c) ? c.conditions.length : 1), 0);
    const dropped =
      form.actions.length - keptActions.length + (leaves(form.conditions) - leaves(keptConditions));
    setForm((f) => ({ ...f, trigger: next, actions: keptActions, conditions: keptConditions }));
    setErrors((e) => ({ ...e, trigger: '' }));
    if (dropped > 0)
      toast.info(
        'Trigger changed',
        `Removed ${dropped} ${dropped === 1 ? 'step' : 'steps'} that ${next} can't use.`,
      );
  };
  const saveBlocker = readOnly
    ? NO_PERMISSION
    : !dirty
      ? 'No changes to save'
      : !form.name.trim()
        ? 'Enter a workflow name'
        : form.actions.length === 0
          ? 'Add at least one action'
          : null;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const validate = (): boolean => {
    const parsed = workflowSaveSchema.safeParse(payload(form));
    const next: Errors = {};
    if (!parsed.success) for (const i of parsed.error.issues) next[i.path.join('.')] ??= i.message;
    setErrors(next);
    const first = Object.keys(next)[0];
    if (first) {
      setTab('builder');
      setTimeout(
        () =>
          document.getElementById(`wf-${first.replace(/\./g, '-')}`)?.focus() ??
          document.getElementById('wf-actions')?.focus(),
        0,
      );
      return false;
    }
    return true;
  };

  const save = async (confirmed = false) => {
    if (!validate()) return;
    if (broad && !confirmed) {
      setConfirmBroad(true);
      return;
    }
    setSaving(true);
    try {
      const { data } = await apiRequest<WorkflowDetail>(
        isEdit ? `/api/workflows/${detail.id}` : '/api/workflows',
        { method: isEdit ? 'PATCH' : 'POST', body: { ...payload(form), version: detail?.version } },
      );
      toast.success(
        'Success',
        isEdit
          ? `Workflow ${data.name} saved.`
          : `Workflow ${data.name} created. It runs on the next ${form.trigger.toLowerCase()} event.`,
      );
      setBaseline(JSON.stringify(payload(form)));
      if (!isEdit) {
        setOpening(true);
        React.startTransition(() => router.replace(`/automation/workflows/${data.id}`));
      } else router.refresh();
    } catch (error) {
      if (isApiError(error)) {
        if (error.code === 'CONFLICT') setConflict(true);
        const next: Errors = {};
        for (const [k, v] of Object.entries(error.fieldErrors)) if (v[0]) next[k] = v[0];
        setErrors(next);
      }
      toast.error("Couldn't save the workflow", isApiError(error) ? error.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  const addAction = (action: WorkflowActionName) =>
    setForm((f) => ({ ...f, actions: [...f.actions, { key: key(), action, params: {} }] }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    setForm((f) => ({
      ...f,
      actions: arrayMove(
        f.actions,
        f.actions.findIndex((a) => a.key === e.active.id),
        f.actions.findIndex((a) => a.key === e.over?.id),
      ),
    }));
  };
  const editingInitial = (t: CondTarget): RuleCondition | null => {
    if (t.insert || t.group === 'new') return null;
    const node =
      t.group === null
        ? form.conditions[t.index]
        : (form.conditions[t.group] as RuleConditionGroup | undefined)?.conditions[t.index];
    return node && !isConditionGroup(node) ? node : null;
  };
  const condState: ConditionModalState | null = cond
    ? {
        title:
          cond.group === 'new'
            ? 'Add group: first condition'
            : cond.insert
              ? cond.group === null
                ? 'Add condition'
                : 'Add condition to group'
              : 'Edit condition',
        catalog,
        initial: editingInitial(cond),
        allowApplyAll: false,
      }
    : null;
  const updateGroup = (gi: number, fn: (g: RuleConditionGroup) => RuleConditionGroup) => {
    const list = [...form.conditions];
    const g = list[gi];
    if (!g || !isConditionGroup(g)) return;
    const next = fn(g);
    // A group never stays empty: removing its last condition removes the group.
    if (next.conditions.length > 0) list.splice(gi, 1, next);
    else list.splice(gi, 1);
    set('conditions', list);
  };
  const conditionRow = (
    c: RuleCondition,
    connector: React.ReactNode,
    onEdit: () => void,
    onDelete: () => void,
    k: string,
  ) => (
    <li
      key={k}
      className="flex items-center gap-2 rounded-lg border border-info/30 bg-info-soft/30 px-3 py-2"
    >
      {connector}
      <span className="flex-1 text-sm text-foreground">{describeCondition(catalog, c, names)}</span>
      {!readOnly ? (
        <>
          <button
            type="button"
            aria-label="Edit condition"
            onClick={onEdit}
            className="rounded p-1 text-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Delete condition"
            onClick={onDelete}
            className="rounded p-1 text-secondary hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </>
      ) : null}
    </li>
  );
  const connectorChip = (first: boolean, match: 'All' | 'Any', firstLabel: string) =>
    first ? (
      <span className="w-9 shrink-0 text-2xs font-semibold text-info">{firstLabel}</span>
    ) : (
      <span className="w-9 shrink-0 rounded-full bg-surface px-1 text-center text-2xs font-bold text-secondary">
        {MATCH_WORD[match]}
      </span>
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <UnsavedChangesGuard when={dirty && !saving && !opening} />
      <PageHeader
        title={isEdit ? detail.name : 'Create Workflow'}
        crumbLabel={isEdit ? 'Workflow Details' : 'Create Workflow'}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/automation/workflows"
              className="inline-flex items-center gap-1 text-sm text-secondary hover:text-primary"
            >
              <ChevronLeft className="h-4 w-4" />
              Workflows
            </Link>
            <Button variant="secondary" onClick={() => router.push('/automation/workflows')}>
              Cancel
            </Button>
            <DisabledReason reason={saveBlocker}>
              <Button
                variant="primary"
                disabled={saveBlocker !== null || saving || opening}
                onClick={() => void save()}
              >
                {opening ? 'Opening workflow…' : saving ? 'Saving…' : 'Save'}
              </Button>
            </DisabledReason>
          </div>
        }
      />
      <p data-slot="page-subtitle" className="-mt-1 px-6 pb-2 text-sm text-secondary">
        When the trigger fires and the conditions match, the actions run in order.
      </p>
      {isEdit ? (
        <UnderlineTabs
          className="px-6"
          ariaLabel="Workflow sections"
          tabs={[
            { key: 'builder', label: 'Builder' },
            { key: 'runs', label: 'Run history', count: detail.runCount },
          ]}
          active={tab}
          onChange={setTab}
        />
      ) : null}
      {conflict ? (
        <div className="px-6 pt-3">
          <Callout
            variant="attention"
            title="This record changed since you opened it"
            action={
              <Button size="sm" onClick={() => window.location.reload()}>
                Reload
              </Button>
            }
          >
            Someone else saved this workflow. Reload to see their changes.
          </Callout>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmBroad}
        onOpenChange={setConfirmBroad}
        variant="attention"
        title="This workflow will change every order in every warehouse"
        description={`It is active, has no conditions and is not limited to a warehouse or client, so ${form.actions.map((a) => a.action).join(', ') || 'its actions'} will run on every ${form.trigger.toLowerCase()} event for all clients. Add a condition or a scope to narrow it, or save anyway.`}
        confirmLabel="Save anyway"
        cancelLabel="Go back"
        onConfirm={async () => {
          setConfirmBroad(false);
          await save(true);
        }}
      />
      {tab === 'runs' && isEdit ? (
        <RunHistory id={detail.id} />
      ) : (
        <div className="grid flex-1 gap-5 overflow-auto p-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex min-w-0 flex-col gap-5">
            <section className="rounded-xl border border-border bg-surface p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-2xs text-white">
                  1
                </span>
                When
              </h2>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor="wf-name" className="text-xs font-medium text-body">
                    Workflow name <span className="text-danger">*</span>
                  </label>
                  <TextField
                    id="wf-name"
                    value={form.name}
                    maxLength={80}
                    disabled={readOnly}
                    invalid={Boolean(errors.name)}
                    placeholder="e.g. Block PO box addresses"
                    onChange={(e) => set('name', e.target.value)}
                  />
                  <FieldError id="wf-name-error" message={errors.name || undefined} />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="wf-trigger" className="text-xs font-medium text-body">
                    Trigger <span className="text-danger">*</span>
                  </label>
                  <Select
                    id="wf-trigger"
                    value={form.trigger}
                    disabled={readOnly}
                    options={WORKFLOW_TRIGGERS.map((t) => ({ value: t, label: t }))}
                    onChange={(v) => v && v !== form.trigger && changeTrigger(v)}
                    invalid={Boolean(errors.trigger)}
                    aria-describedby="wf-trigger-help"
                  />
                  <p id="wf-trigger-help" className="text-2xs text-secondary">
                    Runs when: {TRIGGER_COPY[form.trigger]}
                  </p>
                </div>
                <div className="flex flex-col gap-1 md:col-span-2">
                  <label htmlFor="wf-description" className="text-xs font-medium text-body">
                    Description
                  </label>
                  <Textarea
                    id="wf-description"
                    rows={2}
                    maxLength={500}
                    value={form.description}
                    disabled={readOnly}
                    onChange={(e) => set('description', e.target.value)}
                    placeholder="Why this workflow exists, so the team knows when to release its orders"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="wf-warehouseId" className="text-xs font-medium text-body">
                    Warehouse
                  </label>
                  <Select
                    id="wf-warehouseId"
                    value={form.warehouseId}
                    clearable
                    disabled={readOnly}
                    options={warehouses.options}
                    placeholder="All warehouses"
                    onChange={(v) => set('warehouseId', v)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="wf-clientId" className="text-xs font-medium text-body">
                    Client
                  </label>
                  <Combobox
                    id="wf-clientId"
                    value={form.clientId}
                    clearable
                    disabled={readOnly}
                    options={clients}
                    placeholder="All clients"
                    onChange={(v) => set('clientId', v)}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-6 md:col-span-2">
                  <Checkbox
                    checked={form.isActive}
                    disabled={readOnly}
                    onCheckedChange={(v) => set('isActive', v === true)}
                    label="Active"
                    description="Inactive workflows never run"
                  />
                  <Checkbox
                    checked={form.stopProcessing}
                    disabled={readOnly}
                    onCheckedChange={(v) => set('stopProcessing', v === true)}
                    label="Stop processing"
                    description="When this matches, later workflows are skipped"
                  />
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-border bg-surface p-4">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-info text-2xs text-white">
                    2
                  </span>
                  If
                </h2>
                <SegmentedControl
                  size="sm"
                  ariaLabel="Match"
                  value={form.match}
                  disabled={readOnly}
                  onChange={(v) => set('match', v)}
                  options={MATCH_MODES.map((m) => ({
                    value: m,
                    label: m === 'All' ? 'Match all' : 'Match any',
                  }))}
                />
                <span className="ml-auto flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={readOnly}
                    onClick={() => setCond({ group: 'new', index: form.conditions.length, insert: true })}
                    title="A nested group with its own Match all / Match any, e.g. Country is US AND (Carrier is UPS OR Carrier is FedEx)"
                  >
                    <ListTree className="h-3.5 w-3.5" />
                    Add group
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={readOnly}
                    onClick={() => setCond({ group: null, index: form.conditions.length, insert: true })}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add condition
                  </Button>
                </span>
              </div>
              {form.conditions.length === 0 ? (
                <p
                  className={cn(
                    'rounded-lg border border-dashed px-3 py-3 text-xs',
                    broad ? 'border-warning/50 bg-warning-soft/40 text-body' : 'border-border text-secondary',
                  )}
                >
                  No conditions: the workflow applies to every{' '}
                  {catalog === 'purchaseOrder' ? 'purchase order' : 'order'} in its scope
                  {broad
                    ? ' — and its scope is all warehouses and all clients. Add a condition or pick a warehouse or client.'
                    : '.'}
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5" aria-label="Conditions">
                  {form.conditions.map((c, i) => {
                    const connector = connectorChip(i === 0, form.match, 'If');
                    const remove = () =>
                      set(
                        'conditions',
                        form.conditions.filter((_, j) => j !== i),
                      );
                    if (!isConditionGroup(c))
                      return conditionRow(
                        c,
                        connector,
                        () => setCond({ group: null, index: i, insert: false }),
                        remove,
                        `c-${i}-${c.field}`,
                      );
                    return (
                      <li
                        key={`g-${i}`}
                        data-testid="wf-condition-group"
                        className="flex items-start gap-2 rounded-lg border border-dashed border-info/50 bg-surface px-3 py-2"
                      >
                        <span className="pt-1.5">{connector}</span>
                        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold text-foreground">Group</span>
                            <SegmentedControl
                              size="sm"
                              ariaLabel={`Group ${i + 1} match`}
                              value={c.group}
                              disabled={readOnly}
                              onChange={(v) => updateGroup(i, (g) => ({ ...g, group: v }))}
                              options={MATCH_MODES.map((m) => ({
                                value: m,
                                label: m === 'All' ? 'Match all' : 'Match any',
                              }))}
                            />
                            {!readOnly ? (
                              <span className="ml-auto flex items-center gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  aria-label={`Add condition to group ${i + 1}`}
                                  onClick={() =>
                                    setCond({ group: i, index: c.conditions.length, insert: true })
                                  }
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                  Condition
                                </Button>
                                <button
                                  type="button"
                                  aria-label={`Delete group ${i + 1}`}
                                  onClick={remove}
                                  className="rounded p-1 text-secondary hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </span>
                            ) : null}
                          </div>
                          <ul className="flex flex-col gap-1.5">
                            {c.conditions.map((gc, j) =>
                              conditionRow(
                                gc,
                                connectorChip(j === 0, c.group, ''),
                                () => setCond({ group: i, index: j, insert: false }),
                                () =>
                                  updateGroup(i, (g) => ({
                                    ...g,
                                    conditions: g.conditions.filter((_, k) => k !== j),
                                  })),
                                `g-${i}-${j}-${gc.field}`,
                              ),
                            )}
                          </ul>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="rounded-xl border border-border bg-surface p-4">
              <div className="mb-3 flex items-center gap-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-success text-2xs text-white">
                    3
                  </span>
                  Then
                </h2>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      id="wf-actions"
                      size="sm"
                      variant="secondary"
                      className="ml-auto"
                      disabled={readOnly}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add action
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    side="bottom"
                    sideOffset={4}
                    collisionPadding={{ top: 72, right: 16, bottom: 16, left: 16 }}
                    className="max-h-[min(420px,var(--radix-dropdown-menu-content-available-height))] w-80 overflow-y-auto"
                  >
                    {allowed.map((a) => (
                      <DropdownMenuItem
                        key={a}
                        icon={Zap}
                        description={ACTION_COPY[a]}
                        onSelect={() => addAction(a)}
                      >
                        {a}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {errors.actions ? (
                <div className="mb-2">
                  <FieldError id="wf-actions-error" message={errors.actions} />
                </div>
              ) : null}
              {form.actions.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-secondary">
                  Add at least one action. Actions run in the order shown; drag to reorder.
                </p>
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                  <SortableContext
                    items={form.actions.map((a) => a.key)}
                    strategy={verticalListSortingStrategy}
                  >
                    <ol className="flex flex-col gap-2">
                      {form.actions.map((a, i) => (
                        <SortableAction
                          key={a.key}
                          id={a.key}
                          index={i}
                          label={a.action}
                          readOnly={readOnly}
                          onDelete={() =>
                            set(
                              'actions',
                              form.actions.filter((x) => x.key !== a.key),
                            )
                          }
                        >
                          <p className="mt-1 pl-8 text-2xs text-secondary">{ACTION_COPY[a.action]}</p>
                          {errors[`actions.${i}.action`] ? (
                            <div className="pl-8">
                              <FieldError
                                id={`wf-actions-${i}-action-error`}
                                message={errors[`actions.${i}.action`]}
                              />
                            </div>
                          ) : null}
                          {ACTION_PARAMS[a.action].length > 0 ? (
                            <div className="mt-2 grid gap-2 pl-8 md:grid-cols-2">
                              {ACTION_PARAMS[a.action].map((p) => (
                                <ActionParamField
                                  key={p.key}
                                  id={`wf-actions-${i}-params-${p.key}`}
                                  action={a.action}
                                  def={p}
                                  value={a.params[p.key]}
                                  warehouseId={form.warehouseId}
                                  clientId={form.clientId}
                                  error={errors[`actions.${i}.params.${p.key}`] ?? null}
                                  onChange={(v) => {
                                    setForm((f) => ({
                                      ...f,
                                      actions: f.actions.map((x) =>
                                        x.key === a.key ? { ...x, params: { ...x.params, [p.key]: v } } : x,
                                      ),
                                    }));
                                    setErrors((e) => ({ ...e, [`actions.${i}.params.${p.key}`]: '' }));
                                  }}
                                />
                              ))}
                            </div>
                          ) : null}
                        </SortableAction>
                      ))}
                    </ol>
                  </SortableContext>
                </DndContext>
              )}
            </section>
          </div>
          {/* Keyed by record kind: another trigger tests another kind of record. */}
          <TestPanel
            key={
              conditionCatalogForTrigger(form.trigger) === 'purchaseOrder'
                ? 'po'
                : form.trigger === 'Order Shipped'
                  ? 'shipped'
                  : 'open'
            }
            form={form}
          />
        </div>
      )}
      <ConditionModal
        state={condState}
        onClose={() => setCond(null)}
        onSubmit={(c) => {
          if (!cond || c === 'all') return;
          if (cond.group === 'new') {
            // A new group reads the other way from the top level: Match all → A AND (B OR C).
            set('conditions', [
              ...form.conditions,
              { group: form.match === 'All' ? 'Any' : 'All', conditions: [c] },
            ]);
          } else if (cond.group !== null) {
            const target = cond;
            updateGroup(cond.group, (g) => {
              const inner = [...g.conditions];
              inner.splice(target.index, target.insert ? 0 : 1, c);
              return { ...g, conditions: inner };
            });
          } else {
            const list = [...form.conditions];
            list.splice(cond.index, cond.insert ? 0 : 1, c);
            set('conditions', list);
          }
          setCond(null);
        }}
      />
    </div>
  );
}

const orderOptions = z.array(z.object({ id: z.string(), label: z.string() }));

function TestPanel({ form }: { readonly form: Form }) {
  const kind =
    conditionCatalogForTrigger(form.trigger) === 'purchaseOrder'
      ? 'po'
      : form.trigger === 'Order Shipped'
        ? 'shipped'
        : 'open';
  const noun = kind === 'po' ? 'purchase order' : 'order';
  const [orderId, setOrderId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<WorkflowTestResult | null>(null);
  const load = React.useCallback(
    async (q: string, signal: AbortSignal) => {
      const parsed = orderOptions.safeParse(
        await apiFetch<unknown>('/api/workflows/test-orders', { query: { q, kind }, signal }),
      );
      return parsed.success ? parsed.data.map((o) => ({ value: o.id, label: o.label })) : [];
    },
    [kind],
  );
  const run = async () => {
    if (!orderId) {
      setError(`Choose ${kind === 'po' ? 'a purchase order' : 'an order'} to test against`);
      document.getElementById('wf-test-order')?.focus();
      return;
    }
    const parsed = workflowSaveSchema.safeParse({ ...payload(form), name: form.name || 'Untitled workflow' });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Complete the workflow first');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const { data } = await apiRequest<WorkflowTestResult>('/api/workflows/test', {
        method: 'POST',
        body: { orderId, draft: { ...payload(form), name: form.name || 'Untitled workflow' } },
      });
      setResult(data);
    } catch (e) {
      setResult(null);
      setError(isApiError(e) ? e.message : 'The test could not run');
    } finally {
      setPending(false);
    }
  };
  return (
    <aside className="flex flex-col gap-3 self-start rounded-xl border border-border bg-surface p-4 xl:sticky xl:top-0">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <FlaskConical className="h-4 w-4 text-primary" />
        Test against {noun}
      </h2>
      <p className="text-xs text-secondary">
        Runs the unsaved workflow on a real {kind === 'shipped' ? 'shipped order' : noun} and rolls everything
        back.
      </p>
      <Combobox
        id="wf-test-order"
        aria-label={`${noun} to test`}
        loadOptions={load}
        minChars={0}
        value={orderId}
        onChange={(v) => {
          setOrderId(v);
          setError(null);
        }}
        placeholder={
          kind === 'po' ? 'Search PO code, vendor or reference' : 'Search order code, customer or address'
        }
        invalid={Boolean(error)}
        clearable
      />
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      <DisabledReason
        reason={
          orderId ? null : `Choose ${kind === 'po' ? 'a purchase order' : 'an order'} to test against first`
        }
      >
        <Button
          variant="primary"
          className="w-full"
          onClick={() => void run()}
          disabled={pending || !orderId}
        >
          {pending ? <Spinner className="h-3.5 w-3.5" /> : <FlaskConical className="h-4 w-4" />}Run test
        </Button>
      </DisabledReason>
      {result ? (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <p className="flex items-center gap-2 text-sm">
            {result.matched ? (
              <CheckCircle2 className="h-4 w-4 text-success" />
            ) : (
              <XCircle className="h-4 w-4 text-danger" />
            )}
            <span className="font-semibold">{result.orderCode}</span>
            {result.matched ? 'matches' : "doesn't match"}
            {result.blockType ? (
              <Badge tone="danger" size="sm">
                Blocked · {result.blockType}
              </Badge>
            ) : null}
          </p>
          {result.scopeNote ? <Callout variant="attention">{result.scopeNote}</Callout> : null}
          {result.conditions.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {result.conditions.map((c, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs">
                  {c.passed ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                  ) : (
                    <CircleSlash className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" />
                  )}
                  <span className={c.passed ? 'text-foreground' : 'text-secondary'}>{c.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-secondary">No conditions — every order matches.</p>
          )}
          {result.actions.length > 0 ? (
            <div>
              <h3 className="mb-1 text-2xs font-semibold text-secondary">Actions</h3>
              <ul className="flex flex-col gap-1">
                {result.actions.map((a, i) => (
                  <li key={i} className="text-xs">
                    <span className={a.applied ? 'font-medium text-success' : 'font-medium text-secondary'}>
                      {a.applied ? 'Applied' : 'Skipped'}
                    </span>{' '}
                    · {a.action}
                    {a.message ? <span className="text-faint"> — {a.message}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {result.changes.length > 0 ? (
            <div>
              <h3 className="mb-1 text-2xs font-semibold text-secondary">Order would change</h3>
              <ul className="flex flex-col gap-1">
                {result.changes.map((c) => (
                  <li key={c.field} className="text-xs">
                    <span className="font-medium">{c.field}</span>{' '}
                    {!c.from || c.from === '—' ? (
                      <span className="italic text-faint">(none)</span>
                    ) : (
                      <span className="text-faint line-through">{c.from}</span>
                    )}{' '}
                    → <span className="font-medium text-foreground">{c.to}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : result.matched ? (
            <p className="text-xs text-secondary">No order fields would change.</p>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}

function RunHistory({ id }: { readonly id: string }) {
  const fields = React.useMemo(() => toFilterFields(WORKFLOW_RUN_FIELDS), []);
  const g = useLocalGrid<WorkflowRunRow>({
    gridKey: WORKFLOW_RUNS_GRID_KEY,
    path: `/api/workflows/${id}/runs`,
    fields,
    initial: { sort: [{ field: 'at', dir: 'desc' }] },
  });
  const COLUMNS: GridColumnDef<WorkflowRunRow>[] = [
    { id: 'at', header: 'Run date', size: 180, cell: ({ row }) => <DateTimeText value={row.original.at} /> },
    {
      id: 'orderCode',
      header: 'Order',
      size: 140,
      cell: ({ row }) =>
        row.original.orderCode ? (
          <Link
            className="font-medium text-primary hover:underline"
            href={`/orders/${row.original.entityId}`}
          >
            {row.original.orderCode}
          </Link>
        ) : (
          <Muted>Deleted</Muted>
        ),
    },
    {
      id: 'matched',
      header: 'Matched',
      size: 100,
      cell: ({ row }) =>
        row.original.matched ? (
          <Badge tone="success" size="sm" shape="pill">
            Yes
          </Badge>
        ) : (
          <Badge tone="neutral" size="sm" shape="pill">
            No
          </Badge>
        ),
    },
    {
      id: 'actionsApplied',
      header: 'Actions applied',
      size: 260,
      enableSorting: false,
      cell: ({ row }) =>
        row.original.actionsApplied.length > 0 ? row.original.actionsApplied.join(', ') : <Muted />,
    },
    {
      id: 'blockType',
      header: 'Block',
      size: 100,
      enableSorting: false,
      cell: ({ row }) =>
        row.original.blockType ? (
          <Badge tone="danger" size="sm">
            {row.original.blockType}
          </Badge>
        ) : (
          <Muted />
        ),
    },
    {
      id: 'error',
      header: 'Notes',
      size: 300,
      enableSorting: false,
      cell: ({ row }) =>
        row.original.error ? (
          <span className="truncate text-danger" title={row.original.error}>
            {row.original.error}
          </span>
        ) : (
          <Muted />
        ),
    },
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search order code" />
      <DataGrid<WorkflowRunRow>
        {...g.gridProps}
        columns={COLUMNS}
        getRowId={(r) => r.id}
        emptyTitle="No runs yet"
        emptyDescription="Runs appear here each time the trigger fires for an order in scope."
      />
    </div>
  );
}
