'use client';
/**
 * Labels and custom fields editors for project Settings. Labels: rename, recolor, delete, add.
 * Custom fields: add (text, number, single/multiple choice, date, person, checkbox, money,
 * link), rename, edit choices (add / rename / recolor / remove), required flag, delete.
 * Workspace-wide labels and fields are listed read-only (they belong to every project).
 */
import { useMemo, useState } from 'react';
import {
  Calendar,
  CheckSquare,
  CircleDollarSign,
  Hash,
  Link2,
  List,
  ListChecks,
  Pencil,
  Plus,
  Tag,
  Trash2,
  Type,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  Field,
  IconButton,
  Input,
  Select,
  Switch,
  colorForString,
  cn,
} from '@/components/ui';
import { LabelPill } from '@/components/pm';
import { CUSTOM_FIELD_TYPES, CUSTOM_FIELD_TYPE_LABELS, type CustomFieldType } from '@/lib/constants';
import type { CustomFieldOption } from '@/lib/custom-field-types';
import { useProjectTasks } from '@/lib/hooks/use-data';
import type { CustomFieldDTO, LabelDTO } from '@/lib/types';
import { createCustomFieldAction, createLabelAction, deleteCustomFieldAction, deleteLabelAction, updateCustomFieldAction, updateLabelAction } from '@/server/actions/structure';
import { useCurrentProject } from './project-context';
import { ColorDot, SettingsSection, useSettingsRunner } from './settings-shared';

export const FIELD_ICONS: Readonly<Record<CustomFieldType, LucideIcon>> = {
  text: Type,
  number: Hash,
  select: List,
  multiselect: ListChecks,
  date: Calendar,
  person: UserRound,
  checkbox: CheckSquare,
  currency: CircleDollarSign,
  url: Link2,
};

const FIELD_HELP: Readonly<Record<CustomFieldType, string>> = {
  text: 'A short note, like a PO number',
  number: 'Any number, like hours or quantity',
  select: 'Pick one choice from a list',
  multiselect: 'Pick several choices from a list',
  date: 'A calendar date',
  person: 'Someone in the workspace',
  checkbox: 'Yes or no',
  currency: 'An amount of money',
  url: 'A web link',
};

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'MXN', 'JPY'] as const;

const newOptionId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10));

// --- Labels -----------------------------------------------------------------------------------

function LabelRow({ label, count, canEdit, onDelete }: { readonly label: LabelDTO; readonly count: number; readonly canEdit: boolean; readonly onDelete: () => void }) {
  const run = useSettingsRunner();
  const [name, setName] = useState(label.name);
  const shared = label.projectId === null;
  return (
    <li className="flex items-center gap-2 px-2 py-1.5" data-testid="label-row">
      <ColorDot color={label.color} label={`Color for ${label.name}`} disabled={!canEdit || shared} onChange={(color) => void run(updateLabelAction({ labelId: label.id, patch: { color } }))} />
      {canEdit && !shared ? (
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            const value = name.trim();
            if (!value) setName(label.name);
            else if (value !== label.name) void run(updateLabelAction({ labelId: label.id, patch: { name: value } }), 'Label renamed');
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
            if (event.key === 'Escape') setName(label.name);
          }}
          aria-label={`Name of label ${label.name}`}
          maxLength={40}
          size="sm"
          containerClassName="min-w-0 max-w-64 flex-1 border-transparent bg-transparent hover:border-border-input focus-within:border-border-input"
        />
      ) : (
        <span className="min-w-0 flex-1">
          <LabelPill name={label.name} color={label.color} />
        </span>
      )}
      <span className="ml-auto flex items-center gap-2">
        {shared ? <Badge size="sm">Every project</Badge> : <LabelPill name={name || label.name} color={label.color} className="hidden sm:inline-flex" />}
        <span className="w-14 text-right text-xs text-fg-muted tabular-nums">{count} {count === 1 ? 'task' : 'tasks'}</span>
        <IconButton label={`Delete label ${label.name}`} icon={<Trash2 aria-hidden />} size="sm" disabled={!canEdit || shared} onClick={onDelete} />
      </span>
    </li>
  );
}

