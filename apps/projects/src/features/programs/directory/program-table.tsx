'use client';
/**
 * Program table (docs/programs/SPEC.md 5.3): sticky header, sortable headers, 37px rows, row
 * checkboxes with a bulk bar (Pause, Resume, Archive, Export CSV), a column visibility menu and a
 * totals footer that sums money and sums units per unit label (never across labels).
 */
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Archive, ArrowDown, ArrowUp, Columns3, Download, Pause, Play, X } from 'lucide-react';
import { formatCents, formatPercentBp, formatQty } from '@kitstak/programs-engine';
import {
  Badge,
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  IconButton,
  Tooltip,
  cn,
} from '@/components/ui';
import { PersonAvatar } from '@/components/pm';
import { formatRelative } from '@/lib/dates';
import type { ProgramListItemDTO } from '@/lib/program-types';
import { HealthWithBasis, ProgramIcon, ProgramStatusPill, programHref, targetText, targetTone, useHydrated } from '@/features/programs/kit';
import { TABLE_COLUMNS, directoryTotals, effectiveStatus, programsCsv, unitsByLabelText, type DirectorySort, type SortDir, type TableColumn } from './directory-model';
import { CustomerChip, ProgramRowMenu, StarToggle, type ProgramMenuAccess } from './program-card';
import type { ProgramOps } from './program-ops';

const SORT_BY_COLUMN: Partial<Record<TableColumn | 'name', DirectorySort>> = { name: 'name', revenue: 'revenue', targetBp: 'target', today: 'today', updated: 'updated' };
const NUMERIC: ReadonlySet<TableColumn> = new Set(['today', 'units', 'revenue', 'linked', 'forecast', 'target', 'targetBp', 'minimum']);

export function downloadCsv(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Header({ id, label, sort, dir, onSort, className }: { readonly id: TableColumn | 'name'; readonly label: string; readonly sort: DirectorySort; readonly dir: SortDir; readonly onSort: (sort: DirectorySort) => void; readonly className?: string }) {
  const key = SORT_BY_COLUMN[id];
  const numeric = id !== 'name' && NUMERIC.has(id);
  const active = key !== undefined && sort === key;
  return (
    <th scope="col" aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined} className={cn('sticky top-0 z-[2] h-9 border-b border-border-subtle bg-sunken px-2.5 text-xs font-medium whitespace-nowrap text-fg-muted', numeric ? 'text-right' : 'text-left', className)}>
      {key ? (
        <button type="button" onClick={() => onSort(key)} className={cn('inline-flex items-center gap-1 rounded-sm outline-none hover:text-fg focus-visible:outline-2 focus-visible:outline-focus', active && 'text-fg')}>
          {label}
          {active ? dir === 'asc' ? <ArrowUp aria-hidden className="size-3" /> : <ArrowDown aria-hidden className="size-3" /> : null}
        </button>
      ) : (
        label
      )}
    </th>
  );
}

function Money({ cents }: { readonly cents: string | null }) {
  return cents === null ? <span className="text-fg-muted">None</span> : <>{formatCents(cents)}</>;
}

export interface ProgramTableProps {
  readonly programs: readonly ProgramListItemDTO[];
  readonly ops: ProgramOps;
  readonly access: ProgramMenuAccess;
  readonly sort: DirectorySort;
  readonly dir: SortDir;
  readonly onSort: (sort: DirectorySort) => void;
  readonly hidden: readonly TableColumn[];
  readonly onHiddenChange: (hidden: TableColumn[]) => void;
  readonly onDelete: (program: ProgramListItemDTO) => void;
  readonly onTemplate: (program: ProgramListItemDTO) => void;
}

