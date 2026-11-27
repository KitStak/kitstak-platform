'use client';
/**
 * Build menu items (docs/programs/SPEC.md 5.7): Log output, Set planned qty, Change variant, Move
 * to day, Set build rate, Duplicate, Move to program or project; and under Danger, Cancel build
 * and Delete build (only when nothing was logged). Rendered inside the shared task menus (dropdown
 * and right click) through the card extras, and in the build drawer.
 */
import type { ComponentType, ReactNode } from 'react';
import { ArrowRightLeft, Ban, CalendarDays, ClipboardPen, Copy, DollarSign, Hash, Shapes, Trash2 } from 'lucide-react';
import { addDays, quantityToScaled } from '@kitstak/programs-engine';
import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui';
import { useProjects } from '@/lib/hooks/use-data';
import { usePrograms } from '@/lib/hooks/use-programs';
import type { TaskSummary } from '@/lib/types';
import { useCurrentProgram } from '../program-context';
import { VariantDot } from '../kit/chips';
import { useProgramOverlays } from '../overlays/overlay-params';
import { buildOf } from './builds-model';
import { openBuildDialog } from './build-dialogs';
import type { BuildActions } from './use-build-actions';

type ItemProps = { readonly icon?: ReactNode; readonly onSelect?: (event: Event) => void; readonly variant?: 'default' | 'danger'; readonly children: ReactNode; readonly description?: ReactNode; readonly disabled?: boolean; readonly className?: string };

interface Parts {
  readonly Item: ComponentType<ItemProps>;
  readonly Label: ComponentType<{ children: ReactNode }>;
  readonly Sub: ComponentType<{ children: ReactNode }>;
  readonly SubTrigger: ComponentType<{ icon?: ReactNode; children: ReactNode }>;
  readonly SubContent: ComponentType<{ children: ReactNode; className?: string }>;
}

const DROPDOWN: Parts = {
  Item: DropdownMenuItem as ComponentType<ItemProps>,
  Label: DropdownMenuLabel as ComponentType<{ children: ReactNode }>,
  Sub: DropdownMenuSub as ComponentType<{ children: ReactNode }>,
  SubTrigger: DropdownMenuSubTrigger as ComponentType<{ icon?: ReactNode; children: ReactNode }>,
  SubContent: DropdownMenuSubContent as ComponentType<{ children: ReactNode; className?: string }>,
};

const CONTEXT: Parts = {
  Item: ContextMenuItem as ComponentType<ItemProps>,
  Label: ContextMenuLabel as ComponentType<{ children: ReactNode }>,
  Sub: ContextMenuSub as ComponentType<{ children: ReactNode }>,
  SubTrigger: ContextMenuSubTrigger as ComponentType<{ icon?: ReactNode; children: ReactNode }>,
  SubContent: ContextMenuSubContent as ComponentType<{ children: ReactNode; className?: string }>,
};

export function partsFor(kind: 'dropdown' | 'context'): Parts {
  return kind === 'dropdown' ? DROPDOWN : CONTEXT;
}

export function hasOutput(task: TaskSummary): boolean {
  const build = buildOf(task);
  return Boolean(build && quantityToScaled(build.builtQty) > BigInt(0));
}