export function LabelsSettings({ highlight }: { readonly highlight?: boolean }) {
  const { project, capabilities } = useCurrentProject();
  const canEdit = capabilities['structure:manage'];
  const run = useSettingsRunner();
  const tasks = useProjectTasks(project.key);
  const [name, setName] = useState('');
  const [color, setColor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<LabelDTO | null>(null);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const task of tasks.data ?? []) for (const id of task.labelIds) map.set(id, (map.get(id) ?? 0) + 1);
    return map;
  }, [tasks.data]);
  const labels = [...project.labels].sort((a, b) => Number(a.projectId === null) - Number(b.projectId === null) || a.name.localeCompare(b.name));
  const nextColor = color ?? (name.trim() ? colorForString(name.trim()) : 'blue');

  return (
    <SettingsSection id="labels" title="Labels" highlight={highlight}>
      {labels.length === 0 ? (
        <p className="mb-3 flex items-center gap-2 text-sm text-fg-muted">
          <Tag aria-hidden className="size-4" />
          No labels yet. Add one below, or create them right from a task.
        </p>
      ) : (
        <ul className="mb-3 flex flex-col divide-y divide-border-subtle rounded-lg border border-border-subtle">
          {labels.map((label) => (
            <LabelRow key={`${label.id}-${label.name}`} label={label} count={counts.get(label.id) ?? 0} canEdit={canEdit} onDelete={() => setDeleting(label)} />
          ))}
        </ul>
      )}
      {canEdit ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = name.trim();
            if (!value) return;
            void run(createLabelAction({ projectId: project.id, name: value, color: nextColor }), `Added label ${value}`).then((created) => {
              if (created) {
                setName('');
                setColor(null);
              }
            });
          }}
        >
          <ColorDot color={nextColor} label="Color for the new label" onChange={setColor} />
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New label name" aria-label="New label name" maxLength={40} containerClassName="min-w-0 flex-1 basis-48" data-testid="new-label-name" />
          <Button type="submit" variant="secondary" leadingIcon={<Plus aria-hidden />} disabled={!name.trim()} data-testid="add-label">
            Add label
          </Button>
        </form>
      ) : null}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete the label “${deleting?.name}”?`}
        description={deleting && counts.get(deleting.id) ? `It comes off ${counts.get(deleting.id)} ${counts.get(deleting.id) === 1 ? 'task' : 'tasks'}. The tasks stay.` : 'No tasks use it.'}
        confirmLabel="Delete label"
        destructive
        onConfirm={() => {
          if (deleting) void run(deleteLabelAction({ labelId: deleting.id }), `Deleted ${deleting.name}`);
          setDeleting(null);
        }}
      />
    </SettingsSection>
  );
}

// --- Custom fields --------------------------------------------------------------------------------

function OptionsEditor({ options, onChange }: { readonly options: readonly CustomFieldOption[]; readonly onChange: (options: CustomFieldOption[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const label = draft.trim();
    if (!label || options.some((o) => o.label.toLowerCase() === label.toLowerCase())) return;
    onChange([...options, { id: newOptionId(), label, color: colorForString(label) }]);
    setDraft('');
  };
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1">
        {options.map((option, index) => (
          <li key={option.id} className="flex items-center gap-2">
            <ColorDot color={option.color} label={`Color for ${option.label}`} onChange={(color) => onChange(options.map((o) => (o.id === option.id ? { ...o, color } : o)))} />
            <Input
              value={option.label}
              onChange={(event) => onChange(options.map((o) => (o.id === option.id ? { ...o, label: event.target.value } : o)))}
              aria-label={`Choice ${index + 1}`}
              size="sm"
              maxLength={60}
              containerClassName="flex-1"
            />
            <IconButton label={`Remove ${option.label || 'choice'}`} icon={<X aria-hidden />} size="sm" onClick={() => onChange(options.filter((o) => o.id !== option.id))} />
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
          placeholder="Add a choice and press Enter"
          aria-label="New choice"
          size="sm"
          maxLength={60}
          containerClassName="flex-1"
          data-testid="new-choice"
        />
        <Button type="button" size="sm" variant="secondary" onClick={add} disabled={!draft.trim()}>
          Add
        </Button>
      </div>
    </div>
  );
}

function FieldDialog({ field, open, onOpenChange }: { readonly field: CustomFieldDTO | null; readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) {
  const { project } = useCurrentProject();
  const run = useSettingsRunner();
  const [name, setName] = useState(field?.name ?? '');
  const [type, setType] = useState<CustomFieldType>(field?.type ?? 'select');
  const [options, setOptions] = useState<CustomFieldOption[]>(() => [...(field?.config.options ?? [])]);
  const [currency, setCurrency] = useState(field?.config.currency ?? 'USD');
  const [description, setDescription] = useState(field?.description ?? '');
  const [required, setRequired] = useState(field?.required ?? false);
  const [saving, setSaving] = useState(false);
  const hasOptions = type === 'select' || type === 'multiselect';
  const cleanOptions = options.map((o) => ({ ...o, label: o.label.trim() })).filter((o) => o.label);
  const valid = name.trim().length > 0 && (!hasOptions || cleanOptions.length > 0);

  const save = async () => {
    setSaving(true);
    const config = { ...(field?.config ?? {}), ...(hasOptions ? { options: cleanOptions } : {}), ...(type === 'currency' ? { currency } : {}) };
    const result = field
      ? await run(updateCustomFieldAction({ fieldId: field.id, patch: { name: name.trim(), config, description: description.trim() || null, required } }), `Saved ${name.trim()}`)
      : await run(createCustomFieldAction({ projectId: project.id, name: name.trim(), type, config, description: description.trim() || null, required }), `Added ${name.trim()}. It shows on every task in this project.`);
    setSaving(false);
    if (result) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader title={field ? `Edit “${field.name}”` : 'Add a custom field'} description={field ? 'Changes apply to every task in this project.' : 'Track extra details on every task, like a PO number, cost or region.'} />
        <DialogBody className="flex flex-col gap-4 pb-4">
          <Field label="Field name" required>
            {({ inputId }) => <Input id={inputId} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Region" autoFocus maxLength={80} size="lg" data-testid="field-name" />}
          </Field>
          {field ? (
            <p className="flex items-center gap-2 text-sm text-fg-secondary">
              Type: <strong className="font-medium text-fg">{CUSTOM_FIELD_TYPE_LABELS[field.type]}</strong>
              <span className="text-xs text-fg-muted">(the type can’t change once tasks have values)</span>
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-secondary">Type</span>
              <div role="radiogroup" aria-label="Field type" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {CUSTOM_FIELD_TYPES.map((t) => {
                  const Icon = FIELD_ICONS[t];
                  return (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={type === t}
                      onClick={() => setType(t)}
                      data-testid={`field-type-${t}`}
                      className={cn(
                        'flex items-start gap-2 rounded-lg border px-3 py-2 text-left outline-none transition-colors focus-visible:outline-2 focus-visible:outline-focus',
                        type === t ? 'border-primary bg-primary-subtle' : 'border-border-subtle hover:border-border-default',
                      )}
                    >
                      <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', type === t ? 'text-primary-text' : 'text-icon')} />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-fg">{CUSTOM_FIELD_TYPE_LABELS[t]}</span>
                        <span className="block text-2xs text-fg-muted">{FIELD_HELP[t]}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {hasOptions ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-secondary">Choices</span>
              <OptionsEditor options={options} onChange={setOptions} />
              {cleanOptions.length === 0 ? <span className="text-2xs text-fg-muted">Add at least one choice.</span> : null}
            </div>
          ) : null}
          {type === 'currency' ? (
            <Field label="Currency">
              {({ inputId }) => <Select id={inputId} value={currency} onValueChange={setCurrency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />}
            </Field>
          ) : null}
          <Field label="Help text" hint="Optional. Shown under the field so people know what to put in it.">
            {({ inputId, describedBy }) => <Input id={inputId} aria-describedby={describedBy} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />}
          </Field>
          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-border-subtle px-3 py-2.5">
            <span>
              <span className="block text-sm font-medium text-fg">Ask for it on every task</span>
              <span className="block text-xs text-fg-muted">Shows a reminder when it’s empty.</span>
            </span>
            <Switch checked={required} onCheckedChange={setRequired} aria-label="Required" />
          </label>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!valid} loading={saving} data-testid="save-field">
            {field ? 'Save field' : 'Add field'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CustomFieldsSettings({ highlight }: { readonly highlight?: boolean }) {
  const { project, capabilities } = useCurrentProject();
  const canEdit = capabilities['structure:manage'];
  const run = useSettingsRunner();
  const [editing, setEditing] = useState<CustomFieldDTO | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<CustomFieldDTO | null>(null);
  const fields = project.customFields;

  return (
    <SettingsSection
      id="fields"
      title="Custom fields"
      description="They show in the task panel and as Table columns."
      highlight={highlight}
      action={
        canEdit ? (
          <Button variant="secondary" size="sm" leadingIcon={<Plus aria-hidden />} onClick={() => setCreating(true)} data-testid="add-field">
            Add field
          </Button>
        ) : null
      }
    >
      {fields.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-default px-4 py-6 text-center">
          <ListChecks aria-hidden className="size-6 text-icon" />
          <p className="text-sm font-medium text-fg">No custom fields yet</p>
          <p className="max-w-sm text-xs text-fg-muted">Add fields like “Region”, “Cost” or “Client PO”.</p>
          {canEdit ? (
            <Button size="sm" className="mt-1" leadingIcon={<Plus aria-hidden />} onClick={() => setCreating(true)}>
              Add your first field
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border-subtle">
          {fields.map((field) => {
            const Icon = FIELD_ICONS[field.type];
            const shared = field.projectId === null;
            return (
              <li key={field.id} className="flex items-center gap-3 px-3 py-2.5" data-testid="field-row">
                <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-sunken text-icon">
                  <Icon aria-hidden className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm font-medium text-fg">
                    {field.name}
                    {field.required ? <Badge size="sm" tone="warning">Required</Badge> : null}
                    {shared ? <Badge size="sm">Every project</Badge> : null}
                  </p>
                  <p className="truncate text-xs text-fg-muted">
                    {CUSTOM_FIELD_TYPE_LABELS[field.type]}
                    {field.config.options?.length ? ` · ${field.config.options.map((o) => o.label).join(', ')}` : ''}
                    {field.type === 'currency' && field.config.currency ? ` · ${field.config.currency}` : ''}
                  </p>
                </div>
                {canEdit && !shared ? (
                  <>
                    <IconButton label={`Edit ${field.name}`} icon={<Pencil aria-hidden />} size="sm" onClick={() => setEditing(field)} />
                    <IconButton label={`Delete ${field.name}`} icon={<Trash2 aria-hidden />} size="sm" onClick={() => setDeleting(field)} />
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {creating ? <FieldDialog field={null} open={creating} onOpenChange={setCreating} /> : null}
      {editing ? <FieldDialog key={editing.id} field={editing} open onOpenChange={(open) => !open && setEditing(null)} /> : null}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete the field “${deleting?.name}”?`}
        description="Its values disappear from every task in this project. This can’t be undone."
        confirmLabel="Delete field"
        destructive
        onConfirm={() => {
          if (deleting) void run(deleteCustomFieldAction({ fieldId: deleting.id }), `Deleted ${deleting.name}`);
          setDeleting(null);
        }}
      />
    </SettingsSection>
  );
}
