'use client';
/**
 * Settings sections that manage lists: sites, job types and the catalogs (clients and items).
 * Each has add and edit in a dialog, delete with a confirm (or an Undo toast where the row can be
 * brought back), a teaching empty state and a retry when loading fails.
 */
import { useState, type ReactNode } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Boxes, Building2, Pencil, Plus, Shapes, Star, Trash2, Users } from 'lucide-react';
import { Badge, Button, ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, Field, IconButton, Input, SearchInput, Select, Skeleton, Textarea, toast } from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { Teach } from '@/components/pulse/teach';
import { PRICING_MODEL_LABELS, PRICING_MODEL_VALUES } from '@/lib/constants';
import { formatUnitPrice } from '@/lib/format';
import { useClients, useItems, useJobTypes, useLaborClasses, useSites } from '@/lib/hooks/use-data';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import type { ClientDTO, ItemDTO, JobTypeDTO, SiteDTO } from '@/lib/types';
import type { ActionResult } from '@/server/actions/_action';
import { createClientAction, createItemAction, createJobTypeAction, deleteClientAction, deleteItemAction, deleteJobTypeAction, restoreClientAction, updateClientAction, updateItemAction, updateJobTypeAction } from '@/server/actions/catalog';
import { createSiteAction, deleteSiteAction, updateSiteAction } from '@/server/actions/settings';
import { timeZoneOptions } from './forms';

const NONE = '__none__';

/** Runs a server action, toasts a failure in plain words and refreshes the lists it touched. */
function useRun(invalidate: readonly QueryKey[]) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const run = async <T,>(call: () => Promise<ActionResult<T>>, failed: string): Promise<{ data: T } | { fields: Readonly<Record<string, string>>; message: string }> => {
    setPending(true);
    try {
      const result = await call();
      if (!result.ok) {
        toast.error(failed, result.error.message);
        return { fields: result.error.fields ?? {}, message: result.error.message };
      }
      for (const key of invalidate) await queryClient.invalidateQueries({ queryKey: key });
      return { data: result.data };
    } catch {
      toast.error(failed, 'Check your connection and try again.');
      return { fields: {}, message: 'Check your connection and try again.' };
    } finally {
      setPending(false);
    }
  };
  return { run, pending };
}

