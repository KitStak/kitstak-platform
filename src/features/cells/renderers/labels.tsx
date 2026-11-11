'use client';
import { useMemo, useState } from 'react';
import { ListChecks } from 'lucide-react';
import { Tooltip, cn, labelColorStyle, toast } from '@/components/ui';
import type { Label } from '@/server/db/schema/column-types';
import type { CellRenderContext, CellRenderer } from '../cell-context';
import { LabelEditor } from '../label-editor';
import { LabelPicker } from '../label-picker';
import {
  defaultLabel,
  dropdownLabelIds,
  findLabel,
  labelsFromSettings,
  newLabelId,
  nextLabelColor,
  statusLabelId,
} from '../lib/labels';
import { EmptyGhost } from '../parts/common';
import { useLabelUsage } from '../services';
import type { LabelChange } from '../types';

function useLabels(ctx: CellRenderContext): Label[] {
  return useMemo(() => labelsFromSettings(ctx.column.settings), [ctx.column.settings]);
}

// ---------------------------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------------------------

function StatusDisplay({ ctx }: { readonly ctx: CellRenderContext }) {
  const labels = useLabels(ctx);
  const label = findLabel(labels, statusLabelId(ctx.value));
  const blank = defaultLabel(labels);
  const shown = label ?? null;
  return (
    <span
      className="ks-pill"
      data-empty={shown ? undefined : 'true'}
      data-label-id={shown?.id}
      style={labelColorStyle(shown?.color ?? 'gray')}
    >
      <span className="ks-pill-chip">
        <span className="truncate">{shown ? shown.name || ' ' : (blank?.name ?? '')}</span>
      </span>
      <span className="sr-only">{shown ? '' : 'No status'}</span>
    </span>
  );
}

