'use client';
import { useMemo } from 'react';
import { ArrowRight, Check, CircleSlash, Layers, Pencil, Plus, Type } from 'lucide-react';
import {
  Badge,
  Combobox,
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  cn,
} from '@/components/ui';
import { ColumnTypeIcon } from '@/features/cells';
import type { ColumnType } from '@/server/db/schema/cell-values';
import { COLUMN_TYPE_REGISTRY } from '@/server/db/schema/column-types';
import { dateOrderLabel } from '../lib/parse-values';
import { isMappableColumn, suggestedNewType, typeCompatibility } from '../lib/mapping';
import { CREATABLE_TYPES, type ColumnMapping, type CreatableType, type MappingTarget } from '../lib/types';
import type { ImportModel } from '../use-import-model';
import { ImportPreview } from './import-preview';

const INFERRED_LABEL: Record<string, string> = {
  text: 'Text',
  long_text: 'Long text',
  email: 'Email',
  phone: 'Phone',
  link: 'Link',
  number: 'Number',
  currency: 'Currency',
  date: 'Date',
  checkbox: 'Yes/No',
  status: 'Labels',
  people: 'People',
  tags: 'Tags',
  country: 'Country',
};

/** Values in a column that don't parse as its detected type (they'd be dropped). */
export function misfitCount(nonEmpty: number, confidence: number): number {
  return Math.max(0, nonEmpty - Math.round(nonEmpty * confidence));
}

function targetValue(target: MappingTarget): string {
  if (target.kind === 'existing') return `col:${target.columnKey}`;
  return target.kind;
}

export interface StepMapProps {
  readonly model: ImportModel;
  readonly showErrors: boolean;
  readonly onChange: (mappings: ColumnMapping[]) => void;
}