function LoadFailed({ what, onRetry }: { readonly what: string; readonly onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-8 text-center" role="alert">
      <p className="text-sm text-fg-secondary">We could not load {what}. Check your connection and try again.</p>
      <Button variant="secondary" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

function RowShell({ children, testId }: { readonly children: ReactNode; readonly testId?: string }) {
  return (
    <li data-testid={testId} className="flex flex-wrap items-center gap-3 px-4 py-3">
      {children}
    </li>
  );
}

const percentText = (bp: number | null | undefined): string => (bp === null || bp === undefined ? '' : String(bp / 100));
const percentBp = (text: string): number | null | undefined => {
  const clean = text.trim();
  if (clean === '') return null;
  return /^-?\d+(\.\d{1,2})?$/.test(clean) ? Math.round(Number(clean) * 100) : undefined;
};

/* ------------------------------------------------------------------------------------------ */
/* Sites                                                                                       */
/* ------------------------------------------------------------------------------------------ */

export function SitesSection({ canEdit }: { readonly canEdit: boolean }) {
  const sites = useSites();
  const { run, pending } = useRun([qk.sites()]);
  const [editing, setEditing] = useState<SiteDTO | 'new' | null>(null);
  const [removing, setRemoving] = useState<SiteDTO | null>(null);
  const [form, setForm] = useState({ name: '', code: '', timezone: 'America/Chicago' });
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});

  const open = (site: SiteDTO | 'new'): void => {
    let zone = 'America/Chicago';
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone || zone;
    } catch {
      // keep the fallback
    }
    setForm(site === 'new' ? { name: '', code: '', timezone: zone } : { name: site.name, code: site.code, timezone: site.timezone });
    setErrors({});
    setEditing(site);
  };

  const save = async (): Promise<void> => {
    if (form.name.trim() === '') {
      setErrors({ name: 'Give the site a name.' });
      return;
    }
    const input = { name: form.name.trim(), code: form.code.trim() || null, timezone: form.timezone };
    const result = editing === 'new' ? await run(() => createSiteAction(input), 'Could not add the site') : await run(() => updateSiteAction({ siteId: (editing as SiteDTO).id, patch: input }), 'Could not save the site');
    if ('data' in result) {
      toast.success(editing === 'new' ? 'Site added' : 'Site saved');
      setEditing(null);
    } else setErrors(result.fields);
  };

  const list = sites.data ?? [];
  return (
    <Panel
      title="Sites"
      bodyClassName="p-0"
      action={
        canEdit ? (
          <Button size="sm" leadingIcon={<Plus aria-hidden className="size-4" />} onClick={() => open('new')} data-testid="site-add">
            Add a site
          </Button>
        ) : null
      }
    >
      <p className="border-b border-border-subtle px-4 py-3 text-sm text-fg-secondary">Each building or floor you run. A site has its own time zone, so &quot;today&quot; on the log is right for the people who work there.</p>
      {sites.isError ? (
        <LoadFailed what="your sites" onRetry={() => void sites.refetch()} />
      ) : sites.isLoading ? (
        <div className="p-4">
          <Skeleton height={96} />
        </div>
      ) : (
        <ul className="divide-y divide-border-subtle" data-testid="sites-list">
          {list.map((site) => (
            <RowShell key={site.id} testId={`site-${site.code}`}>
              <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-icon-strong">
                <Building2 className="size-[18px]" />
              </span>
              <div className="min-w-0 flex-1 basis-48">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                  {site.name}
                  {site.isDefault ? <Badge tone="primary">Main site</Badge> : null}
                  {site.archivedAt ? <Badge>Archived</Badge> : null}
                </p>
                <p className="text-xs text-fg-muted">
                  {site.code}, {site.timezone.replace(/_/g, ' ')}
                </p>
              </div>
              {canEdit ? (
                <div className="flex items-center gap-1">
                  {!site.isDefault && !site.archivedAt ? (
                    <Button size="sm" variant="ghost" leadingIcon={<Star aria-hidden className="size-3.5" />} disabled={pending} onClick={() => void run(() => updateSiteAction({ siteId: site.id, patch: { isDefault: true } }), 'Could not change the main site').then((result) => 'data' in result && toast.success(`${site.name} is now the main site`))}>
                      Make main
                    </Button>
                  ) : null}
                  <IconButton label={`Edit ${site.name}`} icon={<Pencil aria-hidden className="size-4" />} variant="ghost" size="sm" onClick={() => open(site)} data-testid={`site-edit-${site.code}`} />
                  {!site.isDefault ? (
                    <>
                      <IconButton label={site.archivedAt ? `Bring back ${site.name}` : `Archive ${site.name}`} icon={site.archivedAt ? <ArchiveRestore aria-hidden className="size-4" /> : <Archive aria-hidden className="size-4" />}
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => void run(() => updateSiteAction({ siteId: site.id, patch: { archived: !site.archivedAt } }), 'Could not change the site').then((result) => 'data' in result && toast.success(site.archivedAt ? 'Site brought back' : 'Site archived'))}
                       />
                      <IconButton label={`Delete ${site.name}`} icon={<Trash2 aria-hidden className="size-4" />} variant="ghost" size="sm" onClick={() => setRemoving(site)} data-testid={`site-delete-${site.code}`} />
                    </>
                  ) : null}
                </div>
              ) : null}
            </RowShell>
          ))}
        </ul>
      )}
      <Dialog open={editing !== null} onOpenChange={(next) => !next && setEditing(null)}>
        <DialogContent size="sm" data-testid="site-dialog">
          <DialogHeader title={editing === 'new' ? 'Add a site' : 'Edit site'} />
          <DialogBody>
            <form
              id="site-form"
              className="flex flex-col gap-4 pb-2"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <Field label="Name" required error={errors.name ?? null}>
                {({ inputId, invalid }) => <Input id={inputId} invalid={invalid} autoFocus value={form.name} maxLength={120} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="North dock" data-testid="site-name" />}
              </Field>
              <Field label="Short code" hint="Used in files and reports. Leave it empty and Pulse makes one." error={errors.code ?? null}>
                {({ inputId, invalid }) => <Input id={inputId} invalid={invalid} value={form.code} maxLength={40} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="NORTH" data-testid="site-code" />}
              </Field>
              <Field label="Time zone" error={errors.timezone ?? null}>
                {({ inputId }) => <Select id={inputId} value={form.timezone} onValueChange={(timezone) => setForm({ ...form, timezone })} options={timeZoneOptions(form.timezone)} />}
              </Field>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit" form="site-form" loading={pending} data-testid="site-save">
              {editing === 'new' ? 'Add site' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => !next && setRemoving(null)}
        title={`Delete ${removing?.name ?? 'this site'}?`}
        description="A site with jobs or logged work cannot be deleted. Archive it instead to hide it from new work."
        confirmLabel="Delete site"
        destructive
        loading={pending}
        onConfirm={() =>
          void run(() => deleteSiteAction({ siteId: (removing as SiteDTO).id }), 'Could not delete the site').then((result) => {
            if ('data' in result) toast.success('Site deleted');
            setRemoving(null);
          })
        }
      />
    </Panel>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Job types                                                                                   */
