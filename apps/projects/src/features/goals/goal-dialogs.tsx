'use client';
/**
 * Goal dialogs: create / edit a goal (with key results on create), add / edit a key result, and
 * the weekly check-in (health, a note and new key result numbers).
 */
import { useMemo, useState } from 'react';
import { CheckCircle2, CircleDollarSign, FolderKanban, Hash, Percent, Plus, Target, ToggleRight, X, type LucideIcon } from 'lucide-react';
import {
  Button,
  ColorPicker,
  Combobox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  Field,
  IconButton,
  Input,
  IsoDatePicker,
  ProgressBar,
  Select,
  Textarea,
  UserPicker,
  cn,
  toLabelColor,
  toast,
} from '@/components/ui';
import { EntityIcon } from '@/components/pm';
import { GOAL_HEALTHS, GOAL_HEALTH_LABELS, type GoalHealth, type GoalProgressMode, type KeyResultKind } from '@/lib/constants';
import { todayIso } from '@/lib/dates';
import { usePeople } from '@/lib/hooks/use-data';
import { keyResultProgress } from '@/lib/rollups';
import type { GoalDTO, KeyResultDTO, ProjectSummary } from '@/lib/types';
import { addKeyResultAction, createGoalAction, linkGoalProjectAction, updateGoalAction, updateKeyResultAction } from '@/server/actions/goals';
import { checkInGoalAction } from '@/server/actions/portfolio';
import { useShell } from '@/features/shell/shell-context';
import { PROJECT_COLORS } from '@/features/projects/appearance-picker';

export const GOAL_TONE: Readonly<Record<GoalHealth, 'success' | 'warning' | 'danger' | 'info' | 'neutral'>> = {
  on_track: 'success',
  at_risk: 'warning',
  off_track: 'danger',
  achieved: 'info',
  missed: 'neutral',
};

export const GOAL_HEALTH_COLOR: Readonly<Record<GoalHealth, string>> = {
  on_track: 'var(--success)',
  at_risk: 'var(--warning)',
  off_track: 'var(--danger)',
  achieved: 'var(--info)',
  missed: 'var(--text-muted)',
};

const KR_KINDS: readonly { value: KeyResultKind; label: string; help: string; icon: LucideIcon }[] = [
  { value: 'number', label: 'Number', help: 'Count something, like orders shipped', icon: Hash },
  { value: 'percent', label: 'Percent', help: 'A percentage, like on-time rate', icon: Percent },
  { value: 'currency', label: 'Money', help: 'An amount, like revenue', icon: CircleDollarSign },
  { value: 'boolean', label: 'Done or not', help: 'Something that happens once', icon: ToggleRight },
  { value: 'project', label: 'Project progress', help: 'Fills in from a project’s tasks', icon: FolderKanban },
];

const MODES: readonly { value: GoalProgressMode; label: string; help: string }[] = [
  { value: 'key_results', label: 'From key results', help: 'Average of the key results below' },
  { value: 'projects', label: 'From linked projects', help: 'Average of the projects’ completed tasks' },
  { value: 'manual', label: 'Set by hand', help: 'You update the percent at each check-in' },
];

/** "Q4 2026", "Q1 2027", "2026", "2027" with their date ranges. */
export function periodPresets(today = todayIso()): { label: string; start: string; due: string }[] {
  const year = Number(today.slice(0, 4));
  const quarter = Math.floor((Number(today.slice(5, 7)) - 1) / 3);
  const q = (y: number, index: number) => {
    const startMonth = index * 3 + 1;
    const endMonth = startMonth + 2;
    const lastDay = new Date(y, endMonth, 0).getDate();
    return { label: `Q${index + 1} ${y}`, start: `${y}-${String(startMonth).padStart(2, '0')}-01`, due: `${y}-${String(endMonth).padStart(2, '0')}-${lastDay}` };
  };
  const next = quarter === 3 ? q(year + 1, 0) : q(year, quarter + 1);
  return [q(year, quarter), next, { label: String(year), start: `${year}-01-01`, due: `${year}-12-31` }, { label: String(year + 1), start: `${year + 1}-01-01`, due: `${year + 1}-12-31` }];
}

