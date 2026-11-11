'use client';
/** Right-hand panels of the form builder: question settings, design and form settings. */
import { GitBranch, Lock } from 'lucide-react';
import { Button, ColorPicker, Input, Select, Switch, Textarea, ToggleGroup } from '@/components/ui';
import { ColumnTypeIcon } from '@/features/cells';
import type { ColumnDto, GroupDto } from '@/server/services/contracts/dto';
import { labelsOf, NAME_QUESTION_KEY, type FormCondition, type FormQuestion, type FormSettings } from '@/server/services/board-views-form-model';

function Field({ label, children, hint }: { readonly label: string; readonly children: React.ReactNode; readonly hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-fg">
      {label}
      {children}
      {hint ? <span className="text-xs font-normal text-fg-muted">{hint}</span> : null}
    </label>
  );
}

export function QuestionPanel({
  question,
  column,
  questions,
  columns,
  onChange,
  onRemove,
}: {
  readonly question: FormQuestion;
  readonly column: ColumnDto;
  readonly questions: readonly FormQuestion[];
  readonly columns: readonly ColumnDto[];
  readonly onChange: (patch: Partial<FormQuestion>) => void;
  readonly onRemove: () => void;
}) {
  const isName = question.columnKey === NAME_QUESTION_KEY;
  const condition = question.condition ?? null;
  const index = questions.findIndex((entry) => entry.columnKey === question.columnKey);
  const earlier = questions.slice(0, index).filter((entry) => entry.columnKey !== NAME_QUESTION_KEY || true);
  const conditionColumn = columns.find((entry) => entry.key === condition?.columnKey);
  const conditionOptions = conditionColumn ? labelsOf(conditionColumn.settings) : [];
  const setCondition = (patch: Partial<FormCondition> | null) =>
    onChange({ condition: patch === null ? null : ({ columnKey: earlier[0]?.columnKey ?? '', operator: 'is', ...condition, ...patch } as FormCondition) });
  return (
    <div className="flex flex-col gap-4" data-testid="question-panel">
      <div className="flex items-center gap-2">
        <ColumnTypeIcon type={column.type === 'name' ? 'text' : column.type} variant="tile" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-fg">{column.title}</p>
          <p className="text-xs text-fg-muted">Answers fill the “{column.title}” column</p>
        </div>
      </div>
      <Field label="Question">
        <Input size="sm" value={question.label ?? ''} placeholder={column.title} onChange={(event) => onChange({ label: event.target.value })} aria-label="Question text" />
      </Field>
      <Field label="Description">
        <Textarea rows={2} value={question.description ?? ''} placeholder="Help text shown under the question" onChange={(event) => onChange({ description: event.target.value })} />
      </Field>
      {column.type !== 'status' && column.type !== 'dropdown' && column.type !== 'rating' && column.type !== 'date' ? (
        <Field label={column.type === 'checkbox' ? 'Checkbox label' : 'Placeholder'}>
          <Input size="sm" value={question.placeholder ?? ''} onChange={(event) => onChange({ placeholder: event.target.value })} />
        </Field>
      ) : null}
      {isName ? (
        // Locked on: shown as an always-checked state with a lock, not as a dim disabled switch.
        <div className="flex items-start justify-between gap-3" data-testid="question-required-locked">
          <div className="min-w-0">
            <p className="text-sm font-medium text-fg">Required</p>
            <p className="text-xs text-fg-muted">The name is always required and always shown.</p>
          </div>
          <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-pill bg-primary-selected px-2 text-xs font-semibold text-primary-text">
            <Lock aria-hidden className="size-3" />
            Always on
          </span>
        </div>
      ) : (
        <>
          <Switch size="sm" label="Required" checked={question.required} onCheckedChange={(checked) => onChange({ required: checked })} />
          <Switch size="sm" label="Hide question" description="Hidden questions keep their settings but aren't shown." checked={question.hidden} onCheckedChange={(checked) => onChange({ hidden: checked })} />
        </>
      )}
      {!isName ? (
        <div className="flex flex-col gap-2 rounded-md border border-border-subtle p-3">
          <div className="flex items-center gap-2">
            <GitBranch aria-hidden className="size-4 text-icon" />
            <span className="flex-1 text-sm font-semibold text-fg">Conditional logic</span>
            <Switch size="sm" aria-label="Show only when a condition matches" checked={Boolean(condition)} disabled={earlier.length === 0} onCheckedChange={(checked) => setCondition(checked ? {} : null)} />
          </div>
          {condition ? (
            <div className="flex flex-col gap-2">
              <span className="text-xs text-fg-muted">Show this question only if</span>
              <Select
                size="sm"
                aria-label="Condition question"
                value={condition.columnKey}
                onValueChange={(value) => setCondition({ columnKey: value, value: '' })}
                options={earlier.map((entry) => ({ value: entry.columnKey, label: entry.label || columns.find((col) => col.key === entry.columnKey)?.title || entry.columnKey }))}
              />
              <Select
                size="sm"
                aria-label="Condition operator"
                value={condition.operator}
                onValueChange={(value) => setCondition({ operator: value as FormCondition['operator'] })}
                options={[
                  { value: 'is', label: 'is' },
                  { value: 'is_not', label: 'is not' },
                  { value: 'contains', label: 'contains' },
                  { value: 'is_not_empty', label: 'is answered' },
                  { value: 'is_empty', label: 'is empty' },
                ]}
              />
              {condition.operator === 'is_empty' || condition.operator === 'is_not_empty' ? null : conditionOptions.length ? (
                <Select size="sm" aria-label="Condition value" value={condition.value || undefined} placeholder="Choose a value" onValueChange={(value) => setCondition({ value })} options={conditionOptions.map((label) => ({ value: label.id, label: label.name || 'Untitled' }))} />
              ) : (
                <Input size="sm" aria-label="Condition value" value={condition.value ?? ''} placeholder="Value" onChange={(event) => setCondition({ value: event.target.value })} />
              )}
            </div>
          ) : earlier.length === 0 ? (
            <p className="text-xs text-fg-muted">Add questions above this one to branch on their answers.</p>
          ) : null}
        </div>
      ) : null}
      {!isName ? (
        <Button variant="danger-ghost" size="sm" onClick={onRemove} className="self-start">
          Remove from form
        </Button>
      ) : null}
    </div>
  );
}

