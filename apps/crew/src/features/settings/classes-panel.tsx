'use client';
/** Labor classes (docs/crew/SPEC.md 5.1, standalone). Rows mirrored from Pulse are read only here. */
import { useState } from 'react';
import { Archive, Pencil, Plus } from 'lucide-react';
import { Panel } from '@/components/layout/page';
import { Badge, Button, Checkbox, ConfirmDialog, IconButton, Input, Select } from '@/components/ui';
import { archiveLaborClassAction, createLaborClassAction, updateLaborClassAction } from '@/server/actions/settings';
import type { LaborClassRow } from '@/server/domain/labor-classes';
import { useRun } from '@/features/people/bits';

const KIND_OPTIONS = [
  { value: 'employee', label: 'Employee' },
  { value: 'temp_agency', label: 'Temp agency' },
];

function ClassForm({ row, onDone }: { readonly row: LaborClassRow | null; readonly onDone: () => void }) {
  const { run, pending, fields } = useRun();
  const [code, setCode] = useState(row?.code ?? '');
  const [name, setName] = useState(row?.name ?? '');
  const [kind, setKind] = useState<'employee' | 'temp_agency'>(row?.kind ?? 'employee');
  const [isDefault, setIsDefault] = useState(row?.isDefault ?? false);
  return (
    <form
      className="flex flex-wrap items-center gap-2 py-1.5"
      onSubmit={async (event) => {
        event.preventDefault();
        const input = { code, name, kind, isDefault };
        const done = row ? await run('save', () => updateLaborClassAction({ ...input, classId: row.id }), { success: 'Labor class saved' }) : await run('save', () => createLaborClassAction(input), { success: 'Labor class added' });
        if (done) onDone();
      }}
    >
      <Input aria-label="Class code" placeholder="Code" value={code} invalid={Boolean(fields.code)} onChange={(event) => setCode(event.target.value)} containerClassName="w-28" data-testid="class-code" />
      <Input aria-label="Class name" placeholder="Name, like Temp packer" value={name} invalid={Boolean(fields.name)} onChange={(event) => setName(event.target.value)} containerClassName="w-56" data-testid="class-name" />
      <div className="w-40">
        <Select aria-label="Kind" value={kind} onValueChange={(value) => setKind(value === 'temp_agency' ? 'temp_agency' : 'employee')} options={KIND_OPTIONS} />
      </div>
      <Checkbox label="Default" checked={isDefault} onCheckedChange={(on) => setIsDefault(on === true)} />
      <Button type="submit" size="sm" variant="secondary" loading={pending === 'save'} disabled={!code.trim() || !name.trim()} data-testid="class-save">
        {row ? 'Save' : 'Add class'}
      </Button>
      {row ? (
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      ) : null}
    </form>
  );
}

function ClassLine({ row }: { readonly row: LaborClassRow }) {
  const { run, pending } = useRun();
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  if (editing) return <ClassForm row={row} onDone={() => setEditing(false)} />;
  return (
    <li className="flex items-center gap-2 py-1.5" data-testid="class-row">
      <span className="w-24 font-mono text-xs text-fg-secondary">{row.code}</span>
      <span className="flex-1 text-sm text-fg">{row.name}</span>
      <Badge tone="outline">{row.kind === 'temp_agency' ? 'Temp agency' : 'Employee'}</Badge>
      {row.isDefault ? <Badge tone="info">Default</Badge> : null}
      {row.fromPulse ? <Badge tone="neutral">From Pulse, edit in Pulse</Badge> : null}
      <span className="w-20 text-right text-xs text-fg-muted tabular-nums">{row.peopleCount} people</span>
      {row.fromPulse ? null : (
        <>
          <IconButton label={`Edit ${row.name}`} icon={<Pencil aria-hidden />} size="sm" onClick={() => setEditing(true)} />
          <IconButton label={`Archive ${row.name}`} icon={<Archive aria-hidden />} size="sm" onClick={() => setArchiving(true)} />
        </>
      )}
      <ConfirmDialog open={archiving} onOpenChange={setArchiving} destructive title={`Archive ${row.name}?`} description="People in this class must move to another class first." confirmLabel="Archive" loading={pending === 'archive'} onConfirm={async () => { if (await run('archive', () => archiveLaborClassAction({ classId: row.id }), { success: 'Labor class archived' })) setArchiving(false); }} />
    </li>
  );
}

export function ClassesPanel({ classes }: { readonly classes: readonly LaborClassRow[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <Panel
      title="Labor classes"
      action={
        adding ? null : (
          <Button size="sm" variant="secondary" leadingIcon={<Plus aria-hidden />} onClick={() => setAdding(true)} data-testid="add-class">
            Add class
          </Button>
        )
      }
    >
      <p className="mb-2 text-sm text-fg-secondary">Groups like Employee and Temp packer. When Pulse is set up, Pulse owns these and Crew shows them read only.</p>
      <ul className="divide-y divide-border-subtle" data-testid="settings-classes">
        {classes.map((row) => (
          <ClassLine key={row.id} row={row} />
        ))}
      </ul>
      {classes.length === 0 && !adding ? <p className="text-sm text-fg-muted">No labor classes yet.</p> : null}
      {adding ? <ClassForm row={null} onDone={() => setAdding(false)} /> : null}
    </Panel>
  );
}