/* ------------------------------------------------------------------------------------------ */

export function JobTypesSection({ canEdit }: { readonly canEdit: boolean }) {
  const types = useJobTypes({ includeArchived: true });
  const classes = useLaborClasses({});
  const { run, pending } = useRun([['job-types']]);
  const [editing, setEditing] = useState<JobTypeDTO | 'new' | null>(null);
  const [removing, setRemoving] = useState<JobTypeDTO | null>(null);
  const [form, setForm] = useState({ name: '', code: '', unitLabel: 'units', pricing: 'per_unit', laborClassId: NONE, pace: '', margin: '' });
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});

  const open = (type: JobTypeDTO | 'new'): void => {
    setForm(
      type === 'new'
        ? { name: '', code: '', unitLabel: 'units', pricing: 'per_unit', laborClassId: NONE, pace: '', margin: '' }
        : { name: type.name, code: type.code, unitLabel: type.unitLabel, pricing: type.defaultPricingModel, laborClassId: type.defaultLaborClassId ?? NONE, pace: type.defaultStandardUph ? String(Number(type.defaultStandardUph)) : '', margin: percentText(type.targetMarginBp) },
    );
    setErrors({});
    setEditing(type);
  };

  const save = async (): Promise<void> => {
    const problems: Record<string, string> = {};
    if (form.name.trim() === '') problems.name = 'Give the job type a name.';
    const margin = percentBp(form.margin);
    if (margin === undefined) problems.targetMarginBp = 'Type a percent, like 30.';
    if (form.pace.trim() !== '' && !(Number(form.pace) > 0)) problems.defaultStandardUph = 'Type a pace above zero.';
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;
    const input = {
      name: form.name.trim(),
      code: form.code.trim() || null,
      unitLabel: form.unitLabel.trim() || 'units',
      defaultPricingModel: form.pricing as JobTypeDTO['defaultPricingModel'],
      defaultLaborClassId: form.laborClassId === NONE ? null : form.laborClassId,
      defaultStandardUph: form.pace.trim() === '' ? null : form.pace.trim(),
      targetMarginBp: margin ?? null,
    };
    const result = editing === 'new' ? await run(() => createJobTypeAction(input), 'Could not add the job type') : await run(() => updateJobTypeAction({ jobTypeId: (editing as JobTypeDTO).id, patch: input }), 'Could not save the job type');
    if ('data' in result) {
      toast.success(editing === 'new' ? 'Job type added' : 'Job type saved');
      setEditing(null);
    } else setErrors(result.fields);
  };

  const list = types.data ?? [];
  const className = (id: string | null): string | null => (id ? ((classes.data ?? []).find((item) => item.id === id)?.name ?? null) : null);
  return (
    <Panel
      title="Job types"
      bodyClassName="p-0"
      action={
        canEdit ? (
          <Button size="sm" leadingIcon={<Plus aria-hidden className="size-4" />} onClick={() => open('new')} data-testid="job-type-add">
            Add a job type
          </Button>
        ) : null
      }
    >
      <p className="border-b border-border-subtle px-4 py-3 text-sm text-fg-secondary">The kinds of work you do, like kitting, relabeling or returns. A job type gives a new job its unit word, its usual pricing and its target margin, and lets you compare profit by kind of work.</p>
      {types.isError ? (
        <LoadFailed what="your job types" onRetry={() => void types.refetch()} />
      ) : types.isLoading ? (
        <div className="p-4">
          <Skeleton height={96} />
        </div>
      ) : list.length === 0 ? (
        <Teach size="sm" icon={Shapes} title="No job types yet" why="Add the kinds of work you do so you can see which kind earns the most." actions={canEdit ? <Button onClick={() => open('new')}>Add a job type</Button> : null} />
      ) : (
        <ul className="divide-y divide-border-subtle" data-testid="job-types-list">
          {list.map((type) => (
            <RowShell key={type.id} testId={`job-type-${type.code}`}>
              <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-icon-strong">
                <Shapes className="size-[18px]" />
              </span>
              <div className="min-w-0 flex-1 basis-48">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                  {type.name}
                  {type.isBuiltin ? <Badge>Built in</Badge> : null}
                  {type.archivedAt ? <Badge>Archived</Badge> : null}
                </p>
                <p className="text-xs text-fg-muted">
                  {[type.code, `counts ${type.unitLabel}`, PRICING_MODEL_LABELS[type.defaultPricingModel], type.targetMarginBp !== null ? `target margin ${percentText(type.targetMarginBp)}%` : null, type.defaultStandardUph ? `target pace ${Number(type.defaultStandardUph)}` : null, className(type.defaultLaborClassId)].filter(Boolean).join(', ')}
                </p>
              </div>
              {canEdit ? (
                <div className="flex items-center gap-1">
                  <IconButton label={`Edit ${type.name}`} icon={<Pencil aria-hidden className="size-4" />} variant="ghost" size="sm" onClick={() => open(type)} data-testid={`job-type-edit-${type.code}`} />
                  {!type.isBuiltin ? (
                    <>
                      <IconButton label={type.archivedAt ? `Bring back ${type.name}` : `Archive ${type.name}`} icon={type.archivedAt ? <ArchiveRestore aria-hidden className="size-4" /> : <Archive aria-hidden className="size-4" />}
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => void run(() => updateJobTypeAction({ jobTypeId: type.id, patch: { archived: !type.archivedAt } }), 'Could not change the job type').then((result) => 'data' in result && toast.success(type.archivedAt ? 'Job type brought back' : 'Job type archived'))}
                       />
                      <IconButton label={`Delete ${type.name}`} icon={<Trash2 aria-hidden className="size-4" />} variant="ghost" size="sm" onClick={() => setRemoving(type)} data-testid={`job-type-delete-${type.code}`} />
                    </>
                  ) : null}
                </div>
              ) : null}
            </RowShell>
          ))}
        </ul>
      )}
      <Dialog open={editing !== null} onOpenChange={(next) => !next && setEditing(null)}>
        <DialogContent size="md" data-testid="job-type-dialog">
          <DialogHeader title={editing === 'new' ? 'Add a job type' : 'Edit job type'} />
          <DialogBody>
            <form
              id="job-type-form"
              className="grid gap-4 pb-2 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <Field label="Name" required error={errors.name ?? null}>
                {({ inputId, invalid }) => <Input id={inputId} invalid={invalid} autoFocus value={form.name} maxLength={120} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Kitting" data-testid="job-type-name" />}
              </Field>
              <Field label="Short code" hint="Leave it empty and Pulse makes one." error={errors.code ?? null}>
                {({ inputId, invalid }) => <Input id={inputId} invalid={invalid} value={form.code} maxLength={40} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="KIT" />}
              </Field>
              <Field label="What one unit is called" hint="Like kits, cases or pallets." error={errors.unitLabel ?? null}>
                {({ inputId }) => <Input id={inputId} value={form.unitLabel} maxLength={30} onChange={(event) => setForm({ ...form, unitLabel: event.target.value })} />}
              </Field>
              <Field label="Usual pricing">
                {({ inputId }) => <Select id={inputId} value={form.pricing} onValueChange={(pricing) => setForm({ ...form, pricing })} options={PRICING_MODEL_VALUES.map((value) => ({ value, label: PRICING_MODEL_LABELS[value] }))} />}
              </Field>
              <Field label="Usual labor class" hint="Who normally does this work.">
                {({ inputId }) => <Select id={inputId} value={form.laborClassId} onValueChange={(laborClassId) => setForm({ ...form, laborClassId })} options={[{ value: NONE, label: 'No usual class' }, ...(classes.data ?? []).map((item) => ({ value: item.id, label: item.name }))]} />}
              </Field>
              <Field label="Target pace" hint="Units one person finishes in an hour." error={errors.defaultStandardUph ?? null}>
                {({ inputId, invalid }) => <Input id={inputId} invalid={invalid} inputMode="decimal" value={form.pace} onChange={(event) => setForm({ ...form, pace: event.target.value })} placeholder="40" />}
              </Field>
              <Field label="Target margin" hint="Leave it empty to use the company target." error={errors.targetMarginBp ?? null}>
                {({ inputId, invalid }) => <Input id={inputId} invalid={invalid} inputMode="decimal" value={form.margin} onChange={(event) => setForm({ ...form, margin: event.target.value })} trailing={<span className="text-sm text-fg-muted">%</span>} placeholder="30" />}
              </Field>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit" form="job-type-form" loading={pending} data-testid="job-type-save">
              {editing === 'new' ? 'Add job type' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => !next && setRemoving(null)}
        title={`Delete ${removing?.name ?? 'this job type'}?`}
        description="A job type that jobs still use cannot be deleted. Archive it instead to keep it off new jobs."
        confirmLabel="Delete job type"
        destructive
        loading={pending}
        onConfirm={() =>
          void run(() => deleteJobTypeAction({ jobTypeId: (removing as JobTypeDTO).id }), 'Could not delete the job type').then((result) => {
            if ('data' in result) toast.success('Job type deleted');
            setRemoving(null);
          })
        }
      />
    </Panel>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Catalogs: clients and items                                                                 */
/* ------------------------------------------------------------------------------------------ */

function ClientsCatalog({ canEdit }: { readonly canEdit: boolean }) {
  const [q, setQ] = useState('');
  const clients = useClients({ q: q.trim() || undefined });
  const { run, pending } = useRun([['clients']]);
  const [editing, setEditing] = useState<ClientDTO | 'new' | null>(null);
  const [form, setForm] = useState({ name: '', code: '', contactName: '', contactEmail: '', phone: '', margin: '', terms: '', partsOwner: NONE, status: 'active', notes: '' });
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  /** The typed name the server said looks like a client you have. While it stands, "Add as a new client" shows. */
  const [lookAlike, setLookAlike] = useState<string | null>(null);

  const open = (client: ClientDTO | 'new'): void => {
    setLookAlike(null);
    setForm(
      client === 'new'
        ? { name: '', code: '', contactName: '', contactEmail: '', phone: '', margin: '', terms: '', partsOwner: NONE, status: 'active', notes: '' }
        : { name: client.name, code: client.code, contactName: client.contactName ?? '', contactEmail: client.contactEmail ?? '', phone: client.phone ?? '', margin: percentText(client.targetMarginBp), terms: client.paymentTermsDays === null ? '' : String(client.paymentTermsDays), partsOwner: client.partsOwner ?? NONE, status: client.status, notes: client.notes ?? '' },
    );
    setErrors({});
    setEditing(client);
  };

  const save = async (confirmNew = false): Promise<void> => {
    const problems: Record<string, string> = {};
    if (form.name.trim() === '') problems.name = 'Give the client a name.';
    const margin = percentBp(form.margin);
    if (margin === undefined) problems.targetMarginBp = 'Type a percent, like 30.';
    if (form.terms.trim() !== '' && !/^\d{1,4}$/.test(form.terms.trim())) problems.paymentTermsDays = 'Type a number of days, like 30.';
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;
    const input = {
      name: form.name.trim(),
      code: form.code.trim() || null,
      status: form.status as 'active' | 'inactive',
      contactName: form.contactName.trim() || null,
      contactEmail: form.contactEmail.trim() || null,
      phone: form.phone.trim() || null,
      targetMarginBp: margin ?? null,
      paymentTermsDays: form.terms.trim() === '' ? null : Number(form.terms.trim()),
      partsOwner: form.partsOwner === NONE ? null : (form.partsOwner as 'us' | 'client'),
      notes: form.notes.trim() || null,
    };
    const result = editing === 'new' ? await run(() => createClientAction({ ...input, confirmNew }), 'Could not add the client') : await run(() => updateClientAction({ clientId: (editing as ClientDTO).id, patch: input, version: (editing as ClientDTO).version, confirmNew }), 'Could not save the client');
    if ('data' in result) {
      toast.success(editing === 'new' ? 'Client added' : 'Client saved');
      setEditing(null);
    } else {
      setErrors(result.fields);
      setLookAlike(result.fields.clientLookAlike ? form.name.trim() : null);
    }
  };

  const remove = async (client: ClientDTO): Promise<void> => {
    const result = await run(() => deleteClientAction({ clientId: client.id }), 'Could not delete the client');
    if ('data' in result) toast.undo(`Deleted ${client.name}`, { onUndo: async () => void (await run(() => restoreClientAction({ clientId: client.id }), 'Could not bring the client back')) });
  };

  const list = clients.data ?? [];
  return (
    <div data-testid="catalog-clients">
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-3">
        <div className="min-w-0 flex-1 basis-56">
          <SearchInput value={q} onValueChange={setQ} placeholder="Find a client" aria-label="Find a client" />
        </div>
        {canEdit ? (
          <Button size="sm" leadingIcon={<Plus aria-hidden className="size-4" />} onClick={() => open('new')} data-testid="client-add">
            Add a client
          </Button>
        ) : null}
      </div>
      {clients.isError ? (
        <LoadFailed what="your clients" onRetry={() => void clients.refetch()} />
      ) : clients.isLoading ? (
        <div className="p-4">
          <Skeleton height={120} />
        </div>
      ) : list.length === 0 ? (
        <Teach
          size="sm"
          icon={Users}
          title={q ? 'No client matches that' : 'No clients yet'}
          why={q ? 'Try a shorter word, or clear the search.' : 'A client is a company you do work for. Every job belongs to one, so profit can be added up by client.'}
          actions={canEdit && !q ? <Button onClick={() => open('new')}>Add a client</Button> : null}
        />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {list.map((client) => (
            <RowShell key={client.id} testId={`client-${client.code}`}>
              <div className="min-w-0 flex-1 basis-48">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                  {client.name}
                  {client.status === 'inactive' ? <Badge>Not active</Badge> : null}
                  {client.isSample ? <Badge tone="info">Sample</Badge> : null}
                </p>
                <p className="text-xs text-fg-muted">{[client.code, client.contactName, client.jobCount !== undefined ? `${client.jobCount} ${client.jobCount === 1 ? 'job' : 'jobs'}` : null, client.targetMarginBp !== null ? `target margin ${percentText(client.targetMarginBp)}%` : null].filter(Boolean).join(', ')}</p>
              </div>
              <div className="flex items-center gap-1">
                <ButtonLink href={routes.client(client.id)} size="sm" variant="ghost">
                  Open
                </ButtonLink>
                {canEdit ? (
                  <>
                    <IconButton label={`Edit ${client.name}`} icon={<Pencil aria-hidden className="size-4" />} variant="ghost" size="sm" onClick={() => open(client)} data-testid={`client-edit-${client.code}`} />
                    <IconButton label={`Delete ${client.name}`} icon={<Trash2 aria-hidden className="size-4" />} variant="ghost" size="sm" disabled={pending} onClick={() => void remove(client)} data-testid={`client-delete-${client.code}`} />
                  </>
                ) : null}
              </div>
            </RowShell>
          ))}
        </ul>
      )}
      <Dialog open={editing !== null} onOpenChange={(next) => !next && setEditing(null)}>
        <DialogContent size="md" data-testid="client-dialog">
          <DialogHeader title={editing === 'new' ? 'Add a client' : 'Edit client'} />
          <DialogBody>
            <form
              id="client-form"
              className="grid gap-4 pb-2 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <Field label="Name" required error={errors.name ?? null}>
                {({ inputId, invalid }) => <Input id={inputId} invalid={invalid} autoFocus value={form.name} maxLength={200} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Acme Outdoor Co" data-testid="client-name" />}
              </Field>
              <Field label="Short code" hint="Leave it empty and Pulse makes one." error={errors.code ?? null}>
                {({ inputId, invalid }) => <Input id={inputId} invalid={invalid} value={form.code} maxLength={40} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="ACME" data-testid="client-code" />}
              </Field>
              <Field label="Contact name" error={errors.contactName ?? null}>
                {({ inputId }) => <Input id={inputId} value={form.contactName} maxLength={200} onChange={(event) => setForm({ ...form, contactName: event.target.value })} />}
              </Field>
              <Field label="Contact email" error={errors.contactEmail ?? null}>
                {({ inputId, invalid }) => <Input id={inputId} invalid={invalid} type="email" value={form.contactEmail} maxLength={200} onChange={(event) => setForm({ ...form, contactEmail: event.target.value })} />}
              </Field>
              <Field label="Phone" error={errors.phone ?? null}>
                {({ inputId }) => <Input id={inputId} value={form.phone} maxLength={60} onChange={(event) => setForm({ ...form, phone: event.target.value })} />}
              </Field>
              <Field label="Status">
                {({ inputId }) => <Select id={inputId} value={form.status} onValueChange={(status) => setForm({ ...form, status })} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Not active' }]} />}
              </Field>
              <Field label="Target margin" hint="Leave it empty to use the company target." error={errors.targetMarginBp ?? null}>
                {({ inputId, invalid }) => <Input id={inputId} invalid={invalid} inputMode="decimal" value={form.margin} onChange={(event) => setForm({ ...form, margin: event.target.value })} trailing={<span className="text-sm text-fg-muted">%</span>} />}
              </Field>
              <Field label="Days to pay" hint="Like 30 for net 30." error={errors.paymentTermsDays ?? null}>
                {({ inputId, invalid }) => <Input id={inputId} invalid={invalid} inputMode="numeric" value={form.terms} onChange={(event) => setForm({ ...form, terms: event.target.value })} />}
              </Field>
              <Field label="Who buys the parts" className="sm:col-span-2">
                {({ inputId }) => (
                  <Select id={inputId} value={form.partsOwner} onValueChange={(partsOwner) => setForm({ ...form, partsOwner })} options={[{ value: NONE, label: 'Follow the company rule' }, { value: 'us', label: 'We do. Parts are our cost' }, { value: 'client', label: 'The client does. Parts cost us nothing' }]} />
                )}
              </Field>
              <Field label="Notes" className="sm:col-span-2" error={errors.notes ?? null}>
                {({ inputId }) => <Textarea id={inputId} rows={2} value={form.notes} maxLength={5000} onChange={(event) => setForm({ ...form, notes: event.target.value })} />}
              </Field>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            {editing !== null && lookAlike !== null && lookAlike === form.name.trim() ? (
              <Button variant="secondary" loading={pending} onClick={() => void save(true)} data-testid="client-save-new">
                {editing === 'new' ? 'Add as a new client' : 'Rename anyway'}
              </Button>
            ) : null}
            <Button type="submit" form="client-form" loading={pending} data-testid="client-save">
              {editing === 'new' ? 'Add client' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ItemsCatalog({ canEdit, seesMoney }: { readonly canEdit: boolean; readonly seesMoney: boolean }) {
  const [q, setQ] = useState('');
  const items = useItems({ q: q.trim() || undefined, limit: 200 });
  const clients = useClients({});
  const { run, pending } = useRun([['items']]);
  const [editing, setEditing] = useState<ItemDTO | 'new' | null>(null);
  const [removing, setRemoving] = useState<ItemDTO | null>(null);
  const [form, setForm] = useState({ sku: '', name: '', uom: 'each', unitCost: '', suppliedBy: NONE, clientId: NONE });
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});

  const open = (item: ItemDTO | 'new'): void => {
    setForm(item === 'new' ? { sku: '', name: '', uom: 'each', unitCost: '', suppliedBy: NONE, clientId: NONE } : { sku: item.sku, name: item.name, uom: item.uom, unitCost: item.unitCost ? String(Number(item.unitCost)) : '', suppliedBy: item.suppliedBy ?? NONE, clientId: item.clientId ?? NONE });
    setErrors({});
    setEditing(item);
  };

  const save = async (): Promise<void> => {
    const problems: Record<string, string> = {};
    if (form.sku.trim() === '') problems.sku = 'Give the item a SKU.';
    else if (/[\s,;]/.test(form.sku.trim())) problems.sku = 'A SKU cannot hold spaces, commas or semicolons.';
    if (form.name.trim() === '') problems.name = 'Give the item a name.';
    if (form.unitCost.trim() !== '' && !/^\d+(\.\d{1,4})?$/.test(form.unitCost.trim())) problems.unitCost = 'Type a cost, like 0.62.';
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;
    const input = {
      sku: form.sku.trim(),
      name: form.name.trim(),
      uom: form.uom.trim() || 'each',
      ...(seesMoney && form.unitCost.trim() !== '' ? { unitCost: form.unitCost.trim() } : {}),
      suppliedBy: form.suppliedBy === NONE ? null : (form.suppliedBy as 'us' | 'client'),
      clientId: form.clientId === NONE ? null : form.clientId,
    };
    const result = editing === 'new' ? await run(() => createItemAction(input), 'Could not add the item') : await run(() => updateItemAction({ itemId: (editing as ItemDTO).id, patch: input, version: (editing as ItemDTO).version }), 'Could not save the item');
    if ('data' in result) {
      toast.success(editing === 'new' ? 'Item added' : 'Item saved');
      setEditing(null);
    } else setErrors(result.fields);
  };

  const list = items.data ?? [];
  return (
    <div data-testid="catalog-items">
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-3">
        <div className="min-w-0 flex-1 basis-56">
          <SearchInput value={q} onValueChange={setQ} placeholder="Find an item" aria-label="Find an item" />
        </div>
        {canEdit ? (
          <Button size="sm" leadingIcon={<Plus aria-hidden className="size-4" />} onClick={() => open('new')} data-testid="item-add">
            Add an item
          </Button>
        ) : null}
      </div>
      {items.isError ? (
        <LoadFailed what="your items" onRetry={() => void items.refetch()} />
      ) : items.isLoading ? (
        <div className="p-4">
          <Skeleton height={120} />
        </div>
      ) : list.length === 0 ? (
        <Teach
          size="sm"
          icon={Boxes}
          title={q ? 'No item matches that' : 'No items yet'}
          why={q ? 'Try a shorter word, or clear the search.' : 'An item is a part or a material with a cost for one, like a box or a label. Material rows on a job use that cost, so you only type it once.'}
          actions={canEdit && !q ? <Button onClick={() => open('new')}>Add an item</Button> : null}
        />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {list.map((item) => (
            <RowShell key={item.id} testId={`item-${item.sku}`}>
              <div className="min-w-0 flex-1 basis-48">
                <p className="text-sm font-medium text-fg">{item.name}</p>
                <p className="text-xs text-fg-muted tabular-nums">
                  {[item.sku, item.unitCost !== null ? `${formatUnitPrice(item.unitCost)} for one ${item.uom}` : `counted by the ${item.uom}`, item.suppliedBy === 'client' ? 'the client supplies it' : item.suppliedBy === 'us' ? 'we buy it' : null].filter(Boolean).join(', ')}
                </p>
              </div>
              {canEdit ? (
                <div className="flex items-center gap-1">
                  <IconButton label={`Edit ${item.name}`} icon={<Pencil aria-hidden className="size-4" />} variant="ghost" size="sm" onClick={() => open(item)} data-testid={`item-edit-${item.sku}`} />
                  <IconButton label={`Delete ${item.name}`} icon={<Trash2 aria-hidden className="size-4" />} variant="ghost" size="sm" onClick={() => setRemoving(item)} data-testid={`item-delete-${item.sku}`} />
                </div>
              ) : null}
            </RowShell>
          ))}
        </ul>
      )}
      <Dialog open={editing !== null} onOpenChange={(next) => !next && setEditing(null)}>
        <DialogContent size="md" data-testid="item-dialog">
          <DialogHeader title={editing === 'new' ? 'Add an item' : 'Edit item'} />
          <DialogBody>
            <form
              id="item-form"
              className="grid gap-4 pb-2 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <Field label="SKU" required error={errors.sku ?? null}>
                {({ inputId, invalid }) => <Input id={inputId} invalid={invalid} autoFocus value={form.sku} maxLength={40} onChange={(event) => setForm({ ...form, sku: event.target.value })} placeholder="BOX-12X9" data-testid="item-sku" />}
              </Field>
              <Field label="Name" required error={errors.name ?? null}>
                {({ inputId, invalid }) => <Input id={inputId} invalid={invalid} value={form.name} maxLength={200} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Gift box 12 x 9" data-testid="item-name" />}
              </Field>
              <Field label="Counted by the" hint="Like each, sheet, roll or foot." error={errors.uom ?? null}>
                {({ inputId }) => <Input id={inputId} value={form.uom} maxLength={20} onChange={(event) => setForm({ ...form, uom: event.target.value })} />}
              </Field>
              {seesMoney ? (
                <Field label="Cost for one" hint="Up to 4 decimal places." error={errors.unitCost ?? null}>
                  {({ inputId, invalid }) => <Input id={inputId} invalid={invalid} inputMode="decimal" value={form.unitCost} onChange={(event) => setForm({ ...form, unitCost: event.target.value })} leadingIcon={<span className="text-sm text-fg-muted">$</span>} placeholder="0.62" data-testid="item-cost" />}
                </Field>
              ) : null}
              <Field label="Who supplies it">
                {({ inputId }) => <Select id={inputId} value={form.suppliedBy} onValueChange={(suppliedBy) => setForm({ ...form, suppliedBy })} options={[{ value: NONE, label: 'Follow the job' }, { value: 'us', label: 'We buy it' }, { value: 'client', label: 'The client supplies it' }]} />}
              </Field>
              <Field label="Only for one client">
                {({ inputId }) => <Select id={inputId} value={form.clientId} onValueChange={(clientId) => setForm({ ...form, clientId })} options={[{ value: NONE, label: 'Any client' }, ...(clients.data ?? []).map((client) => ({ value: client.id, label: client.name }))]} />}
              </Field>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit" form="item-form" loading={pending} data-testid="item-save">
              {editing === 'new' ? 'Add item' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => !next && setRemoving(null)}
        title={`Delete ${removing?.name ?? 'this item'}?`}
        description="Material rows that already used this item keep their own cost. New rows can no longer pick it."
        confirmLabel="Delete item"
        destructive
        loading={pending}
        onConfirm={() =>
          void run(() => deleteItemAction({ itemId: (removing as ItemDTO).id }), 'Could not delete the item').then((result) => {
            if ('data' in result) toast.success('Item deleted');
            setRemoving(null);
          })
        }
      />
    </div>
  );
}

export function CatalogsSection({ canEdit, seesMoney }: { readonly canEdit: boolean; readonly seesMoney: boolean }) {
  const [tab, setTab] = useState<'clients' | 'items'>('clients');
  return (
    <div className="flex flex-col gap-5">
      <Panel title="Catalogs" bodyClassName="p-0">
        <div role="tablist" aria-label="Which catalog" className="flex gap-1 border-b border-border-subtle px-3 pt-2">
          {(
            [
              ['clients', 'Clients'],
              ['items', 'Items'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              data-testid={`catalog-tab-${id}`}
              className={cn('-mb-px h-9 rounded-t-md border-b-2 px-3 text-sm font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus', tab === id ? 'border-primary text-fg' : 'border-transparent text-fg-secondary hover:text-fg')}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'clients' ? <ClientsCatalog canEdit={canEdit} /> : <ItemsCatalog canEdit={canEdit} seesMoney={seesMoney} />}
      </Panel>
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          { title: 'Extra services', detail: 'Labeling, shrink wrap and other add ons, with their price and target pace.', href: routes.services() },
          { title: 'Labor classes and rates', detail: 'Who does the work and what an hour of each really costs.', href: routes.labor('rates') },
        ].map((card) => (
          <div key={card.title} className="flex items-center justify-between gap-3 rounded-xl border border-border-subtle bg-panel px-4 py-3 shadow-xs">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-fg">{card.title}</p>
              <p className="text-sm text-fg-muted">{card.detail}</p>
            </div>
            <ButtonLink href={card.href} variant="secondary" size="sm">
              Open
            </ButtonLink>
          </div>
        ))}
      </div>
    </div>
  );
}
