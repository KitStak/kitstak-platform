'use client';
/**
 * The public agency form (docs/crew/SPEC.md 6.1 `/join/a/[token]`): one row per person (name,
 * phone, email, agency id, start date, language), add rows, paste rows from a spreadsheet, submit.
 * Nothing else is asked: no tax ids, no birth dates.
 */
import { useState } from 'react';
import { CheckCircle2, ClipboardPaste, Plus, Send, Trash2 } from 'lucide-react';
import { Button, IconButton, Input, Select, Textarea } from '@/components/ui';
import { CrewMark } from '@/features/shell/logo';
import { parseCsv } from '@/lib/csv/parse';
import { parseDate } from '@/lib/csv/coerce';

interface Row {
  key: number;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  agencyRef: string;
  startDate: string;
  language: 'en' | 'es';
}

let nextKey = 1;
const blank = (): Row => ({ key: nextKey++, firstName: '', lastName: '', phone: '', email: '', agencyRef: '', startDate: '', language: 'en' });
const CHUNK = 50;

/** Rows pasted from a spreadsheet: first name, last name, phone, email, agency id, start date, language. A header row is skipped. */
export function rowsFromPaste(text: string): Row[] {
  const parsed = parseCsv(`first,last,phone,email,id,start,lang\n${text.trim()}`);
  return parsed.rows
    .filter((cells) => cells.some((cell) => cell.trim() !== ''))
    .filter((cells) => !/^first/i.test(cells[0]?.trim() ?? ''))
    .map((cells) => ({
      ...blank(),
      firstName: cells[0]?.trim() ?? '',
      lastName: cells[1]?.trim() ?? '',
      phone: cells[2]?.trim() ?? '',
      email: cells[3]?.trim() ?? '',
      agencyRef: cells[4]?.trim() ?? '',
      startDate: cells[5]?.trim() ?? '',
      language: /^(es|spanish|espa)/i.test(cells[6]?.trim() ?? '') ? 'es' : 'en',
    }));
}