/** Frozen Name column: its edge casts a soft shadow once the table scrolls sideways. */
const FROZEN_EDGE = 'shadow-[1px_0_0_var(--color-border-subtle)] group-data-[scrolled=true]/table:shadow-[1px_0_0_var(--color-border-subtle),8px_0_10px_-8px_rgb(0_0_0/0.22)]';
/** The row menu column stays on the right; while more columns wait behind it, its edge casts a shadow. */
const FROZEN_RIGHT_EDGE = 'shadow-[-1px_0_0_var(--color-border-subtle),-8px_0_10px_-8px_rgb(0_0_0/0.22)]';
/** Frozen cells paint an opaque fill under the translucent hover and selected tints. */
const FROZEN_ROW = 'bg-panel group-hover/row:bg-[linear-gradient(var(--color-hover),var(--color-hover)),linear-gradient(var(--color-panel),var(--color-panel))]';
const FROZEN_SELECTED = 'bg-[linear-gradient(color-mix(in_srgb,var(--color-primary-subtle)_40%,transparent),color-mix(in_srgb,var(--color-primary-subtle)_40%,transparent)),linear-gradient(var(--color-panel),var(--color-panel))]';

/** Tracks whether the table is scrolled sideways and whether more columns wait on the right. */
function useSideScroll() {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState({ scrolled: false, more: false });
  const measure = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    const scrolled = node.scrollLeft > 1;
    const more = node.scrollLeft + node.clientWidth < node.scrollWidth - 1;
    setState((old) => (old.scrolled === scrolled && old.more === more ? old : { scrolled, more }));
  }, []);
  useEffect(() => {
    measure();
    const node = ref.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    return () => observer.disconnect();
  }, [measure]);
  return { ref, measure, ...state };
}

