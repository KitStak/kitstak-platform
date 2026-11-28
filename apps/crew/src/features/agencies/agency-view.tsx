'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Archive, Check, Copy, Link2, X } from 'lucide-react';
import { Panel } from '@/components/layout/page';
import { Badge, Button, Checkbox, ConfirmDialog, Field, Input, Select, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, Textarea, toast } from '@/components/ui';
import { acceptSubmissionsAction, archiveAgencyAction, createAgencyLinkAction, rejectSubmissionsAction, revokeAgencyLinkAction, updateAgencyAction } from '@/server/actions/agencies';
import type { AgencyDetail } from '@/server/domain/agencies';
import { formatDate, formatWhen } from '@/lib/dates';
import { routes } from '@/lib/routes';
import { STATUS_LABELS, STATUS_TONE, useRun } from '@/features/people/bits';
import { PinSlipsButton } from '@/features/people/pin-slips';

function Contact({ detail }: { readonly detail: AgencyDetail }) {
  const router = useRouter();
  const { run, pending, fields } = useRun();
  const [name, setName] = useState(detail.agency.name);
  const [email, setEmail] = useState(detail.agency.email ?? '');
  const [phone, setPhone] = useState(detail.agency.phone ?? '');
  const [notes, setNotes] = useState(detail.agency.notes ?? '');
  const [archiving, setArchiving] = useState(false);
  return (
    <Panel title="Contact">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name" required error={fields.name ?? null}>
          {({ inputId, invalid }) => <Input id={inputId} invalid={invalid} value={name} onChange={(event) => setName(event.target.value)} />}
        </Field>
        <Field label="Email" error={fields.email ?? null}>
          {({ inputId, invalid }) => <Input id={inputId} invalid={invalid} type="email" value={email} onChange={(event) => setEmail(event.target.value)} />}
        </Field>
        <Field label="Phone">
          {({ inputId }) => <Input id={inputId} type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />}
        </Field>
        <Field label="Notes" className="sm:col-span-3">
          {({ inputId }) => <Textarea id={inputId} rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />}
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-fg-muted">
          {detail.agency.sharedWith.length > 0 ? `This company is also a ${detail.agency.sharedWith.join(', ').replace(/_/g, ' ')} vendor, so it stays when Crew stops using it.` : 'Only Crew uses this vendor.'}
        </p>
        <div className="flex gap-2">
          {detail.agency.canArchive ? (
            <Button variant="ghost" leadingIcon={<Archive aria-hidden />} onClick={() => setArchiving(true)}>
              Archive
            </Button>
          ) : null}
          <Button variant="secondary" loading={pending === 'save'} onClick={() => void run('save', () => updateAgencyAction({ vendorId: detail.agency.id, name, email: email || null, phone: phone || null, notes: notes || null }), { success: 'Saved' })}>
            Save
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        destructive
        title={`Archive ${detail.agency.name}?`}
        description="Its links stop working. People from it keep their history. You can only archive an agency nobody active comes from."
        confirmLabel="Archive"
        loading={pending === 'archive'}
        onConfirm={async () => {
          if (await run('archive', () => archiveAgencyAction({ vendorId: detail.agency.id }), { success: 'Agency archived', refresh: false })) router.push(routes.agencies());
        }}
      />
    </Panel>
  );
}

