'use client';
import { useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Download, Rows3, SkipForward } from 'lucide-react';
import { Badge, Button, Checkbox, CountBadge, Combobox, Input, Skeleton, Switch, Tooltip, cn } from '@/components/ui';
import { errorMessage } from '@/lib/hooks';
import { buildErrorReport, baseFileName, downloadBlob } from '../lib/error-report';
import { overrideKey } from '../lib/plan';
import type { DedupeMode, RowIssue } from '../lib/types';
import type { ImportDraft } from '../store';
import { pluralize, type ImportModel } from '../use-import-model';

const MAX_LISTED = 100;

export interface StepReviewProps {
  readonly model: ImportModel;
  readonly onDraft: (patch: Partial<ImportDraft>) => void;
}

/** `blocking`: the row is always skipped (no name). `warning`: the value is dropped, the row imports. */
export type IssueSeverity = 'blocking' | 'warning';

export function issueSeverity(issue: RowIssue, nameIndex: number | null): IssueSeverity {
  return issue.sourceIndex === nameIndex ? 'blocking' : 'warning';
}

interface StatTileProps {
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: number;
  readonly tone: 'neutral' | 'success' | 'warning' | 'muted';
  readonly testId: string;
  readonly note?: ReactNode;
}

function StatTile({ icon, label, value, tone, testId, note }: StatTileProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-panel p-4 shadow-xs" data-testid={testId}>
      <span
        aria-hidden
        className={cn(
          'hidden size-9 shrink-0 items-center justify-center rounded-md sm:inline-flex [&_svg]:size-[18px]',
          tone === 'success' && 'bg-success-subtle text-success-text',
          tone === 'warning' && 'bg-warning-subtle text-warning-text',
          tone === 'neutral' && 'bg-muted text-icon',
          tone === 'muted' && 'bg-muted text-fg-secondary',
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-xl font-semibold leading-tight text-fg tabular-nums">{value.toLocaleString('en-US')}</p>
        <p className="truncate text-sm text-fg-secondary">{label}</p>
        {note}
      </div>
    </div>
  );
}

function FixInput({ issue, value, severity, onCommit }: { issue: RowIssue; value: string; severity: IssueSeverity; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  return (
    <Input
      size="sm"
      aria-label={`Fix ${issue.column} on row ${issue.row}`}
      value={draft}
      placeholder={severity === 'blocking' ? 'Type a name to import this row' : undefined}
      containerClassName={cn(severity === 'warning' && 'border-warning-accent')}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onCommit(draft);
        if (event.key === 'Escape') setDraft(value);
      }}
    />
  );
}

interface ProblemProps {
  readonly issue: RowIssue;
  readonly severity: IssueSeverity;
  readonly value: string;
  readonly skipped: boolean;
  /** Skipped no matter what (no name, or "Skip rows with problems" is on). */
  readonly forced: boolean;
  readonly onFix: (value: string) => void;
  readonly onSkip: (skip: boolean) => void;
}

function SkipControl({ issue, skipped, forced, onSkip }: Pick<ProblemProps, 'issue' | 'skipped' | 'forced' | 'onSkip'>) {
  const box = (
    <Checkbox
      aria-label={`Skip row ${issue.row}`}
      checked={skipped || forced}
      disabled={forced}
      onCheckedChange={(checked) => onSkip(checked === true)}
    />
  );
  return forced ? (
    <Tooltip content="This row is always skipped. Add a name to import it.">
      <span className="inline-flex">{box}</span>
    </Tooltip>
  ) : (
    box
  );
}

function ProblemMessage({ severity, forced, message }: { severity: IssueSeverity; forced: boolean; message: string }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {forced ? (
        <Badge tone="neutral">
          Skipped
        </Badge>
      ) : null}
      <span className={cn(severity === 'blocking' ? 'text-fg-secondary' : 'text-warning-text')}>{message}</span>
    </span>
  );
}

function ProblemCard(props: ProblemProps) {
  const { issue, severity, forced } = props;
  return (
    <li className={cn('flex flex-col gap-2 px-3 py-3', forced && 'bg-sunken/60')} data-testid="import-issue-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-fg">{issue.column}</p>
          <p className="text-xs text-fg-muted tabular-nums">Row {issue.row}</p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm text-fg-secondary">
          Skip
          <SkipControl {...props} />
        </label>
      </div>
      <p className="text-sm">
        <ProblemMessage severity={severity} forced={forced} message={issue.message} />
      </p>
      <FixInput issue={issue} severity={severity} value={props.value} onCommit={props.onFix} />
    </li>
  );
}

