'use client';
/**
 * Quick output entry for one build on one day (docs/programs/SPEC.md 5.7): the table's Built cell
 * popover ("Built on Wed Nov 25", Add or Set) and the inline Built today inputs of the runs view
 * and the calendar popover. Saves through `logOutputAction` with Undo.
 */
import { useState } from 'react';
import { formatQty, quantityToScaled } from '@kitstak/programs-engine';
import { Button, ToggleGroup, toast } from '@/components/ui';
import type { IsoDate } from '@/lib/program-types';
import type { TaskSummary } from '@/lib/types';
import { logOutputAction, undoLogOutputAction } from '@/server/actions/output';
import { useCurrentProgram } from '../program-context';
import { dayLabel } from '../kit/format';
import { OutputCell } from '../kit/output-cell';
import { readQty } from '../kit/qty-input';
import { buildOf } from './builds-model';
import { useBuildActions } from './use-build-actions';

type Result<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: { readonly message: string } };
type Undo = Parameters<typeof undoLogOutputAction>[0]['undo'];

/** Logs entries for one day of one program, with an Undo toast. */
export function useLogEntries(programKey: string) {
  const actions = useBuildActions(programKey);
  return async (date: IsoDate, entries: readonly { readonly buildId: string; readonly mode: 'add' | 'set'; readonly qty: string }[], message: string): Promise<boolean> => {
    if (entries.length === 0) return true;
    const result = (await logOutputAction({ key: programKey, date, entries: entries.map((entry) => ({ ...entry })) })) as Result<{ undo: Undo }>;
    if (!result.ok) {
      toast.error("Couldn't log the output", result.error.message);
      actions.refresh();
      return false;
    }
    actions.refresh();
    const undo = result.data.undo;
    toast.undo(message, {
      onUndo: async () => {
        const back = (await undoLogOutputAction({ key: programKey, undo })) as Result<unknown>;
        actions.refresh();
        if (!back.ok) toast.error("Couldn't undo", back.error.message);
        else toast.success('Output put back');
      },
    });
    return true;
  };
}

export function BuiltEditor({ task, onDone }: { readonly task: TaskSummary; readonly onDone: () => void }) {
  const { key, unit, today, capabilities } = useCurrentProgram();
  const build = buildOf(task);
  const log = useLogEntries(key);
  const [mode, setMode] = useState<'add' | 'set'>('add');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  if (!build) return null;
  const day = build.buildDate > today ? today : build.buildDate;
  const future = build.buildDate > today;
  const read = readQty(value);
  const save = async () => {
    if (!read.ok || read.qty === null) return;
    setBusy(true);
    const ok = await log(day, [{ buildId: task.id, mode, qty: read.qty }], `${mode === 'add' ? 'Added' : 'Set'} ${formatQty(read.qty)} ${quantityToScaled(read.qty) === BigInt(1000) ? unit.singular : unit.plural} on ${task.key}`);
    setBusy(false);
    if (ok) onDone();
  };
  if (!capabilities.canLog) return <p className="p-3 text-sm text-fg-muted">You can view output. Editors can log it.</p>;
  return (
    <div className="flex w-64 flex-col gap-3 p-3" data-testid="built-editor">
      <div>
        <p className="text-sm font-semibold text-fg">Built on {dayLabel(day)}</p>
        <p className="text-xs text-fg-muted">{future ? 'This build is planned later, so output goes on today.' : `${formatQty(build.builtQty)} of ${formatQty(build.plannedQty)} ${unit.plural} so far.`}</p>
      </div>
      <ToggleGroup
        size="sm"
        label="Add or set"
        value={mode}
        onValueChange={setMode}
        options={[
          { value: 'add', label: 'Add' },
          { value: 'set', label: 'Set day total' },
        ]}
      />
      <OutputCell
        value={value}
        onChange={setValue}
        label={`Built on ${dayLabel(day)} for ${task.key}`}
        planned={build.plannedQty}
        builtBefore={build.builtQty}
        onEnter={() => void save()}
        lockedReason={build.locked ? 'This day is closed.' : null}
        size="md"
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => void save()} loading={busy} disabled={!read.ok || read.qty === null || build.locked}>
          Save
        </Button>
      </div>
    </div>
  );
}