export function DesignPanel({ settings, onChange }: { readonly settings: FormSettings; readonly onChange: (patch: Partial<FormSettings>) => void }) {
  return (
    <div className="flex flex-col gap-4" data-testid="design-panel">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-fg">Accent color</span>
        <ColorPicker value={settings.accent} onChange={(accent) => onChange({ accent })} columns={8} size="sm" label="Accent color" />
      </div>
      <div className="flex items-center justify-between gap-3 text-sm font-medium text-fg">
        Alignment
        <ToggleGroup
          size="sm"
          label="Alignment"
          value={settings.align}
          onValueChange={(align) => onChange({ align })}
          options={[
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Center' },
          ]}
        />
      </div>
      <Field label="Submit button text">
        <Input size="sm" value={settings.submitLabel} maxLength={60} onChange={(event) => onChange({ submitLabel: event.target.value })} />
      </Field>
      <Switch size="sm" label="Hide KitStak branding" description="Free on every plan." checked={settings.hideBranding} onCheckedChange={(hideBranding) => onChange({ hideBranding })} />
    </div>
  );
}

export function SettingsPanel({
  settings,
  groups,
  noun,
  onChange,
}: {
  readonly settings: FormSettings;
  readonly groups: readonly GroupDto[];
  readonly noun: string;
  readonly onChange: (patch: Partial<FormSettings>) => void;
}) {
  return (
    <div className="flex flex-col gap-5" data-testid="form-settings-panel">
      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold text-fg-muted ">After submit</h3>
        <Field label="Thank-you title">
          <Input size="sm" value={settings.thankYouTitle} onChange={(event) => onChange({ thankYouTitle: event.target.value })} />
        </Field>
        <Field label="Thank-you message">
          <Textarea rows={3} value={settings.thankYouMessage} onChange={(event) => onChange({ thankYouMessage: event.target.value })} />
        </Field>
        <Switch size="sm" label="Show “Submit another response”" checked={settings.allowAnother} onCheckedChange={(allowAnother) => onChange({ allowAnother })} />
        <Field label="Redirect to a URL" hint="Optional. Respondents go here instead of the thank-you screen.">
          <Input size="sm" type="url" value={settings.redirectUrl ?? ''} placeholder="https://" onChange={(event) => onChange({ redirectUrl: event.target.value || null })} />
        </Field>
      </section>
      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold text-fg-muted ">Responses</h3>
        <Field label={`New ${noun.toLowerCase()}s go to`}>
          <Select size="sm" aria-label="Target group" value={settings.groupId ?? 'first'} onValueChange={(value) => onChange({ groupId: value === 'first' ? null : value })} options={[{ value: 'first', label: 'Top group' }, ...groups.map((group) => ({ value: group.id, label: group.title }))]} />
        </Field>
        <p className="text-sm text-fg-secondary tabular-nums">
          {settings.responseCount} {settings.responseCount === 1 ? 'response' : 'responses'} so far
        </p>
      </section>
      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold text-fg-muted ">Access</h3>
        <Switch size="sm" label="Close form" description="Stop accepting responses now." checked={settings.closed} onCheckedChange={(closed) => onChange({ closed })} />
        <Field label="Close on date">
          <Input size="sm" type="date" value={settings.closeAt ?? ''} onChange={(event) => onChange({ closeAt: event.target.value || null })} />
        </Field>
        <Field label="Close after N responses">
          <Input size="sm" type="number" min={1} value={settings.maxResponses ?? ''} placeholder="No limit" onChange={(event) => onChange({ maxResponses: event.target.value ? Math.max(1, Number(event.target.value)) : null })} />
        </Field>
        <p className="text-xs text-fg-muted">Spam protection is always on: a hidden honeypot field, a human-speed check and per-network rate limits.</p>
      </section>
    </div>
  );
}
