'use client';

/**
 * Visual rule canvas (`@xyflow/react`, spec 06 §3/§4): Rule name node → Condition nodes,
 * Action nodes joined by AND (putaway) / Inventory condition nodes joined by AND (allocation),
 * and Order By nodes joined by THEN. Each node edits, deletes and adds siblings before/after.
 * Footer: Cancel Rule · Test Rule · Save Rule. Bottom-right: − 100% + zoom, fit and minimap.
 */
import '@xyflow/react/dist/style.css';
import * as React from 'react';
import {
  Background,
  BackgroundVariant,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useViewport,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Filter,
  Map as MapIcon,
  Maximize2,
  Minus,
  Pencil,
  Plus,
  Sparkles,
  Target,
  X,
} from 'lucide-react';
import type { OrderByClause, RuleCondition } from '@/lib/domain-types';
import {
  ALLOCATION_ORDER_BY,
  PUTAWAY_ORDER_BY,
  describeCondition,
  orderByLabel,
  putawayActionDef,
  type ConditionCatalog,
} from '@/lib/grid-defs/integrations/rule-fields';
import type { AlgorithmRuleInput } from '@/lib/grid-defs/integrations/algorithms';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { TextField } from '@/components/ui/text-field';
import { DisabledReason } from '@/components/ui/tooltip';
import type { AlgorithmAction } from '@/server/db/schema';
import { ActionModal, ConditionModal, OrderByModal, type ConditionModalState } from './rule-modals';
import type { NameOf } from './rule-names';

type Rule = AlgorithmRuleInput;
type SectionKey = 'conditions' | 'inventoryConditions' | 'actions' | 'orderBy';
type Tone = 'condition' | 'inventory' | 'action' | 'order';

const TONES: Record<
  Tone,
  { readonly ring: string; readonly chip: string; readonly icon: React.ComponentType<{ className?: string }> }
> = {
  condition: { ring: 'border-info/40', chip: 'bg-info-soft text-info', icon: Filter },
  inventory: {
    ring: 'border-[var(--label-purple-text)]/35',
    chip: 'bg-[#DFCEF5] text-[var(--label-purple-text)]',
    icon: Target,
  },
  action: { ring: 'border-success/40', chip: 'bg-success-soft text-success', icon: Sparkles },
  order: { ring: 'border-warning/45', chip: 'bg-warning-soft text-warning', icon: ArrowUpNarrowWide },
};

interface ItemData extends Record<string, unknown> {
  readonly tone: Tone;
  readonly kicker: string;
  readonly label: string;
  readonly placeholder?: boolean;
  readonly readOnly: boolean;
  readonly onEdit?: () => void;
  readonly onDelete?: () => void;
  readonly onAddBefore?: () => void;
  readonly onAddAfter?: () => void;
}

