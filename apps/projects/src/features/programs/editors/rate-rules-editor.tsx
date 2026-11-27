'use client';
/**
 * Rate rules ("Rates by attribute", docs/programs/SPEC.md 5.4 Step 2, 5.12): rows of
 * "{Attribute} is {value}" then "Add $" or "Set $" and an amount. Shared by the variant generator
 * (wizard and Edit attributes) and the price card editor. Conflicts and how many variants each rule
 * prices come from the engine through `rowRates`.
 */
import { Plus, Trash2 } from 'lucide-react';
import { Button, IconButton, Select, cn } from '@/components/ui';
import { formatUnitPrice } from '@kitstak/programs-engine';
import { localId, rateCellProblem, ruleText, type EditorAxis, type EditorRule } from './variant-model';

export interface RateRulesEditorProps {
  readonly axes: readonly EditorAxis[];
  readonly rules: readonly EditorRule[];
  readonly onChange: (rules: EditorRule[]) => void;
  /** Rule id to how many variants it prices now. */
  readonly ruleUse?: ReadonlyMap<string, number>;
  /** Messages from compiling the rules ("Two rules set a price for XL Yellow."), deduped. */
  readonly conflicts?: readonly string[];
  readonly disabled?: boolean;
  readonly className?: string;
}

export function RateRulesEditor({ axes, rules, onChange, ruleUse, conflicts = [], disabled, className }: RateRulesEditorProps) {
  const usable = axes.filter((axis) => axis.values.length > 0);
  const update = (id: string, patch: Partial<EditorRule>) => onChange(rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
  const add = () => {
    const axis = usable[usable.length - 1] ?? usable[0];
    const value = axis?.values[axis.values.length - 1];
    if (!axis || !value) return;
    onChange([...rules, { id: localId('r'), attributeId: axis.id, valueId: value.id, op: 'add', amount: '' }]);
  };
  return (
    <section className={cn('flex flex-col gap-2', className)} aria-label="Rates by attribute" data-testid="rate-rules-editor">
      {rules.length === 0 ? <p className="text-xs text-fg-muted">Add a rule to price every variant with one value the same way, like adding $0.25 to every XL.</p> : null}
      <ul className="flex flex-col gap-1.5">
        {rules.map((rule) => {
          const axis = usable.find((entry) => entry.id === rule.attributeId) ?? usable[0];
          const problem = rateCellProblem(rule.op === 'add' ? rule.amount.replace(/^-/, '') : rule.amount);
          const uses = ruleUse?.get(rule.id) ?? 0;
          return (
            <li key={rule.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle bg-panel px-2.5 py-2" data-testid="rate-rule">
              <Select
                aria-label="Attribute"
                size="sm"
                value={rule.attributeId}
                disabled={disabled}
                onValueChange={(attributeId) => {
                  const next = usable.find((entry) => entry.id === attributeId);
                  update(rule.id, { attributeId, valueId: next?.values[0]?.id ?? '' });
                }}
                options={usable.map((entry) => ({ value: entry.id, label: entry.name || 'Attribute' }))}
                className="w-32"
              />
              <span className="text-sm text-fg-secondary">is</span>
              <Select aria-label="Value" size="sm" value={rule.valueId} disabled={disabled} onValueChange={(valueId) => update(rule.id, { valueId })} options={(axis?.values ?? []).map((value) => ({ value: value.id, label: value.label }))} className="w-36" />
              <Select
                aria-label="Add or set"
                size="sm"
                value={rule.op}
                disabled={disabled}
                onValueChange={(op) => update(rule.id, { op: op as EditorRule['op'] })}
                options={[
                  { value: 'add', label: 'Add $', description: 'To the card rate' },
                  { value: 'set', label: 'Set $', description: 'Replaces the card rate' },
                ]}
                className="w-24"
              />
              <span className="relative">
                <span aria-hidden className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-xs text-fg-muted">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={rule.op === 'add' ? 'Amount to add' : 'Rate to set'}
                  aria-invalid={problem ? true : undefined}
                  title={problem ?? undefined}
                  value={rule.amount}
                  disabled={disabled}
                  onChange={(event) => update(rule.id, { amount: event.target.value.replace(/^\$/, '') })}
                  className={cn(
                    'h-7 w-24 rounded-md border bg-panel pr-2 pl-5 text-right text-sm tabular-nums outline-none focus:border-primary focus:shadow-[0_0_0_3px_var(--focus-ring-soft)]',
                    problem ? 'border-danger' : 'border-border-input hover:border-border-input-hover',
                  )}
                />
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-fg-muted" title={ruleText(rule, axes)}>
                {rule.amount.trim() && !problem ? `${uses} ${uses === 1 ? 'variant' : 'variants'}` : problem ?? 'Type an amount'}
              </span>
              <IconButton label="Remove rule" size="sm" icon={<Trash2 aria-hidden />} disabled={disabled} onClick={() => onChange(rules.filter((entry) => entry.id !== rule.id))} />
            </li>
          );
        })}
      </ul>
      {conflicts.length ? (
        <ul className="flex flex-col gap-1 rounded-md bg-danger-subtle px-3 py-2 text-xs text-danger-text" role="alert">
          {[...new Set(conflicts)].slice(0, 5).map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}
      <Button variant="ghost" size="sm" leadingIcon={<Plus aria-hidden />} onClick={add} disabled={disabled || usable.length === 0} className="w-fit" data-testid="rate-rule-add">
        Add a rule
      </Button>
    </section>
  );
}

/** A compact rate for a cell: "$2.20 · rule", "$1.95 card", "typed". */
export function rateHint(price: string | null, source: 'typed' | 'rule' | 'card' | 'none'): string {
  if (source === 'none' || !price) return 'No price';
  if (source === 'card') return `${formatUnitPrice(price)} card`;
  if (source === 'rule') return `${formatUnitPrice(price)} · rule`;
  return 'typed';
}