export function AgencyJoinForm({ token, siteName, agencyName, remaining }: { readonly token: string; readonly siteName: string; readonly agencyName: string; readonly remaining: number }) {
  const [rows, setRows] = useState<Row[]>(() => [blank(), blank(), blank()]);
  const [paste, setPaste] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  const update = (key: number, patch: Partial<Row>) => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const filled = rows.filter((row) => row.firstName.trim() || row.lastName.trim());

  const submit = async () => {
    setError(null);
    if (filled.length === 0) {
      setError('Add at least one person with a first and last name.');
      return;
    }
    if (filled.length > remaining) {
      setError(`This link takes ${remaining} more ${remaining === 1 ? 'person' : 'people'}.`);
      return;
    }
    const out = [];
    for (const [index, row] of filled.entries()) {
      if (!row.firstName.trim() || !row.lastName.trim()) {
        setError(`Row ${index + 1}: type a first and a last name.`);
        return;
      }
      let startDate: string | null = null;
      if (row.startDate.trim()) {
        const read = parseDate(row.startDate.trim());
        if (!read.ok) {
          setError(`Row ${index + 1}: ${read.message}`);
          return;
        }
        startDate = read.value;
      }
      out.push({ firstName: row.firstName, lastName: row.lastName, phone: row.phone || null, email: row.email || null, agencyRef: row.agencyRef || null, startDate, language: row.language });
    }
    setSending(true);
    let total = 0;
    try {
      for (let at = 0; at < out.length; at += CHUNK) {
        const response = await fetch(`/api/v1/agency/${encodeURIComponent(token)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows: out.slice(at, at + CHUNK) }) });
        const body = (await response.json().catch(() => null)) as { data?: { received: number }; error?: { message: string } } | null;
        if (!response.ok || !body?.data) {
          setError(`${total > 0 ? `${total} people were sent. ` : ''}${body?.error?.message ?? 'That did not send. Try again.'}`);
          return;
        }
        total += body.data.received;
      }
      setSent(total);
    } catch {
      setError('No connection. Check your internet and try again.');
    } finally {
      setSending(false);
    }
  };

  const cell = (row: Row, key: keyof Omit<Row, 'key' | 'language'>, label: string, extra: { type?: string; placeholder?: string } = {}) => (
    <Input aria-label={label} type={extra.type ?? 'text'} placeholder={extra.placeholder} value={row[key]} onChange={(event) => update(row.key, { [key]: event.target.value })} />
  );

  return (
    <main className="min-h-dvh bg-app p-4 sm:p-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <header className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-sunken">
            <CrewMark size={28} />
          </span>
          <div>
            <h1 className="text-2xl font-semibold text-fg">Send your people to {siteName}</h1>
            <p className="text-sm text-fg-secondary">
              For {agencyName}. One row per person. This link takes up to {remaining} more {remaining === 1 ? 'person' : 'people'}.
            </p>
          </div>
        </header>
        {sent !== null ? (
          <div className="rounded-2xl border border-border-subtle bg-panel p-8 text-center" data-testid="join-sent">
            <CheckCircle2 aria-hidden className="mx-auto size-10 text-success" />
            <h2 className="mt-3 text-xl font-semibold text-fg">
              Thank you. {sent} {sent === 1 ? 'person was' : 'people were'} sent.
            </h2>
            <p className="mt-1 text-base text-fg-secondary">The site checks them and adds them. You can close this page.</p>
            <Button
              className="mt-4"
              variant="secondary"
              onClick={() => {
                setSent(null);
                setRows([blank(), blank(), blank()]);
              }}
            >
              Send more people
            </Button>
          </div>
        ) : (
          <section className="flex flex-col gap-3 rounded-2xl border border-border-subtle bg-panel p-4">
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" leadingIcon={<Plus aria-hidden />} onClick={() => setRows((current) => [...current, blank()])}>
                Add a row
              </Button>
              <Button variant="secondary" size="sm" leadingIcon={<ClipboardPaste aria-hidden />} onClick={() => setShowPaste((open) => !open)} data-testid="join-paste-toggle">
                Paste from a spreadsheet
              </Button>
            </div>
            {showPaste ? (
              <div className="flex flex-col gap-2 rounded-lg bg-sunken p-3">
                <p className="text-sm text-fg-secondary">Copy the rows from your spreadsheet in this order: first name, last name, phone, email, agency id, start date, language. Then paste them here.</p>
                <Textarea aria-label="Rows from a spreadsheet" rows={5} value={paste} onChange={(event) => setPaste(event.target.value)} data-testid="join-paste" />
                <div>
                  <Button
                    size="sm"
                    onClick={() => {
                      const added = rowsFromPaste(paste);
                      setRows((current) => [...current.filter((row) => row.firstName.trim() || row.lastName.trim()), ...added]);
                      setPaste('');
                      setShowPaste(false);
                    }}
                    data-testid="join-paste-add"
                  >
                    Add these rows
                  </Button>
                </div>
              </div>
            ) : null}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-separate border-spacing-y-1.5 text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium text-fg-muted">
                    <th className="px-1">First name</th>
                    <th className="px-1">Last name</th>
                    <th className="px-1">Phone</th>
                    <th className="px-1">Email</th>
                    <th className="px-1">Your id for them</th>
                    <th className="px-1">Start date</th>
                    <th className="px-1">Language</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key} data-testid="join-row">
                      <td className="px-1">{cell(row, 'firstName', 'First name')}</td>
                      <td className="px-1">{cell(row, 'lastName', 'Last name')}</td>
                      <td className="px-1">{cell(row, 'phone', 'Phone', { type: 'tel' })}</td>
                      <td className="px-1">{cell(row, 'email', 'Email', { type: 'email' })}</td>
                      <td className="px-1">{cell(row, 'agencyRef', 'Your id for them')}</td>
                      <td className="px-1">{cell(row, 'startDate', 'Start date', { placeholder: '2026-12-01' })}</td>
                      <td className="w-32 px-1">
                        <Select aria-label="Language" value={row.language} onValueChange={(value) => update(row.key, { language: value === 'es' ? 'es' : 'en' })} options={[{ value: 'en', label: 'English' }, { value: 'es', label: 'Spanish' }]} />
                      </td>
                      <td className="px-1">
                        <IconButton label="Remove this row" icon={<Trash2 aria-hidden />} size="sm" onClick={() => setRows((current) => (current.length > 1 ? current.filter((entry) => entry.key !== row.key) : [blank()]))} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {error ? (
              <p role="alert" className="text-sm font-medium text-danger-text" data-testid="join-error">
                {error}
              </p>
            ) : null}
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-fg-muted">We only ask for these fields. Never send tax ids or birth dates here.</p>
              <Button leadingIcon={<Send aria-hidden />} loading={sending} onClick={() => void submit()} data-testid="join-submit">
                Send {filled.length > 0 ? filled.length : ''} {filled.length === 1 ? 'person' : 'people'}
              </Button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
