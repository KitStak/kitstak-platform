'use client';
/**
 * The variant generator (docs/programs/SPEC.md 5.4 Step 2 "Make a matrix", 5.11 Edit attributes).
 * Up to 4 attributes with value chips (label, code, color; drag to reorder), presets, name, key and
 * SKU patterns with token chips and a live example, a matrix preview (a grid for 2 attributes, a
 * table otherwise) with include, default qty and rate per variant, row and column selection with a
 * toolbar, rate rules, conflict outlines and a summary. Controlled: `value` and `onChange`.
 */
import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, GripVertical, MoreHorizontal, Plus, Sparkles, X } from 'lucide-react';
import {
  Button,
  Checkbox,
  ColorPicker,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  cn,
  isLabelColor,
} from '@/components/ui';
import type { UnitLabel } from '@/lib/program-types';
import { VariantDot } from '../kit/chips';
import { RateRulesEditor, rateHint } from './rate-rules-editor';
import {
  AXIS_PRESETS,
  axisFromPreset,
  buildRows,
  canAddAxis,
  effectivePatterns,
  existingComboKeys,
  generatorSummary,
  lineKeys,
  localId,
  matrixKeys,
  moveAxis,
  moveValue,
  newValue,
  newVariantsSummary,
  patchOverrides,
  qtyCellProblem,
  rateCellProblem,
  rowConflicts,
  rowRates,
  type EditorAxis,
  type EditorRow,
  type EditorValue,
  type RowRate,
  type VariantGeneratorValue,
} from './variant-model';

export interface VariantGeneratorProps {
  readonly value: VariantGeneratorValue;
  readonly onChange: (value: VariantGeneratorValue) => void;
  readonly programKey: string;
  readonly unit: UnitLabel;
  /** The card default rate ("1.9500"), so empty rate cells show what they will get. */
  readonly cardRate?: string | null;
  /** The program's variants today, for conflict checks (Edit attributes, Add variants). */
  readonly existing?: readonly { readonly key: string; readonly name: string; readonly sku: string | null; readonly attributes: Record<string, string> }[];
  /**
   * Rows that match `existing` show checked and locked with an "Already a variant" tag, and are
   * left out of the new count and of conflicts (the Variants tab's Add variants and Edit attributes).
   */
  readonly lockedExisting?: boolean;
  /** A kit cell per row (the wizard's "Kit found" chip and Link kit). */
  readonly renderKitCell?: (row: EditorRow) => ReactNode;
  readonly showRules?: boolean;
  readonly disabled?: boolean;
}

const cellInput =
  'h-7 w-full min-w-0 rounded-md border bg-panel px-1.5 text-right text-xs tabular-nums text-fg outline-none placeholder:text-fg-muted hover:border-border-input-hover focus:border-primary focus:shadow-[0_0_0_3px_var(--focus-ring-soft)] disabled:bg-muted';

/* ---------------------------------------------------------------------------------------------- */
/* Value chips                                                                                    */
/* ---------------------------------------------------------------------------------------------- */

