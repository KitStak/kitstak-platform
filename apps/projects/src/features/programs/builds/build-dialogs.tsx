'use client';
/**
 * The small dialogs behind build and run menus (docs/programs/SPEC.md 5.7): Set planned qty, Set
 * build rate (amount and a required reason), Move to day (date), Move run to day, Copy run to
 * (day list), Cancel run. Menus close before a dialog opens, so dialogs live in one host and are
 * opened through a tiny store:
 *
 *   openBuildDialog({ kind: 'planned', builds: [task] });
 *   <BuildDialogsHost programKey="GLOVE" />
 */
import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { addDays, isWorkDay, quantityToScaled, shortDate } from '@kitstak/programs-engine';
import { Button, Checkbox, ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, Field, Input, IsoDatePicker, Textarea, cn } from '@/components/ui';
import type { IsoDate, RunDTO } from '@/lib/program-types';
import type { TaskSummary } from '@/lib/types';
import { useCurrentProgram } from '../program-context';
import { dayLabel } from '../kit/format';
import { readQty, trimQty } from '../kit/qty-input';
import { buildOf } from './builds-model';
import { useBuildActions } from './use-build-actions';

export type BuildDialog =
  | { readonly kind: 'planned'; readonly builds: readonly TaskSummary[] }
  | { readonly kind: 'rate'; readonly build: TaskSummary }
  | { readonly kind: 'day'; readonly builds: readonly TaskSummary[] }
  | { readonly kind: 'move-run'; readonly run: RunDTO }
  | { readonly kind: 'copy-run'; readonly run: RunDTO }
  | { readonly kind: 'cancel-run'; readonly run: RunDTO };

interface DialogStore {
  readonly dialog: BuildDialog | null;
  open(dialog: BuildDialog): void;
  close(): void;
}

export const useBuildDialogStore = create<DialogStore>((set) => ({
  dialog: null,
  open: (dialog) => set({ dialog }),
  close: () => set({ dialog: null }),
}));

export function openBuildDialog(dialog: BuildDialog): void {
  // Let the menu that asked close and return focus first.
  window.setTimeout(() => useBuildDialogStore.getState().open(dialog), 0);
}

const RATE_RE = /^\$?\s*(\d{1,6})(\.\d{1,4})?$/;

/** Next `count` days after `from` with their work day flag (for Copy run to). */
function nextDays(from: IsoDate, count: number, workingDays: readonly number[] | null): { date: IsoDate; work: boolean }[] {
  return Array.from({ length: count }, (_, index) => {
    const date = addDays(from, index + 1);
    return { date, work: isWorkDay(date, workingDays ?? undefined) };
  });
}

function PlannedDialog({ builds, onDone }: { readonly builds: readonly TaskSummary[]; readonly onDone: () => void }) {
  const { key, unit } = useCurrentProgram();
  const actions = useBuildActions(key);
  const first = buildOf(builds[0]!);
  const [value, setValue] = useState(first && builds.length === 1 ? trimQty(first.plannedQty) : '');
  const [busy, setBusy] = useState(false);
  const read = readQty(value);
  const error = value.trim() && !read.ok ? read.message : null;
  const save = async () => {
    if (!read.ok || read.qty === null) return;
    setBusy(true);
    let ok = true;
    for (const task of builds) ok = (await actions.update(task, { plannedQty: read.qty })) && ok;
    setBusy(false);
    if (ok) onDone();
  };
  return (
    <>
      <DialogHeader title="Set planned qty" description={builds.length === 1 ? `${builds[0]!.key} · ${first?.variantName ?? builds[0]!.title}` : `${builds.length} builds get the same planned qty.`} />
      <DialogBody>
        <Field label={`Planned ${unit.plural}`} error={error}>
          {({ inputId, describedBy, invalid }) => (
            <Input id={inputId} aria-describedby={describedBy} invalid={invalid} autoFocus inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void save()} data-testid="planned-input" />
          )}
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={() => void save()} loading={busy} disabled={!read.ok || read.qty === null}>
          Save
        </Button>
      </DialogFooter>
    </>
  );
}