export function formatKrValue(kr: Pick<KeyResultDTO, 'kind' | 'unit'>, value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (kr.kind === 'boolean') return value >= 1 ? 'Done' : 'Not yet';
  if (kr.kind === 'percent') return `${rounded}%`;
  if (kr.kind === 'currency') {
    const code = kr.unit && /^[A-Z]{3}$/.test(kr.unit) ? kr.unit : 'USD';
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: code, maximumFractionDigits: rounded % 1 ? 2 : 0 }).format(rounded);
    } catch {
      return `${rounded.toLocaleString('en-US')} ${code}`;
    }
  }
  return `${rounded.toLocaleString('en-US')}${kr.unit ? ` ${kr.unit}` : ''}`;
}

// --- Key result editor (used inside the goal dialog and on its own) ---------------------------

interface KrDraft {
  readonly key: string;
  name: string;
  kind: KeyResultKind;
  start: string;
  target: string;
  current: string;
  unit: string;
  projectId: string | null;
}

const emptyDraft = (kind: KeyResultKind = 'number'): KrDraft => ({ key: Math.random().toString(36).slice(2), name: '', kind, start: '0', target: kind === 'percent' ? '100' : kind === 'boolean' ? '1' : '', current: '0', unit: '', projectId: null });

function draftValid(draft: KrDraft): boolean {
  if (!draft.name.trim()) return false;
  if (draft.kind === 'project') return Boolean(draft.projectId);
  if (draft.kind === 'boolean') return true;
  return draft.target.trim() !== '' && Number.isFinite(Number(draft.target)) && Number.isFinite(Number(draft.start || 0));
}

function draftToInput(draft: KrDraft) {
  const num = (value: string, fallback = 0) => (value.trim() === '' || !Number.isFinite(Number(value)) ? fallback : Number(value));
  return {
    name: draft.name.trim(),
    kind: draft.kind,
    startValue: draft.kind === 'boolean' ? 0 : num(draft.start),
    targetValue: draft.kind === 'boolean' ? 1 : num(draft.target, 100),
    currentValue: draft.kind === 'boolean' ? num(draft.current) : num(draft.current, num(draft.start)),
    unit: draft.kind === 'currency' ? draft.unit.trim() || 'USD' : draft.unit.trim() || null,
    projectId: draft.kind === 'project' ? draft.projectId : null,
  };
}

