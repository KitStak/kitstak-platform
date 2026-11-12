'use client';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Avatar,
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  Field,
  Input,
  Select,
  Switch,
  Textarea,
  cn,
  labelColorStyle,
  toLabelColor,
} from '@/components/ui';
import {
  EditLabelsDialog,
  countLabelUsage,
  labelsFromSettings,
  useCellServices,
  type LabelChange,
} from '@/features/cells';
import { COLUMN_TYPE_REGISTRY } from '@/server/db/schema/column-types';
import type { ColumnDto } from '@/server/services/contracts/dto';
import type { FilterOperator, FilterRule } from '../lib/view-state';
import { useTableStore } from '../state/table-store';
import { useTable } from '../table-context';

/** Renders whichever column dialog the header menu asked for. */
export function ColumnDialogs() {
  const dialog = useTableStore((state) => state.columnDialog);
  const close = useTableStore((state) => state.openColumnDialog);
  const { columns } = useTable();
  const column = dialog ? columns.find((entry) => entry.id === dialog.columnId) : undefined;
  if (!dialog || !column) return null;
  const onOpenChange = (open: boolean) => {
    if (!open) close(null);
  };
  if (dialog.kind === 'labels') return <LabelsDialog column={column} onOpenChange={onOpenChange} />;
  if (dialog.kind === 'filter') return <FilterDialog column={column} onOpenChange={onOpenChange} />;
  return <SettingsDialog column={column} onOpenChange={onOpenChange} />;
}