export function StepMap({ model, showErrors, onChange }: StepMapProps) {
  const { profiles, draft, targetColumns, plan, built, terminology } = model;
  const mappings = draft.mappings;
  const issuesBySource = useMemo(() => {
    const counts = new Map<number, number>();
    for (const issue of built.issues) counts.set(issue.sourceIndex, (counts.get(issue.sourceIndex) ?? 0) + 1);
    return counts;
  }, [built.issues]);
  const problems = useMemo(() => {
    const map = new Map<number | null, string>();
    for (const problem of model.mappingProblems)
      if (!map.has(problem.sourceIndex)) map.set(problem.sourceIndex, problem.message);
    return map;
  }, [model.mappingProblems]);
  const usedKeys = new Set(
    mappings
      .filter((mapping) => mapping.target.kind === 'existing')
      .map((mapping) => (mapping.target as { columnKey: string }).columnKey),
  );
  const nameMapping = mappings.find((mapping) => mapping.target.kind === 'name');
  const mappedCount = mappings.filter((mapping) => mapping.target.kind !== 'skip').length;

  const setTarget = (sourceIndex: number, target: MappingTarget) =>
    onChange(
      mappings.map((mapping) => {
        if (mapping.sourceIndex === sourceIndex) return { ...mapping, target, auto: false, confidence: 0 };
        // Only one name column: demote the previous one to a new text column.
        if (target.kind === 'name' && mapping.target.kind === 'name') {
          return {
            ...mapping,
            target: { kind: 'new', type: 'text', title: model.headers[mapping.sourceIndex] ?? 'Text' },
            auto: false,
          };
        }
        return mapping;
      }),
    );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-balance text-fg outline-none">
            Map your columns
          </h2>
          <p className="mt-1 text-base text-fg-secondary">
            {mappedCount} of {mappings.length} columns will be imported.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm text-fg-secondary">
          <span className="inline-flex items-center gap-1.5">
            <Check aria-hidden className="size-4 text-success-text" /> Matched
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-full bg-warning-accent" /> New column
          </span>
        </div>
      </div>
      {showErrors && problems.get(null) ? (
        <p
          role="alert"
          className="rounded-md border border-danger bg-danger-subtle px-3 py-2 text-sm text-danger-text"
        >
          {problems.get(null)}
        </p>
      ) : null}

      <div
        className="overflow-hidden rounded-lg border border-border-subtle bg-panel"
        data-testid="import-mapping"
      >
        <div className="hidden grid-cols-[minmax(0,1fr)_24px_minmax(0,1.15fr)] gap-3 border-b border-border-subtle bg-sunken px-4 py-2 text-xs font-semibold text-fg-muted md:grid">
          <span>Column in file</span>
          <span />
          <span>Column on board</span>
        </div>
        <ul className="divide-y divide-border-subtle">
          {mappings.map((mapping) => {
            const profile = profiles[mapping.sourceIndex];
            if (!profile) return null;
            const target = mapping.target;
            const matched = target.kind === 'name' || target.kind === 'existing' || target.kind === 'group';
            const problem = problems.get(mapping.sourceIndex);
            const issueCount = issuesBySource.get(mapping.sourceIndex) ?? 0;
            const options = [
              {
                value: 'name',
                label: `${terminology} name`,
                description: 'Required · the title of each row',
                icon: <Type aria-hidden />,
              },
              ...targetColumns.filter(isMappableColumn).map((column) => {
                const compat = typeCompatibility(profile.inferred, column.type);
                return {
                  value: `col:${column.key}`,
                  label: column.title,
                  description: `${COLUMN_TYPE_REGISTRY[column.type].label}${compat < 0.5 ? ' · values may not fit' : ''}${usedKeys.has(column.key) && !(target.kind === 'existing' && target.columnKey === column.key) ? ' · already mapped' : ''}`,
                  keywords: [COLUMN_TYPE_REGISTRY[column.type].label],
                };
              }),
              target.kind === 'new'
                ? {
                    value: 'new',
                    label: `New column: ${target.title || profile.header}`,
                    description: `${COLUMN_TYPE_REGISTRY[target.type].label} · rename or change the type with the pencil`,
                    icon: <ColumnTypeIcon type={target.type} />,
                  }
                : {
                    value: 'new',
                    label: 'New column',
                    description: 'Create a column from this data',
                    icon: <Plus aria-hidden />,
                  },
              {
                value: 'group',
                label: 'Group',
                description: 'Put each row in the group with this name',
                icon: <Layers aria-hidden />,
              },
              {
                value: 'skip',
                label: "Don't import",
                description: 'Leave this column out',
                icon: <CircleSlash aria-hidden />,
              },
            ];
            return (
              <li
                key={mapping.sourceIndex}
                data-testid="import-mapping-row"
                data-source-header={profile.header}
                className={cn(
                  'grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_24px_minmax(0,1.15fr)] md:items-start',
                  target.kind === 'skip' && 'bg-sunken/50',
                )}
              >
                <div className="flex min-w-0 items-start gap-2.5">
                  <span
                    className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center"
                    aria-hidden
                  >
                    {target.kind === 'skip' ? (
                      <span className="size-2 rounded-full bg-border-strong" />
                    ) : matched ? (
                      <Check className="size-4 text-success-text" strokeWidth={2.5} />
                    ) : (
                      <span className="size-2 rounded-full bg-warning-accent" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p
                      className={cn(
                        'truncate text-base font-semibold',
                        target.kind === 'skip' ? 'text-fg-secondary' : 'text-fg',
                      )}
                      title={profile.header}
                    >
                      {profile.header}
                    </p>
                    <p className="truncate text-sm text-fg-muted" title={profile.samples.join(' · ')}>
                      {profile.samples.length ? profile.samples.join(' · ') : 'Empty column'}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge size="sm" tone="neutral" className="gap-1 text-xs">
                        <ColumnTypeIcon type={profile.inferred as ColumnType} size="sm" />
                        {INFERRED_LABEL[profile.inferred] ?? 'Text'}
                      </Badge>
                      {misfitCount(profile.nonEmpty, profile.confidence) > 0 && target.kind !== 'skip' ? (
                        <Badge size="sm" tone="warning" className="text-xs">
                          {misfitCount(profile.nonEmpty, profile.confidence)}{' '}
                          {misfitCount(profile.nonEmpty, profile.confidence) === 1
                            ? "value won't fit"
                            : "values won't fit"}
                        </Badge>
                      ) : null}
                      {profile.inferred === 'date' ? (
                        <Badge size="sm" tone="info">
                          {dateOrderLabel(profile.dateOrder)}
                        </Badge>
                      ) : null}
                      {profile.inferred === 'status' ? (
                        <Badge size="sm" tone="neutral">
                          {profile.distinctCount} labels
                        </Badge>
                      ) : null}
                      {issueCount && target.kind !== 'skip' ? (
                        <Badge size="sm" tone="warning">
                          {issueCount} {issueCount === 1 ? 'problem' : 'problems'}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                </div>
                <ArrowRight aria-hidden className="mt-2 hidden size-4 text-icon md:block" />
                <div className="flex min-w-0 flex-col gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <div className="min-w-0 flex-1">
                      <Combobox
                        value={targetValue(target)}
                        aria-label={`Board column for ${profile.header}`}
                        invalid={showErrors && Boolean(problem)}
                        onValueChange={(value) => {
                          if (!value) return;
                          if (value === 'name') setTarget(mapping.sourceIndex, { kind: 'name' });
                          else if (value === 'skip') setTarget(mapping.sourceIndex, { kind: 'skip' });
                          else if (value === 'group') setTarget(mapping.sourceIndex, { kind: 'group' });
                          else if (value === 'new')
                            setTarget(mapping.sourceIndex, {
                              kind: 'new',
                              type: suggestedNewType(profile),
                              title: profile.header,
                            });
                          else
                            setTarget(mapping.sourceIndex, { kind: 'existing', columnKey: value.slice(4) });
                        }}
                        options={options}
                        searchPlaceholder="Search columns"
                        emptyMessage="No columns match"
                      />
                    </div>
                    {target.kind === 'new' ? (
                      <Popover>
                        <PopoverTrigger asChild>
                          <IconButton
                            label={`Edit new column for ${profile.header}`}
                            icon={<Pencil aria-hidden />}
                            size="sm"
                            variant="ghost"
                            data-testid="import-new-column-edit"
                            className={cn(showErrors && problem && 'text-danger-text')}
                          />
                        </PopoverTrigger>
                        <PopoverContent align="end" className="flex w-72 flex-col gap-3 p-3">
                          <label className="flex flex-col gap-1 text-sm font-semibold text-fg">
                            Column name
                            <Input
                              size="sm"
                              aria-label={`New column name for ${profile.header}`}
                              value={target.title}
                              maxLength={255}
                              invalid={showErrors && Boolean(problem)}
                              onChange={(event) =>
                                setTarget(mapping.sourceIndex, { ...target, title: event.target.value })
                              }
                            />
                          </label>
                          <div className="flex flex-col gap-1 text-sm font-semibold text-fg">
                            Column type
                            <Combobox
                              aria-label={`Column type for ${profile.header}`}
                              value={target.type}
                              onValueChange={(value) =>
                                value &&
                                setTarget(mapping.sourceIndex, { ...target, type: value as CreatableType })
                              }
                              options={CREATABLE_TYPES.filter(
                                (type) => type !== 'people' || model.members.length > 0,
                              ).map((type) => ({
                                value: type,
                                label: COLUMN_TYPE_REGISTRY[type].label,
                                icon: <ColumnTypeIcon type={type} />,
                              }))}
                              searchPlaceholder="Search types"
                              emptyMessage="No types match"
                            />
                          </div>
                        </PopoverContent>
                      </Popover>
                    ) : null}
                  </div>
                  {showErrors && problem ? (
                    <p role="alert" className="text-sm text-danger-text">
                      {problem}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <section aria-labelledby="import-preview-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="import-preview-title" className="text-md font-semibold text-fg">
            Preview
          </h3>
          <p className="text-sm text-fg-secondary">
            First {Math.min(5, built.rows.length)} rows, exactly as they&apos;ll appear on the board
            {plan.columns.some((entry) => entry.addedLabels > 0) ? (
              <Tooltip content="New labels get colors automatically. You can recolor them on the board.">
                <span className="ml-1 cursor-help underline decoration-dotted underline-offset-2">
                  · {plan.columns.reduce((sum, entry) => sum + entry.addedLabels, 0)} new labels
                </span>
              </Tooltip>
            ) : null}
          </p>
        </div>
        <ImportPreview
          plan={plan}
          rows={built.rows}
          terminology={terminology}
          nameTitle={nameMapping ? (model.headers[nameMapping.sourceIndex] ?? terminology) : terminology}
          users={model.users}
        />
      </section>
    </div>
  );
}
