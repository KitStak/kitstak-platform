'use client';
/**
 * Step 1 of an import (SPEC 7): pick what the file holds and the CSV file. The browser reads the
 * file as text and sends it to the check step; nothing is saved until the person commits.
 */
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileUp } from 'lucide-react';
import { Button, Field, Select, toast } from '@/components/ui';
import { apiPost } from '@/lib/api-client';
import { routes } from '@/lib/routes';

export interface StreamChoice {
  readonly id: string;
  readonly title: string;
  readonly file: string;
  readonly columns: readonly { readonly key: string; readonly required: boolean }[];
  readonly match: string;
}

const MAX_BYTES = 10 * 1024 * 1024;

export function ImportUpload({ streams, initialStream }: { readonly streams: readonly StreamChoice[]; readonly initialStream: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [stream, setStream] = useState<string>(initialStream ?? streams[0]?.id ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const chosen = streams.find((item) => item.id === stream);

  const check = () => {
    if (!file || !chosen) return;
    if (file.size > MAX_BYTES) {
      setProblem('This file is larger than 10 MB. Split it into smaller files.');
      return;
    }
    startTransition(async () => {
      try {
        const text = await file.text();
        const result = await apiPost<{ batchId: string }>('/api/v1/import', { stream, fileName: file.name, text });
        router.push(routes.importBatch(result.batchId));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'The file could not be checked.';
        setProblem(message);
        toast.error("Couldn't check the file", message);
      }
    });
  };

  return (
    <div className="flex flex-col gap-5" data-testid="import-upload">
      <Field label="What the file holds" required>
        {({ inputId }) => (
          <Select id={inputId} value={stream} onValueChange={setStream} options={streams.map((item) => ({ value: item.id, label: item.title }))} data-testid="import-stream" />
        )}
      </Field>
      {chosen ? (
        <div className="rounded-lg border border-border-subtle bg-sunken p-3 text-sm">
          <p className="text-fg">
            Columns of <span className="font-mono">{chosen.file}</span>, needed ones starred. QuickBooks export headers work too. Rows match {chosen.match.charAt(0).toLowerCase() + chosen.match.slice(1)}
          </p>
          <p className="mt-2 font-mono text-xs break-words text-fg-secondary">{chosen.columns.map((column) => `${column.key}${column.required ? '*' : ''}`).join(', ')}</p>
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          data-testid="import-file"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setProblem(null);
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" leadingIcon={<FileUp aria-hidden className="size-4" />} onClick={() => input.current?.click()}>
            {file ? 'Pick another file' : 'Pick a CSV file'}
          </Button>
          <span className="text-sm text-fg-secondary">{file ? file.name : 'No file picked yet'}</span>
        </div>
      </div>
      {problem ? (
        <p role="alert" className="rounded-md border border-danger bg-danger-subtle px-3 py-2 text-sm text-danger-text">
          {problem}
        </p>
      ) : null}
      <div>
        <Button onClick={check} loading={pending} disabled={!file || !chosen} data-testid="import-check">
          Check the rows
        </Button>
      </div>
    </div>
  );
}
