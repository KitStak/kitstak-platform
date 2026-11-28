'use client';
/** Sites and areas (docs/crew/SPEC.md 5.1): code, name, time zone, week start, the default site, and each site's areas. */
import { useState } from 'react';
import { Archive, Pencil, Plus, Star } from 'lucide-react';
import { Panel } from '@/components/layout/page';
import { Badge, Button, Checkbox, ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, Field, IconButton, Input, Select } from '@/components/ui';
import { archiveAreaAction, archiveSiteAction, createAreaAction, createSiteAction, updateAreaAction, updateSiteAction } from '@/server/actions/settings';
import type { AreaRow, SiteRow } from '@/server/domain/sites';
import { useRun, WEEKDAYS } from '@/features/people/bits';

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'America/Chicago';
  }
}

function SiteDialog({ site, open, onOpenChange }: { readonly site: SiteRow | null; readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) {
  const { run, pending, fields } = useRun();
  const [code, setCode] = useState(site?.code ?? '');
  const [name, setName] = useState(site?.name ?? '');
  const [timezone, setTimezone] = useState(site?.timezone ?? browserZone());
  const [weekStart, setWeekStart] = useState(site?.weekStart ?? 0);
  const [isDefault, setIsDefault] = useState(site?.isDefault ?? false);
  const save = async () => {
    const input = { code, name, timezone, weekStart, isDefault };
    const done = site ? await run('save', () => updateSiteAction({ ...input, siteId: site.id, version: site.version }), { success: 'Site saved' }) : await run('save', () => createSiteAction(input), { success: 'Site added' });
    if (done) onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader title={site ? `Edit ${site.name}` : 'Add a site'} description="Today, the week and the time clock follow the site's time zone." />
        <DialogBody className="flex flex-col gap-3">
          <Field label="Code" required hint="Short, like MLT1." error={fields.code ?? null}>
            {({ inputId, invalid }) => <Input id={inputId} invalid={invalid} value={code} onChange={(event) => setCode(event.target.value)} data-testid="site-code" />}
          </Field>
          <Field label="Name" required error={fields.name ?? null}>
            {({ inputId, invalid }) => <Input id={inputId} invalid={invalid} value={name} onChange={(event) => setName(event.target.value)} data-testid="site-name" />}
          </Field>
          <Field label="Time zone" required error={fields.timezone ?? null}>
            {({ inputId, invalid }) => <Input id={inputId} invalid={invalid} value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="America/New_York" />}
          </Field>
          <Field label="Week starts on">
            {({ inputId }) => <Select id={inputId} value={String(weekStart)} onValueChange={(value) => setWeekStart(Number(value))} options={WEEKDAYS.map((day, index) => ({ value: String(index), label: day }))} />}
          </Field>
          <Checkbox label="Default site" description="New people start here." checked={isDefault} disabled={site?.isDefault} onCheckedChange={(on) => setIsDefault(on === true)} />
        </DialogBody>
        <DialogFooter>
          <Button loading={pending === 'save'} onClick={() => void save()} data-testid="site-save">
            {site ? 'Save' : 'Add site'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AreaLine({ area }: { readonly area: AreaRow }) {
  const { run, pending } = useRun();
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState(area.code);
  const [name, setName] = useState(area.name);
  const [archiving, setArchiving] = useState(false);
  if (editing) {
    return (
      <li className="flex flex-wrap items-center gap-2 py-1.5">
        <Input aria-label="Area code" value={code} onChange={(event) => setCode(event.target.value)} containerClassName="w-28" />
        <Input aria-label="Area name" value={name} onChange={(event) => setName(event.target.value)} containerClassName="w-56" />
        <Button size="sm" loading={pending === 'save'} onClick={async () => { if (await run('save', () => updateAreaAction({ areaId: area.id, code, name }), { success: 'Area saved' })) setEditing(false); }}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </li>
    );
  }
  return (
    <li className="flex items-center gap-2 py-1.5" data-testid="area-row">
      <span className="w-20 font-mono text-xs text-fg-secondary">{area.code}</span>
      <span className="flex-1 text-sm text-fg">{area.name}</span>
      <span className="text-xs text-fg-muted tabular-nums">{area.peopleCount} usual</span>
      <IconButton label={`Edit ${area.name}`} icon={<Pencil aria-hidden />} size="sm" onClick={() => setEditing(true)} />
      <IconButton label={`Archive ${area.name}`} icon={<Archive aria-hidden />} size="sm" onClick={() => setArchiving(true)} />
      <ConfirmDialog open={archiving} onOpenChange={setArchiving} destructive title={`Archive ${area.name}?`} description="Its code becomes free. People whose usual area it is must move first." confirmLabel="Archive" loading={pending === 'archive'} onConfirm={async () => { if (await run('archive', () => archiveAreaAction({ areaId: area.id }), { success: 'Area archived' })) setArchiving(false); }} />
    </li>
  );
}

function SiteCard({ site }: { readonly site: SiteRow }) {
  const { run, pending, fields } = useRun();
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  return (
    <li className="rounded-lg border border-border-subtle p-3" data-testid="site-card">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold text-fg">{site.code}</span>
        <span className="text-sm text-fg">{site.name}</span>
        {site.isDefault ? <Badge tone="info" icon={<Star aria-hidden className="size-3" />}>Default</Badge> : null}
        <span className="text-xs text-fg-muted">
          {site.timezone} · week starts {WEEKDAYS[site.weekStart]} · {site.peopleCount} {site.peopleCount === 1 ? 'person' : 'people'}
        </span>
        <span className="ml-auto flex gap-1">
          <IconButton label={`Edit ${site.name}`} icon={<Pencil aria-hidden />} size="sm" onClick={() => setEditing(true)} />
          {site.isDefault ? null : <IconButton label={`Archive ${site.name}`} icon={<Archive aria-hidden />} size="sm" onClick={() => setArchiving(true)} />}
        </span>
      </div>
      <ul className="mt-2 divide-y divide-border-subtle pl-2">
        {site.areas.map((area) => (
          <AreaLine key={area.id} area={area} />
        ))}
      </ul>
      <form
        className="mt-2 flex flex-wrap items-center gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          if (await run('area', () => createAreaAction({ siteId: site.id, code, name }), { success: 'Area added' })) {
            setCode('');
            setName('');
          }
        }}
      >
        <Input aria-label="New area code" placeholder="Code" value={code} invalid={Boolean(fields.code)} onChange={(event) => setCode(event.target.value)} containerClassName="w-28" />
        <Input aria-label="New area name" placeholder="Area name, like Kitting line 3" value={name} invalid={Boolean(fields.name)} onChange={(event) => setName(event.target.value)} containerClassName="w-64" />
        <Button type="submit" size="sm" variant="secondary" leadingIcon={<Plus aria-hidden />} loading={pending === 'area'} disabled={!code.trim() || !name.trim()}>
          Add area
        </Button>
      </form>
      {editing ? <SiteDialog site={site} open={editing} onOpenChange={setEditing} /> : null}
      <ConfirmDialog open={archiving} onOpenChange={setArchiving} destructive title={`Archive ${site.name}?`} description="Its code becomes free and it leaves every picker. People whose home site it is must move first." confirmLabel="Archive" loading={pending === 'archive'} onConfirm={async () => { if (await run('archive', () => archiveSiteAction({ siteId: site.id }), { success: 'Site archived' })) setArchiving(false); }} />
    </li>
  );
}

export function SitesPanel({ sites }: { readonly sites: readonly SiteRow[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <Panel
      title="Sites and areas"
      action={
        <Button size="sm" variant="secondary" leadingIcon={<Plus aria-hidden />} onClick={() => setAdding(true)} data-testid="add-site">
          Add site
        </Button>
      }
    >
      <ul className="flex flex-col gap-3" data-testid="settings-sites">
        {sites.map((site) => (
          <SiteCard key={`${site.id}-${site.version}`} site={site} />
        ))}
      </ul>
      {adding ? <SiteDialog site={null} open={adding} onOpenChange={setAdding} /> : null}
    </Panel>
  );
}
