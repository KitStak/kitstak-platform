'use client';
/** The Pay tab (`pay:read`, docs/crew/SPEC.md 5.2): pay type, overtime exempt, dated wages and the "sent to Pulse" state. */
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Panel } from '@/components/layout/page';
import { Badge, Button, Checkbox, Field, IconButton, Input, IsoDatePicker, Select, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui';
import { removeWageAction, setPersonPayAction, setWageAction } from '@/server/actions/people';
import type { PersonDto } from '@/server/domain/people-dto';
import { formatDate } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { dollarsToCents, useRun } from './bits';

export function PersonPay({ person, canManage }: { readonly person: PersonDto; readonly canManage: boolean }) {
  const { run, pending } = useRun();
  const [payType, setPayType] = useState(person.payType ?? 'hourly');
  const [exempt, setExempt] = useState(person.overtimeExempt ?? false);
  const [from, setFrom] = useState<string | null>(null);
  const [wage, setWage] = useState('');
  const cents = dollarsToCents(wage);
  return (
    <div className="flex flex-col gap-4" data-testid="person-pay">
      <Panel title="Pay type">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Pay type" className="w-48">
            {({ inputId }) => <Select id={inputId} disabled={!canManage} value={payType} onValueChange={setPayType} options={[{ value: 'hourly', label: 'Hourly' }, { value: 'salary', label: 'Salary' }]} />}
          </Field>
          <div className="pb-1.5">
            <Checkbox disabled={!canManage} label="Overtime exempt" description="All their minutes count as regular." checked={exempt} onCheckedChange={(on) => setExempt(on === true)} />
          </div>
          {canManage ? (
            <Button variant="secondary" loading={pending === 'pay'} onClick={() => void run('pay', () => setPersonPayAction({ personId: person.id, payType: payType as 'hourly' | 'salary', overtimeExempt: exempt }), { success: 'Pay type saved' })}>
              Save
            </Button>
          ) : null}
        </div>
      </Panel>
      <Panel title="Wages">
        <p className="mb-3 text-sm text-fg-secondary">
          Crew uses a wage only for its own estimates when Pulse is not set up. The day Pulse is added, these move to Pulse and Pulse keeps the real cost of an hour.
        </p>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>From</TableHeaderCell>
              <TableHeaderCell numeric>Per hour</TableHeaderCell>
              <TableHeaderCell>Note</TableHeaderCell>
              <TableHeaderCell>Pulse</TableHeaderCell>
              <TableHeaderCell className="w-10" />
            </TableRow>
          </TableHead>
          <TableBody>
            {(person.wages ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-sm text-fg-muted">
                  No wage yet.
                </TableCell>
              </TableRow>
            ) : (
              (person.wages ?? []).map((row) => (
                <TableRow key={row.id} data-testid="wage-row">
                  <TableCell className="tabular-nums">{formatDate(row.effectiveFrom)}</TableCell>
                  <TableCell numeric>{formatCents(row.wageCents)}</TableCell>
                  <TableCell>{row.note}</TableCell>
                  <TableCell>{row.sentToPulseAt ? <Badge tone="info">Sent to Pulse</Badge> : <Badge tone="neutral">In Crew</Badge>}</TableCell>
                  <TableCell>
                    {canManage && !row.sentToPulseAt ? <IconButton label="Remove this wage" icon={<Trash2 aria-hidden />} size="sm" onClick={() => void run(`rm-${row.id}`, () => removeWageAction({ personId: person.id, wageId: row.id }), { success: 'Wage removed' })} /> : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {canManage ? (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <Field label="Starts on" className="w-48">
              {({ inputId }) => <IsoDatePicker id={inputId} value={from} onChange={setFrom} />}
            </Field>
            <Field label="Per hour" className="w-36" error={wage && cents === null ? 'Use dollars, like 19.50.' : null}>
              {({ inputId, invalid }) => <Input id={inputId} invalid={invalid} inputMode="decimal" placeholder="19.50" value={wage} onChange={(event) => setWage(event.target.value)} data-testid="wage-input" />}
            </Field>
            <Button
              variant="secondary"
              disabled={!from || cents === null}
              loading={pending === 'wage'}
              onClick={async () => {
                if (!from || cents === null) return;
                if (await run('wage', () => setWageAction({ personId: person.id, effectiveFrom: from, wageCents: cents }), { success: 'Wage added' })) setWage('');
              }}
            >
              Add wage
            </Button>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
