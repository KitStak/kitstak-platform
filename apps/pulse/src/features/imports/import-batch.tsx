'use client';
/**
 * Steps 2 to 4 of an import, driven by the state of the batch: match columns, check every row
 * (the dry run), and the result with Undo. Every problem is shown in plain words on its cell and
 * can be fixed in place or the row left out, before anything is saved.
 */
import { ScrollX } from '@/components/ui/scroll-x';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, CircleAlert, CircleCheck, Download, Info, Pencil, RotateCcw, Save, Trash2, TriangleAlert, Undo2, Upload } from 'lucide-react';
import { Badge, Button, Checkbox, ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, Field, Input, ProgressBar, Select, Skeleton, Switch, TablePagination, ToggleGroup, toast } from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { Teach } from '@/components/pulse/teach';
import { anyStreamDef, type ColumnDef } from '@/lib/csv/streams';
import { formatNumber } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import { errorText, fileLinks, importApi, importKeys } from './api';
import { IMPORT_ACTION_LABELS, type ImportAction, type ImportBatchDTO, type ImportCounts, type ImportOptions, type ImportPresetDTO, type ImportProgressDTO, type ImportRowDTO } from './types';
import { When } from './when';

const IGNORE = '__ignore__';
const PAGE_SIZE = 50;

const count = (value: number): string => formatNumber(value, { maxDigits: 0 });
const rowsWord = (value: number): string => `${count(value)} ${value === 1 ? 'row' : 'rows'}`;

const ACTION_TONE: Readonly<Record<ImportAction, 'success' | 'info' | 'neutral' | 'warning' | 'danger'>> = {
  create: 'success',
  update: 'info',
  unchanged: 'neutral',
  lookalike: 'warning',
  skip: 'neutral',
  error: 'danger',
};

const KIND_WORDS: Readonly<Record<string, string>> = { client: 'Client', job_type: 'Job type', labor_class: 'Labor class', item: 'Item' };

type Step = 'map' | 'check' | 'done';