export function BuildMenuItems({ task, kind, actions }: { readonly task: TaskSummary; readonly kind: 'dropdown' | 'context'; readonly actions: BuildActions }) {
  const { Item, Label, Sub, SubTrigger, SubContent } = partsFor(kind);
  const { key, program, activeVariants, capabilities, today } = useCurrentProgram();
  const overlays = useProgramOverlays();
  const programs = usePrograms({}, { staleTime: 60_000 });
  const projects = useProjects();
  const build = buildOf(task);
  if (!build) return null;
  const canPlan = capabilities.canPlan;
  const logDate = build.buildDate > today ? today : build.buildDate;
  const nextWork = program.calendar.nextWorkDay;
  const otherPrograms = (programs.data ?? []).filter((entry) => entry.key !== key && !entry.archivedAt && entry.status !== 'archived');
  const otherProjects = (projects.data ?? []).filter((entry) => !entry.archivedAt && !entry.isTemplate && (entry.role === 'owner' || entry.role === 'editor') && entry.kind !== 'program');

  return (
    <>
      <Label>Build</Label>
      {capabilities.canLog ? (
        <Item icon={<ClipboardPen aria-hidden />} onSelect={() => overlays.openLog({ date: logDate, builds: [task.id] })}>
          Log output
        </Item>
      ) : null}
      {canPlan ? (
        <>
          <Item icon={<Hash aria-hidden />} onSelect={() => openBuildDialog({ kind: 'planned', builds: [task] })}>
            Set planned qty
          </Item>
          {activeVariants.length > 1 ? (
            <Sub>
              <SubTrigger icon={<Shapes aria-hidden />}>Change variant</SubTrigger>
              <SubContent className="max-h-80 w-56 overflow-y-auto">
                {activeVariants.map((variant) => (
                  <Item key={variant.id} icon={<VariantDot color={variant.color} />} disabled={variant.id === build.variantId} onSelect={() => void actions.update(task, { variantId: variant.id }, `${task.key} is now ${variant.name}`)}>
                    {variant.id === build.variantId ? `${variant.name} (now)` : variant.name}
                  </Item>
                ))}
              </SubContent>
            </Sub>
          ) : null}
          <Sub>
            <SubTrigger icon={<CalendarDays aria-hidden />}>Move to day</SubTrigger>
            <SubContent className="w-52">
              <Item disabled={build.buildDate === today} onSelect={() => void actions.update(task, { buildDate: today }, `${task.key} moved to today`)}>
                Today
              </Item>
              <Item onSelect={() => void actions.update(task, { buildDate: addDays(today, 1) }, `${task.key} moved to tomorrow`)}>Tomorrow</Item>
              <Item onSelect={() => void actions.update(task, { buildDate: nextWork }, `${task.key} moved to the next work day`)}>Next work day</Item>
              <Item onSelect={() => openBuildDialog({ kind: 'day', builds: [task] })}>Pick a date</Item>
            </SubContent>
          </Sub>
          {capabilities.canPrice ? (
            <Item className="[&_.truncate]:whitespace-normal" icon={<DollarSign aria-hidden />} description="Beats the price card on open days" onSelect={() => openBuildDialog({ kind: 'rate', build: task })}>
              Set build rate
            </Item>
          ) : null}
          <Sub>
            <SubTrigger icon={<Copy aria-hidden />}>Duplicate</SubTrigger>
            <SubContent className="w-56">
              <Item onSelect={() => void actions.duplicate(task, 'here')}>Here</Item>
              <Item onSelect={() => void actions.duplicate(task, 'tomorrow')}>To tomorrow</Item>
              <Item onSelect={() => void actions.duplicate(task, 'next_scheduled')}>To next scheduled day</Item>
            </SubContent>
          </Sub>
          {otherPrograms.length + otherProjects.length > 0 ? (
            <Sub>
              <SubTrigger icon={<ArrowRightLeft aria-hidden />}>Move to program or project</SubTrigger>
              <SubContent className="max-h-80 w-72 overflow-y-auto">
                {otherPrograms.length ? <Label>Programs</Label> : null}
                {otherPrograms.map((entry) => (
                  <Item key={entry.id} description="The variant is cleared" onSelect={() => void actions.move(task, entry.key, entry.name, null)}>
                    {`${entry.name} (${entry.key})`}
                  </Item>
                ))}
                {otherProjects.length ? <Label>Projects</Label> : null}
                {otherProjects.map((entry) => (
                  <Item key={entry.id} description="Priced by its build rate or job" onSelect={() => void actions.move(task, entry.key, entry.name, null)}>
                    {`${entry.name} (${entry.key})`}
                  </Item>
                ))}
              </SubContent>
            </Sub>
          ) : null}
        </>
      ) : null}
    </>
  );
}

export function BuildDangerItems({ task, kind, actions }: { readonly task: TaskSummary; readonly kind: 'dropdown' | 'context'; readonly actions: BuildActions }) {
  const { Item, Label } = partsFor(kind);
  const { capabilities } = useCurrentProgram();
  const build = buildOf(task);
  if (!build || !capabilities.canPlan) return null;
  const cancelled = task.statusCategory === 'cancelled';
  return (
    <>
      <Label>Danger</Label>
      {!cancelled ? (
        <Item className="[&_.truncate]:whitespace-normal" icon={<Ban aria-hidden />} variant="danger" description="Keeps logged output, stops the batch fee" onSelect={() => void actions.cancel([task.id])}>
          Cancel build
        </Item>
      ) : null}
      {!hasOutput(task) ? (
        <Item className="[&_.truncate]:whitespace-normal" icon={<Trash2 aria-hidden />} variant="danger" description="Only when nothing was logged" onSelect={() => void actions.remove([task.id], `Deleted ${task.key}`)}>
          Delete build
        </Item>
      ) : null}
    </>
  );
}