export function ProgramTable({ programs, ops, access, sort, dir, onSort, hidden, onHiddenChange, onDelete, onTemplate }: ProgramTableProps) {
  const hydrated = useHydrated();
  const { ref: sideRef, measure: measureSide, scrolled: sideScrolled, more: sideMore } = useSideScroll();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const moneyHidden = programs.some((program) => program.moneyHidden);
  const columns = TABLE_COLUMNS.filter((column) => !hidden.includes(column.id) && !(column.money && moneyHidden));
  const totals = directoryTotals(programs);
  const chosen = programs.filter((program) => selected.has(program.id));
  const allChecked = programs.length > 0 && chosen.length === programs.length;
  const toggle = (id: string) => setSelected((old) => {
    const next = new Set(old);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const cell = (program: ProgramListItemDTO, id: TableColumn): ReactNode => {
    switch (id) {
      case 'customer':
        return <CustomerChip customer={program.customer} className="max-w-[160px]" />;
      case 'status':
        return <ProgramStatusPill status={effectiveStatus(program)} />;
      case 'health':
        return <HealthWithBasis health={program.health} basis={program.healthBasis} auto={program.healthAuto} size="sm" />;
      case 'today':
        return program.today.builds === 0 ? <span className="text-fg-muted">No builds</span> : `${program.today.done} of ${program.today.builds}`;
      case 'units':
        return `${formatQty(program.month.units)} ${program.unit.plural}`;
      case 'revenue':
        return <Money cents={program.month.revenueCents} />;
      case 'linked':
        return <Money cents={program.month.linkedJobsCents ?? program.month.revenueCents} />;
      case 'forecast':
        return <Money cents={program.month.forecastCents} />;
      case 'target':
        return program.month.targetCents === null ? <span className="text-fg-muted">No target</span> : formatCents(program.month.targetCents);
      case 'targetBp':
        // The header already says "% of target": the cell shows the number in the target tone.
        return program.month.targetBp === null ? (
          <span className="text-fg-muted">No target</span>
        ) : (
          <span title={targetText(program.month.targetBp)}>
            <Badge tone={targetTone(program.month.targetBp)} size="sm" className="tabular-nums">
              {formatPercentBp(program.month.targetBp)}
            </Badge>
          </span>
        );
      case 'minimum': {
        const gap = program.month.minimumGapSoFarCents;
        return gap === null || gap === '0' ? <span className="text-fg-muted">None</span> : <span className="text-warning-text">{formatCents(gap)}</span>;
      }
      case 'pulse':
        return program.pulseJob ? <Tooltip content={program.pulseJob.name}><span tabIndex={0} className="rounded-sm font-key text-fg-secondary outline-none focus-visible:outline-2 focus-visible:outline-focus">{program.pulseJob.number}</span></Tooltip> : <span className="text-fg-muted">None</span>;
      case 'owner':
        return program.owner ? <PersonAvatar userId={program.owner.id} size="xs" showName firstNameOnly /> : <span className="text-fg-muted">No owner</span>;
      case 'updated':
        return <span suppressHydrationWarning className="text-fg-secondary">{hydrated ? formatRelative(program.updatedAt) : ''}</span>;
    }
  };

  const total = (id: TableColumn): ReactNode => {
    switch (id) {
      case 'today':
        return `${totals.todayDone} of ${totals.todayBuilds}`;
      case 'units':
        return unitsByLabelText(totals.units);
      case 'revenue':
        return <Money cents={totals.revenueCents} />;
      case 'linked':
        return <Money cents={totals.linkedCents} />;
      case 'forecast':
        return <Money cents={totals.forecastCents} />;
      case 'target':
        return <Money cents={totals.targetCents} />;
      case 'minimum':
        return <Money cents={totals.minimumGapCents} />;
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
        {chosen.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border-subtle bg-panel px-2 py-1 shadow-xs" role="toolbar" aria-label="Selected programs" data-testid="program-bulk-bar">
            <span className="px-1 text-sm font-medium text-fg tabular-nums">{chosen.length} selected</span>
            {access.canEdit ? (
              <>
                <Button size="sm" variant="ghost" leadingIcon={<Pause aria-hidden />} onClick={() => void ops.setPaused(chosen, true)}>Pause</Button>
                <Button size="sm" variant="ghost" leadingIcon={<Play aria-hidden />} onClick={() => void ops.setPaused(chosen, false)}>Resume</Button>
                <Button size="sm" variant="ghost" leadingIcon={<Archive aria-hidden />} onClick={() => { void ops.archive(chosen); setSelected(new Set()); }}>Archive</Button>
              </>
            ) : null}
            <Button size="sm" variant="ghost" leadingIcon={<Download aria-hidden />} onClick={() => downloadCsv('programs.csv', programsCsv(chosen))}>Export CSV</Button>
            <IconButton size="sm" label="Clear selection" icon={<X aria-hidden />} onClick={() => setSelected(new Set())} />
          </div>
        ) : (
          <p className="text-xs text-fg-muted">{programs.length} {programs.length === 1 ? 'program' : 'programs'} · select rows to pause, archive or export</p>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" leadingIcon={<Columns3 aria-hidden />}>Columns</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Show columns</DropdownMenuLabel>
            {TABLE_COLUMNS.filter((column) => !(column.money && moneyHidden)).map((column) => (
              <DropdownMenuCheckboxItem
                key={column.id}
                checked={!hidden.includes(column.id)}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={(checked) => onHiddenChange(checked ? hidden.filter((id) => id !== column.id) : [...hidden, column.id])}
              >
                {column.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="relative">
      <div
        ref={sideRef}
        onScroll={measureSide}
        data-scrolled={sideScrolled}
        className="group/table max-h-[calc(100vh-260px)] overflow-auto rounded-xl border border-border-subtle bg-panel shadow-xs"
      >
        <table className="w-full border-separate border-spacing-0 text-sm" data-testid="programs-table">
          <thead>
            <tr>
              <th scope="col" className="sticky top-0 left-0 z-[3] h-9 w-10 border-b border-border-subtle bg-sunken px-3">
                <Checkbox checked={allChecked ? true : chosen.length > 0 ? 'indeterminate' : false} onCheckedChange={() => setSelected(allChecked ? new Set() : new Set(programs.map((program) => program.id)))} aria-label="Select all programs" />
              </th>
              <Header id="name" label="Name" sort={sort} dir={dir} onSort={onSort} className={cn('sticky left-10 z-[3] min-w-[200px]', FROZEN_EDGE)} />
              {columns.map((column) => <Header key={column.id} id={column.id} label={column.label} sort={sort} dir={dir} onSort={onSort} />)}
              <th scope="col" className={cn('sticky top-0 right-0 z-[3] w-10 border-b border-border-subtle bg-sunken', sideMore && FROZEN_RIGHT_EDGE)}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {programs.map((program) => {
              const href = programHref(program.key);
              const isSelected = selected.has(program.id);
              return (
                <tr key={program.id} className={cn('group group/row h-[37px]', isSelected ? 'bg-primary-subtle/40' : 'hover:bg-hover')} data-testid="program-row" data-program={program.key}>
                  <td className={cn('sticky left-0 z-[1] border-b border-border-subtle px-3', isSelected ? FROZEN_SELECTED : FROZEN_ROW)}>
                    <Checkbox checked={isSelected} onCheckedChange={() => toggle(program.id)} aria-label={`Select ${program.name}`} />
                  </td>
                  <td className={cn('sticky left-10 z-[1] max-w-[320px] border-b border-border-subtle px-3', isSelected ? FROZEN_SELECTED : FROZEN_ROW, FROZEN_EDGE)}>
                    <span className="flex min-w-0 items-center gap-2">
                      <ProgramIcon icon={program.icon} color={program.color} size={20} />
                      {href ? (
                        <Link href={href} className="truncate font-medium text-fg outline-none hover:underline focus-visible:outline-2 focus-visible:outline-focus" title={program.name}>{program.name}</Link>
                      ) : (
                        <span className="truncate font-medium text-fg" title={program.name}>{program.name}</span>
                      )}
                      <span className="shrink-0 font-key text-xs text-fg-muted">{program.key}</span>
                      <StarToggle program={program} ops={ops} />
                    </span>
                  </td>
                  {columns.map((column) => (
                    <td key={column.id} className={cn('border-b border-border-subtle px-2.5 whitespace-nowrap', NUMERIC.has(column.id) ? 'text-right text-fg tabular-nums' : 'text-fg-secondary')}>
                      {cell(program, column.id)}
                    </td>
                  ))}
                  <td className={cn('sticky right-0 z-[1] border-b border-border-subtle px-1', isSelected ? FROZEN_SELECTED : FROZEN_ROW, sideMore && FROZEN_RIGHT_EDGE)}>
                    <ProgramRowMenu program={program} ops={ops} access={access} onDelete={() => onDelete(program)} onTemplate={() => onTemplate(program)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="h-10 font-semibold" data-testid="programs-totals">
              <td className="sticky bottom-0 left-0 z-[3] border-t border-border-default bg-sunken px-3" />
              <td className={cn('sticky bottom-0 left-10 z-[3] border-t border-border-default bg-sunken px-3 whitespace-nowrap text-fg', FROZEN_EDGE)}>
                Total · {totals.programs} {totals.programs === 1 ? 'program' : 'programs'}
              </td>
              {columns.map((column) => (
                <td key={column.id} className={cn('sticky bottom-0 z-[2] border-t border-border-default bg-sunken px-2.5 whitespace-nowrap text-fg', NUMERIC.has(column.id) && 'text-right tabular-nums')}>
                  {total(column.id)}
                </td>
              ))}
              <td className={cn('sticky right-0 bottom-0 z-[3] border-t border-border-default bg-sunken', sideMore && FROZEN_RIGHT_EDGE)} />
            </tr>
          </tfoot>
        </table>
      </div>

      </div>
      <p className="text-2xs text-fg-muted">
        Units{moneyHidden ? '' : ' and money'} are this month to date.{moneyHidden ? '' : ` % of target uses the forecast. ${formatPercentBp(10000)} means the forecast meets the target.`} Turn more columns on in Columns.
      </p>
    </div>
  );
}