function ItemNode({ data }: NodeProps<Node<ItemData>>) {
  const tone = TONES[data.tone];
  const Icon = data.placeholder ? Plus : tone.icon;
  return (
    <div
      className={cn(
        'group relative w-[230px] rounded-lg border bg-surface px-3 py-2 shadow-sm',
        tone.ring,
        data.placeholder && 'border-dashed bg-surface/70',
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-1.5 !w-1.5 !border-0 !bg-border-strong"
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-1.5 !w-1.5 !border-0 !bg-border-strong"
        isConnectable={false}
      />
      <p className="flex items-center gap-1.5 text-2xs font-semibold text-faint">
        <span className={cn('flex h-4 w-4 items-center justify-center rounded', tone.chip)}>
          <Icon className="h-2.5 w-2.5" aria-hidden />
        </span>
        {data.kicker}
      </p>
      {data.placeholder ? (
        <button
          type="button"
          disabled={data.readOnly}
          onClick={data.onAddAfter}
          className="nodrag mt-1 w-full rounded text-left text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:text-faint disabled:no-underline"
        >
          {data.label}
        </button>
      ) : (
        <p className="mt-1 line-clamp-3 text-xs font-medium leading-4 text-foreground" title={data.label}>
          {data.label}
        </p>
      )}
      {!data.placeholder && !data.readOnly ? (
        <div className="nodrag absolute -top-3 right-2 hidden gap-1 group-focus-within:flex group-hover:flex">
          <button
            type="button"
            aria-label={`Edit ${data.label}`}
            onClick={data.onEdit}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface text-secondary shadow-sm hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            aria-label={`Delete ${data.label}`}
            onClick={data.onDelete}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface text-secondary shadow-sm hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : null}
      {!data.placeholder && !data.readOnly ? (
        <>
          <button
            type="button"
            aria-label="Add before"
            onClick={data.onAddBefore}
            className="nodrag absolute -left-3 top-1/2 hidden h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-white shadow group-focus-within:flex group-hover:flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
          >
            <Plus className="h-3 w-3" />
          </button>
          <button
            type="button"
            aria-label="Add after"
            onClick={data.onAddAfter}
            className="nodrag absolute -right-3 top-1/2 hidden h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-white shadow group-focus-within:flex group-hover:flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
          >
            <Plus className="h-3 w-3" />
          </button>
        </>
      ) : null}
    </div>
  );
}

function JoinNode({ data }: NodeProps<Node<{ label: string }>>) {
  return (
    <div className="rounded-full border border-border-strong bg-surface-sunken px-2 py-0.5 text-2xs font-bold tracking-wider text-secondary">
      <Handle type="target" position={Position.Left} className="!opacity-0" isConnectable={false} />
      <Handle type="source" position={Position.Right} className="!opacity-0" isConnectable={false} />
      {data.label}
    </div>
  );
}

function SectionNode({ data }: NodeProps<Node<{ label: string; hint: string }>>) {
  return (
    <div className="w-[150px] text-right">
      <p className="text-xs font-semibold text-foreground">{data.label}</p>
      <p className="text-2xs leading-3 text-faint">{data.hint}</p>
      <Handle type="source" position={Position.Right} className="!opacity-0" isConnectable={false} />
      <Handle type="target" position={Position.Top} className="!opacity-0" isConnectable={false} />
    </div>
  );
}

function RuleNameNode({
  data,
}: NodeProps<
  Node<{
    name: string;
    index: number;
    isActive: boolean;
    readOnly: boolean;
    onName: (v: string) => void;
    onActive: (v: boolean) => void;
    error: string | null;
  }>
>) {
  return (
    <div className="w-[300px] rounded-xl border-2 border-primary/40 bg-surface px-3 py-2.5 shadow-md">
      <Handle type="source" position={Position.Bottom} className="!opacity-0" isConnectable={false} />
      <p className="text-2xs font-semibold text-primary">
        {data.index === 0 ? 'If' : `${data.index}. If else`} · Rule name
      </p>
      <div className="nodrag mt-1.5 flex items-center gap-2">
        <TextField
          id="rule-name"
          aria-label="Rule name"
          size="sm"
          value={data.name}
          maxLength={80}
          disabled={data.readOnly}
          invalid={Boolean(data.error)}
          onChange={(e) => data.onName(e.target.value)}
          placeholder="e.g. Same SKU in picking"
          wrapperClassName="flex-1"
        />
        <Switch
          aria-label="Rule active"
          checked={data.isActive}
          disabled={data.readOnly}
          onCheckedChange={(v) => data.onActive(v === true)}
          size="sm"
        />
      </div>
      {data.error ? (
        <p role="alert" className="mt-1 text-2xs text-danger">
          {data.error}
        </p>
      ) : null}
    </div>
  );
}

const NODE_TYPES = { item: ItemNode, join: JoinNode, section: SectionNode, ruleName: RuleNameNode };

/** Auto-fit never shrinks node text below a readable size: a rule wider than the canvas opens at MIN_FIT_ZOOM pinned to its top-left, and the user pans / scrolls for the rest. */
const MIN_FIT_ZOOM = 0.85;
async function readableFit(flow: ReturnType<typeof useReactFlow>): Promise<void> {
  await flow.fitView({ padding: 0.2, maxZoom: 1 });
  if (flow.getZoom() >= MIN_FIT_ZOOM) return;
  const b = flow.getNodesBounds(flow.getNodes());
  await flow.setViewport({ x: -b.x * MIN_FIT_ZOOM + 32, y: -b.y * MIN_FIT_ZOOM + 48, zoom: MIN_FIT_ZOOM });
}

function ZoomPanel() {
  const flow = useReactFlow();
  const { zoom } = useViewport();
  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-surface px-1 py-1 shadow-sm">
      <Button size="icon-sm" variant="ghost" aria-label="Zoom out" onClick={() => void flow.zoomOut()}>
        <Minus className="h-3.5 w-3.5" />
      </Button>
      <button
        type="button"
        className="w-12 rounded text-center text-xs tabular-nums text-body hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        onClick={() => void flow.zoomTo(1)}
        aria-label="Reset zoom to 100%"
      >
        {Math.round(zoom * 100)}%
      </button>
      <Button size="icon-sm" variant="ghost" aria-label="Zoom in" onClick={() => void flow.zoomIn()}>
        <Plus className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Fit to screen"
        onClick={() => void readableFit(flow)}
      >
        <Maximize2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export interface RuleCanvasProps {
  readonly kind: 'Putaway' | 'Allocation';
  readonly rule: Rule;
  readonly index: number;
  readonly onChange: (rule: Rule) => void;
  readonly names: NameOf;
  readonly warehouseId: string | null;
  readonly readOnly: boolean;
  readonly dirty: boolean;
  readonly nameError: string | null;
  readonly onCancel: () => void;
  readonly onSave: () => void;
  readonly onTest: (() => void) | null;
  readonly testReason: string | null;
}

const W = 230;
const GAP = 70;
const ROW_H = 120;
const LEFT = 170;

type Editing =
  | {
      readonly section: 'conditions' | 'inventoryConditions';
      readonly index: number;
      readonly insert: boolean;
    }
  | { readonly section: 'actions'; readonly index: number; readonly insert: boolean }
  | { readonly section: 'orderBy'; readonly index: number; readonly insert: boolean };

function insertAt<T>(list: readonly T[], index: number, item: T, replace: boolean): T[] {
  const next = [...list];
  next.splice(index, replace ? 1 : 0, item);
  return next;
}

function CanvasInner(p: RuleCanvasProps) {
  const { rule, kind, onChange, names, readOnly } = p;
  const [editing, setEditing] = React.useState<Editing | null>(null);
  // Hidden by default: rules are small enough to fit the view; shown on demand with real node shapes.
  const [showMap, setShowMap] = React.useState(false);
  const flow = useReactFlow();
  const orderMethods = kind === 'Putaway' ? PUTAWAY_ORDER_BY : ALLOCATION_ORDER_BY;
  const sections: readonly {
    key: SectionKey;
    label: string;
    hint: string;
    tone: Tone;
    join: string;
    catalog?: ConditionCatalog;
  }[] =
    kind === 'Putaway'
      ? [
          {
            key: 'conditions',
            label: 'Condition',
            hint: 'When the rule applies',
            tone: 'condition',
            join: 'AND',
            catalog: 'putaway',
          },
          { key: 'actions', label: 'Action', hint: 'Which locations qualify', tone: 'action', join: 'AND' },
          { key: 'orderBy', label: 'Order By', hint: 'How candidates rank', tone: 'order', join: 'THEN' },
        ]
      : [
          {
            key: 'conditions',
            label: 'Order Conditions',
            hint: 'Which orders use the rule',
            tone: 'condition',
            join: 'AND',
            catalog: 'order',
          },
          {
            key: 'inventoryConditions',
            label: 'Inventory Conditions',
            hint: 'Which stock is eligible',
            tone: 'inventory',
            join: 'AND',
            catalog: 'inventory',
          },
          { key: 'orderBy', label: 'Order By', hint: 'Which stock goes first', tone: 'order', join: 'THEN' },
        ];

  const listOf = (key: SectionKey): readonly unknown[] => (rule[key] ?? []) as readonly unknown[];
  const remove = (key: SectionKey, i: number) =>
    onChange({ ...rule, [key]: listOf(key).filter((_, j) => j !== i) });
  const labelOf = (s: (typeof sections)[number], item: unknown): string => {
    if (s.key === 'actions') {
      const a = item as AlgorithmAction;
      const def = putawayActionDef(a.action);
      const v =
        a.value === undefined || a.value === null
          ? ''
          : Array.isArray(a.value)
            ? a.value.map((x) => names(String(x))).join(', ')
            : names(String(a.value));
      return `${def?.label ?? a.action}${v ? ` · ${v}` : ''}`;
    }
    if (s.key === 'orderBy') {
      const o = item as OrderByClause;
      return `${o.dir === 'asc' ? 'Asc' : 'Desc'} - ${orderByLabel(o.field)}`;
    }
    return `If ${describeCondition(s.catalog ?? 'order', item as RuleCondition, names)}`;
  };

  const { nodes, edges } = React.useMemo(() => {
    const n: Node[] = [];
    const e: Edge[] = [];
    const longest = Math.max(1, ...sections.map((s) => listOf(s.key).length + 1));
    const width = LEFT + longest * (W + GAP);
    n.push({
      id: 'rule',
      type: 'ruleName',
      position: { x: Math.max(LEFT, width / 2 - 150), y: 0 },
      draggable: false,
      selectable: false,
      data: {
        name: rule.name,
        index: p.index,
        isActive: rule.isActive ?? true,
        readOnly,
        error: p.nameError,
        onName: (v: string) => onChange({ ...rule, name: v }),
        onActive: (v: boolean) => onChange({ ...rule, isActive: v }),
      },
    });
    sections.forEach((s, row) => {
      const y = 130 + row * ROW_H;
      const items = listOf(s.key);
      n.push({
        id: `sec-${s.key}`,
        type: 'section',
        position: { x: 0, y: y + 10 },
        draggable: false,
        selectable: false,
        data: { label: s.label, hint: s.hint },
      });
      const entries = items.length === 0 && s.key === 'conditions' ? [{ applyAll: true }] : items;
      entries.forEach((item, i) => {
        const isApplyAll = (item as { applyAll?: boolean }).applyAll === true;
        const id = `${s.key}-${i}`;
        n.push({
          id,
          type: 'item',
          position: { x: LEFT + i * (W + GAP), y },
          draggable: false,
          data: {
            tone: s.tone,
            kicker: s.key === 'orderBy' ? `Order ${i + 1}` : isApplyAll ? s.label : `${s.label} ${i + 1}`,
            label: isApplyAll ? 'Applied to all' : labelOf(s, item),
            readOnly,
            onEdit: isApplyAll
              ? () => setEditing({ section: s.key as 'conditions', index: 0, insert: true })
              : () => setEditing({ section: s.key, index: i, insert: false } as Editing),
            onDelete: isApplyAll ? undefined : () => remove(s.key, i),
            onAddBefore: () =>
              setEditing({ section: s.key, index: isApplyAll ? 0 : i, insert: true } as Editing),
            onAddAfter: () =>
              setEditing({ section: s.key, index: isApplyAll ? 0 : i + 1, insert: true } as Editing),
          } satisfies ItemData,
        });
        if (i === 0)
          e.push({
            id: `e-rule-${id}`,
            source: 'rule',
            target: id,
            type: 'smoothstep',
            style: { stroke: 'var(--color-border-strong, #C5CBD3)' },
          });
        if (i > 0) {
          const joinId = `${s.key}-join-${i}`;
          n.push({
            id: joinId,
            type: 'join',
            position: { x: LEFT + i * (W + GAP) - GAP / 2 - 18, y: y + 22 },
            draggable: false,
            selectable: false,
            data: { label: s.join },
          });
          e.push({
            id: `e-${joinId}-a`,
            source: `${s.key}-${i - 1}`,
            target: joinId,
            style: { stroke: 'var(--border-strong)' },
          });
          e.push({
            id: `e-${joinId}-b`,
            source: joinId,
            target: id,
            style: { stroke: 'var(--border-strong)' },
          });
        }
      });
      const isAllOnly = items.length === 0 && s.key === 'conditions';
      if (!isAllOnly) {
        const i = items.length;
        n.push({
          id: `${s.key}-add`,
          type: 'item',
          position: { x: LEFT + i * (W + GAP), y },
          draggable: false,
          data: {
            tone: s.tone,
            kicker: 'New',
            label:
              s.key === 'orderBy' ? 'Add Order By' : s.key === 'actions' ? 'Add action' : 'Add condition',
            placeholder: true,
            readOnly,
            onAddAfter: () => setEditing({ section: s.key, index: i, insert: true } as Editing),
          } satisfies ItemData,
        });
        if (i === 0)
          e.push({
            id: `e-rule-${s.key}-add`,
            source: 'rule',
            target: `${s.key}-add`,
            type: 'smoothstep',
            style: { stroke: '#C5CBD3', strokeDasharray: '4 4' },
          });
        else
          e.push({
            id: `e-${s.key}-add`,
            source: `${s.key}-${i - 1}`,
            target: `${s.key}-add`,
            style: { stroke: '#C5CBD3', strokeDasharray: '4 4' },
          });
      }
    });
    return { nodes: n, edges: e };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rule, p.index, p.nameError, readOnly, names, kind]);

  React.useEffect(() => {
    const t = setTimeout(() => void readableFit(flow), 30);
    return () => clearTimeout(t);
  }, [p.index, kind, flow]);

  const conditionState: ConditionModalState | null =
    editing && (editing.section === 'conditions' || editing.section === 'inventoryConditions')
      ? {
          title: editing.insert ? 'Add condition' : 'Edit condition',
          catalog: sections.find((s) => s.key === editing.section)?.catalog ?? 'order',
          initial: editing.insert ? null : (listOf(editing.section)[editing.index] as RuleCondition),
          allowApplyAll: editing.section === 'conditions',
        }
      : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-[420px] flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.2, minZoom: MIN_FIT_ZOOM, maxZoom: 1 }}
          minZoom={0.3}
          maxZoom={1.8}
          nodesConnectable={false}
          nodesDraggable={false}
          proOptions={{ hideAttribution: true }}
          panOnScroll
          className="bg-surface-sunken/40"
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} color="#C5CBD3" />
          {showMap ? (
            <MiniMap
              pannable
              zoomable
              position="bottom-left"
              className="!rounded-lg !border !border-border"
              bgColor="var(--color-surface-sunken, #F4F6F8)"
              maskColor="rgba(46,107,230,0.08)"
              maskStrokeColor="#2E6BE6"
              maskStrokeWidth={2}
              nodeBorderRadius={6}
              nodeStrokeWidth={2}
              nodeStrokeColor={(n) =>
                n.type === 'ruleName' ? '#2E6BE6' : n.type === 'item' ? '#7B8794' : 'transparent'
              }
              nodeColor={(n) =>
                n.type === 'ruleName' ? '#2E6BE6' : n.type === 'item' ? '#C5CBD3' : 'transparent'
              }
            />
          ) : null}
          <Panel position="bottom-right">
            <div className="flex items-center gap-1.5">
              <Button
                size="icon-sm"
                variant="secondary"
                aria-label={showMap ? 'Hide minimap' : 'Show minimap'}
                aria-pressed={showMap}
                onClick={() => setShowMap((v) => !v)}
              >
                <MapIcon className="h-3.5 w-3.5" />
              </Button>
              <ZoomPanel />
            </div>
          </Panel>
          <Panel position="top-left">
            <p className="flex items-center gap-1.5 rounded-md bg-surface/90 px-2 py-1 text-2xs text-secondary shadow-sm">
              <ArrowDownWideNarrow className="h-3 w-3" aria-hidden />
              Hover a node to edit, delete or add before/after it.
            </p>
          </Panel>
        </ReactFlow>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border bg-surface px-4 py-2.5">
        <span className="mr-auto text-xs text-secondary">
          {p.dirty ? 'Unsaved rule changes' : 'Rule saved to the list'}
        </span>
        <Button variant="secondary" onClick={p.onCancel} disabled={readOnly || !p.dirty}>
          Cancel Rule
        </Button>
        {p.onTest ? (
          <DisabledReason reason={p.testReason}>
            <Button variant="secondary" onClick={p.onTest} disabled={Boolean(p.testReason)}>
              Test Rule
            </Button>
          </DisabledReason>
        ) : null}
        <Button variant="primary" onClick={p.onSave} disabled={readOnly || !p.dirty}>
          Save Rule
        </Button>
      </div>
      <ConditionModal
        state={conditionState}
        onClose={() => setEditing(null)}
        onSubmit={(c) => {
          if (!editing || (editing.section !== 'conditions' && editing.section !== 'inventoryConditions'))
            return;
          if (c === 'all') onChange({ ...rule, conditions: [] });
          else
            onChange({
              ...rule,
              [editing.section]: insertAt(
                listOf(editing.section) as RuleCondition[],
                editing.index,
                c,
                !editing.insert,
              ),
            });
          setEditing(null);
        }}
      />
      <ActionModal
        open={editing?.section === 'actions'}
        warehouseId={p.warehouseId}
        initial={
          editing?.section === 'actions' && !editing.insert
            ? (listOf('actions')[editing.index] as AlgorithmAction)
            : null
        }
        onClose={() => setEditing(null)}
        onSubmit={(a) => {
          if (editing?.section !== 'actions') return;
          onChange({
            ...rule,
            actions: insertAt(listOf('actions') as AlgorithmAction[], editing.index, a, !editing.insert),
          });
          setEditing(null);
        }}
      />
      <OrderByModal
        open={editing?.section === 'orderBy'}
        methods={orderMethods}
        used={(rule.orderBy ?? []).map((o) => o.field)}
        initial={
          editing?.section === 'orderBy' && !editing.insert
            ? (listOf('orderBy')[editing.index] as OrderByClause)
            : null
        }
        onClose={() => setEditing(null)}
        onSubmit={(o) => {
          if (editing?.section !== 'orderBy') return;
          onChange({
            ...rule,
            orderBy: insertAt(listOf('orderBy') as OrderByClause[], editing.index, o, !editing.insert),
          });
          setEditing(null);
        }}
      />
    </div>
  );
}

export function RuleCanvas(p: RuleCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...p} />
    </ReactFlowProvider>
  );
}

export function EmptyCanvas({ message }: { readonly message: string }) {
  return (
    <div
      className="flex flex-1 items-center justify-center bg-surface-sunken/40 p-8"
      style={{
        backgroundImage: 'radial-gradient(#C5CBD3 1px, transparent 1px)',
        backgroundSize: '18px 18px',
      }}
    >
      <p className="max-w-sm rounded-lg bg-surface px-4 py-3 text-center text-sm text-secondary shadow-sm">
        {message}
      </p>
    </div>
  );
}