/** Shared "pick ⇄ edit labels" panel used by status and dropdown editors. */
function LabelsPanel({
  ctx,
  labels,
  renderPicker,
}: {
  readonly ctx: CellRenderContext;
  readonly labels: readonly Label[];
  readonly renderPicker: (openEditor: (() => void) | undefined) => React.ReactNode;
}) {
  const [mode, setMode] = useState<'pick' | 'edit'>('pick');
  const [saving, setSaving] = useState(false);
  const { saveLabels, boardItems } = ctx.services;
  const fallbackItems = useMemo(() => boardItems ?? [ctx.item], [boardItems, ctx.item]);
  const { usage } = useLabelUsage(ctx.column, fallbackItems);
  const kind = ctx.column.type === 'status' ? 'status' : 'dropdown';

  const apply = async (change: LabelChange) => {
    if (!saveLabels) return;
    setSaving(true);
    try {
      await saveLabels(ctx.column, change);
      toast.success('Labels updated');
      setMode('pick');
    } catch (error) {
      toast.error("Couldn't save labels", error instanceof Error ? error.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  if (mode === 'edit' && saveLabels) {
    return (
      <div className="w-[300px]">
        <LabelEditor
          kind={kind}
          labels={labels}
          usage={usage}
          saving={saving}
          itemNoun={ctx.board?.itemTerminology ?? 'item'}
          onApply={apply}
          onCancel={() => setMode('pick')}
          registerDismissGuard={ctx.registerDismissGuard}
        />
      </div>
    );
  }
  return <>{renderPicker(saveLabels && !ctx.readOnly ? () => setMode('edit') : undefined)}</>;
}

function StatusEditor({ ctx }: { readonly ctx: CellRenderContext }) {
  const labels = useLabels(ctx);
  const current = statusLabelId(ctx.value);
  return (
    <LabelsPanel
      ctx={ctx}
      labels={labels}
      renderPicker={(openEditor) => (
        <LabelPicker
          className="w-[216px]"
          mode="single"
          labels={labels}
          value={current ? [current] : []}
          aria-label={`${ctx.column.title} labels`}
          onEditLabels={openEditor}
          onSelect={(labelId) => {
            if (labelId !== current) ctx.commit(labelId ? { labelId } : null);
            ctx.endEdit();
          }}
        />
      )}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Dropdown
// ---------------------------------------------------------------------------------------------

/** Estimate how many chips fit in the column (no layout pass needed). */
function chipsThatFit(labels: readonly Label[], width: number): number {
  let used = 16;
  let count = 0;
  for (const label of labels) {
    const chip = Math.min(140, label.name.length * 7 + 28);
    if (used + chip > width - (count < labels.length - 1 ? 36 : 0) && count > 0) break;
    used += chip + 4;
    count += 1;
  }
  return Math.max(1, count);
}

export function LabelChip({ label, className }: { readonly label: Label; readonly className?: string }) {
  return (
    <span
      style={labelColorStyle(label.color)}
      className={cn('inline-flex h-6 min-w-0 shrink items-center rounded-sm bg-[var(--lc-subtle)] px-2 text-sm text-fg', className)}
    >
      <span aria-hidden className="mr-1.5 size-2 shrink-0 rounded-full bg-[var(--lc-bg)]" />
      <span className="truncate">{label.name || 'Untitled'}</span>
    </span>
  );
}

function DropdownDisplay({ ctx }: { readonly ctx: CellRenderContext }) {
  const labels = useLabels(ctx);
  const picked = dropdownLabelIds(ctx.value)
    .map((id) => findLabel(labels, id))
    .filter((label): label is Label => Boolean(label));
  if (picked.length === 0) {
    return ctx.readOnly ? null : <EmptyGhost icon={<ListChecks aria-hidden />} label="Add labels" />;
  }
  const fit = chipsThatFit(picked, ctx.column.width);
  const shown = picked.slice(0, fit);
  const hidden = picked.slice(fit);
  return (
    <span className="flex min-w-0 flex-1 items-center justify-center gap-1 px-2">
      {shown.map((label) => (
        <LabelChip key={label.id} label={label} />
      ))}
      {hidden.length ? (
        <Tooltip content={hidden.map((label) => label.name).join(', ')} side="top">
          <span className="inline-flex h-6 shrink-0 items-center rounded-sm bg-muted px-1.5 text-xs font-semibold text-fg-secondary">
            +{hidden.length}
          </span>
        </Tooltip>
      ) : null}
    </span>
  );
}

function DropdownEditor({ ctx }: { readonly ctx: CellRenderContext }) {
  const labels = useLabels(ctx);
  const [selected, setSelected] = useState<string[]>(() => dropdownLabelIds(ctx.value));
  const { saveLabels } = ctx.services;

  const write = (next: string[]) => {
    setSelected(next);
    ctx.commit(next.length ? { labelIds: next } : null);
  };

  const create = async (name: string) => {
    if (!saveLabels) return;
    const label: Label = { id: newLabelId(labels), name, color: nextLabelColor(labels), position: labels.length };
    try {
      await saveLabels(ctx.column, { labels: [...labels, label], reassign: new Map() });
      write([...selected, label.id]);
    } catch (error) {
      toast.error("Couldn't create the label", error instanceof Error ? error.message : undefined);
    }
  };

  return (
    <LabelsPanel
      ctx={ctx}
      labels={labels}
      renderPicker={(openEditor) => (
        <LabelPicker
          className="w-[256px]"
          mode="multi"
          labels={labels}
          value={selected}
          aria-label={`${ctx.column.title} options`}
          onEditLabels={openEditor}
          onCreate={saveLabels ? (name) => void create(name) : undefined}
          onSelect={(labelId) => {
            if (!labelId) return;
            write(selected.includes(labelId) ? selected.filter((id) => id !== labelId) : [...selected, labelId]);
          }}
        />
      )}
    />
  );
}

export const statusRenderer: CellRenderer = {
  behavior: { mode: 'popover', clearable: true, width: 216, popup: 'listbox' },
  Display: StatusDisplay,
  Editor: StatusEditor,
};

export const dropdownRenderer: CellRenderer = {
  behavior: { mode: 'popover', clearable: true, width: 256, popup: 'listbox' },
  Display: DropdownDisplay,
  Editor: DropdownEditor,
};