function Links({ detail }: { readonly detail: AgencyDetail }) {
  const { run, pending } = useRun();
  const [siteId, setSiteId] = useState(detail.sites[0]?.value ?? '');
  const [days, setDays] = useState('14');
  const [made, setMade] = useState<string | null>(null);
  const make = async () => {
    const link = await run('make', () => createAgencyLinkAction({ vendorId: detail.agency.id, siteId, days: Number(days) || 14 }), { success: 'Link made' });
    if (link) setMade(`${window.location.origin}/join/a/${link.token}`);
  };
  return (
    <Panel title="Agency links">
      <p className="mb-3 text-sm text-fg-secondary">Send a link to the agency. They type or paste their people, no login needed. Nobody becomes a person until you accept them below.</p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Site" className="w-56">
          {({ inputId }) => <Select id={inputId} value={siteId} onValueChange={setSiteId} options={detail.sites} />}
        </Field>
        <Field label="Days it works" className="w-32">
          {({ inputId }) => <Input id={inputId} inputMode="numeric" value={days} onChange={(event) => setDays(event.target.value.replace(/\D/g, '').slice(0, 2))} />}
        </Field>
        <Button leadingIcon={<Link2 aria-hidden />} disabled={!siteId} loading={pending === 'make'} onClick={() => void make()} data-testid="make-link">
          Make a link
        </Button>
      </div>
      {made ? (
        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-border-subtle bg-sunken p-3" data-testid="new-link">
          <p className="text-sm font-medium text-fg">Copy this link now. It shows only once.</p>
          <div className="flex gap-2">
            <Input readOnly value={made} aria-label="The new agency link" data-testid="new-link-url" onFocus={(event) => event.currentTarget.select()} />
            <Button
              variant="secondary"
              leadingIcon={<Copy aria-hidden />}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(made);
                  toast.success('Link copied');
                } catch {
                  toast.error('Could not copy', 'Select the link and copy it by hand.');
                }
              }}
            >
              Copy
            </Button>
          </div>
        </div>
      ) : null}
      {detail.links.length > 0 ? (
        <Table className="mt-4">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Link</TableHeaderCell>
              <TableHeaderCell>Site</TableHeaderCell>
              <TableHeaderCell>Ends</TableHeaderCell>
              <TableHeaderCell numeric>People sent</TableHeaderCell>
              <TableHeaderCell>State</TableHeaderCell>
              <TableHeaderCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {detail.links.map((link) => (
              <TableRow key={link.id}>
                <TableCell className="font-mono">{link.prefix}...</TableCell>
                <TableCell>{link.siteName}</TableCell>
                <TableCell className="tabular-nums">{formatWhen(link.expiresAt)}</TableCell>
                <TableCell numeric>
                  {link.used} of {link.maxPeople}
                </TableCell>
                <TableCell>
                  <Badge tone={link.state === 'open' ? 'success' : 'neutral'}>{link.state === 'open' ? 'Open' : link.state === 'expired' ? 'Ended' : 'Revoked'}</Badge>
                </TableCell>
                <TableCell>
                  {link.state === 'open' ? (
                    <Button size="sm" variant="ghost" loading={pending === link.id} onClick={() => void run(link.id, () => revokeAgencyLinkAction({ linkId: link.id }), { success: 'Link revoked' })}>
                      Revoke
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </Panel>
  );
}

function Submissions({ detail }: { readonly detail: AgencyDetail }) {
  const { run, pending } = useRun();
  const pending_ = detail.submissions.filter((row) => row.status === 'pending');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [accepted, setAccepted] = useState<readonly string[]>([]);
  if (pending_.length === 0 && accepted.length === 0) return null;
  const ids = [...picked];
  return (
    <Panel title={`Waiting for you (${pending_.length})`}>
      {accepted.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle bg-sunken p-3" data-testid="accepted-banner">
          <p className="text-sm text-fg">
            {accepted.length} {accepted.length === 1 ? 'person is' : 'people are'} in Crew now. Print their PIN slips for the time clock.
          </p>
          <PinSlipsButton personIds={accepted} variant="primary" />
        </div>
      ) : null}
      {pending_.length > 0 ? (
        <>
          <div className="mb-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              leadingIcon={<Check aria-hidden />}
              disabled={ids.length === 0}
              loading={pending === 'accept'}
              data-testid="accept-submissions"
              onClick={async () => {
                const done = await run('accept', () => acceptSubmissionsAction({ submissionIds: ids }), { success: `Accepted ${ids.length}` });
                if (done) {
                  setAccepted(done.personIds);
                  setPicked(new Set());
                }
              }}
            >
              Accept {ids.length > 0 ? ids.length : ''}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<X aria-hidden />}
              disabled={ids.length === 0}
              loading={pending === 'reject'}
              onClick={async () => {
                if (await run('reject', () => rejectSubmissionsAction({ submissionIds: ids }), { success: `Rejected ${ids.length}` })) setPicked(new Set());
              }}
            >
              Reject
            </Button>
          </div>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell className="w-10">
                  <Checkbox aria-label="Pick all" checked={pending_.every((row) => picked.has(row.id))} onCheckedChange={(on) => setPicked(on === true ? new Set(pending_.map((row) => row.id)) : new Set())} data-testid="pick-all-submissions" />
                </TableHeaderCell>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Agency id</TableHeaderCell>
                <TableHeaderCell>Start</TableHeaderCell>
                <TableHeaderCell>Phone</TableHeaderCell>
                <TableHeaderCell>Email</TableHeaderCell>
                <TableHeaderCell>Language</TableHeaderCell>
                <TableHeaderCell>Sent</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pending_.map((row) => (
                <TableRow key={row.id} data-testid="submission-row">
                  <TableCell>
                    <Checkbox
                      aria-label={`Pick ${row.firstName} ${row.lastName}`}
                      checked={picked.has(row.id)}
                      onCheckedChange={(on) =>
                        setPicked((current) => {
                          const next = new Set(current);
                          if (on === true) next.add(row.id);
                          else next.delete(row.id);
                          return next;
                        })
                      }
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    {row.firstName} {row.lastName}
                  </TableCell>
                  <TableCell>{row.agencyRef}</TableCell>
                  <TableCell className="tabular-nums">{formatDate(row.startDate)}</TableCell>
                  <TableCell>{row.phone}</TableCell>
                  <TableCell>{row.email}</TableCell>
                  <TableCell>{row.language === 'es' ? 'Spanish' : 'English'}</TableCell>
                  <TableCell className="tabular-nums text-fg-muted">{formatWhen(row.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      ) : null}
    </Panel>
  );
}

function People({ detail }: { readonly detail: AgencyDetail }) {
  const active = detail.people.filter((row) => row.status === 'active');
  return (
    <Panel title={`People from ${detail.agency.name}`} action={active.length > 0 ? <PinSlipsButton personIds={active.map((row) => row.id)} label="Print PIN slips for all active" /> : undefined}>
      {detail.people.length === 0 ? (
        <p className="text-sm text-fg-muted">Nobody from this agency yet.</p>
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Number</TableHeaderCell>
              <TableHeaderCell>Agency id</TableHeaderCell>
              <TableHeaderCell>Site</TableHeaderCell>
              <TableHeaderCell>Start</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {detail.people.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Link href={routes.person(row.id)} className="font-medium text-fg-link hover:underline">
                    {row.name}
                  </Link>
                </TableCell>
                <TableCell className="font-mono tabular-nums">{row.number}</TableCell>
                <TableCell>{row.agencyRef}</TableCell>
                <TableCell>{row.siteName}</TableCell>
                <TableCell className="tabular-nums">{formatDate(row.startDate)}</TableCell>
                <TableCell>
                  <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>{STATUS_LABELS[row.status] ?? row.status}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}

export function AgencyView({ detail }: { readonly detail: AgencyDetail }) {
  return (
    <div className="flex flex-col gap-4">
      <Submissions detail={detail} />
      <Links detail={detail} />
      <People detail={detail} />
      <Contact detail={detail} />
    </div>
  );
}