function ProblemRow(props: ProblemProps) {
  const { issue, severity, forced } = props;
  return (
    <tr className={cn('align-middle hover:bg-hover', forced && 'bg-sunken/60')}>
      <td className="px-3 py-1.5 tabular-nums text-fg-secondary">{issue.row}</td>
      <td className="max-w-[180px] truncate px-3 py-1.5 font-semibold text-fg">{issue.column}</td>
      <td className="px-3 py-1.5">
        <FixInput issue={issue} severity={severity} value={props.value} onCommit={props.onFix} />
      </td>
      <td className="px-3 py-1.5 text-sm">
        <ProblemMessage severity={severity} forced={forced} message={issue.message} />
      </td>
      <td className="px-3 py-1.5 text-center">
        <SkipControl {...props} />
      </td>
    </tr>
  );
}

const CARD_PAGE = 20;

export function StepReview({ model, onDraft }: StepReviewProps) {
  const { draft, built, terminology, match, dedupe } = model;
  const [cardLimit, setCardLimit] = useState(CARD_PAGE);
  const existing = draft.destination.type === 'existing';
  const keyOptions = [
    { value: 'name', label: `${terminology} name` },
    ...model.keyColumns.map((column) => ({ value: column.key, label: column.title })),
  ];

  const excluded = new Set(draft.excludedRows);
  const toggleRow = (row: number, skip: boolean) =>
    onDraft({ excludedRows: skip ? [...draft.excludedRows, row] : draft.excludedRows.filter((entry) => entry !== row) });
  const setOverride = (issue: RowIssue, value: string) =>
    onDraft({ overrides: { ...draft.overrides, [overrideKey(issue.row, issue.sourceIndex)]: value } });

  const listed = built.issues.slice(0, MAX_LISTED);
  const newColumns = model.plan.columns.filter((entry) => entry.isNew).length;
  const newLabels = model.plan.columns.reduce((sum, entry) => sum + entry.addedLabels, 0);
  const blockingRows = new Set(built.issues.filter((issue) => issueSeverity(issue, model.plan.nameIndex) === 'blocking').map((issue) => issue.row));
  const term = (count: number) => pluralize(terminology, count);
  const importedRows = new Set(built.rows.map((row) => row.row));
  const droppedValues = built.issues.filter((issue) => importedRows.has(issue.row)).length;
  const problemProps = (issue: RowIssue): ProblemProps => {
    const key = overrideKey(issue.row, issue.sourceIndex);
    return {
      issue,
      severity: issueSeverity(issue, model.plan.nameIndex),
      value: draft.overrides[key] ?? issue.raw,
      skipped: excluded.has(issue.row),
      forced: blockingRows.has(issue.row) || draft.skipRowsWithIssues,
      onFix: (value) => setOverride(issue, value),
      onSkip: (skip) => toggleRow(issue.row, skip),
    };
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold text-balance text-fg outline-none">Review before importing</h2>
        <p className="mt-1 text-base text-fg-secondary">
          {existing
            ? 'Fix problems inline, choose how to handle duplicates, then import.'
            : built.issues.length
              ? 'Fix problems inline, then import.'
              : 'Everything fits. Check the summary, then import.'}
        </p>
      </div>
      {/* Ready + skipped = rows in file; dropped values are a note on Ready, not a separate bucket. */}
      <div className="grid grid-cols-3 gap-3">
        <StatTile testId="import-stat-rows" icon={<Rows3 />} label="Rows in file" value={built.rows.length + built.skippedRows.length} tone="neutral" />
        <StatTile
          testId="import-stat-ready"
          icon={<CheckCircle2 />}
          label="Ready to import"
          value={built.rows.length}
          tone="success"
          note={
            droppedValues ? (
              <p className="mt-1 inline-flex items-center gap-1 text-xs text-warning-text" data-testid="import-stat-dropped">
                <AlertTriangle aria-hidden className="size-3" />
                {droppedValues} {droppedValues === 1 ? 'value' : 'values'} will be left empty
              </p>
            ) : null
          }
        />
        <StatTile testId="import-stat-skipped" icon={<SkipForward />} label="Will be skipped" value={built.skippedRows.length} tone="muted" />
      </div>

      <section className="rounded-lg border border-border-subtle bg-panel p-4" aria-labelledby="import-summary-title">
        <h3 id="import-summary-title" className="text-base font-semibold text-fg">
          Summary
        </h3>
        <ul className="mt-2 flex flex-col gap-1 text-sm text-fg-secondary" aria-live="polite">
          <li>
            Destination:{' '}
            <span className="font-semibold text-fg">
              {model.destination.type === 'new' ? `New board “${model.destination.name.trim()}”` : (model.boardName ?? 'Board')}
            </span>
          </li>
          <li data-testid="import-outcome">
            {match.pending ? (
              <span className="inline-flex items-center gap-2">
                Checking for duplicates <Skeleton height={12} width={120} />
              </span>
            ) : match.enabled ? (
              <>
                <span className="font-semibold text-fg tabular-nums">{match.create.toLocaleString('en-US')}</span> will be created
                {dedupe.mode === 'update' ? (
                  <>
                    {' · '}
                    <span className="font-semibold text-fg tabular-nums">{match.matched.toLocaleString('en-US')}</span> will update existing {term(match.matched)}
                  </>
                ) : match.matched ? (
                  ` · ${match.matched.toLocaleString('en-US')} already on the board will be skipped`
                ) : null}
                {match.repeats ? ` · ${match.repeats.toLocaleString('en-US')} repeated in the file` : ''}
              </>
            ) : (
              <>
                <span className="font-semibold text-fg tabular-nums">{built.rows.length.toLocaleString('en-US')}</span> {term(built.rows.length)} will be created
              </>
            )}
          </li>
          <li>
            {newColumns ? `${newColumns} new ${newColumns === 1 ? 'column' : 'columns'}` : 'No new columns'}
            {newLabels ? ` · ${newLabels} new ${newLabels === 1 ? 'label' : 'labels'}` : ''}
            {model.plan.groupIndex !== null ? ' · rows go into groups by name' : ''}
          </li>
          {model.truncated ? <li className="text-warning-text">Rows beyond 10,000 are not imported.</li> : null}
        </ul>
      </section>

      {existing ? (
        <section className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-panel p-4" aria-labelledby="import-dedupe-title">
          <div>
            <h3 id="import-dedupe-title" className="text-base font-semibold text-fg">
              Duplicates
            </h3>
            <p className="text-sm text-fg-secondary">Match rows to {term(2)} already on the board.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
            <div role="radiogroup" aria-label="When a row matches" className="flex flex-col gap-2">
              {(
                [
                  ['create', 'Always create new', `Every row becomes a new ${terminology.toLowerCase()}`],
                  ['skip', 'Skip duplicates', 'Leave existing items untouched'],
                  ['update', 'Update existing', 'Fill matched items with the file’s non-empty values'],
                ] as const
              ).map(([mode, title, body]) => {
                const selected = draft.dedupe.mode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    data-testid={`import-dedupe-${mode}`}
                    onClick={() => onDraft({ dedupe: { mode: mode as DedupeMode, key: draft.dedupe.key } })}
                    className={cn(
                      'flex items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors duration-[var(--duration-fast)] ease-out',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:bg-pressed',
                      selected ? 'border-primary bg-primary-subtle' : 'border-border-subtle hover:bg-muted',
                    )}
                  >
                    <span aria-hidden className={cn('mt-1 inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border-2', selected ? 'border-primary' : 'border-border-input')}>
                      {selected ? <span className="size-1.5 rounded-full bg-primary" /> : null}
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-fg">{title}</span>
                      <span className="block text-sm text-fg-secondary">{body}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-fg" htmlFor="import-dedupe-key">
                Match on
              </label>
              <Combobox
                id="import-dedupe-key"
                disabled={draft.dedupe.mode === 'create'}
                value={dedupe.key ?? 'name'}
                onValueChange={(value) => value && onDraft({ dedupe: { ...draft.dedupe, key: value }, dedupeKeyChosen: true })}
                options={keyOptions}
                searchPlaceholder="Search columns"
                emptyMessage="No columns match"
              />
              <div className="min-h-10 text-sm text-fg-secondary" aria-live="polite">
                {draft.dedupe.mode === 'create' ? (
                  'Duplicates are not checked.'
                ) : match.pending ? (
                  <Skeleton height={14} width={160} />
                ) : match.error ? (
                  <span className="text-danger-text">{errorMessage(match.error, "Couldn't check duplicates.")}</span>
                ) : (
                  <span data-testid="import-match-count">
                    <span className="font-semibold text-fg tabular-nums">{match.matched}</span> {match.matched === 1 ? 'row matches' : 'rows match'} existing {term(2)}
                  </span>
                )}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-3" aria-labelledby="import-problems-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id="import-problems-title" className="flex items-center gap-2 text-base font-semibold text-fg">
            Problems <CountBadge count={built.issues.length} tone="critical" label={built.issues.length === 1 ? 'problem' : 'problems'} />
          </h3>
          <div className="flex flex-wrap items-center gap-3">
            <Switch
              size="sm"
              checked={draft.skipRowsWithIssues}
              onCheckedChange={(checked) => onDraft({ skipRowsWithIssues: checked })}
              label="Skip rows with problems"
            />
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Download aria-hidden />}
              disabled={built.issues.length === 0}
              data-testid="import-download-errors"
              onClick={() =>
                downloadBlob(buildErrorReport(built.issues), `${baseFileName(draft.file?.fileName ?? 'import')} problems.csv`, 'text/csv;charset=utf-8')
              }
            >
              Error report
            </Button>
          </div>
        </div>
        {built.issues.length === 0 ? (
          <p className="flex items-center gap-2 rounded-lg border border-border-subtle bg-success-subtle px-4 py-3 text-sm text-success-text">
            <CheckCircle2 aria-hidden className="size-4" /> Every value fits its column. Ready to import.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border-subtle bg-panel">
            {/* Phones: one page scroll (no nested scroll area); long lists page in with "Show more". */}
            <ul className="divide-y divide-border-subtle sm:hidden" data-testid="import-issues-cards">
              {listed.slice(0, cardLimit).map((issue) => (
                <ProblemCard key={`${overrideKey(issue.row, issue.sourceIndex)}-${issue.message}`} {...problemProps(issue)} />
              ))}
            </ul>
            {listed.length > cardLimit ? (
              <div className="border-t border-border-subtle p-2 sm:hidden">
                <Button variant="ghost" size="sm" fullWidth onClick={() => setCardLimit((limit) => limit + CARD_PAGE)}>
                  Show {Math.min(CARD_PAGE, listed.length - cardLimit)} more
                </Button>
              </div>
            ) : null}
            <div className="hidden max-h-[420px] overflow-auto sm:block">
              <table className="w-full min-w-[640px] border-collapse text-sm" data-testid="import-issues">
                <thead className="sticky top-0 z-[1] bg-sunken text-left text-xs font-semibold text-fg-muted">
                  <tr>
                    <th scope="col" className="w-16 px-3 py-2">Row</th>
                    <th scope="col" className="px-3 py-2">Column</th>
                    <th scope="col" className="w-[30%] px-3 py-2">Value</th>
                    <th scope="col" className="px-3 py-2">Problem</th>
                    <th scope="col" className="w-16 px-3 py-2 text-center">Skip</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {listed.map((issue) => (
                    <ProblemRow key={`${overrideKey(issue.row, issue.sourceIndex)}-${issue.message}`} {...problemProps(issue)} />
                  ))}
                </tbody>
              </table>
            </div>
            {built.issues.length > MAX_LISTED ? (
              <p className="border-t border-border-subtle bg-sunken px-3 py-2 text-xs text-fg-muted">
                Showing the first {MAX_LISTED} of {built.issues.length.toLocaleString('en-US')} problems. Download the error report for the full list.
              </p>
            ) : null}
          </div>
        )}
        {built.issues.length ? (
          <p className="text-sm text-fg-muted">
            <span className="text-warning-text">Amber</span> values don&apos;t fit their column and are left empty; the rest of the row imports
            {draft.skipRowsWithIssues ? ', but “Skip rows with problems” is on, so those rows are skipped.' : '.'} Rows without a name are always skipped.
          </p>
        ) : null}
      </section>
    </div>
  );
}
