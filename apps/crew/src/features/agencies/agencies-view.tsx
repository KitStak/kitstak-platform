'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Building2, Plus } from 'lucide-react';
import { Panel } from '@/components/layout/page';
import { Teach } from '@/components/crew/teach';
import { Badge, Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, Field, Input, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui';
import { createAgencyAction } from '@/server/actions/agencies';
import type { AgencyRow } from '@/server/domain/agencies';
import { routes } from '@/lib/routes';
import { useRun } from '@/features/people/bits';

function AddAgency({ open, onOpenChange }: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { run, pending, fields } = useRun();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const save = async () => {
    const made = await run('add', () => createAgencyAction({ name, email: email || null, phone: phone || null }), { success: 'Agency added', refresh: false });
    if (made) router.push(routes.agency(made.id));
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader title="Add an agency" description="If this company is already a vendor (Ledger pays it), Crew marks the same vendor as an agency." />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <DialogBody className="flex flex-col gap-3">
            <Field label="Name" required error={fields.name ?? null}>
              {({ inputId, invalid }) => <Input id={inputId} invalid={invalid} value={name} onChange={(event) => setName(event.target.value)} autoFocus data-testid="agency-name" />}
            </Field>
            <Field label="Email" error={fields.email ?? null}>
              {({ inputId }) => <Input id={inputId} type="email" value={email} onChange={(event) => setEmail(event.target.value)} />}
            </Field>
            <Field label="Phone">
              {({ inputId }) => <Input id={inputId} type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />}
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" loading={pending === 'add'} data-testid="agency-save">
              Add agency
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AgenciesView({ agencies }: { readonly agencies: readonly AgencyRow[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button leadingIcon={<Plus aria-hidden />} onClick={() => setAdding(true)} data-testid="add-agency">
          Add agency
        </Button>
      </div>
      {agencies.length === 0 ? (
        <Panel>
          <Teach icon={Building2} title="No agencies yet" why="Add the agencies that send you temps. Then make an agency link so they type in their own people, or bring them in from a file." />
        </Panel>
      ) : (
        <Panel bodyClassName="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Agency</TableHeaderCell>
                <TableHeaderCell>Contact</TableHeaderCell>
                <TableHeaderCell numeric>Active people</TableHeaderCell>
                <TableHeaderCell>Waiting for you</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {agencies.map((agency) => (
                <TableRow key={agency.id} data-testid="agency-row">
                  <TableCell>
                    <Link href={routes.agency(agency.id)} className="font-medium text-fg-link hover:underline">
                      {agency.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-fg-secondary">{[agency.email, agency.phone].filter(Boolean).join(' · ')}</TableCell>
                  <TableCell numeric>{agency.activePeople}</TableCell>
                  <TableCell>{agency.pendingSubmissions > 0 ? <Badge tone="warning">{agency.pendingSubmissions} to accept</Badge> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      )}
      <AddAgency open={adding} onOpenChange={setAdding} />
    </div>
  );
}