function LabelsDialog({
  column,
  onOpenChange,
}: {
  readonly column: ColumnDto;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const services = useCellServices();
  const { allItems, terminology } = useTable();
  const [saving, setSaving] = useState(false);
  const usage = useMemo(() => countLabelUsage(allItems, column.key), [allItems, column.key]);
  const onApply = async (change: LabelChange) => {
    if (!services.saveLabels) return;
    setSaving(true);
    try {
      await services.saveLabels(column, change);
      onOpenChange(false);
    } catch {
      // useUpdateColumn rolled back and toasted.
    } finally {
      setSaving(false);
    }
  };
  return (
    <EditLabelsDialog
      open
      onOpenChange={onOpenChange}
      columnTitle={column.title}
      kind={column.type === 'dropdown' ? 'dropdown' : 'status'}
      labels={labelsFromSettings(column.settings)}
      usage={usage}
      saving={saving}
      itemNoun={terminology}
      onApply={onApply}
    />
  );
}

type Settings = Record<string, unknown>;

function SettingRow({
  label,
  children,
  hint,
}: {
  readonly label: string;
  readonly children: (id: string) => ReactNode;
  readonly hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      {({ inputId }) => children(inputId)}
    </Field>
  );
}

function TypeSettings({
  column,
  settings,
  onChange,
}: {
  readonly column: ColumnDto;
  readonly settings: Settings;
  readonly onChange: (patch: Settings) => void;
}) {
  switch (column.type) {
    case 'number':
      return (
        <div className="grid grid-cols-2 gap-3">
          <SettingRow label="Unit" hint="e.g. $, %, hrs">
            {(id) => (
              <Input
                id={id}
                value={String(settings.unit ?? '')}
                maxLength={10}
                onChange={(event) => onChange({ unit: event.target.value || undefined })}
              />
            )}
          </SettingRow>
          <SettingRow label="Unit position">
            {(id) => (
              <Select
                id={id}
                value={String(settings.unitPosition ?? 'suffix')}
                onValueChange={(value) => onChange({ unitPosition: value })}
                options={[
                  { value: 'prefix', label: 'Before the number ($10)' },
                  { value: 'suffix', label: 'After the number (10%)' },
                ]}
              />
            )}
          </SettingRow>
          <SettingRow label="Decimals">
            {(id) => (
              <Select
                id={id}
                value={String(settings.decimals ?? 0)}
                onValueChange={(value) => onChange({ decimals: Number(value) })}
                options={[0, 1, 2, 3, 4].map((value) => ({
                  value: String(value),
                  label: value === 0 ? 'None' : `${value}`,
                }))}
              />
            )}
          </SettingRow>
          <SettingRow label="Format">
            {(id) => (
              <Select
                id={id}
                value={String(settings.format ?? 'plain')}
                onValueChange={(value) => onChange({ format: value })}
                options={[
                  { value: 'plain', label: '1,234,567' },
                  { value: 'compact', label: '1.2M (compact)' },
                  { value: 'percent', label: 'Percent' },
                ]}
              />
            )}
          </SettingRow>
        </div>
      );
    case 'currency':
      return (
        <div className="grid grid-cols-2 gap-3">
          <SettingRow label="Currency">
            {(id) => (
              <Select
                id={id}
                value={String(settings.currency ?? 'USD')}
                onValueChange={(value) => onChange({ currency: value })}
                options={['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'INR', 'BRL', 'MXN'].map(
                  (code) => ({ value: code, label: code }),
                )}
              />
            )}
          </SettingRow>
          <SettingRow label="Decimals">
            {(id) => (
              <Select
                id={id}
                value={String(settings.decimals ?? 0)}
                onValueChange={(value) => onChange({ decimals: Number(value) })}
                options={[0, 1, 2].map((value) => ({
                  value: String(value),
                  label: value === 0 ? 'None' : `${value}`,
                }))}
              />
            )}
          </SettingRow>
        </div>
      );
    case 'date':
      return (
        <div className="flex flex-col gap-3">
          <SettingRow label="Date format">
            {(id) => (
              <Select
                id={id}
                value={String(settings.format ?? 'short')}
                onValueChange={(value) => onChange({ format: value })}
                options={[
                  { value: 'short', label: 'Short (Oct 30)' },
                  { value: 'long', label: 'Long (Oct 30, 2026)' },
                  { value: 'relative', label: 'Relative (in 3 days)' },
                  { value: 'iso', label: 'ISO (2026-10-30)' },
                ]}
              />
            )}
          </SettingRow>
          <Switch
            label="Include time"
            checked={settings.includeTime === true}
            onCheckedChange={(checked) => onChange({ includeTime: checked })}
          />
        </div>
      );
    case 'people':
      return (
        <Switch
          label="Allow more than one person"
          checked={settings.allowMultiple !== false}
          onCheckedChange={(checked) => onChange({ allowMultiple: checked })}
        />
      );
    case 'rating':
      return (
        <SettingRow label="Maximum rating">
          {(id) => (
            <Select
              id={id}
              value={String(settings.max ?? 5)}
              onValueChange={(value) => onChange({ max: Number(value) })}
              options={[3, 4, 5, 6, 7, 8, 9, 10].map((value) => ({
                value: String(value),
                label: `${value} stars`,
              }))}
            />
          )}
        </SettingRow>
      );
    case 'connect_boards':
      return (
        <Switch
          label="Allow linking more than one item"
          checked={settings.allowMultiple !== false}
          onCheckedChange={(checked) => onChange({ allowMultiple: checked })}
        />
      );
    default:
      return null;
  }
}

function SettingsDialog({
  column,
  onOpenChange,
}: {
  readonly column: ColumnDto;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { actions } = useTable();
  const openColumnDialog = useTableStore((state) => state.openColumnDialog);
  const [title, setTitle] = useState(column.title);
  const [description, setDescription] = useState(column.description ?? '');
  const [settings, setSettings] = useState<Settings>(() => ({ ...(column.settings as Settings) }));
  const [saving, setSaving] = useState(false);
  const definition = COLUMN_TYPE_REGISTRY[column.type];
  const hasLabels = column.type === 'status' || column.type === 'dropdown';
  const settingsChanged = JSON.stringify(settings) !== JSON.stringify(column.settings);

  const save = async () => {
    setSaving(true);
    await actions.updateColumn(column, {
      ...(title.trim() && title.trim() !== column.title && { title: title.trim() }),
      ...(description !== (column.description ?? '') && { description: description.trim() || null }),
      ...(settingsChanged && !hasLabels && { settings }),
    });
    setSaving(false);
    onOpenChange(false);
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="column-settings-dialog">
        <DialogHeader
          title="Column settings"
          description={`${definition.label} column · ${definition.description}`}
        />
        <DialogBody className="flex flex-col gap-4">
          <SettingRow label="Column name">
            {(id) => (
              <Input
                id={id}
                value={title}
                maxLength={255}
                onChange={(event) => setTitle(event.target.value)}
              />
            )}
          </SettingRow>
          <SettingRow label="Description" hint="Shown as an info tooltip in the column header.">
            {(id) => (
              <Textarea
                id={id}
                value={description}
                maxLength={2_000}
                rows={3}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What goes in this column?"
              />
            )}
          </SettingRow>
          <TypeSettings
            column={column}
            settings={settings}
            onChange={(patch) => setSettings((current) => ({ ...current, ...patch }))}
          />
          {hasLabels ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-sunken p-3">
              <span className="flex flex-wrap gap-1">
                {labelsFromSettings(column.settings)
                  .filter((label) => !label.isDefault)
                  .slice(0, 8)
                  .map((label) => (
                    <span
                      key={label.id}
                      className="rounded-xs bg-[var(--lc-bg)] px-2 py-0.5 text-xs font-medium text-[var(--lc-fg)]"
                      style={labelColorStyle(toLabelColor(label.color))}
                    >
                      {label.name || 'Blank'}
                    </span>
                  ))}
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => openColumnDialog({ columnId: column.id, kind: 'labels' })}
              >
                Edit labels
              </Button>
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={saving} disabled={!title.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const TEXT_OPERATORS: readonly { value: FilterOperator; label: string }[] = [
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: "doesn't contain" },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
];
const NUMBER_OPERATORS: readonly { value: FilterOperator; label: string }[] = [
  { value: 'gt', label: 'greater than' },
  { value: 'gte', label: 'at least' },
  { value: 'lt', label: 'less than' },
  { value: 'lte', label: 'at most' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
];
const DATE_OPERATORS: readonly { value: FilterOperator; label: string }[] = [
  { value: 'before', label: 'is before' },
  { value: 'after', label: 'is after' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
];

/** Quick filter for one column: label / person checklist, or operator + value. */
function FilterDialog({
  column,
  onOpenChange,
}: {
  readonly column: ColumnDto;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { view, users } = useTable();
  const existing = view.state.filters.rules.find((rule) => rule.columnKey === column.key);
  const discrete =
    column.type === 'status' ||
    column.type === 'dropdown' ||
    column.type === 'people' ||
    column.type === 'checkbox';
  const numeric = ['number', 'currency', 'rating', 'progress', 'formula'].includes(column.type);
  const dated = ['date', 'timeline', 'last_updated', 'creation_log'].includes(column.type);
  const operators = numeric ? NUMBER_OPERATORS : dated ? DATE_OPERATORS : TEXT_OPERATORS;
  const [picked, setPicked] = useState<string[]>(() =>
    Array.isArray(existing?.value) ? (existing.value as string[]) : [],
  );
  const [operator, setOperator] = useState<FilterOperator>(
    existing && !discrete ? existing.operator : (operators[0]?.value ?? 'contains'),
  );
  const [value, setValue] = useState(existing && !discrete ? String(existing.value ?? '') : '');

  const options = useMemo(() => {
    if (column.type === 'people')
      return users.map((user) => ({
        id: user.id,
        name: user.name,
        avatar: user.image,
        color: null as string | null,
      }));
    if (column.type === 'checkbox')
      return [
        { id: 'true', name: 'Checked', avatar: null, color: null },
        { id: 'false', name: 'Unchecked', avatar: null, color: null },
      ];
    return labelsFromSettings(column.settings).map((label) => ({
      id: label.id,
      name: label.isDefault ? 'Blank' : label.name,
      avatar: null,
      color: label.color as string,
    }));
  }, [column, users]);

  const apply = () => {
    const needsValue = !['is_empty', 'is_not_empty'].includes(operator);
    let rule: FilterRule | null = null;
    if (discrete) rule = picked.length ? { columnKey: column.key, operator: 'any_of', value: picked } : null;
    else if (!needsValue) rule = { columnKey: column.key, operator };
    else if (value.trim())
      rule = { columnKey: column.key, operator, value: numeric ? Number(value) : value.trim() };
    if (rule) view.addFilterRule(rule);
    else view.removeFilterRule(column.key);
    onOpenChange(false);
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="column-filter-dialog">
        <DialogHeader
          title={`Filter by ${column.title}`}
          description="Only matching items stay visible in this view."
        />
        <DialogBody className="flex flex-col gap-3">
          {discrete ? (
            <ul
              className="flex max-h-72 flex-col gap-0.5 overflow-y-auto"
              aria-label={`${column.title} values`}
            >
              {options.map((option) => (
                <li key={option.id}>
                  <label
                    className={cn(
                      'flex h-9 cursor-pointer items-center gap-2.5 rounded-sm px-2 hover:bg-hover',
                      picked.includes(option.id) && 'bg-primary-subtle',
                    )}
                  >
                    <Checkbox
                      checked={picked.includes(option.id)}
                      onCheckedChange={(checked) =>
                        setPicked((current) =>
                          checked ? [...current, option.id] : current.filter((id) => id !== option.id),
                        )
                      }
                    />
                    {option.color ? (
                      <span
                        aria-hidden
                        className="size-3.5 rounded-xs"
                        style={{ background: `var(--label-${option.color})` }}
                      />
                    ) : null}
                    {column.type === 'people' ? (
                      <Avatar name={option.name} src={option.avatar} size="xs" />
                    ) : null}
                    <span className="truncate text-base">{option.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex gap-2">
              <Select
                value={operator}
                onValueChange={(next) => setOperator(next as FilterOperator)}
                options={operators}
                aria-label="Condition"
                className="w-44"
              />
              {!['is_empty', 'is_not_empty'].includes(operator) ? (
                <Input
                  autoFocus
                  type={numeric ? 'number' : dated ? 'date' : 'text'}
                  aria-label="Value"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') apply();
                  }}
                  containerClassName="flex-1"
                />
              ) : null}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          {existing ? (
            <Button
              variant="ghost"
              className="mr-auto"
              onClick={() => {
                view.removeFilterRule(column.key);
                onOpenChange(false);
              }}
            >
              Clear filter
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={apply} data-testid="apply-filter">
            Apply filter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
