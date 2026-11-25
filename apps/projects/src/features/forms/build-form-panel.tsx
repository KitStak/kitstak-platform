'use client';
/**
 * Form builder settings for a build form (docs/programs/SPEC.md 5.17): "Creates a build in
 * {program}" with the question that names the kit, the qty question and the date question.
 */
import { Factory, RefreshCw } from 'lucide-react';
import { Button, Select } from '@/components/ui';
import { Panel } from '@/components/layout/page';
import type { FormField } from '@/lib/form-types';
import { useVariants } from '@/lib/hooks/use-programs';
import { mappingChoices, mappingProblem, syncVariantOptions, type BuildMapping } from './build-form';

export interface BuildFormPanelProps {
  readonly program: { readonly key: string; readonly name: string };
  readonly fields: readonly FormField[];
  readonly mapping: BuildMapping | undefined;
  readonly onMapping: (mapping: BuildMapping) => void;
  readonly onField: (id: string, field: FormField) => void;
}

export function BuildFormPanel({ program, fields, mapping, onMapping, onField }: BuildFormPanelProps) {
  const variants = useVariants(program.key);
  const choices = mappingChoices(fields);
  const problem = mappingProblem(fields, mapping);
  const variantField = fields.find((field) => field.id === mapping?.variantFieldId);
  const label = (field: FormField, index: number) => field.label.trim() || `Question ${index + 1}`;
  return (
    <Panel title={`Creates a build in ${program.name}`}>
      <div className="flex flex-col gap-4" data-testid="build-form-panel">
        <p className="flex items-start gap-2 text-sm text-fg-secondary">
          <Factory aria-hidden className="mt-0.5 size-4 shrink-0 text-icon" />
          Each response makes one build, planned from the form, on the day it asks for or the next work day.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-secondary">Kit question</span>
            <Select aria-label="Kit question" value={mapping?.variantFieldId} placeholder="Pick a question" onValueChange={(variantFieldId) => onMapping({ ...mapping, variantFieldId })} options={choices.variant.map((field) => ({ value: field.id, label: label(field, fields.indexOf(field)), description: field.type === 'select' ? 'A list of kits' : 'A typed SKU' }))} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-secondary">How many question</span>
            <Select aria-label="How many question" value={mapping?.qtyFieldId} placeholder="Pick a question" onValueChange={(qtyFieldId) => onMapping({ ...mapping, qtyFieldId })} options={choices.qty.map((field) => ({ value: field.id, label: label(field, fields.indexOf(field)) }))} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-secondary">Day question</span>
            <Select aria-label="Day question" value={mapping?.dateFieldId ?? 'none'} onValueChange={(dateFieldId) => onMapping({ ...mapping, dateFieldId: dateFieldId === 'none' ? undefined : dateFieldId })} options={[{ value: 'none', label: 'The next work day' }, ...choices.date.map((field) => ({ value: field.id, label: label(field, fields.indexOf(field)) }))]} />
          </label>
        </div>
        {problem ? <p role="alert" className="text-sm font-medium text-warning-text">{problem}</p> : null}
        {variantField?.type === 'select' ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-subtle bg-sunken/60 px-3 py-2">
            <span className="text-sm text-fg-secondary">
              {variantField.options?.length ?? 0} kits in the list{variants.data ? ` · the program has ${variants.data.length} active` : ''}
            </span>
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<RefreshCw aria-hidden />}
              disabled={!variants.data}
              onClick={() => variants.data && onField(variantField.id, syncVariantOptions(variantField, variants.data.map((variant) => ({ id: variant.id, name: variant.name, sku: variant.sku }))))}
            >
              Match the program&apos;s kits
            </Button>
          </div>
        ) : variantField ? (
          <p className="text-xs text-fg-muted">Typed SKUs are matched to the program&apos;s kits by SKU, key or name.</p>
        ) : null}
      </div>
    </Panel>
  );
}