function KrFields({ draft, onChange, projects, compact }: { readonly draft: KrDraft; readonly onChange: (patch: Partial<KrDraft>) => void; readonly projects: readonly ProjectSummary[]; readonly compact?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <Input value={draft.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="What will you measure? e.g. Ship 500 orders a day" aria-label="Key result" maxLength={200} data-testid="kr-name" />
      <div role="radiogroup" aria-label="Measured as" className={cn('grid gap-1.5', compact ? 'grid-cols-3 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-5')}>
        {KR_KINDS.map((kind) => {
          const Icon = kind.icon;
          const checked = draft.kind === kind.value;
          return (
            <button
              key={kind.value}
              type="button"
              role="radio"
              aria-checked={checked}
              title={kind.help}
              onClick={() => onChange({ kind: kind.value, ...(kind.value === 'percent' && !draft.target ? { target: '100' } : {}) })}
              className={cn(
                'flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:outline-2 focus-visible:outline-focus',
                checked ? 'border-primary bg-primary-subtle text-primary-text' : 'border-border-subtle text-fg-secondary hover:border-border-default hover:text-fg',
              )}
            >
              <Icon aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">{kind.label}</span>
            </button>
          );
        })}
      </div>
      {draft.kind === 'project' ? (
        <Combobox
          aria-label="Project"
          value={draft.projectId}
          onValueChange={(projectId) => onChange({ projectId })}
          placeholder="Pick a project"
          searchPlaceholder="Find a project"
          emptyMessage="No projects match"
          options={projects.map((p) => ({ value: p.id, label: p.name, description: `${p.key} · ${p.progress.percent}% done`, icon: <EntityIcon icon={p.icon} color={p.color} size={18} /> }))}
        />
      ) : draft.kind === 'boolean' ? (
        <Select aria-label="Is it done?" value={Number(draft.current) >= 1 ? '1' : '0'} onValueChange={(current) => onChange({ current })} options={[{ value: '0', label: 'Not done yet' }, { value: '1', label: 'Done' }]} />
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="flex flex-col gap-1 text-2xs font-medium text-fg-secondary">
            Start
            <Input value={draft.start} onChange={(e) => onChange({ start: e.target.value })} inputMode="decimal" size="sm" aria-label="Start value" />
          </label>
          <label className="flex flex-col gap-1 text-2xs font-medium text-fg-secondary">
            Now
            <Input value={draft.current} onChange={(e) => onChange({ current: e.target.value })} inputMode="decimal" size="sm" aria-label="Current value" />
          </label>
          <label className="flex flex-col gap-1 text-2xs font-medium text-fg-secondary">
            Target
            <Input value={draft.target} onChange={(e) => onChange({ target: e.target.value })} inputMode="decimal" size="sm" aria-label="Target value" data-testid="kr-target" />
          </label>
          <label className="flex flex-col gap-1 text-2xs font-medium text-fg-secondary">
            {draft.kind === 'currency' ? 'Currency' : 'Unit'}
            <Input value={draft.unit} onChange={(e) => onChange({ unit: e.target.value })} placeholder={draft.kind === 'currency' ? 'USD' : draft.kind === 'percent' ? '' : 'orders'} size="sm" maxLength={20} aria-label="Unit" disabled={draft.kind === 'percent'} />
          </label>
        </div>
      )}
    </div>
  );
}

// --- Goal dialog ---------------------------------------------------------------------------------

export function GoalDialog({
  goal,
  goals,
  projects,
  defaultParentId,
  open,
  onOpenChange,
  onSaved,
}: {
  readonly goal: GoalDTO | null;
  readonly goals: readonly GoalDTO[];
  readonly projects: readonly ProjectSummary[];
  readonly defaultParentId?: string | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSaved: (goal: GoalDTO) => void;
}) {
  const { user } = useShell();
  const people = usePeople();
  const presets = useMemo(() => periodPresets(), []);
  const [name, setName] = useState(goal?.name ?? '');
  const [description, setDescription] = useState(goal?.description ?? '');
  const [ownerId, setOwnerId] = useState<string | null>(goal?.ownerId ?? user.id);
  const [period, setPeriod] = useState<string>(goal?.period ?? presets[0]?.label ?? '');
  const [startDate, setStartDate] = useState<string | null>(goal ? goal.startDate : (presets[0]?.start ?? null));
  const [dueDate, setDueDate] = useState<string | null>(goal ? goal.dueDate : (presets[0]?.due ?? null));
  const [mode, setMode] = useState<GoalProgressMode>(goal?.progressMode ?? 'key_results');
  const [manual, setManual] = useState(String(goal?.manualProgress ?? 0));
  const [parentId, setParentId] = useState<string | null>(goal?.parentGoalId ?? defaultParentId ?? null);
  const [color, setColor] = useState(goal?.color ?? 'blue');
  const [projectIds, setProjectIds] = useState<string[]>(() => [...(goal?.projectIds ?? [])]);
  const [krs, setKrs] = useState<KrDraft[]>(() => (goal ? [] : [emptyDraft()]));
  const [saving, setSaving] = useState(false);
  const descendants = useMemo(() => {
    if (!goal) return new Set<string>();
    const set = new Set<string>([goal.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const g of goals) if (g.parentGoalId && set.has(g.parentGoalId) && !set.has(g.id)) {
        set.add(g.id);
        grew = true;
      }
    }
    return set;
  }, [goal, goals]);
  const filledKrs = krs.filter((kr) => kr.name.trim());
  const krsValid = filledKrs.every(draftValid);
  const valid = name.trim().length > 0 && krsValid && !(startDate && dueDate && startDate > dueDate);

  const save = async () => {
    setSaving(true);
    const base = {
      name: name.trim(),
      description: description.trim() || null,
      ownerId,
      parentGoalId: parentId,
      period: period.trim() || null,
      startDate,
      dueDate,
      progressMode: mode,
      manualProgress: Math.max(0, Math.min(100, Number(manual) || 0)),
      color,
    };
    const result = goal ? await updateGoalAction({ goalId: goal.id, patch: base }) : await createGoalAction(base);
    if (!result.ok) {
      setSaving(false);
      toast.error(goal ? "Couldn't save the goal" : "Couldn't create the goal", result.error.message);
      return;
    }
    let saved = result.data;
    for (const draft of filledKrs) {
      const added = await addKeyResultAction({ goalId: saved.id, ...draftToInput(draft) });
      if (added.ok) saved = added.data;
      else toast.error(`Couldn't add “${draft.name}”`, added.error.message);
    }
    const before = new Set(goal?.projectIds ?? []);
    const after = new Set(projectIds);
    for (const id of after) if (!before.has(id)) {
      const linked = await linkGoalProjectAction({ goalId: saved.id, projectId: id, linked: true });
      if (linked.ok) saved = linked.data;
    }
    for (const id of before) if (!after.has(id)) {
      const unlinked = await linkGoalProjectAction({ goalId: saved.id, projectId: id, linked: false });
      if (unlinked.ok) saved = unlinked.data;
    }
    setSaving(false);
    toast.success(goal ? 'Goal saved' : `Added “${saved.name}”`);
    onSaved(saved);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader
          icon={<span className="inline-flex size-9 items-center justify-center rounded-lg" style={{ background: `var(--label-${toLabelColor(color)}-subtle)`, color: `var(--label-${toLabelColor(color)}-text)` }}><Target aria-hidden className="size-5" /></span>}
          title={goal ? 'Edit goal' : 'New goal'}
        />
        <DialogBody className="flex flex-col gap-4 pb-4">
          <Field label="Goal" required>
            {({ inputId }) => <Input id={inputId} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ship every order within 24 hours" autoFocus maxLength={200} size="lg" data-testid="goal-name" />}
          </Field>
          <Field label="Why it matters" hint="Optional">
            {({ inputId, describedBy }) => <Textarea id={inputId} aria-describedby={describedBy} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-secondary">Owner</span>
              <UserPicker people={people.data ?? []} meId={user.id} value={ownerId} onChange={setOwnerId} className="h-10 w-full" aria-label="Owner" />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-secondary">Time frame</span>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Time frame">
                {presets.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    role="radio"
                    aria-checked={period === preset.label}
                    onClick={() => {
                      setPeriod(preset.label);
                      setStartDate(preset.start);
                      setDueDate(preset.due);
                    }}
                    className={cn(
                      'h-8 rounded-md border px-2.5 text-sm font-medium outline-none transition-colors focus-visible:outline-2 focus-visible:outline-focus',
                      period === preset.label ? 'border-primary bg-primary-subtle text-primary-text' : 'border-border-subtle text-fg-secondary hover:border-border-default',
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-secondary">Starts</span>
              <IsoDatePicker value={startDate} onChange={setStartDate} aria-label="Starts" placeholder="No start date" />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-secondary">Due</span>
              <IsoDatePicker value={dueDate} onChange={setDueDate} aria-label="Due" placeholder="No due date" />
              {startDate && dueDate && startDate > dueDate ? <span role="alert" className="text-2xs font-medium text-danger-text">Due has to be after the start.</span> : null}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-secondary">How progress is measured</span>
            <div role="radiogroup" aria-label="How progress is measured" className="grid gap-2 sm:grid-cols-3">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={mode === m.value}
                  onClick={() => setMode(m.value)}
                  data-testid={`goal-mode-${m.value}`}
                  className={cn(
                    'flex flex-col items-start rounded-lg border px-3 py-2 text-left outline-none transition-colors focus-visible:outline-2 focus-visible:outline-focus',
                    mode === m.value ? 'border-primary bg-primary-subtle' : 'border-border-subtle hover:border-border-default',
                  )}
                >
                  <span className={cn('text-sm font-medium', mode === m.value ? 'text-primary-text' : 'text-fg')}>{m.label}</span>
                  <span className="text-2xs text-fg-muted">{m.help}</span>
                </button>
              ))}
            </div>
          </div>

          {mode === 'manual' ? (
            <Field label="Progress today (%)">
              {({ inputId }) => <Input id={inputId} value={manual} onChange={(e) => setManual(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} inputMode="numeric" containerClassName="w-28" />}
            </Field>
          ) : null}

          {mode === 'projects' || projectIds.length ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-secondary">Projects that move this goal</span>
              <Combobox
                multiple
                aria-label="Linked projects"
                value={projectIds}
                onValueChange={setProjectIds}
                placeholder="Pick projects"
                searchPlaceholder="Find a project"
                emptyMessage="No projects match"
                options={projects.map((p) => ({ value: p.id, label: p.name, description: `${p.key} · ${p.progress.percent}% done`, icon: <EntityIcon icon={p.icon} color={p.color} size={18} /> }))}
              />
            </div>
          ) : null}

          {!goal ? (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-fg-secondary">Key results {mode === 'key_results' ? '' : '(optional)'}</span>
              {krs.map((draft, index) => (
                <div key={draft.key} className="relative rounded-lg border border-border-subtle bg-sunken/40 p-3 pr-10">
                  <KrFields draft={draft} projects={projects} onChange={(patch) => setKrs(krs.map((k, i) => (i === index ? { ...k, ...patch } : k)))} compact />
                  <IconButton label="Remove key result" icon={<X aria-hidden />} size="sm" className="absolute top-2.5 right-2" onClick={() => setKrs(krs.filter((_, i) => i !== index))} />
                </div>
              ))}
              <Button type="button" variant="ghost" size="sm" className="self-start" leadingIcon={<Plus aria-hidden />} onClick={() => setKrs([...krs, emptyDraft()])} data-testid="add-kr-draft">
                Add a key result
              </Button>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-secondary">Part of a bigger goal</span>
              <Select
                aria-label="Parent goal"
                value={parentId ?? 'none'}
                onValueChange={(value) => setParentId(value === 'none' ? null : value)}
                options={[{ value: 'none', label: 'No, it’s a top goal' }, ...goals.filter((g) => !descendants.has(g.id)).map((g) => ({ value: g.id, label: g.name }))]}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-secondary">Color</span>
              <ColorPicker value={toLabelColor(color)} onChange={setColor} colors={PROJECT_COLORS} columns={8} size="sm" />
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!valid} loading={saving} data-testid="save-goal">
            {goal ? 'Save goal' : 'Create goal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Key result dialog ---------------------------------------------------------------------------

export function KeyResultDialog({
  goal,
  keyResult,
  projects,
  open,
  onOpenChange,
  onSaved,
}: {
  readonly goal: GoalDTO;
  readonly keyResult: KeyResultDTO | null;
  readonly projects: readonly ProjectSummary[];
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSaved: (goal: GoalDTO) => void;
}) {
  const [draft, setDraft] = useState<KrDraft>(() =>
    keyResult
      ? {
          key: keyResult.id,
          name: keyResult.name,
          kind: keyResult.kind,
          start: String(keyResult.startValue),
          target: String(keyResult.targetValue),
          current: String(keyResult.currentValue),
          unit: keyResult.unit ?? '',
          projectId: keyResult.projectId,
        }
      : emptyDraft(),
  );
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const input = draftToInput(draft);
    const result = keyResult ? await updateKeyResultAction({ keyResultId: keyResult.id, patch: input }) : await addKeyResultAction({ goalId: goal.id, ...input });
    setSaving(false);
    if (!result.ok) {
      toast.error("Couldn't save the key result", result.error.message);
      return;
    }
    toast.success(keyResult ? 'Key result saved' : 'Key result added');
    onSaved(result.data);
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader title={keyResult ? 'Edit key result' : 'Add a key result'} description={`For “${goal.name}”.`} />
        <DialogBody className="pb-4">
          <KrFields draft={draft} projects={projects} onChange={(patch) => setDraft({ ...draft, ...patch })} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!draftValid(draft)} loading={saving} data-testid="save-kr">
            {keyResult ? 'Save' : 'Add key result'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Check-in dialog -----------------------------------------------------------------------------

export function CheckInDialog({ goal, open, onOpenChange, onSaved }: { readonly goal: GoalDTO; readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly onSaved: (goal: GoalDTO) => void }) {
  const [health, setHealth] = useState<GoalHealth>(goal.health);
  const [note, setNote] = useState('');
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(goal.keyResults.map((kr) => [kr.id, String(kr.currentValue)])));
  const [manual, setManual] = useState(String(goal.manualProgress));
  const [saving, setSaving] = useState(false);
  const editable = goal.keyResults.filter((kr) => kr.kind !== 'project');
  const invalid = editable.some((kr) => values[kr.id]?.trim() === '' || !Number.isFinite(Number(values[kr.id])));

  const save = async () => {
    setSaving(true);
    const result = await checkInGoalAction({
      goalId: goal.id,
      health,
      note: note.trim() || null,
      keyResults: editable.map((kr) => ({ id: kr.id, currentValue: Number(values[kr.id]) })),
      ...(goal.progressMode === 'manual' ? { manualProgress: Math.max(0, Math.min(100, Number(manual) || 0)) } : {}),
    });
    setSaving(false);
    if (!result.ok) {
      toast.error("Couldn't save the check-in", result.error.message);
      return;
    }
    toast.success(health === 'achieved' ? `Goal achieved: “${goal.name}”` : 'Check-in saved');
    onSaved(result.data.goal);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader title="Check in" description={`How is “${goal.name}” going?`} />
        <DialogBody className="flex flex-col gap-4 pb-4">
          <div role="radiogroup" aria-label="How is it going?" className="flex flex-wrap gap-1.5">
            {GOAL_HEALTHS.map((h) => (
              <button
                key={h}
                type="button"
                role="radio"
                aria-checked={health === h}
                onClick={() => setHealth(h)}
                data-testid={`checkin-health-${h}`}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium outline-none transition-colors focus-visible:outline-2 focus-visible:outline-focus',
                  health === h ? 'text-fg shadow-xs' : 'border-border-subtle text-fg-secondary hover:border-border-default',
                )}
                style={health === h ? { borderColor: GOAL_HEALTH_COLOR[h], background: `color-mix(in srgb, ${GOAL_HEALTH_COLOR[h]} 10%, var(--surface-raised))` } : undefined}
              >
                <span aria-hidden className="size-2 rounded-full" style={{ background: GOAL_HEALTH_COLOR[h] }} />
                {GOAL_HEALTH_LABELS[h]}
              </button>
            ))}
          </div>
          {editable.length ? (
            <ul className="flex flex-col gap-3" aria-label="Key results">
              {editable.map((kr) => {
                const value = Number(values[kr.id]);
                const preview = Number.isFinite(value) ? keyResultProgress({ ...kr, currentValue: value }) : kr.progress;
                return (
                  <li key={kr.id} className="rounded-lg border border-border-subtle p-3">
                    <div className="flex items-center gap-3">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{kr.name}</span>
                      {kr.kind === 'boolean' ? (
                        <Select size="sm" aria-label={`${kr.name}: done?`} value={value >= 1 ? '1' : '0'} onValueChange={(v) => setValues({ ...values, [kr.id]: v })} options={[{ value: '0', label: 'Not yet' }, { value: '1', label: 'Done' }]} className="w-28" />
                      ) : (
                        <span className="flex items-center gap-1.5 text-xs text-fg-muted">
                          <Input value={values[kr.id] ?? ''} onChange={(e) => setValues({ ...values, [kr.id]: e.target.value })} inputMode="decimal" size="sm" aria-label={`New value for ${kr.name}`} containerClassName="w-24" data-testid="checkin-kr-value" />
                          of {formatKrValue(kr, kr.targetValue)}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <ProgressBar value={preview} size="sm" label={`${kr.name} progress`} className="flex-1" tone={preview >= 100 ? 'success' : 'primary'} />
                      <span className="w-10 text-right text-xs font-medium tabular-nums">{preview}%</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {goal.keyResults.some((kr) => kr.kind === 'project') ? (
            <p className="flex items-center gap-2 text-xs text-fg-muted">
              <CheckCircle2 aria-hidden className="size-3.5" />
              Project key results fill in by themselves as tasks get done.
            </p>
          ) : null}
          {goal.progressMode === 'manual' ? (
            <Field label="Progress today (%)">
              {({ inputId }) => <Input id={inputId} value={manual} onChange={(e) => setManual(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} inputMode="numeric" containerClassName="w-28" />}
            </Field>
          ) : null}
          <Field label="Note" hint="What went well, what’s in the way, what’s next.">
            {({ inputId, describedBy }) => <Textarea id={inputId} aria-describedby={describedBy} rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} data-testid="checkin-note" />}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={saving} disabled={invalid} data-testid="save-checkin">
            Save check-in
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Plain words for a key result's value, start included, so "98.6% of 99.5%" never reads as almost
 * done when it started at 97.2%: "Started 97.2% · Now 98.6% · Target 99.5%". When the target is
 * below the start (mis-picks, dock-to-stock hours) the target says "or less".
 */
export function krValueText(kr: Pick<KeyResultDTO, 'kind' | 'unit' | 'startValue' | 'targetValue' | 'currentValue'>): {
  readonly text: string;
  readonly lowerIsBetter: boolean;
  readonly start: string;
  readonly now: string;
  readonly target: string;
} {
  const lowerIsBetter = kr.kind !== 'boolean' && kr.kind !== 'project' && kr.targetValue < kr.startValue;
  const now = formatKrValue(kr, kr.currentValue);
  const start = formatKrValue(kr, kr.startValue);
  const target = `${formatKrValue(kr, kr.targetValue)}${lowerIsBetter ? ' or less' : ''}`;
  if (kr.kind === 'boolean') return { text: now, lowerIsBetter, start, now, target };
  return { text: `Started ${start} · Now ${now} · Target ${target}`, lowerIsBetter, start, now, target };
}

/** One number for the formula text: plain, no unit, at most two decimals. */
function plain(value: number): string {
  return (Math.round(value * 100) / 100).toLocaleString('en-US');
}

/**
 * How a key result's percent is worked out, for its tooltip. Progress counts from the start
 * value, not from zero, which is why 98.6% of a 99.5% target can be 61%.
 */
export function krProgressFormula(kr: Pick<KeyResultDTO, 'kind' | 'unit' | 'startValue' | 'targetValue' | 'currentValue' | 'progress'>): { readonly text: string; readonly steps: string | null } {
  if (kr.kind === 'project') return { text: `${kr.progress}% of the linked project's tasks are done.`, steps: null };
  if (kr.kind === 'boolean') return { text: kr.currentValue >= 1 ? 'Done, so 100%.' : 'Not done yet, so 0%. It jumps to 100% when it is done.', steps: null };
  const span = kr.targetValue - kr.startValue;
  if (span === 0) return { text: `Start and target are the same, so it is 100% once it reaches ${formatKrValue(kr, kr.targetValue)}.`, steps: null };
  const moved = kr.currentValue - kr.startValue;
  const steps = `(${plain(kr.currentValue)} \u2212 ${plain(kr.startValue)}) \u00f7 (${plain(kr.targetValue)} \u2212 ${plain(kr.startValue)}) = ${kr.progress}%`;
  const backwards = Math.sign(moved) === -Math.sign(span);
  const lead = backwards
    ? `It has moved ${plain(Math.abs(moved))} the wrong way since the start, so it counts as 0%.`
    : span < 0
      ? `It has come down ${plain(Math.abs(moved))} of the ${plain(Math.abs(span))} it needs to drop.`
      : `It has gone up ${plain(moved)} of the ${plain(span)} it needs to gain.`;
  return { text: `Progress counts from where it started, not from zero. ${lead}`, steps: backwards ? null : steps };
}

/** Bar color follows the goal's health (neutral on track, red only means trouble), and goes green when hit. */
export function krBarTone(progress: number, health: GoalHealth): 'primary' | 'success' | 'warning' | 'danger' {
  if (progress >= 100) return 'success';
  if (health === 'off_track' || health === 'missed') return 'danger';
  if (health === 'at_risk') return 'warning';
  return 'primary';
}