function RateDialog({ build: task, onDone }: { readonly build: TaskSummary; readonly onDone: () => void }) {
  const { key, unit } = useCurrentProgram();
  const actions = useBuildActions(key);
  const build = buildOf(task);
  const [value, setValue] = useState(build?.rateOverride ? build.rateOverride.replace(/0+$/, '').replace(/\.$/, '') : '');
  const [reason, setReason] = useState(build?.rateOverrideReason ?? '');
  const [busy, setBusy] = useState(false);
  const clearing = value.trim() === '';
  const match = RATE_RE.exec(value.trim());
  const amount = match ? `${match[1]}${match[2] ?? ''}` : null;
  const error = !clearing && !amount ? 'Type a price like 2.10 (up to 4 decimals).' : null;
  const save = async () => {
    if (error || (!clearing && !reason.trim())) return;
    setBusy(true);
    const ok = await actions.update(task, { rateOverride: clearing ? null : amount, rateOverrideReason: clearing ? null : reason.trim() }, clearing ? `${task.key} uses the price card again` : `${task.key} now earns $${amount} a ${unit.singular}`);
    setBusy(false);
    if (ok) onDone();
  };
  return (
    <>
      <DialogHeader title="Set build rate" description={`A rate on ${task.key} beats the price card for its open days. Locked days keep their price.`} />
      <DialogBody className="flex flex-col gap-4">
        <Field label={`Rate per ${unit.singular}`} error={error} hint="Leave it empty to use the price card again.">
          {({ inputId, describedBy, invalid }) => (
            <Input id={inputId} aria-describedby={describedBy} invalid={invalid} autoFocus inputMode="decimal" leadingIcon={<span className="text-sm text-fg-muted">$</span>} value={value} onChange={(event) => setValue(event.target.value)} data-testid="rate-input" />
          )}
        </Field>
        {!clearing ? (
          <Field label="Reason" required hint="Shown in the activity and on the build.">
            {({ inputId, describedBy }) => <Textarea id={inputId} aria-describedby={describedBy} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} data-testid="rate-reason" />}
          </Field>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={() => void save()} loading={busy} disabled={Boolean(error) || (!clearing && !reason.trim())}>
          {clearing ? 'Use card rate' : 'Set rate'}
        </Button>
      </DialogFooter>
    </>
  );
}

function DayDialog({ title, description, initial, onSave, onDone, busyLabel }: { readonly title: string; readonly description: string; readonly initial: IsoDate; readonly onSave: (date: IsoDate) => Promise<boolean>; readonly onDone: () => void; readonly busyLabel: string }) {
  const { program } = useCurrentProgram();
  const [date, setDate] = useState<IsoDate | null>(initial);
  const [busy, setBusy] = useState(false);
  const lockedThrough = program.locks.lockedThrough;
  const locked = Boolean(date && lockedThrough && date <= lockedThrough);
  const save = async () => {
    if (!date || locked) return;
    setBusy(true);
    const ok = await onSave(date);
    setBusy(false);
    if (ok) onDone();
  };
  return (
    <>
      <DialogHeader title={title} description={description} />
      <DialogBody>
        <Field label="Day" error={locked && lockedThrough ? `Days through ${shortDate(lockedThrough)} are closed.` : null}>
          {({ inputId }) => <IsoDatePicker id={inputId} value={date} onChange={setDate} />}
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={() => void save()} loading={busy} disabled={!date || locked}>
          {busyLabel}
        </Button>
      </DialogFooter>
    </>
  );
}

function CopyRunDialog({ run, onDone }: { readonly run: RunDTO; readonly onDone: () => void }) {
  const { key, program, today } = useCurrentProgram();
  const actions = useBuildActions(key);
  const start = run.date > today ? run.date : today;
  const days = useMemo(() => nextDays(start, 14, program.calendar.workingDays), [program.calendar.workingDays, start]);
  const [picked, setPicked] = useState<IsoDate[]>(() => days.filter((day) => day.work).slice(0, 1).map((day) => day.date));
  const [busy, setBusy] = useState(false);
  const toggle = (date: IsoDate) => setPicked((list) => (list.includes(date) ? list.filter((entry) => entry !== date) : [...list, date].sort()));
  const save = async () => {
    setBusy(true);
    const ok = await actions.copyRun(run.id, picked);
    setBusy(false);
    if (ok) onDone();
  };
  return (
    <>
      <DialogHeader title="Copy run to" description={`Makes the same ${run.builds} builds with the same planned qty on each day you pick.`} />
      <DialogBody>
        <div className="mb-2 flex gap-2">
          <Button size="xs" variant="secondary" onClick={() => setPicked(days.filter((day) => day.work).slice(0, 5).map((day) => day.date))}>
            Next 5 work days
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setPicked([])}>
            Clear
          </Button>
        </div>
        <ul className="grid grid-cols-2 gap-1 sm:grid-cols-2" aria-label="Days to copy to">
          {days.map((day) => (
            <li key={day.date}>
              <label className={cn('flex h-9 cursor-pointer items-center gap-2 rounded-md border border-border-subtle px-2.5 text-sm hover:bg-hover', picked.includes(day.date) && 'border-primary bg-primary-subtle')}>
                <Checkbox size="sm" checked={picked.includes(day.date)} onCheckedChange={() => toggle(day.date)} aria-label={dayLabel(day.date)} />
                <span className="text-fg">{dayLabel(day.date)}</span>
                {!day.work ? <span className="ml-auto text-2xs text-fg-muted">Day off</span> : null}
              </label>
            </li>
          ))}
        </ul>
      </DialogBody>
      <DialogFooter>
        <span className="mr-auto text-xs text-fg-muted tabular-nums">{picked.length ? `${picked.length} ${picked.length === 1 ? 'day' : 'days'} · ${picked.length * run.builds} builds` : 'Pick at least one day'}</span>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={() => void save()} loading={busy} disabled={picked.length === 0}>
          Copy run
        </Button>
      </DialogFooter>
    </>
  );
}

