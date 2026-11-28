'use client';
/**
 * The import center upload (docs/crew/SPEC.md section 7, the Pulse flow): the browser reads the
 * file, maps its headers by name, alias and close match, and sends raw rows in chunks. The server
 * checks every row. Templates come from the same column list the server reads.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, FileUp, ListChecks } from 'lucide-react';
import { Panel } from '@/components/layout/page';
import { Badge, Button, Checkbox, Select, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, toast } from '@/components/ui';
import { checkImportAction, createImportBatchAction } from '@/server/actions/imports';
import { CSV_LIMITS, parseCsv, type ParsedCsv } from '@/lib/csv/parse';
import { mapHeaders } from '@/lib/csv/headers';
import { toCsv } from '@/lib/csv/write';
import { peopleColumnsFor, type PeopleColumn } from '@/lib/csv/people';
import { routes } from '@/lib/routes';
import { NONE } from '@/features/people/bits';

const CHUNK = 500;

function download(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function sha256Hex(text: string): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

export function PeopleTemplateButtons({ columns }: { readonly columns: readonly PeopleColumn[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" size="sm" leadingIcon={<Download aria-hidden />} onClick={() => download('crew-people-template.csv', toCsv(columns.map((c) => c.key), [columns.map((c) => c.examples[0]), columns.map((c) => c.examples[1])]))} data-testid="people-template">
        Template
      </Button>
      <Button variant="secondary" size="sm" leadingIcon={<ListChecks aria-hidden />} onClick={() => download('crew-people-how-to-fill.csv', toCsv(['column', 'needed', 'what to put in it', 'example'], columns.map((c) => [c.key, c.required ? 'yes' : 'no', c.help, c.examples[0] || c.examples[1]])))}>
        How to fill it in
      </Button>
    </div>
  );
}

export function ImportUpload({ canSeePay, canSeePrivate }: { readonly canSeePay: boolean; readonly canSeePrivate: boolean }) {
  const router = useRouter();
  const columns = useMemo(() => peopleColumnsFor({ canSeePay, canSeePrivate }), [canSeePay, canSeePrivate]);
  const [file, setFile] = useState<{ name: string; size: number; text: string; parsed: ParsedCsv } | null>(null);
  const [mapping, setMapping] = useState<(string | null)[]>([]);
  const [makeNumbers, setMakeNumbers] = useState(true);
  const [makeAgencies, setMakeAgencies] = useState(true);
  const [skipBad, setSkipBad] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const read = async (picked: File | undefined) => {
    if (!picked) return;
    if (picked.size > CSV_LIMITS.maxBytes) {
      toast.error('That file is too big', 'Files can be up to 10 MB.');
      return;
    }
    const text = await picked.text();
    const parsed = parseCsv(text);
    const blocking = parsed.problems.find((problem) => problem.level === 'error');
    if (blocking) {
      toast.error('Crew could not read that file', blocking.message);
      return;
    }
    setFile({ name: picked.name, size: picked.size, text, parsed });
    setMapping(mapHeaders(parsed.headers, columns).columns);
  };

  const used = new Set(mapping.filter(Boolean));
  const missing = columns.filter((column) => column.required && !used.has(column.key));

  const start = async () => {
    if (!file) return;
    setBusy('Making the import');
    try {
      const made = await createImportBatchAction({ stream: 'people', fileName: file.name, fileSize: file.size, fileHash: await sha256Hex(file.text), delimiter: file.parsed.delimiter, headers: file.parsed.headers, columns: mapping, options: { makeNumbers, makeAgencies, mode: skipBad ? 'skip' : 'all' } });
      if (!made.ok) {
        toast.error('Could not start the import', made.error.message);
        return;
      }
      const rows = file.parsed.rows.map((cells, index) => ({ rowNumber: file.parsed.rowNumbers[index] ?? index + 2, cells }));
      for (let at = 0; at < rows.length; at += CHUNK) {
        setBusy(`Sending rows ${at + 1} to ${Math.min(at + CHUNK, rows.length)} of ${rows.length}`);
        const response = await fetch(`/api/v1/import/${made.data.id}/rows`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows: rows.slice(at, at + CHUNK) }) });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
          toast.error('Could not send the rows', body?.error?.message ?? 'Try again.');
          return;
        }
      }
      setBusy('Checking every row');
      const checked = await checkImportAction({ batchId: made.data.id });
      if (!checked.ok) {
        toast.error('Could not check the file', checked.error.message);
        return;
      }
      router.push(routes.importBatch(made.data.id));
    } finally {
      setBusy(null);
    }
  };

  const columnOptions = [{ value: NONE, label: 'Leave out' }, ...columns.map((column) => ({ value: column.key, label: `${column.label}${column.required ? ' (needed)' : ''}` }))];

  return (
    <Panel title="People" action={<PeopleTemplateButtons columns={columns} />}>
      <div className="flex flex-col gap-4" data-testid="import-people">
        <p className="text-sm text-fg-secondary">
          One row per person. Rows match by employee number, else by agency and agency person id. A blank cell keeps what Crew has. A file never sets a PIN: print PIN slips after you bring people in.
          {canSeePay ? '' : ' Pay columns are for payroll, so they are not in your template.'}
        </p>
        <label className="flex w-fit cursor-pointer items-center gap-2 rounded-md border border-dashed border-border-strong bg-sunken px-4 py-3 text-sm font-medium text-fg hover:bg-hover">
          <FileUp aria-hidden className="size-4" />
          {file ? `${file.name}: ${file.parsed.rows.length} rows` : 'Choose a CSV file'}
          <input type="file" accept=".csv,text/csv,.txt,text/plain" className="sr-only" onChange={(event) => void read(event.target.files?.[0])} data-testid="import-file" />
        </label>
        {file ? (
          <>
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Header in your file</TableHeaderCell>
                  <TableHeaderCell>First value</TableHeaderCell>
                  <TableHeaderCell>Goes into</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {file.parsed.headers.map((header, index) => (
                  <TableRow key={`${header}-${index}`}>
                    <TableCell className="font-medium">{header}</TableCell>
                    <TableCell className="text-fg-secondary">{file.parsed.rows[0]?.[index] ?? ''}</TableCell>
                    <TableCell className="w-72">
                      <Select
                        aria-label={`Column for ${header}`}
                        value={mapping[index] ?? NONE}
                        onValueChange={(value) => setMapping((current) => current.map((entry, at) => (at === index ? (value === NONE ? null : value) : entry === value ? null : entry)))}
                        options={columnOptions}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {missing.length > 0 ? <Badge tone="danger">Pick a header for: {missing.map((column) => column.label).join(', ')}</Badge> : null}
            <div className="flex flex-col gap-2">
              <Checkbox label="Make numbers for temps" description="A temp with no employee number gets the next one, like T-1001." checked={makeNumbers} onCheckedChange={(on) => setMakeNumbers(on === true)} />
              <Checkbox label="Make new agencies" description="An agency name Crew does not know yet is added as an agency." checked={makeAgencies} onCheckedChange={(on) => setMakeAgencies(on === true)} />
              <Checkbox label="Skip bad rows" description="Bring in the good rows and leave the rows with errors out. Off means all or nothing." checked={skipBad} onCheckedChange={(on) => setSkipBad(on === true)} />
            </div>
            <div className="flex items-center gap-3">
              <Button disabled={missing.length > 0 || busy !== null} loading={busy !== null} onClick={() => void start()} data-testid="import-check">
                Check the file
              </Button>
              {busy ? <span className="text-sm text-fg-secondary">{busy}</span> : null}
            </div>
          </>
        ) : null}
      </div>
    </Panel>
  );
}
