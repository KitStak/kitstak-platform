'use client';
/**
 * Quick add in build mode (docs/programs/SPEC.md 5.17): opened as "New build", or by typing
 * "build " in quick add. "build 100 small brown glove tomorrow" picks the program, variant, qty
 * and day (src/lib/nl-parse-build.ts); chips show what was understood, unresolved parts are red
 * with suggestions, and every field can be set by hand. A project key (+FRA) makes a build in
 * that project, with no variant. Saves with `createBuildAction`; "Add another" keeps the
 * program and day.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Boxes, CalendarDays, Hash, Repeat2, Shapes, UserRound } from 'lucide-react';
import { shortDate, unitLabel } from '@kitstak/programs-engine';
import { Button, Checkbox, Combobox, DialogBody, DialogContent, DialogFooter, DialogHeader, Input, IsoDatePicker, Kbd, UserPicker, cn, toast, useModKey } from '@/components/ui';
import { todayIso } from '@/lib/dates';
import { usePeople, useProjects } from '@/lib/hooks/use-data';
import { programInvalidations, usePrograms, useVariants } from '@/lib/hooks/use-programs';
import { useTaskDrawer } from '@/lib/hooks/use-task-drawer';
import { parseBuildQuickAdd, type BuildQuickAddContainer } from '@/lib/nl-parse-build';
import type { BuildDTO } from '@/lib/program-types';
import { createBuildAction } from '@/server/actions/builds';
import { useShell } from '@/features/shell/shell-context';
import { useShellStore } from '@/features/shell/store';
import { readQty } from '@/features/programs/kit/qty-input';

type Result<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: { readonly message: string } };

const CHIP = 'inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium';

export function BuildQuickAddForm({ initialText, onTaskMode }: { readonly initialText: string; readonly onTaskMode: (text: string) => void }) {
  const pathname = usePathname() ?? '';
  const mod = useModKey();
  const queryClient = useQueryClient();
  const { user } = useShell();
  const { openTask } = useTaskDrawer();
  const defaults = useShellStore((state) => state.quickAdd.defaults);
  const close = useShellStore((state) => state.closeQuickAdd);
  const programs = usePrograms({}, { staleTime: 60_000 });
  const projects = useProjects();
  const people = usePeople();
  const today = todayIso();
  const [text, setText] = useState(initialText);
  const [containerChoice, setContainerChoice] = useState<string | null>(defaults.projectId ?? null);
  const [variantChoice, setVariantChoice] = useState<string | null>(null);
  const [qtyChoice, setQtyChoice] = useState('');
  const [qtyTouched, setQtyTouched] = useState(false);
  const [dateTouched, setDateTouched] = useState(false);
  const [dateChoice, setDateChoice] = useState<string | null>(defaults.dueDate ?? null);
  const [assigneeChoice, setAssigneeChoice] = useState<string | null>(defaults.assigneeId ?? null);
  const [another, setAnother] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Switching from task mode mounts this form mid typing: keep the caret at the end of the text.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);

  const programContainers = useMemo<BuildQuickAddContainer[]>(() => (programs.data ?? []).filter((program) => !program.archivedAt).map((program) => ({ id: program.id, key: program.key, name: program.name, kind: 'program', unit: program.unit, variants: [] })), [programs.data]);
  const projectContainers = useMemo<BuildQuickAddContainer[]>(
    () => (projects.data ?? []).filter((project) => !project.archivedAt && !project.isTemplate && project.kind !== 'program' && (project.role === 'owner' || project.role === 'editor')).map((project) => ({ id: project.id, key: project.key, name: project.name, kind: 'project', variants: [] })),
    [projects.data],
  );
  const containers = useMemo(() => [...programContainers, ...projectContainers], [programContainers, projectContainers]);
  const pathKey = /^\/(?:programs|p)\/([A-Z][A-Z0-9]+)/.exec(pathname)?.[1];
  const defaultContainer = containerChoice ?? containers.find((container) => container.key === pathKey)?.id ?? programContainers[0]?.id ?? null;

  // Pass 1 finds the container; pass 2 matches variants inside it.
  const first = useMemo(() => parseBuildQuickAdd(text, { containers, today, people: people.data ?? [], meId: user.id, defaultContainerId: defaultContainer, forceBuild: true }), [containers, defaultContainer, people.data, text, today, user.id]);
  const containerId = first.containerId ?? defaultContainer;
  const container = containers.find((entry) => entry.id === containerId) ?? null;
  const variantsQuery = useVariants(container?.kind === 'program' ? container.key : '', false, { enabled: container?.kind === 'program', staleTime: 60_000 });
  const activeVariants = useMemo(() => (variantsQuery.data ?? []).filter((variant) => variant.status === 'active'), [variantsQuery.data]);
  const withVariants = useMemo(() => containers.map((entry) => (entry.id === container?.id ? { ...entry, variants: activeVariants.map((variant) => ({ id: variant.id, key: variant.key, name: variant.name, sku: variant.sku })) } : entry)), [activeVariants, container?.id, containers]);
  const parsed = useMemo(() => parseBuildQuickAdd(text, { containers: withVariants, today, people: people.data ?? [], meId: user.id, defaultContainerId: containerId, forceBuild: true }), [containerId, people.data, text, today, user.id, withVariants]);

  const variantId = parsed.variantId ?? variantChoice ?? (container?.kind === 'program' && activeVariants.length === 1 ? activeVariants[0]!.id : null);
  const variant = activeVariants.find((entry) => entry.id === variantId) ?? null;
  // A number typed in the Planned field wins over the one in the sentence.
  const qty = qtyTouched ? qtyChoice : parsed.qty ?? (qtyChoice.trim() ? qtyChoice : variant?.defaultQty ?? '');
  const qtyRead = readQty(qty);
  const date = (dateTouched ? dateChoice : null) ?? parsed.date ?? dateChoice ?? today;
  const assigneeId = parsed.assigneeId ?? assigneeChoice;
  const unit = container?.unit ?? { singular: 'unit', plural: 'units' };
  const needsVariant = container?.kind === 'program' && activeVariants.length > 0 && !variantId;
  const ready = Boolean(container) && qtyRead.ok && Boolean(qtyRead.qty) && !needsVariant;
  const variantProblem = parsed.unresolved.find((entry) => entry.kind === 'variant');
  const programProblem = parsed.unresolved.find((entry) => entry.kind === 'program');
  const title = parsed.rest && parsed.rest.split(' ').length > 1 ? parsed.rest : null;
  // Up to three picks under a red variant chip: the closest matches, else the first variants.
  const variantSuggestions = variantProblem ? (variantProblem.suggestions.length ? variantProblem.suggestions : activeVariants.map((entry) => entry.id)).slice(0, 3) : [];

  const submit = async (open: boolean) => {
    setAttempted(true);
    if (!ready || !container || !qtyRead.ok || !qtyRead.qty) return;
    setSaving(true);
    const result = (await createBuildAction({ containerKey: container.key, variantId: container.kind === 'program' ? variantId : null, buildDate: date, plannedQty: qtyRead.qty, title, assigneeId })) as Result<BuildDTO>;
    setSaving(false);
    for (const key of programInvalidations(container.key, date)) void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
    if (!result.ok) {
      toast.error("Couldn't create the build", result.error.message);
      return;
    }
    toast.success(`Created ${result.data.key}`, `${variant?.name ?? container.name} · ${unitLabel(qtyRead.qty, unit)} · ${shortDate(date)}`);
    if (open) {
      close();
      openTask(result.data.key);
      return;
    }
    if (another) {
      setText('');
      setVariantChoice(null);
      setQtyChoice('');
      setQtyTouched(false);
      setContainerChoice(container.id);
      setDateChoice(date);
      setAttempted(false);
      inputRef.current?.focus();
      return;
    }
    close();
  };

  const chips = [
    container ? { key: 'program', icon: <Repeat2 aria-hidden className="size-3" />, text: container.kind === 'program' ? container.name : `Project ${container.key}`, bad: false } : null,
    programProblem ? { key: 'program-bad', icon: <Repeat2 aria-hidden className="size-3" />, text: programProblem.message, bad: true } : null,
    variant ? { key: 'variant', icon: <Shapes aria-hidden className="size-3" />, text: variant.name, bad: false } : variantProblem ? { key: 'variant-bad', icon: <Shapes aria-hidden className="size-3" />, text: variantProblem.message, bad: true } : null,
    qtyRead.ok && qtyRead.qty ? { key: 'qty', icon: <Hash aria-hidden className="size-3" />, text: unitLabel(qtyRead.qty, unit), bad: false } : null,
    { key: 'date', icon: <CalendarDays aria-hidden className="size-3" />, text: date === today ? 'Today' : shortDate(date), bad: false },
    parsed.assigneeToken && !parsed.assigneeId ? { key: 'who', icon: <UserRound aria-hidden className="size-3" />, text: `No one named ${parsed.assigneeToken.slice(1)}`, bad: true } : null,
  ].filter((chip): chip is { key: string; icon: React.ReactElement; text: string; bad: boolean } => Boolean(chip));

  return (
    <DialogContent
      size="lg"
      data-testid="quick-add-build"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        inputRef.current?.focus();
      }}
    >
      <DialogHeader title="New build" description='Type it like "build 100 small brown glove tomorrow". Program, variant, qty and day are picked out as you type.' />
      <DialogBody className="flex flex-col gap-3 [&>*]:shrink-0">
        <Input
          ref={inputRef}
          size="lg"
          aria-label="Describe the build"
          value={text}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void submit(event.shiftKey && (event.metaKey || event.ctrlKey));
            }
          }}
          placeholder="build 100 small brown glove tomorrow"
          data-testid="build-quick-input"
        />
        <div className="flex flex-wrap items-center gap-1.5" aria-live="polite" data-testid="build-chips">
          {chips.map((chip) => (
            <span key={chip.key} className={cn(CHIP, chip.bad ? 'bg-danger-subtle text-danger-text' : 'bg-muted text-fg-secondary')}>
              {chip.icon}
              {chip.text}
            </span>
          ))}
        </div>
        {variantProblem && !variant && variantSuggestions.length ? (
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-fg-secondary" data-testid="variant-suggestions">
            {variantProblem.suggestions.length ? 'Did you mean' : 'Pick one'}
            {variantSuggestions.map((id) => {
              const match = activeVariants.find((entry) => entry.id === id);
              return match ? (
                <button key={id} type="button" onClick={() => setVariantChoice(id)} className="inline-flex h-6 items-center gap-1.5 rounded-full border border-border-subtle bg-panel px-2 text-xs font-medium text-fg hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus">
                  {match.name}
                  {match.sku ? <span className="font-key text-fg-muted">{match.sku}</span> : null}
                </button>
              ) : null;
            })}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          <label className="flex flex-col gap-1.5 text-xs font-medium text-fg-secondary">
            Program or project
            <Combobox
              aria-label="Program or project"
              value={container?.id ?? null}
              onValueChange={(value) => {
                setContainerChoice(value);
                setVariantChoice(null);
              }}
              placeholder="Pick one"
              options={[
                ...programContainers.map((entry) => ({ value: entry.id, label: entry.name, description: `Program ${entry.key}`, icon: <Repeat2 aria-hidden className="size-4 text-icon" />, keywords: [entry.key] })),
                ...projectContainers.map((entry) => ({ value: entry.id, label: entry.name, description: `Project ${entry.key}`, icon: <Boxes aria-hidden className="size-4 text-icon" />, keywords: [entry.key] })),
              ]}
            />
          </label>
          {container?.kind === 'program' ? (
            <label className="flex flex-col gap-1.5 text-xs font-medium text-fg-secondary">
              Variant
              <Combobox
                aria-label="Variant"
                value={variantId}
                onValueChange={setVariantChoice}
                placeholder="Pick a variant"
                invalid={attempted && needsVariant}
                options={activeVariants.map((entry) => ({ value: entry.id, label: entry.name, description: entry.sku ?? undefined, keywords: [entry.key, entry.sku ?? ''] }))}
              />
            </label>
          ) : (
            <p className="self-end pb-2 text-xs text-fg-muted">A build in a project has no variant. It is priced by its build rate or its Pulse job.</p>
          )}
          <label className="flex flex-col gap-1.5 text-xs font-medium text-fg-secondary">
            Planned {unit.plural}
            <Input
              inputMode="decimal"
              value={qtyTouched ? qtyChoice : parsed.qty ?? qtyChoice}
              onChange={(event) => {
                setQtyTouched(true);
                setQtyChoice(event.target.value);
              }}
              invalid={attempted && !(qtyRead.ok && qtyRead.qty)} aria-label={`Planned ${unit.plural}`} placeholder={variant?.defaultQty ? String(Number(variant.defaultQty)) : undefined} />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-fg-secondary">
            Day
            <IsoDatePicker
              value={date}
              onChange={(next) => {
                setDateTouched(true);
                setDateChoice(next);
              }}
              clearable={false}
            />
          </label>
          <label className="col-span-2 flex flex-col gap-1.5 text-xs font-medium text-fg-secondary max-sm:col-span-1">
            Assignee
            <UserPicker value={assigneeId} onChange={setAssigneeChoice} people={(people.data ?? []).map((person) => ({ id: person.id, name: person.name, email: person.email, image: person.image }))} placeholder="No one" />
          </label>
        </div>
      </DialogBody>
      <DialogFooter className="flex-wrap">
        <button type="button" onClick={() => onTaskMode(text.replace(/^\s*build\s+/i, ''))} className="mr-auto text-xs font-medium text-fg-link hover:underline">
          Make a task instead
        </button>
        <label className="flex items-center gap-2 text-sm text-fg-secondary">
          <Checkbox checked={another} onCheckedChange={(value) => setAnother(value === true)} aria-label="Add another" />
          Add another
        </label>
        <Button variant="ghost" onClick={close}>
          Cancel
        </Button>
        <Button onClick={() => void submit(false)} loading={saving} disabled={needsVariant || (attempted && !ready)} data-testid="build-quick-save">
          Create build <Kbd className="ml-1 border-white/30 bg-white/10 text-primary-fg">Enter</Kbd>
        </Button>
      </DialogFooter>
      <span className="sr-only">{mod} Shift Enter creates and opens the build.</span>
    </DialogContent>
  );
}
