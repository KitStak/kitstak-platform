'use client';
/**
 * "Paste a list" (docs/programs/SPEC.md 5.4 Step 2, B.2): paste SKUs or rows copied from a
 * spreadsheet. The engine (`inferAxes`) finds the attributes live; people rename the axes ("Part 1"
 * becomes Size), see the kits it found and the lines it could not read with the reason, then
 * "Use these kits" moves the result into the matrix to refine.
 */
import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, ClipboardPaste, Lightbulb } from 'lucide-react';
import { inferAxes, type InferResult } from '@kitstak/programs-engine';
import { Button, Field, Input, Select, Textarea, cn } from '@/components/ui';
import type { UnitLabel } from '@/lib/program-types';
import { foundText, valueFromInferred, type VariantGeneratorValue } from './variant-model';

export type PasteSeparator = 'auto' | '-' | '_' | '/' | ' ';

const SEPARATORS: readonly { readonly value: PasteSeparator; readonly label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: '-', label: 'Dash' },
  { value: '_', label: 'Underscore' },
  { value: '/', label: 'Slash' },
  { value: ' ', label: 'Space' },
];

/** Reads pasted text with the chosen separator ("Auto" lets the engine decide). */
export function readPasted(text: string, separator: PasteSeparator): InferResult {
  return inferAxes({ text, separator: separator === 'auto' ? undefined : separator });
}

/** Renames an axis in a result (and in every row), so "Part 1" can become "Size". */
export function renameAxis(result: InferResult, from: string, to: string): InferResult {
  if (!to.trim() || from === to) return result;
  return {
    ...result,
    axes: result.axes.map((axis) => (axis.name === from ? { ...axis, name: to } : axis)),
    rows: result.rows.map((row) => {
      if (!(from in row.attributes)) return row;
      const { [from]: label, ...rest } = row.attributes;
      return { ...row, attributes: { ...rest, [to]: label as string } };
    }),
  };
}

export interface PasteListProps {
  readonly unit: UnitLabel;
  /** Called with the generator value built from the pasted list. */
  readonly onUse: (value: VariantGeneratorValue) => void;
  readonly previous?: VariantGeneratorValue;
  readonly initialText?: string;
  readonly disabled?: boolean;
}

export function PasteList({ unit, onUse, previous, initialText = '', disabled }: PasteListProps) {
  const [text, setText] = useState(initialText);
  const [separator, setSeparator] = useState<PasteSeparator>('auto');
  const [names, setNames] = useState<Readonly<Record<string, string>>>({});
  const raw = useMemo(() => readPasted(text, separator), [text, separator]);
  const result = useMemo(() => Object.entries(names).reduce((acc, [from, to]) => renameAxis(acc, from, to), raw), [raw, names]);
  const partNames = raw.mode === 'sku' && raw.axes.some((axis) => /^Part \d+$/.test(axis.name)) && Object.keys(names).length === 0;
  const hasResult = result.rows.length > 0;

  return (
    <div className="flex flex-col gap-4" data-testid="paste-list">
      <div className="grid gap-3 md:grid-cols-[1fr_180px]">
        <Field label="Paste SKUs or a sheet" hint="One SKU per line, or rows copied from a spreadsheet with a header row.">
          {(ids) => (
            <Textarea
              id={ids.inputId}
              aria-describedby={ids.describedBy}
              value={text}
              disabled={disabled}
              onChange={(event) => setText(event.target.value)}
              rows={8}
              spellCheck={false}
              className="font-key text-xs"
              data-testid="paste-text"
            />
          )}
        </Field>
        <Field label="Separator" hint="How the parts of a SKU are split.">
          {(ids) => <Select id={ids.inputId} value={separator} onValueChange={(next) => setSeparator(next as PasteSeparator)} options={SEPARATORS.map((option) => ({ value: option.value, label: option.label }))} disabled={disabled || raw.mode === 'columns'} />}
        </Field>
      </div>

      {!text.trim() ? (
        <p className="flex items-center gap-2 rounded-lg border border-dashed border-border-default bg-sunken/60 px-4 py-4 text-sm text-fg-secondary">
          <ClipboardPaste aria-hidden className="size-4 shrink-0 text-icon" />
          Paste a list like GLOVE-S-BRN on each line, or copy rows with a header like Size, Color, Qty.
        </p>
      ) : (
        <section className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-panel p-3" aria-label="What we found">
          <p className={cn('text-sm font-semibold', hasResult ? 'text-fg' : 'text-fg-muted')} data-testid="paste-found">
            {hasResult ? foundText(result, unit) : 'No kits found yet'}
          </p>
          {partNames ? (
            <p className="flex items-center gap-2 rounded-md bg-info-subtle px-3 py-2 text-xs text-info-text">
              <Lightbulb aria-hidden className="size-3.5 shrink-0" />
              Name these, for example Size and Color.
            </p>
          ) : null}
          {result.axes.length ? (
            <ul className="flex flex-col gap-2">
              {raw.axes.map((axis, index) => {
                const shown = result.axes[index] ?? axis;
                return (
                  <li key={`${axis.name}-${index}`} className="grid gap-2 sm:grid-cols-[160px_1fr] sm:items-start">
                    <Input aria-label={`Name of attribute ${index + 1}`} value={names[axis.name] ?? axis.name} disabled={disabled} onChange={(event) => setNames({ ...names, [axis.name]: event.target.value })} className="font-medium" />
                    <div className="flex flex-wrap gap-1.5">
                      {shown.values.map((value) => (
                        <span key={value.code} className="inline-flex h-6 items-center gap-1.5 rounded-full border border-border-subtle bg-sunken px-2 text-xs font-medium text-fg">
                          {value.label}
                          <span className="font-key text-2xs text-fg-muted">{value.code}</span>
                        </span>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {result.notes.length ? (
            <ul className="flex flex-col gap-1 text-xs text-fg-secondary">
              {result.notes.map((note) => (
                <li key={`${note.line}-${note.text}`}>
                  Line {note.line}: {note.text}
                </li>
              ))}
            </ul>
          ) : null}
          {result.unmatched.length ? (
            <div className="rounded-md border border-warning/40 bg-warning-subtle/60 px-3 py-2" data-testid="paste-unmatched">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-warning-text">
                <AlertTriangle aria-hidden className="size-3.5" />
                Could not read {result.unmatched.length} {result.unmatched.length === 1 ? 'line' : 'lines'}
              </p>
              <ul className="flex max-h-32 flex-col gap-0.5 overflow-auto text-xs text-fg-secondary">
                {result.unmatched.map((line) => (
                  <li key={line.line}>
                    <span className="font-medium text-fg">Line {line.line}</span> <span className="font-key">{line.raw}</span>: {line.why}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex justify-end">
            <Button trailingIcon={<ArrowRight aria-hidden />} disabled={disabled || !hasResult} onClick={() => onUse(valueFromInferred(result, previous))} data-testid="paste-use">
              Use these {unit.plural}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