function ValueChip({ value, onChange, onRemove, onDragStart, onDrop, disabled }: { readonly value: EditorValue; readonly onChange: (value: EditorValue) => void; readonly onRemove: () => void; readonly onDragStart: () => void; readonly onDrop: () => void; readonly disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      draggable={!disabled}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
      className="group/chip inline-flex h-7 items-center gap-1 rounded-full border border-border-subtle bg-panel pr-1 pl-1.5 text-xs font-medium text-fg shadow-xs"
      data-testid="axis-value"
    >
      <GripVertical aria-hidden className="size-3 cursor-grab text-fg-muted opacity-0 group-hover/chip:opacity-100" />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" disabled={disabled} className="inline-flex items-center gap-1.5 rounded-full outline-none focus-visible:outline-2 focus-visible:outline-focus" aria-label={`Edit ${value.label}`}>
            {value.color ? <VariantDot color={value.color} /> : null}
            <span>{value.label}</span>
            <span className="font-key text-2xs text-fg-muted">{value.code}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="start">
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-fg-secondary">
              Label
              <Input value={value.label} onChange={(event) => onChange({ ...value, label: event.target.value })} autoFocus />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-fg-secondary">
              Code
              <Input value={value.code} maxLength={6} onChange={(event) => onChange({ ...value, code: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} className="font-key" />
              <span className="font-normal text-fg-muted">1 to 6 letters or numbers. Used in keys and SKUs.</span>
            </label>
            <div className="flex flex-col gap-1 text-xs font-medium text-fg-secondary">
              Color
              <ColorPicker value={isLabelColor(value.color) ? value.color : 'gray'} onChange={(color) => onChange({ ...value, color })} />
            </div>
            <Button size="sm" onClick={() => setOpen(false)} className="self-end">
              Done
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <button type="button" aria-label={`Remove ${value.label}`} disabled={disabled} onClick={onRemove} className="inline-flex size-5 items-center justify-center rounded-full text-icon hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-focus">
        <X aria-hidden className="size-3" />
      </button>
    </span>
  );
}

function AttributeRow({ axis, index, count, onChange, onMove, onRemove, disabled }: { readonly axis: EditorAxis; readonly index: number; readonly count: number; readonly onChange: (axis: EditorAxis) => void; readonly onMove: (by: -1 | 1) => void; readonly onRemove: () => void; readonly disabled?: boolean }) {
  const [draft, setDraft] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const addDraft = () => {
    const labels = draft
      .split(/[,\n]/)
      .map((label) => label.trim())
      .filter(Boolean);
    if (labels.length === 0) return;
    let next = axis;
    for (const label of labels) {
      if (next.values.some((value) => value.label.toLowerCase() === label.toLowerCase())) continue;
      next = { ...next, values: [...next.values, newValue(next, label)] };
    }
    onChange(next);
    setDraft('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addDraft();
    } else if (event.key === 'Backspace' && draft === '' && axis.values.length) {
      onChange({ ...axis, values: axis.values.slice(0, -1) });
    }
  };
  return (
    <li className="grid gap-2 rounded-lg border border-border-subtle bg-panel p-2.5 sm:grid-cols-[160px_1fr_auto] sm:items-start" data-testid="attribute-row">
      <Input ref={nameRef} aria-label={`Attribute ${index + 1} name`} value={axis.name} disabled={disabled} onChange={(event) => onChange({ ...axis, name: event.target.value })} placeholder="Size" className="font-medium" />
      <div className="flex min-h-8 flex-wrap items-center gap-1.5 rounded-md border border-dashed border-border-default px-1.5 py-1 focus-within:border-primary">
        {axis.values.map((value, valueIndex) => (
          <ValueChip
            key={value.id}
            value={value}
            disabled={disabled}
            onChange={(next) => onChange({ ...axis, values: axis.values.map((entry) => (entry.id === value.id ? next : entry)) })}
            onRemove={() => onChange({ ...axis, values: axis.values.filter((entry) => entry.id !== value.id) })}
            onDragStart={() => setDragging(value.id)}
            onDrop={() => {
              if (dragging && dragging !== value.id) onChange(moveValue(axis, dragging, valueIndex));
              setDragging(null);
            }}
          />
        ))}
        <input
          aria-label={`Add a value to ${axis.name || 'this attribute'}`}
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={addDraft}
          placeholder={axis.values.length ? 'Add a value' : 'Type a value and press Enter'}
          className="h-7 min-w-32 flex-1 bg-transparent px-1 text-sm text-fg outline-none placeholder:text-fg-placeholder"
        />
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label={`More for ${axis.name || 'this attribute'}`} icon={<MoreHorizontal aria-hidden />} size="md" disabled={disabled} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={() => window.setTimeout(() => nameRef.current?.select(), 0)}>Rename</DropdownMenuItem>
          <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(-1)}>
            Move up
          </DropdownMenuItem>
          <DropdownMenuItem disabled={index === count - 1} onSelect={() => onMove(1)}>
            Move down
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="danger" onSelect={onRemove}>
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Patterns                                                                                       */
/* ---------------------------------------------------------------------------------------------- */

function PatternField({ label, value, tokens, onChange, onClear, disabled }: { readonly label: string; readonly value: string; readonly tokens: readonly string[]; readonly onChange: (value: string) => void; readonly onClear?: () => void; readonly disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const id = useId();
  const insert = (token: string) => {
    const input = ref.current;
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? value.length;
    const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
    onChange(next);
    window.setTimeout(() => {
      input?.focus();
      input?.setSelectionRange(start + token.length, start + token.length);
    }, 0);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="flex items-center justify-between text-xs font-medium text-fg-secondary">
        {label}
        {onClear && value ? (
          <button type="button" onClick={onClear} className="text-xs font-medium text-fg-link hover:underline">
            Clear
          </button>
        ) : null}
      </label>
      <Input id={id} ref={ref} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="font-key text-xs" placeholder={onClear ? 'No SKU' : undefined} />
      <div className="flex flex-wrap gap-1">
        {tokens.map((token) => (
          <button key={token} type="button" disabled={disabled} onClick={() => insert(token)} className="rounded-sm border border-border-subtle bg-sunken px-1.5 py-px font-key text-2xs text-fg-secondary hover:border-border-default hover:text-fg focus-visible:outline-2 focus-visible:outline-focus">
            {token}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Matrix and table                                                                               */
/* ---------------------------------------------------------------------------------------------- */

interface CellProps {
  readonly row: EditorRow;
  readonly rate: RowRate | undefined;
  readonly conflict: string | null;
  readonly rateConflict: string | null;
  readonly selected: boolean;
  /** Already a variant of the program (locked, `lockedExisting`). */
  readonly locked?: boolean;
  readonly unit: UnitLabel;
  readonly disabled?: boolean;
  readonly onPatch: (patch: { include?: boolean; defaultQty?: string | null; unitPrice?: string | null }) => void;
  readonly onToggleSelect: () => void;
}

function RateInput({ row, rate, disabled, onPatch, label }: Pick<CellProps, 'row' | 'rate' | 'disabled' | 'onPatch'> & { readonly label: string }) {
  const problem = rateCellProblem(row.unitPrice);
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      title={problem ?? (rate?.ruleText ? rate.ruleText : undefined)}
      aria-invalid={problem ? true : undefined}
      value={row.unitPrice ?? ''}
      disabled={disabled || !row.include}
      placeholder={rate ? rateHint(rate.price, rate.source === 'typed' ? 'card' : rate.source) : 'Rate'}
      onChange={(event) => onPatch({ unitPrice: event.target.value.replace(/^\$/, '') || null })}
      className={cn(cellInput, problem ? 'border-danger' : 'border-border-input')}
    />
  );
}

function QtyInput({ row, disabled, onPatch, label }: Pick<CellProps, 'row' | 'disabled' | 'onPatch'> & { readonly label: string }) {
  const problem = qtyCellProblem(row.defaultQty);
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      title={problem ?? undefined}
      aria-invalid={problem ? true : undefined}
      value={row.defaultQty ?? ''}
      disabled={disabled || !row.include}
      placeholder="Qty"
      onChange={(event) => onPatch({ defaultQty: event.target.value || null })}
      className={cn(cellInput, problem ? 'border-danger' : 'border-border-input')}
    />
  );
}

function AlreadyTag() {
  return <span className="inline-flex h-4 shrink-0 items-center rounded-sm bg-sunken px-1 text-[10px] font-medium text-fg-muted" data-testid="already-variant">Already a variant</span>;
}

function MatrixCell({ row, rate, conflict, rateConflict, selected, disabled: disabledProp, locked, onPatch, onToggleSelect }: CellProps) {
  const problem = locked ? null : (conflict ?? rateConflict);
  const disabled = disabledProp || locked;
  const card = (
    <div
      className={cn(
        'flex h-[84px] w-[132px] flex-col gap-1 rounded-lg border bg-panel p-1.5 transition-[border-color,box-shadow,opacity]',
        row.include ? 'shadow-xs' : 'border-dashed opacity-60',
        problem ? 'border-danger ring-1 ring-danger' : selected ? 'border-primary ring-1 ring-primary' : 'border-border-subtle',
      )}
      data-testid="matrix-cell"
      data-combo={row.comboKey}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <Checkbox checked={locked ? true : row.include} disabled={disabled} onCheckedChange={(checked) => onPatch({ include: checked === true })} aria-label={locked ? `${row.name} is already a variant` : `Include ${row.name}`} />
        <button type="button" onClick={locked ? undefined : onToggleSelect} disabled={locked} className="min-w-0 flex-1 truncate text-left text-xs font-medium text-fg outline-none focus-visible:underline" title={locked ? `${row.name} is already a variant of this program.` : `${row.name}. Click to select.`}>
          {row.name}
        </button>
      </div>
      <span className="flex min-w-0 items-center gap-1">
        <span className="min-w-0 truncate font-key text-[11px] text-fg-muted" title={row.sku ?? row.key}>
          {row.sku ?? row.key}
        </span>
        {locked ? <AlreadyTag /> : null}
      </span>
      <div className="mt-auto grid grid-cols-2 gap-1">
        <QtyInput row={row} disabled={disabled} onPatch={onPatch} label={`Default qty for ${row.name}`} />
        <RateInput row={row} rate={rate} disabled={disabled} onPatch={onPatch} label={`Rate for ${row.name}`} />
      </div>
    </div>
  );
  return problem ? <Tooltip content={problem}>{<div tabIndex={-1}>{card}</div>}</Tooltip> : card;
}

/* ---------------------------------------------------------------------------------------------- */
/* Selection toolbar                                                                              */
/* ---------------------------------------------------------------------------------------------- */

function SetValuePopover({ label, placeholder, onApply }: { readonly label: string; readonly placeholder: string; readonly onApply: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm">
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3" align="start">
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onApply(text);
            setOpen(false);
            setText('');
          }}
        >
          <Input autoFocus inputMode="decimal" aria-label={label} placeholder={placeholder} value={text} onChange={(event) => setText(event.target.value)} />
          <Button type="submit" size="sm" disabled={!text.trim()}>
            Apply
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* The generator                                                                                  */
/* ---------------------------------------------------------------------------------------------- */

export function VariantGenerator({ value, onChange, programKey, unit, cardRate = null, existing = [], lockedExisting = false, renderKitCell, showRules = true, disabled }: VariantGeneratorProps) {
  const [patternsOpen, setPatternsOpen] = useState(!value.patternsEdited);
  const [selection, setSelection] = useState<readonly string[]>([]);
  const built = useMemo(() => buildRows(value, programKey), [value, programKey]);
  const rows = built.rows;
  const rates = useMemo(() => rowRates(rows, value.rules, value.axes, cardRate), [rows, value.rules, value.axes, cardRate]);
  const lockedKeys = useMemo(() => (lockedExisting ? existingComboKeys(rows, existing) : new Set<string>()), [lockedExisting, rows, existing]);
  const conflicts = useMemo(() => rowConflicts(lockedExisting ? rows.filter((row) => !lockedKeys.has(row.comboKey)) : rows, existing), [rows, existing, lockedExisting, lockedKeys]);
  const patterns = effectivePatterns(value);
  const matrix = matrixKeys(rows, value.axes);
  const usedAxes = value.axes.filter((axis) => axis.values.length > 0 && axis.name.trim());
  const tokens = [...usedAxes.flatMap((axis) => [`{${axis.name.trim()}}`, `{${axis.name.trim()}.code}`]), '{program}'];
  const example = rows.find((row) => row.include) ?? rows[0];

  const setAxes = (axes: readonly EditorAxis[]) => onChange({ ...value, axes: [...axes] });
  const patchRow = (comboKey: string, patch: Parameters<CellProps['onPatch']>[0]) => onChange({ ...value, overrides: patchOverrides(value.overrides, [comboKey], patch) });
  const patchSelection = (patch: Parameters<CellProps['onPatch']>[0]) => onChange({ ...value, overrides: patchOverrides(value.overrides, selection, patch) });
  const toggle = (all: readonly string[]) => {
    const keys = all.filter((key) => !lockedKeys.has(key));
    setSelection((current) => (keys.every((key) => current.includes(key)) ? current.filter((key) => !keys.includes(key)) : [...new Set([...current, ...keys])]));
  };
  const setPattern = (field: 'name' | 'key' | 'sku', text: string | null) => onChange({ ...value, patterns: { ...patterns, [field]: text }, patternsEdited: true });
  const rateFor = (row: EditorRow) => rates.rates.get(row.comboKey);
  const cellProps = (row: EditorRow): CellProps => ({
    row,
    rate: rateFor(row),
    conflict: conflicts.get(row.comboKey) ?? null,
    rateConflict: rates.conflicts.get(row.comboKey) ?? null,
    selected: selection.includes(row.comboKey),
    locked: lockedKeys.has(row.comboKey),
    unit,
    disabled,
    onPatch: (patch) => patchRow(row.comboKey, patch),
    onToggleSelect: () => toggle([row.comboKey]),
  });

  return (
    <div className="flex flex-col gap-5" data-testid="variant-generator">
      <section className="flex flex-col gap-2" aria-label="Attributes">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-fg">Attributes</h3>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" leadingIcon={<Sparkles aria-hidden />} disabled={disabled || !canAddAxis(value.axes)} data-testid="axis-presets">
                Use a preset
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel>Add an attribute</DropdownMenuLabel>
              {AXIS_PRESETS.map((preset) => (
                <DropdownMenuItem key={preset.id} description={preset.values.map((entry) => entry.label).join(', ')} onSelect={() => setAxes([...value.axes, axisFromPreset(preset, value.axes)])}>
                  {preset.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {value.axes.length === 0 ? <p className="rounded-lg border border-dashed border-border-default bg-sunken/60 px-4 py-5 text-center text-sm text-fg-secondary">Add an attribute like Size or Color, or pick a preset. Each mix of values becomes one variant.</p> : null}
        <ul className="flex flex-col gap-2">
          {value.axes.map((axis, index) => (
            <AttributeRow
              key={axis.id}
              axis={axis}
              index={index}
              count={value.axes.length}
              disabled={disabled}
              onChange={(next) => setAxes(value.axes.map((entry) => (entry.id === axis.id ? next : entry)))}
              onMove={(by) => setAxes(moveAxis(value.axes, axis.id, by))}
              onRemove={() => onChange({ ...value, axes: value.axes.filter((entry) => entry.id !== axis.id), rules: value.rules.filter((rule) => rule.attributeId !== axis.id) })}
            />
          ))}
        </ul>
        {canAddAxis(value.axes) ? (
          <Button variant="ghost" size="sm" leadingIcon={<Plus aria-hidden />} disabled={disabled} className="w-fit" onClick={() => setAxes([...value.axes, { id: localId('a'), name: '', values: [] }])} data-testid="axis-add">
            Add attribute
          </Button>
        ) : (
          <p className="text-xs text-fg-muted">Up to 4 attributes.</p>
        )}
      </section>

      <section className="rounded-lg border border-border-subtle bg-sunken/40" aria-label="Names and SKUs">
        <button type="button" onClick={() => setPatternsOpen(!patternsOpen)} aria-expanded={patternsOpen} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-fg outline-none focus-visible:outline-2 focus-visible:outline-focus">
          {patternsOpen ? <ChevronDown aria-hidden className="size-4 text-icon" /> : <ChevronRight aria-hidden className="size-4 text-icon" />}
          Names and SKUs
          {example ? <span className="ml-auto truncate font-normal text-xs text-fg-muted">{[example.name, example.key, example.sku].filter(Boolean).join(' · ')}</span> : null}
        </button>
        {patternsOpen ? (
          <div className="grid gap-3 border-t border-border-subtle p-3 md:grid-cols-3">
            <PatternField label="Name" value={patterns.name} tokens={tokens} disabled={disabled} onChange={(text) => setPattern('name', text)} />
            <PatternField label="Key" value={patterns.key} tokens={tokens.filter((token) => token.endsWith('.code}') || token === '{program}')} disabled={disabled} onChange={(text) => setPattern('key', text)} />
            <PatternField label="SKU" value={patterns.sku ?? ''} tokens={tokens.filter((token) => token.endsWith('.code}') || token === '{program}')} disabled={disabled} onChange={(text) => setPattern('sku', text)} onClear={() => setPattern('sku', null)} />
            {example ? (
              <p className="text-xs text-fg-secondary md:col-span-3" data-testid="pattern-example">
                Example: <span className="font-medium text-fg">{example.name}</span> · <span className="font-key">{example.key}</span>
                {example.sku ? (
                  <>
                    {' '}
                    · <span className="font-key">{example.sku}</span>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      {built.error ? (
        <p className="rounded-md bg-danger-subtle px-3 py-2 text-sm text-danger-text" role="alert">
          {built.error}
        </p>
      ) : null}

      {rows.length ? (
        <section className="flex flex-col gap-2" aria-label="Variants">
          <div className="flex min-h-8 flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-fg">Variants</h3>
            {selection.length ? (
              <div className="ml-auto flex flex-wrap items-center gap-1.5 rounded-lg border border-border-subtle bg-raised px-2 py-1 shadow-xs" role="toolbar" aria-label="Selected variants" data-testid="selection-toolbar">
                <span className="px-1 text-xs font-medium text-fg">{selection.length} selected</span>
                <SetValuePopover label="Set qty" placeholder="100" onApply={(text) => patchSelection({ defaultQty: text })} />
                <SetValuePopover label="Set rate" placeholder="1.95" onApply={(text) => patchSelection({ unitPrice: text.replace(/^\$/, '') })} />
                <Button variant="secondary" size="sm" onClick={() => patchSelection({ include: true })}>
                  Include
                </Button>
                <Button variant="secondary" size="sm" onClick={() => patchSelection({ include: false })}>
                  Leave out
                </Button>
                <IconButton label="Clear selection" size="sm" icon={<X aria-hidden />} onClick={() => setSelection([])} />
              </div>
            ) : (
              <span className="ml-auto text-xs text-fg-muted">{matrix ? 'Click a row or column name to select it.' : 'Click a name to select it.'}</span>
            )}
          </div>
          {matrix ? (
            <div className="overflow-auto rounded-lg border border-border-subtle bg-sunken/40" data-testid="variant-matrix">
              <table className="border-separate border-spacing-1.5">
                <thead>
                  <tr>
                    <th className="sticky top-0 left-0 z-[2] bg-sunken/95 px-2 text-left text-2xs font-semibold tracking-wide text-fg-muted uppercase">
                      {matrix.rowAxis.name} / {matrix.colAxis.name}
                    </th>
                    {matrix.colAxis.values.map((col) => {
                      const keys = lineKeys(rows, matrix.colAxis.id, col.id);
                      const on = keys.length > 0 && keys.every((key) => selection.includes(key));
                      return (
                        <th key={col.id} scope="col" className="sticky top-0 z-[1] bg-sunken/95">
                          <button type="button" onClick={() => toggle(keys)} aria-pressed={on} className={cn('inline-flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus', on ? 'bg-selected text-primary-text' : 'text-fg')}>
                            {col.color ? <VariantDot color={col.color} /> : null}
                            {col.label}
                            <span className="font-key text-2xs font-normal text-fg-muted">{col.code}</span>
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {matrix.rowAxis.values.map((rowValue) => {
                    const keys = lineKeys(rows, matrix.rowAxis.id, rowValue.id);
                    const on = keys.length > 0 && keys.every((key) => selection.includes(key));
                    return (
                      <tr key={rowValue.id}>
                        <th scope="row" className="sticky left-0 z-[1] bg-sunken/95 align-middle">
                          <button type="button" onClick={() => toggle(keys)} aria-pressed={on} className={cn('inline-flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs font-semibold whitespace-nowrap outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus', on ? 'bg-selected text-primary-text' : 'text-fg')}>
                            {rowValue.label}
                            <span className="font-key text-2xs font-normal text-fg-muted">{rowValue.code}</span>
                          </button>
                        </th>
                        {matrix.colAxis.values.map((col) => {
                          const row = matrix.byCell.get(`${rowValue.id}|${col.id}`);
                          return <td key={col.id}>{row ? <MatrixCell {...cellProps(row)} /> : null}</td>;
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-auto rounded-lg border border-border-subtle" data-testid="variant-table">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-sunken text-left text-2xs font-semibold tracking-wide text-fg-muted uppercase">
                  <tr>
                    <th className="w-10 px-3 py-2">
                      <span className="sr-only">Include</span>
                    </th>
                    <th className="px-2 py-2">Name</th>
                    <th className="px-2 py-2">Key</th>
                    <th className="px-2 py-2">SKU</th>
                    <th className="w-24 px-2 py-2 text-right">Default qty</th>
                    <th className="w-28 px-2 py-2 text-right">Rate</th>
                    {renderKitCell ? <th className="px-2 py-2">Kit</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const props = cellProps(row);
                    const problem = props.locked ? null : (props.conflict ?? props.rateConflict);
                    const off = disabled || props.locked;
                    return (
                      <tr key={row.comboKey} className={cn('border-t border-border-subtle', !row.include && !props.locked && 'opacity-60', props.selected && 'bg-selected', problem && 'bg-danger-subtle/50')} data-testid="variant-table-row">
                        <td className="px-3 py-1.5">
                          <Checkbox checked={props.locked ? true : row.include} disabled={off} onCheckedChange={(checked) => props.onPatch({ include: checked === true })} aria-label={props.locked ? `${row.name} is already a variant` : `Include ${row.name}`} />
                        </td>
                        <td className="px-2 py-1.5">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <button type="button" onClick={props.locked ? undefined : props.onToggleSelect} disabled={props.locked} className="truncate text-left font-medium text-fg outline-none focus-visible:underline" title={problem ?? (props.locked ? `${row.name} is already a variant of this program.` : undefined)}>
                              {row.name}
                            </button>
                            {props.locked ? <AlreadyTag /> : null}
                          </span>
                          {problem ? <span className="block text-2xs text-danger-text">{problem}</span> : null}
                        </td>
                        <td className="px-2 py-1.5 font-key text-xs text-fg-secondary">{row.key}</td>
                        <td className="px-2 py-1.5 font-key text-xs text-fg-secondary">{row.sku ?? <span className="text-fg-muted">No SKU</span>}</td>
                        <td className="px-2 py-1.5">
                          <QtyInput row={row} disabled={off} onPatch={props.onPatch} label={`Default qty for ${row.name}`} />
                        </td>
                        <td className="px-2 py-1.5">
                          <RateInput row={row} rate={props.rate} disabled={off} onPatch={props.onPatch} label={`Rate for ${row.name}`} />
                        </td>
                        {renderKitCell ? <td className="px-2 py-1.5">{renderKitCell(row)}</td> : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {showRules && usedAxes.length ? (
        <section className="flex flex-col gap-2" aria-label="Rates by attribute">
          <h3 className="text-sm font-semibold text-fg">Rates by attribute</h3>
          <RateRulesEditor axes={value.axes} rules={value.rules} onChange={(rules) => onChange({ ...value, rules })} ruleUse={rates.ruleUse} conflicts={[...rates.conflicts.values()]} disabled={disabled} />
        </section>
      ) : null}

      {rows.length ? (
        <p className="border-t border-border-subtle pt-3 text-sm font-medium text-fg" data-testid="generator-summary">
          {lockedExisting && lockedKeys.size ? newVariantsSummary(rows, existing, unit) : generatorSummary(rows, unit)}
          {conflicts.size ? <span className="ml-2 text-xs font-normal text-danger-text">{conflicts.size} to fix</span> : null}
        </p>
      ) : null}
    </div>
  );
}