function Stepper({ step }: { readonly step: Step }) {
  const steps: readonly [string, string][] = [
    ['upload', 'Upload'],
    ['map', 'Match columns'],
    ['check', 'Check'],
    ['done', 'Done'],
  ];
  const current = steps.findIndex(([id]) => id === step);
  return (
    <ol aria-label="Steps of this import" className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="import-steps" data-step={step}>
      {steps.map(([id, label], index) => {
        const state = index < current || step === 'done' ? 'done' : index === current ? 'current' : 'next';
        return (
          <li key={id} aria-current={state === 'current' ? 'step' : undefined} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden
              className={cn(
                'flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                state === 'done' && 'bg-success-subtle text-success-text',
                state === 'current' && 'bg-primary text-primary-fg',
                state === 'next' && 'bg-muted text-fg-muted',
              )}
            >
              {state === 'done' ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}
            </span>
            <span className={cn(state === 'next' ? 'text-fg-muted' : 'font-medium text-fg')}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function ImportBatch({ initial }: { readonly initial: ImportBatchDTO }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const query = useQuery({ queryKey: importKeys.batch(initial.id), queryFn: () => importApi.batch(initial.id), initialData: initial, staleTime: 30_000 });
  const batch = query.data;
  const [remap, setRemap] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const step: Step = batch.status === 'committed' || batch.status === 'undone' ? 'done' : batch.status === 'checked' && !remap ? 'check' : 'map';

  const setBatch = (next: ImportBatchDTO): void => {
    queryClient.setQueryData(importKeys.batch(next.id), next);
    void queryClient.invalidateQueries({ queryKey: [...importKeys.batch(next.id), 'rows'] });
    void queryClient.invalidateQueries({ queryKey: importKeys.center() });
  };

  const discard = async (): Promise<void> => {
    setBusy(true);
    try {
      await importApi.discard(batch.id);
      await queryClient.invalidateQueries({ queryKey: importKeys.center() });
      toast.success('Import discarded', 'Nothing from that file was saved.');
      router.push(routes.importCenter());
    } catch (error) {
      toast.error('Could not discard the import', errorText(error));
      setBusy(false);
    }
  };

  if (batch.status === 'uploading') {
    return (
      <Panel>
        <Teach
          testId="import-unfinished"
          icon={Upload}
          title="This file did not finish uploading"
          why="The upload stopped part of the way, so Pulse does not have all the rows. Nothing was saved. Discard it and upload the file again."
          actions={
            <Button variant="danger" loading={busy} onClick={() => void discard()} data-testid="import-discard">
              Discard and start again
            </Button>
          }
        />
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Stepper step={step} />
        <p className="text-sm text-fg-muted">
          <span className="font-medium text-fg">{batch.fileName ?? 'Pasted rows'}</span>, {rowsWord(batch.totalRows)}
        </p>
      </div>
      {step === 'map' ? <MapStep batch={batch} onChecked={(next) => { setRemap(false); setBatch(next); }} onDiscard={() => setDiscardOpen(true)} /> : null}
      {step === 'check' ? <CheckStep batch={batch} onBatch={setBatch} onRemap={() => setRemap(true)} onDiscard={() => setDiscardOpen(true)} /> : null}
      {step === 'done' ? <DoneStep batch={batch} onBatch={setBatch} /> : null}
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Discard this import?"
        description="Nothing from this file was saved yet. Discarding it removes the uploaded rows."
        confirmLabel="Discard"
        destructive
        loading={busy}
        onConfirm={() => void discard()}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Step 2: match columns                                                                       */
/* ------------------------------------------------------------------------------------------ */

function MapStep({ batch, onChecked, onDiscard }: { readonly batch: ImportBatchDTO; readonly onChecked: (batch: ImportBatchDTO) => void; readonly onDiscard: () => void }) {
  const queryClient = useQueryClient();
  const def = useMemo(() => anyStreamDef(batch.stream), [batch.stream]);
  const [mapping, setMapping] = useState<(string | null)[]>(() => [...batch.mapping]);
  const [auto] = useState<(string | null)[]>(() => [...batch.mapping]);
  const [options, setOptions] = useState<ImportOptions>(batch.options);
  const [remember, setRemember] = useState(false);
  const [presetName, setPresetName] = useState(() => (batch.fileName ?? `${batch.streamName} file`).replace(/\.[A-Za-z0-9]+$/, '').slice(0, 60));
  const [managing, setManaging] = useState(false);
  const [checking, setChecking] = useState(false);
  const sample = useQuery({ queryKey: importKeys.rows(batch.id, { sample: true }), queryFn: () => importApi.rows(batch.id, { limit: 5 }), staleTime: 60_000 });
  const presets = useQuery({ queryKey: importKeys.presets(batch.stream), queryFn: () => importApi.presets(batch.stream), staleTime: 60_000 });

  const used = new Map<string, number>();
  for (const key of mapping) if (key) used.set(key, (used.get(key) ?? 0) + 1);
  const missing = def.columns.filter((column) => column.required && !used.has(column.key));
  const doubled = [...used.entries()].filter(([, times]) => times > 1).map(([key]) => key);
  const matched = mapping.filter((key) => key !== null).length;
  const columnOptions = useMemo(
    () => [
      { value: IGNORE, label: 'Do not import this column' },
      ...def.columns.map((column: ColumnDef) => ({ value: column.key, label: `${column.label}${column.required ? ' (needed)' : ''}`, description: column.key })),
    ],
    [def],
  );

  const applyPreset = (preset: ImportPresetDTO): void => {
    const lookup = new Map(Object.entries(preset.mapping).map(([header, column]) => [header.trim().toLowerCase(), column]));
    setMapping(batch.headers.map((header, index) => (lookup.has(header.trim().toLowerCase()) ? (lookup.get(header.trim().toLowerCase()) ?? null) : (mapping[index] ?? null))));
    setOptions((current) => ({ ...current, ...preset.options }));
    toast.success(`Used "${preset.name}"`, 'Check the matches below, then check the file.');
  };

  const check = async (): Promise<void> => {
    setChecking(true);
    try {
      const next = await importApi.check(batch.id, { mapping, options, savePresetAs: remember && presetName.trim() ? presetName.trim() : null });
      if (remember) void queryClient.invalidateQueries({ queryKey: importKeys.presets(batch.stream) });
      onChecked(next);
    } catch (error) {
      toast.error('Could not check the file', errorText(error));
    } finally {
      setChecking(false);
    }
  };

  const samples = (index: number): string => {
    const values = (sample.data?.rows ?? []).map((row) => (row.cells[index] ?? '').trim()).filter((value) => value !== '');
    return [...new Set(values)].slice(0, 3).join(', ');
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
      <Panel title="2. Match your columns" bodyClassName="p-0">
        <p className="border-b border-border-subtle px-4 py-3 text-sm text-fg-secondary">
          Pulse matched {matched} of your {batch.headers.length} columns by their names. Check each one. A column set to &quot;Do not import&quot; is left out.
        </p>
        <ul className="divide-y divide-border-subtle" data-testid="mapping-list">
          {batch.headers.map((header, index) => {
            const value = mapping[index] ?? null;
            const column = value ? def.columns.find((item) => item.key === value) : undefined;
            const isAuto = value !== null && auto[index] === value;
            const clash = value !== null && doubled.includes(value);
            return (
              <li key={`${header}-${index}`} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center" data-testid={`map-row-${index}`}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-fg">{header || `Column ${index + 1} (no name)`}</p>
                  <p className="truncate text-xs text-fg-muted">{sample.isLoading ? 'Reading sample values' : samples(index) ? `For example: ${samples(index)}` : 'Every cell in the first rows is empty'}</p>
                </div>
                <div className="min-w-0">
                  <Select
                    aria-label={`What "${header || `column ${index + 1}`}" is`}
                    value={value ?? IGNORE}
                    invalid={clash}
                    onValueChange={(next) => setMapping((current) => current.map((item, position) => (position === index ? (next === IGNORE ? null : next) : item)))}
                    options={columnOptions}
                  />
                  <p className={cn('mt-1 text-xs', clash ? 'text-danger-text' : 'text-fg-muted')}>
                    {clash ? 'Two of your columns are matched to this. Match only one.' : column ? `${isAuto ? 'Matched for you. ' : ''}${column.help}` : 'This column will be left out.'}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>

      <div className="flex flex-col gap-5">
        <Panel title="Before you check">
          <div className="flex flex-col gap-4">
            {missing.length > 0 ? (
              <div role="alert" data-testid="mapping-missing" className="rounded-lg border border-danger/40 bg-danger-subtle px-3 py-2.5 text-sm text-danger-text">
                <p className="flex items-start gap-2 font-medium">
                  <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                  Still needed: {missing.map((column) => column.label.toLowerCase()).join(', ')}
                </p>
                <p className="mt-1 pl-6">Match one of your columns to each of these. A row cannot be saved without them.</p>
              </div>
            ) : (
              <p className="flex items-start gap-2 rounded-lg border border-success/40 bg-success-subtle px-3 py-2.5 text-sm text-success-text" data-testid="mapping-ready">
                <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
                Every needed column is matched.
              </p>
            )}

            {(presets.data ?? []).length > 0 ? (
              <Field label="Use a saved mapping" hint="Mappings you saved for this kind of file.">
                {({ inputId }) => (
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <Select
                        id={inputId}
                        value={undefined}
                        placeholder="Pick a saved mapping"
                        onValueChange={(id) => {
                          const preset = (presets.data ?? []).find((item) => item.id === id);
                          if (preset) applyPreset(preset);
                        }}
                        options={(presets.data ?? []).map((preset) => ({ value: preset.id, label: preset.name }))}
                      />
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setManaging(true)} data-testid="presets-manage">
                      Manage
                    </Button>
                  </div>
                )}
              </Field>
            ) : null}

            <Field label="Dates like 3/4/2026" hint="Dates written 2026-03-04 or Mar 4 2026 are always read the same way.">
              {({ inputId }) => (
                <Select
                  id={inputId}
                  value={options.dateOrder ?? 'auto'}
                  onValueChange={(value) => setOptions((current) => ({ ...current, dateOrder: value === 'auto' ? null : (value as 'MDY' | 'DMY') }))}
                  options={[
                    { value: 'auto', label: 'Let Pulse work it out' },
                    { value: 'MDY', label: 'Month first: March 4' },
                    { value: 'DMY', label: 'Day first: April 3' },
                  ]}
                />
              )}
            </Field>

            <Switch
              checked={options.createMissing}
              onCheckedChange={(checked) => setOptions((current) => ({ ...current, createMissing: checked }))}
              label="Add what is missing"
              description="When the file names a client, job type or item that Pulse does not have yet, add it. Each one is listed in the check. New labor classes are asked for on the next step."
              data-testid="option-create-missing"
            />

            <div className="flex flex-col gap-2 border-t border-border-subtle pt-3">
              <Checkbox checked={remember} onCheckedChange={(checked) => setRemember(checked === true)} label="Remember this mapping" description="The next file with the same column names will match itself." data-testid="preset-remember" />
              {remember ? (
                <Field label="Name for this mapping">
                  {({ inputId }) => <Input id={inputId} value={presetName} maxLength={80} onChange={(event) => setPresetName(event.target.value)} data-testid="preset-name" />}
                </Field>
              ) : null}
            </div>
          </div>
        </Panel>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" leadingIcon={<Trash2 aria-hidden className="size-4" />} onClick={onDiscard}>
            Discard
          </Button>
          <Button onClick={() => void check()} loading={checking} disabled={missing.length > 0 || doubled.length > 0} data-testid="mapping-check">
            Check the file
          </Button>
        </div>
        <p className="text-xs text-fg-muted">The check saves nothing. It shows what each row would do first.</p>
      </div>
      <PresetManager open={managing} onOpenChange={setManaging} stream={batch.stream} presets={presets.data ?? []} />
    </div>
  );
}

function PresetManager({ open, onOpenChange, stream, presets }: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly stream: string; readonly presets: readonly ImportPresetDTO[] }) {
  const queryClient = useQueryClient();
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = (): Promise<void> => queryClient.invalidateQueries({ queryKey: importKeys.presets(stream) });

  const rename = async (preset: ImportPresetDTO): Promise<void> => {
    const name = (names[preset.id] ?? preset.name).trim();
    if (name === '' || name === preset.name) return;
    setBusy(preset.id);
    try {
      await importApi.renamePreset(preset.id, name);
      await refresh();
      toast.success('Mapping renamed');
    } catch (error) {
      toast.error('Could not rename the mapping', errorText(error));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (preset: ImportPresetDTO): Promise<void> => {
    setBusy(preset.id);
    try {
      await importApi.deletePreset(preset.id);
      await refresh();
      toast.undo(`Deleted "${preset.name}"`, {
        onUndo: async () => {
          const headers = Object.keys(preset.mapping);
          await importApi.savePreset({ stream, name: preset.name, headers, mapping: headers.map((header) => preset.mapping[header] ?? null), options: preset.options });
          await refresh();
        },
      });
    } catch (error) {
      toast.error('Could not delete the mapping', errorText(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="presets-dialog">
        <DialogHeader title="Saved mappings" description="Rename a mapping or delete one you no longer use." />
        <DialogBody>
          {presets.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-muted">No saved mappings yet. Tick &quot;Remember this mapping&quot; before you check a file.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border-subtle">
              {presets.map((preset) => (
                <li key={preset.id} className="flex items-center gap-2 py-2.5">
                  <Input aria-label={`Name of the mapping ${preset.name}`} value={names[preset.id] ?? preset.name} maxLength={80} onChange={(event) => setNames((current) => ({ ...current, [preset.id]: event.target.value }))} containerClassName="min-w-0 flex-1" />
                  <Button size="sm" variant="secondary" loading={busy === preset.id} disabled={(names[preset.id] ?? preset.name).trim() === preset.name || (names[preset.id] ?? preset.name).trim() === ''} onClick={() => void rename(preset)}>
                    Rename
                  </Button>
                  <Button size="sm" variant="danger-ghost" disabled={busy === preset.id} onClick={() => void remove(preset)} aria-label={`Delete the mapping ${preset.name}`}>
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Step 3: check                                                                               */
/* ------------------------------------------------------------------------------------------ */

type Filter = ImportAction | 'all' | 'problems';

const TILES: readonly { id: ImportAction; label: string; hint: string }[] = [
  { id: 'create', label: 'New', hint: 'Rows that will be added' },
  { id: 'update', label: 'Changed', hint: 'Rows already here that will change' },
  { id: 'unchanged', label: 'No change', hint: 'Already here and the same' },
  { id: 'lookalike', label: 'Look the same', hint: 'Left out so nothing is counted twice' },
  { id: 'skip', label: 'Left out', hint: 'Rows you chose to leave out' },
  { id: 'error', label: 'Problems', hint: 'Rows that cannot be saved as they are' },
];

function CountTiles({ counts, filter, onFilter }: { readonly counts: ImportCounts; readonly filter: Filter; readonly onFilter: (filter: Filter) => void }) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6" data-testid="check-counts">
      {TILES.map((tile) => {
        const value = counts[tile.id];
        const active = filter === tile.id;
        return (
          <li key={tile.id}>
            <button
              type="button"
              aria-pressed={active}
              onClick={() => onFilter(active ? 'all' : tile.id)}
              data-testid={`count-${tile.id}`}
              data-count={value}
              className={cn(
                'flex h-full w-full flex-col items-start rounded-xl border bg-panel px-3 py-2.5 text-left shadow-xs transition-colors',
                'hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                active ? 'border-primary ring-1 ring-primary' : 'border-border-subtle',
              )}
            >
              <span className="text-xs font-medium text-fg-muted">{tile.label}</span>
              <span className={cn('text-xl font-semibold tabular-nums', tile.id === 'error' && value > 0 ? 'text-danger-text' : 'text-fg')}>{count(value)}</span>
              <span className="mt-0.5 text-2xs text-fg-muted">{tile.hint}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** "PACK", "PACK and LEAD" or "PACK, LEAD and 3 more", for a sentence. */
function listWords(codes: readonly string[]): string {
  const shown = codes.slice(0, 3);
  const more = codes.length - shown.length;
  if (more > 0) return `${shown.join(', ')} and ${more} more`;
  if (shown.length <= 1) return shown[0] ?? '';
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

function CheckStep({ batch, onBatch, onRemap, onDiscard }: { readonly batch: ImportBatchDTO; readonly onBatch: (batch: ImportBatchDTO) => void; readonly onRemap: () => void; readonly onDiscard: () => void }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>(batch.counts.error > 0 ? 'error' : 'all');
  const [working, setWorking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<ImportProgressDTO | null>(null);
  const { counts, options } = batch;
  const toSave = counts.create + counts.update;
  const blocked = batch.problems.length > 0 || (counts.error > 0 && options.mode === 'all_or_nothing');

  const recheck = async (patch: Partial<ImportOptions>): Promise<void> => {
    setWorking(true);
    try {
      onBatch(await importApi.check(batch.id, { options: { ...options, ...patch } }));
    } catch (error) {
      toast.error('Could not check the file again', errorText(error));
    } finally {
      setWorking(false);
    }
  };

  const skipProblems = async (): Promise<void> => {
    setWorking(true);
    try {
      let next = batch;
      // Leave out every row with a problem, a page at a time.
      for (let guard = 0; guard < 200 && next.counts.error > 0; guard += 1) {
        const page = await importApi.rows(batch.id, { action: 'error', limit: 500 });
        if (page.rows.length === 0) break;
        next = await importApi.editRows(
          batch.id,
          page.rows.map((row) => ({ rowNumber: row.rowNumber, skip: true })),
        );
      }
      onBatch(next);
      setFilter('all');
      toast.success('Rows with problems are left out', 'You can put any of them back from the Left out list.');
    } catch (error) {
      toast.error('Could not leave those rows out', errorText(error));
    } finally {
      setWorking(false);
    }
  };

  useEffect(() => {
    if (!saving) return undefined;
    const timer = window.setInterval(() => {
      void importApi
        .progress(batch.id)
        .then(setProgress)
        .catch(() => undefined);
    }, 700);
    return () => window.clearInterval(timer);
  }, [saving, batch.id]);

  const save = async (): Promise<void> => {
    setSaving(true);
    setProgress({ phase: 'checking', done: 0, total: toSave });
    try {
      const saved = await importApi.commit(batch.id);
      for (const key of [qk.streams(), qk.jobsRoot(), qk.profitRoot(), qk.summaryRoot(), qk.badges()]) void queryClient.invalidateQueries({ queryKey: key });
      onBatch(saved);
      toast.success(toSave > 0 ? `Saved ${rowsWord(toSave)}` : 'Import finished', toSave > 0 ? 'You can undo this import for 7 days.' : 'Every row was already in Pulse, so nothing changed.');
    } catch (error) {
      toast.error('Nothing was saved', errorText(error));
      void queryClient.invalidateQueries({ queryKey: importKeys.batch(batch.id) });
    } finally {
      setSaving(false);
      setProgress(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {batch.problems.length > 0 ? (
        <div role="alert" data-testid="check-file-problems" className="rounded-xl border border-danger/40 bg-danger-subtle px-4 py-3 text-sm text-danger-text">
          <p className="flex items-center gap-2 font-semibold">
            <TriangleAlert aria-hidden className="size-4" />
            This file cannot be checked yet
          </p>
          <ul className="mt-1.5 list-disc pl-6">
            {batch.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
          <div className="mt-2">
            <Button size="sm" variant="secondary" onClick={onRemap}>
              Back to columns
            </Button>
          </div>
        </div>
      ) : null}

      <CountTiles counts={counts} filter={filter} onFilter={setFilter} />

      {batch.sameFileNote || batch.dateOrderNote || batch.willCreate.length > 0 || counts.warning > 0 ? (
        <ul className="flex flex-col gap-1.5 rounded-xl border border-border-subtle bg-sunken px-4 py-3 text-sm text-fg-secondary" data-testid="check-notes">
          {batch.sameFileNote ? (
            <li className="flex items-start gap-2" data-testid="note-same-file">
              <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-icon-strong" />
              {batch.sameFileNote}
            </li>
          ) : null}
          {batch.dateOrderNote ? (
            <li className="flex items-start gap-2">
              <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-icon-strong" />
              {batch.dateOrderNote}
            </li>
          ) : null}
          {batch.willCreate.length > 0 ? (
            <li className="flex items-start gap-2" data-testid="note-will-create">
              <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-icon-strong" />
              <span>
                Pulse will also add {batch.willCreate.length === 1 ? 'one record' : `${batch.willCreate.length} records`} the file names and you do not have yet:{' '}
                {batch.willCreate
                  .slice(0, 12)
                  .map((item) => `${KIND_WORDS[item.kind] ?? item.kind} ${item.code}`)
                  .join(', ')}
                {batch.willCreate.length > 12 ? `, and ${batch.willCreate.length - 12} more` : ''}.
              </span>
            </li>
          ) : null}
          {counts.warning > 0 ? (
            <li className="flex items-start gap-2">
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-text" />
              <span>
                {rowsWord(counts.warning)} {counts.warning === 1 ? 'has' : 'have'} a note worth a look. They can still be saved.{' '}
                <button type="button" className="font-medium text-fg-link hover:underline" onClick={() => setFilter('problems')}>
                  Show them
                </button>
              </span>
            </li>
          ) : null}
        </ul>
      ) : null}

      <Panel
        title="3. Check every row"
        bodyClassName="p-0"
        action={
          counts.error + counts.lookalike > 0 ? (
            <a href={fileLinks.errorReport(batch.id)} download data-testid="error-report" className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-fg-secondary hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
              <Download aria-hidden className="size-4" />
              Download rows with problems
            </a>
          ) : null
        }
      >
        <RowsTable batch={batch} filter={filter} onFilter={setFilter} onBatch={onBatch} />
      </Panel>

      <div className="rounded-xl border border-border-subtle bg-panel p-4 shadow-xs">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="flex flex-col gap-3">
            {counts.error > 0 ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-fg">When a row has a problem</span>
                <ToggleGroup
                  className="self-start"
                  label="When a row has a problem"
                  value={options.mode}
                  onValueChange={(mode) => void recheck({ mode })}
                  options={[
                    { value: 'all_or_nothing', label: 'Save nothing' },
                    { value: 'skip_bad_rows', label: 'Skip bad rows' },
                  ]}
                />
                <span className="text-xs text-fg-muted">
                  {options.mode === 'all_or_nothing' ? 'One problem stops the whole file, so you never end up with half of it saved.' : `The ${rowsWord(counts.error)} with problems will be left out. The rest are saved.`}
                </span>
                <div>
                  <Button size="sm" variant="secondary" loading={working} onClick={() => void skipProblems()} data-testid="skip-problems">
                    Leave out all {rowsWord(counts.error)} with problems
                  </Button>
                </div>
              </div>
            ) : null}
            {batch.missingLaborClasses.length > 0 || options.createLaborClasses ? (
              <Checkbox
                checked={options.createLaborClasses}
                disabled={working}
                onCheckedChange={(checked) => void recheck({ createLaborClasses: checked === true })}
                label="Add new labor classes"
                description={
                  batch.missingLaborClasses.length > 0
                    ? `Pulse does not have ${listWords(batch.missingLaborClasses)}. Turn this on to add ${batch.missingLaborClasses.length === 1 ? 'it' : 'them'}. A new class has no rate yet, so its hours cost the workspace default until you set one in Labor.`
                    : 'New labor classes in this file will be added. A new class has no rate yet, so its hours cost the workspace default until you set one in Labor.'
                }
                data-testid="option-create-labor-classes"
              />
            ) : null}
            {counts.lookalike > 0 || options.lookalikes === 'add' ? (
              <Switch
                checked={options.lookalikes === 'add'}
                disabled={working}
                onCheckedChange={(checked) => void recheck({ lookalikes: checked ? 'add' : 'skip' })}
                label="Add them anyway"
                description="Rows that look the same as rows already here are left out, so money is not counted twice. Turn this on when they really are separate rows."
                data-testid="option-lookalikes"
              />
            ) : null}
            <p className="text-sm text-fg-muted" data-testid="check-verdict">
              {batch.problems.length > 0
                ? 'Fix the columns first.'
                : blocked
                  ? `Nothing can be saved while ${rowsWord(counts.error)} ${counts.error === 1 ? 'has a problem. Fix it, leave it out' : 'have problems. Fix them, leave them out'}, or pick "Skip bad rows".`
                  : toSave === 0
                    ? 'Every row is already in Pulse, so saving changes nothing.'
                    : `Ready. ${rowsWord(toSave)} will be saved together: ${count(counts.create)} new and ${count(counts.update)} changed.${counts.error > 0 ? ` The ${rowsWord(counts.error)} with problems ${counts.error === 1 ? 'is' : 'are'} left out.` : ''} You can undo for 7 days.`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" leadingIcon={<Trash2 aria-hidden className="size-4" />} onClick={onDiscard} disabled={saving}>
              Discard
            </Button>
            <Button variant="secondary" leadingIcon={<ArrowLeft aria-hidden className="size-4" />} onClick={onRemap} disabled={saving} data-testid="check-back">
              Back to columns
            </Button>
            <Button leadingIcon={<Save aria-hidden className="size-4" />} onClick={() => void save()} loading={saving} disabled={blocked || working} data-testid="check-save">
              {toSave === 0 ? 'Finish' : `Save ${rowsWord(toSave)}`}
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={saving}>
        <DialogContent size="sm" hideClose onEscapeKeyDown={(event) => event.preventDefault()} onPointerDownOutside={(event) => event.preventDefault()} data-testid="save-progress">
          <DialogHeader title="Saving your rows" description="Every row is saved together, so keep this page open." />
          <DialogBody className="pb-6">
            <div role="status" aria-live="polite" className="flex flex-col gap-2">
              <ProgressBar value={progress && progress.phase === 'saving' && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : undefined} label="Saving rows" />
              <p className="text-sm text-fg-secondary">
                {progress?.phase === 'saving'
                  ? `${count(progress.done)} of ${count(progress.total)} rows saved`
                  : progress?.phase === 'totals'
                    ? 'Working out the new totals'
                    : 'Checking every row one more time'}
              </p>
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* The preview table                                                                           */
/* ------------------------------------------------------------------------------------------ */

function RowsTable({ batch, filter, onFilter, onBatch, readOnly = false }: { readonly batch: ImportBatchDTO; readonly filter: Filter; readonly onFilter: (filter: Filter) => void; readonly onBatch?: (batch: ImportBatchDTO) => void; readonly readOnly?: boolean }) {
  const [page, setPage] = useState(1);
  const [shown, setShown] = useState(filter);
  const [editing, setEditing] = useState<{ rowNumber: number; cells: string[] } | null>(null);
  const [busyRow, setBusyRow] = useState<number | null>(null);
  // A new filter starts on its first page.
  if (shown !== filter) {
    setShown(filter);
    setPage(1);
  }
  const params = { action: filter, offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE };
  const rows = useQuery({ queryKey: importKeys.rows(batch.id, params), queryFn: () => importApi.rows(batch.id, params), placeholderData: keepPreviousData, staleTime: 10_000 });
  const def = useMemo(() => anyStreamDef(batch.stream), [batch.stream]);
  const labelOf = (key: string): string => def.columns.find((column) => column.key === key)?.label ?? key;
  const total = rows.data?.total ?? 0;

  const apply = async (edit: { rowNumber: number; cells?: string[]; skip?: boolean }, done: string): Promise<void> => {
    if (!onBatch) return;
    setBusyRow(edit.rowNumber);
    try {
      onBatch(await importApi.editRows(batch.id, [edit]));
      setEditing(null);
      toast.success(done);
    } catch (error) {
      toast.error('Could not change that row', errorText(error));
    } finally {
      setBusyRow(null);
    }
  };

  const filters: readonly { value: Filter; label: string }[] = [
    { value: 'all', label: `All ${count(batch.totalRows)}` },
    ...TILES.filter((tile) => batch.counts[tile.id] > 0).map((tile) => ({ value: tile.id as Filter, label: `${tile.label} ${count(batch.counts[tile.id])}` })),
    ...(batch.counts.warning > 0 ? [{ value: 'problems' as Filter, label: 'Worth a look' }] : []),
  ];

  return (
    <div data-testid="rows-table" data-filter={filter}>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border-subtle px-4 py-2.5" role="group" aria-label="Which rows to show">
        {filters.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={filter === item.value}
            onClick={() => onFilter(item.value)}
            data-testid={`filter-${item.value}`}
            className={cn(
              'inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
              filter === item.value ? 'border-primary bg-primary-subtle text-primary-text' : 'border-border-subtle bg-panel text-fg-secondary hover:bg-hover hover:text-fg',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      {rows.isError ? (
        <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
          <p className="text-sm text-fg-secondary">We could not load the rows. {errorText(rows.error)}</p>
          <Button variant="secondary" onClick={() => void rows.refetch()}>
            Try again
          </Button>
        </div>
      ) : rows.isLoading ? (
        <div className="p-4">
          <Skeleton height={220} />
        </div>
      ) : (rows.data?.rows.length ?? 0) === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-fg-muted" data-testid="rows-empty">
          {rows.data?.cleared ? 'The row details of this import were cleared after its 7 day undo window. The counts above are still right.' : 'No rows of this kind.'}
        </p>
      ) : (
        <>
        <ul className={cn('divide-y divide-border-subtle md:hidden', rows.isPlaceholderData && 'opacity-60')} data-testid="rows-cards">
          {(rows.data?.rows ?? []).map((row) => (
            <PreviewCard
              key={row.rowNumber}
              row={row}
              batch={batch}
              labelOf={labelOf}
              readOnly={readOnly}
              busy={busyRow === row.rowNumber}
              editing={editing?.rowNumber === row.rowNumber ? editing.cells : null}
              onEdit={(cells) => setEditing(cells ? { rowNumber: row.rowNumber, cells } : null)}
              onSave={() => editing && void apply({ rowNumber: row.rowNumber, cells: editing.cells }, `Row ${row.rowNumber} was checked again`)}
              onSkip={(skip) => void apply({ rowNumber: row.rowNumber, skip }, skip ? `Row ${row.rowNumber} is left out` : `Row ${row.rowNumber} is back in`)}
            />
          ))}
        </ul>
        <ScrollX label="Rows of the file" className={cn('hidden md:block', rows.isPlaceholderData && 'opacity-60')}>
          <table className="w-full min-w-max border-collapse text-left text-sm">
            <thead>
              <tr className="bg-sunken text-xs text-fg-muted">
                <th scope="col" className="sticky left-0 z-[1] border-b border-border-subtle bg-sunken px-3 py-2 font-semibold">
                  Row
                </th>
                <th scope="col" className="min-w-[220px] border-b border-border-subtle px-3 py-2 font-semibold">
                  What happens
                </th>
                {batch.headers.map((header, index) => (
                  <th key={`${header}-${index}`} scope="col" className="border-b border-border-subtle px-3 py-2 font-semibold whitespace-nowrap">
                    <span className="block text-fg">{header || `Column ${index + 1}`}</span>
                    <span className="block font-normal">{batch.mapping[index] ? labelOf(batch.mapping[index] as string) : 'Not imported'}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(rows.data?.rows ?? []).map((row) => (
                <PreviewRow
                  key={row.rowNumber}
                  row={row}
                  batch={batch}
                  labelOf={labelOf}
                  readOnly={readOnly}
                  busy={busyRow === row.rowNumber}
                  editing={editing?.rowNumber === row.rowNumber ? editing.cells : null}
                  onEdit={(cells) => setEditing(cells ? { rowNumber: row.rowNumber, cells } : null)}
                  onSave={() => editing && void apply({ rowNumber: row.rowNumber, cells: editing.cells }, `Row ${row.rowNumber} was checked again`)}
                  onSkip={(skip) => void apply({ rowNumber: row.rowNumber, skip }, skip ? `Row ${row.rowNumber} is left out` : `Row ${row.rowNumber} is back in`)}
                />
              ))}
            </tbody>
          </table>
        </ScrollX>
        </>
      )}
      {total > PAGE_SIZE ? <TablePagination page={page} pageCount={Math.ceil(total / PAGE_SIZE)} total={total} onPageChange={setPage} /> : null}
    </div>
  );
}

interface PreviewProps {
  readonly row: ImportRowDTO;
  readonly batch: ImportBatchDTO;
  readonly labelOf: (key: string) => string;
  readonly readOnly: boolean;
  readonly busy: boolean;
  readonly editing: string[] | null;
  readonly onEdit: (cells: string[] | null) => void;
  readonly onSave: () => void;
  readonly onSkip: (skip: boolean) => void;
}

type RowMessage = ImportRowDTO['messages'][number];

/** Messages of a row, split into the ones that sit on a file column and the ones about the whole row. */
function splitMessages(row: ImportRowDTO, mapping: readonly (string | null)[]): { byColumn: Map<number, RowMessage[]>; general: RowMessage[] } {
  const byColumn = new Map<number, RowMessage[]>();
  const general: RowMessage[] = [];
  for (const message of row.messages) {
    const index = message.column ? mapping.indexOf(message.column) : -1;
    if (index >= 0) byColumn.set(index, [...(byColumn.get(index) ?? []), message]);
    else general.push(message);
  }
  return { byColumn, general };
}

const messageTone = (level: RowMessage['level']): string => (level === 'error' ? 'text-danger-text' : level === 'warning' ? 'text-warning-text' : 'text-fg-muted');

/** One preview row as a card, for narrow screens: only the columns that hold something, problems on their own field. */
function PreviewCard({ row, batch, labelOf, readOnly, busy, editing, onEdit, onSave, onSkip }: PreviewProps) {
  const action = row.action ?? 'unchanged';
  const { byColumn, general } = splitMessages(row, batch.mapping);
  const canFix = !readOnly && action !== 'unchanged';
  const shown = batch.headers.map((header, index) => ({ header, index })).filter(({ index }) => editing !== null || byColumn.has(index) || (batch.mapping[index] !== null && (row.cells[index] ?? '').trim() !== ''));
  return (
    <li className={cn('flex flex-col gap-2 px-4 py-3', action === 'error' && 'bg-danger-subtle/40')} data-testid={`card-row-${row.rowNumber}`} data-action={action}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-fg-muted tabular-nums">Row {row.rowNumber}</span>
        <Badge tone={ACTION_TONE[action]}>{IMPORT_ACTION_LABELS[action]}</Badge>
      </div>
      {row.changes.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-xs text-fg-secondary">
          {row.changes.slice(0, 6).map((change) => (
            <li key={change.column}>
              <span className="font-medium text-fg">{labelOf(change.column)}:</span> {change.from || 'empty'} to <span className="font-medium text-fg">{change.to || 'empty'}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {general.map((message, index) => (
        <p key={index} className={cn('text-xs', messageTone(message.level))}>
          {message.column ? `${labelOf(message.column)}: ` : ''}
          {message.text}
        </p>
      ))}
      <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 gap-y-1.5 text-sm">
        {shown.map(({ header, index }) => {
          const messages = byColumn.get(index) ?? [];
          const worst = messages.some((message) => message.level === 'error');
          return (
            <div key={index} className="contents">
              <dt className="truncate pt-1 text-xs text-fg-muted">{batch.mapping[index] ? labelOf(batch.mapping[index] as string) : header || `Column ${index + 1}`}</dt>
              <dd className={cn('min-w-0 rounded-sm', worst && 'bg-danger-subtle px-1.5 py-1')}>
                {editing ? (
                  <Input size="sm" aria-label={`Row ${row.rowNumber}, ${header || `column ${index + 1}`}`} value={editing[index] ?? ''} invalid={worst} onChange={(event) => onEdit(editing.map((cell, position) => (position === index ? event.target.value : cell)))} data-testid={`card-cell-${row.rowNumber}-${index}`} />
                ) : (
                  <span className="block break-words text-fg">{row.cells[index] || <span className="text-fg-muted">empty</span>}</span>
                )}
                {messages.map((message, position) => (
                  <span key={position} className={cn('mt-0.5 block text-xs', messageTone(message.level))}>
                    {message.text}
                  </span>
                ))}
              </dd>
            </div>
          );
        })}
      </dl>
      {canFix ? (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {editing ? (
            <>
              <Button size="sm" loading={busy} onClick={onSave} data-testid={`card-row-save-${row.rowNumber}`}>
                Check this row again
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onEdit(null)} disabled={busy}>
                Cancel
              </Button>
            </>
          ) : row.skippedByUser ? (
            <Button size="sm" variant="secondary" loading={busy} leadingIcon={<Undo2 aria-hidden className="size-3.5" />} onClick={() => onSkip(false)}>
              Put back
            </Button>
          ) : (
            <>
              <Button size="sm" variant="secondary" leadingIcon={<Pencil aria-hidden className="size-3.5" />} onClick={() => onEdit([...row.cells])} disabled={busy} data-testid={`card-row-fix-${row.rowNumber}`}>
                Fix
              </Button>
              <Button size="sm" variant="ghost" loading={busy} onClick={() => onSkip(true)} data-testid={`card-row-skip-${row.rowNumber}`}>
                Leave out
              </Button>
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}

function PreviewRow({ row, batch, labelOf, readOnly, busy, editing, onEdit, onSave, onSkip }: PreviewProps) {
  const action = row.action ?? 'unchanged';
  const { byColumn, general } = splitMessages(row, batch.mapping);
  const canFix = !readOnly && action !== 'unchanged';
  return (
    <tr className={cn('border-b border-border-subtle align-top last:border-0', action === 'error' && 'bg-danger-subtle/40')} data-testid={`row-${row.rowNumber}`} data-action={action}>
      <th scope="row" className={cn('sticky left-0 z-[1] px-3 py-2 text-xs font-medium text-fg-muted tabular-nums', action === 'error' ? 'bg-[color-mix(in_oklab,var(--danger-subtle)_40%,var(--panel))]' : 'bg-panel')}>
        {row.rowNumber}
      </th>
      <td className="max-w-[320px] px-3 py-2">
        <Badge tone={ACTION_TONE[action]}>{IMPORT_ACTION_LABELS[action]}</Badge>
        {row.changes.length > 0 ? (
          <ul className="mt-1.5 flex flex-col gap-0.5 text-xs text-fg-secondary" data-testid={`changes-${row.rowNumber}`}>
            {row.changes.slice(0, 6).map((change) => (
              <li key={change.column}>
                <span className="font-medium text-fg">{labelOf(change.column)}:</span> <span className="line-through decoration-fg-muted/60">{change.from || 'empty'}</span> to <span className="font-medium text-fg">{change.to || 'empty'}</span>
              </li>
            ))}
            {row.changes.length > 6 ? <li>And {row.changes.length - 6} more.</li> : null}
          </ul>
        ) : null}
        {general.length > 0 ? (
          <ul className="mt-1.5 flex flex-col gap-1 text-xs">
            {general.map((message, index) => (
              <li key={index} className={cn(message.level === 'error' ? 'text-danger-text' : message.level === 'warning' ? 'text-warning-text' : 'text-fg-muted')}>
                {message.column ? `${labelOf(message.column)}: ` : ''}
                {message.text}
              </li>
            ))}
          </ul>
        ) : null}
        {canFix ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {editing ? (
              <>
                <Button size="sm" loading={busy} onClick={onSave} data-testid={`row-save-${row.rowNumber}`}>
                  Check this row again
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onEdit(null)} disabled={busy}>
                  Cancel
                </Button>
              </>
            ) : row.skippedByUser ? (
              <Button size="sm" variant="secondary" loading={busy} leadingIcon={<Undo2 aria-hidden className="size-3.5" />} onClick={() => onSkip(false)} data-testid={`row-restore-${row.rowNumber}`}>
                Put back
              </Button>
            ) : (
              <>
                <Button size="sm" variant="secondary" leadingIcon={<Pencil aria-hidden className="size-3.5" />} onClick={() => onEdit([...row.cells])} disabled={busy} data-testid={`row-fix-${row.rowNumber}`}>
                  Fix
                </Button>
                <Button size="sm" variant="ghost" loading={busy} onClick={() => onSkip(true)} data-testid={`row-skip-${row.rowNumber}`}>
                  Leave out
                </Button>
              </>
            )}
          </div>
        ) : null}
      </td>
      {batch.headers.map((header, index) => {
        const messages = byColumn.get(index) ?? [];
        const worst = messages.some((message) => message.level === 'error') ? 'error' : messages.some((message) => message.level === 'warning') ? 'warning' : null;
        return (
          <td key={index} className={cn('max-w-[240px] px-3 py-2', worst === 'error' && 'bg-danger-subtle', worst === 'warning' && 'bg-warning-subtle')} data-cell-state={worst ?? undefined}>
            {editing ? (
              <Input
                size="sm"
                aria-label={`Row ${row.rowNumber}, ${header || `column ${index + 1}`}`}
                value={editing[index] ?? ''}
                invalid={worst === 'error'}
                onChange={(event) => onEdit(editing.map((cell, position) => (position === index ? event.target.value : cell)))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onSave();
                  if (event.key === 'Escape') onEdit(null);
                }}
                containerClassName="min-w-[110px]"
                data-testid={`cell-${row.rowNumber}-${index}`}
              />
            ) : (
              <span className={cn('block truncate', batch.mapping[index] ? 'text-fg' : 'text-fg-muted')} title={row.cells[index] ?? ''}>
                {row.cells[index] ?? ''}
              </span>
            )}
            {messages.map((message, position) => (
              <span key={position} className={cn('mt-1 block text-xs whitespace-normal', message.level === 'error' ? 'text-danger-text' : message.level === 'warning' ? 'text-warning-text' : 'text-fg-muted')} data-testid={`cell-message-${row.rowNumber}-${index}`}>
                {message.text}
              </span>
            ))}
          </td>
        );
      })}
    </tr>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Step 4: done                                                                                */
/* ------------------------------------------------------------------------------------------ */

function DoneStep({ batch, onBatch }: { readonly batch: ImportBatchDTO; readonly onBatch: (batch: ImportBatchDTO) => void }) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const { counts } = batch;
  const saved = counts.create + counts.update;
  const leftOut = counts.error + counts.lookalike + counts.skip;

  const undo = async (): Promise<void> => {
    setBusy(true);
    try {
      const next = await importApi.undo(batch.id);
      for (const key of [qk.streams(), qk.jobsRoot(), qk.profitRoot(), qk.summaryRoot(), qk.badges()]) void queryClient.invalidateQueries({ queryKey: key });
      onBatch(next);
      setConfirm(false);
      toast.success('Import undone', next.undoLeft > 0 ? `${rowsWord(next.undoLeft)} were changed after the import, so they were left as they are.` : 'The rows it added are gone and the rows it changed are back to what they were.');
    } catch (error) {
      toast.error('Could not undo the import', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border-subtle bg-panel p-5 shadow-xs" data-testid="import-result" data-status={batch.status}>
        <div className="flex flex-wrap items-start gap-4">
          <span aria-hidden className={cn('flex size-12 shrink-0 items-center justify-center rounded-2xl', batch.status === 'committed' ? 'bg-success-subtle text-success-text' : 'bg-muted text-fg-secondary')}>
            {batch.status === 'committed' ? <CircleCheck className="size-6" /> : <RotateCcw className="size-6" />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-fg">
              {batch.status === 'undone' ? 'This import was undone' : saved > 0 ? `${rowsWord(saved)} saved` : 'Finished. Nothing needed to change'}
            </h2>
            <p className="mt-1 text-sm text-fg-secondary" data-testid="import-result-line">
              {batch.status === 'undone' ? (
                <>
                  The rows it added were removed and the rows it changed went back to what they were
                  {batch.undoLeft > 0 ? `, except ${rowsWord(batch.undoLeft)} that someone changed after the import` : ''}. Undone <When iso={batch.undoneAt} />.
                </>
              ) : (
                <>
                  {count(counts.create)} new, {count(counts.update)} changed, {count(counts.unchanged)} already the same{leftOut > 0 ? `, ${count(leftOut)} left out` : ''}.{' '}
                  {batch.createdByName ? `Saved by ${batch.createdByName} ` : 'Saved '}
                  <When iso={batch.committedAt} />.
                </>
              )}
            </p>
            {batch.status === 'committed' && batch.willCreate.length > 0 ? (
              <p className="mt-1 text-sm text-fg-muted">
                Also added:{' '}
                {batch.willCreate
                  .slice(0, 12)
                  .map((item) => `${(KIND_WORDS[item.kind] ?? item.kind).toLowerCase()} ${item.code}`)
                  .join(', ')}
                .
              </p>
            ) : null}
            {batch.status === 'committed' ? (
              <p className="mt-1 text-sm text-fg-muted">
                {batch.canUndo ? (
                  <>
                    You can undo this import until <When iso={batch.undoUntil} dayOnly />.
                  </>
                ) : (
                  'The 7 days to undo this import have passed.'
                )}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {batch.status === 'committed' && batch.resultUrl ? (
                <ButtonLink href={batch.resultUrl} testId="result-open">
                  See it in Pulse
                </ButtonLink>
              ) : null}
              <ButtonLink href={routes.newImport(batch.stream)} variant="secondary" icon={<Upload aria-hidden className="size-4" />} testId="result-again">
                Import another file
              </ButtonLink>
              <ButtonLink href={routes.importCenter()} variant="ghost">
                All imports
              </ButtonLink>
              {leftOut > 0 ? (
                <a href={fileLinks.errorReport(batch.id)} download data-testid="error-report" className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-fg-secondary hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                  <Download aria-hidden className="size-4" />
                  Download rows left out
                </a>
              ) : null}
              {batch.canUndo ? (
                <Button variant="danger" leadingIcon={<RotateCcw aria-hidden className="size-4" />} onClick={() => setConfirm(true)} data-testid="result-undo">
                  Undo this import
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      <Panel title="What happened to each row" bodyClassName="p-0">
        <RowsTable batch={batch} filter={filter} onFilter={setFilter} readOnly />
      </Panel>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Undo this import?"
        description={`The ${count(counts.create)} rows it added will be removed and the ${count(counts.update)} rows it changed will go back to what they were. Rows that someone changed after the import are left alone.`}
        confirmLabel="Undo the import"
        destructive
        loading={busy}
        onConfirm={() => void undo()}
      />
    </div>
  );
}