export function BuildDialogsHost() {
  const { key } = useCurrentProgram();
  const dialog = useBuildDialogStore((state) => state.dialog);
  const close = useBuildDialogStore((state) => state.close);
  const actions = useBuildActions(key);
  const [cancelBusy, setCancelBusy] = useState(false);
  useEffect(() => () => close(), [close]);

  if (dialog?.kind === 'cancel-run') {
    return (
      <ConfirmDialog
        open
        onOpenChange={(open) => !open && close()}
        title={`Cancel ${dialog.run.name} on ${dayLabel(dialog.run.date)}?`}
        description="Cancels every build in this run that has no output. Builds with output stay as they are."
        confirmLabel="Cancel run"
        cancelLabel="Keep run"
        destructive
        loading={cancelBusy}
        onConfirm={async () => {
          setCancelBusy(true);
          await actions.cancelRun(dialog.run.id, dialog.run.buildIds);
          setCancelBusy(false);
          close();
        }}
      />
    );
  }

  return (
    <Dialog open={dialog !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent size="sm" aria-describedby={undefined}>
        {dialog?.kind === 'planned' ? <PlannedDialog builds={dialog.builds} onDone={close} /> : null}
        {dialog?.kind === 'rate' ? <RateDialog build={dialog.build} onDone={close} /> : null}
        {dialog?.kind === 'day' ? (
          <DayDialog
            title={dialog.builds.length === 1 ? `Move ${dialog.builds[0]!.key} to a day` : `Move ${dialog.builds.length} builds to a day`}
            description="Output already logged stays on its own day."
            initial={buildOf(dialog.builds[0]!)?.buildDate ?? dialog.builds[0]!.dueDate ?? ''}
            busyLabel="Move"
            onDone={close}
            onSave={async (date) => {
              let ok = true;
              for (const task of dialog.builds) ok = (await actions.update(task, { buildDate: date })) && ok;
              return ok;
            }}
          />
        ) : null}
        {dialog?.kind === 'move-run' ? (
          <DayDialog
            title="Move run to day"
            description={`${dialog.run.name} has ${dialog.run.builds} builds. Builds with output stay on their day.`}
            initial={dialog.run.date}
            busyLabel="Move run"
            onDone={close}
            onSave={(date) => actions.moveRun(dialog.run.id, date, dayLabel(date))}
          />
        ) : null}
        {dialog?.kind === 'copy-run' ? <CopyRunDialog run={dialog.run} onDone={close} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/** Sum of planned qty, for headers ("3 builds · 300 kits"). */
export function sumPlanned(tasks: readonly TaskSummary[]): bigint {
  return tasks.reduce((sum, task) => sum + quantityToScaled(buildOf(task)?.plannedQty ?? '0'), BigInt(0));
}
