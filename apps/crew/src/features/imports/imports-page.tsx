import 'server-only';
import Link from 'next/link';
import { FileSpreadsheet } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/crew/button-link';
import { Badge, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui';
import { BlockedPage } from '@/features/people/blocked';
import { getImportBatch, listImportBatches } from '@/server/domain/imports';
import { isDomainError } from '@/server/errors';
import { pageFor } from '@/server/page';
import { formatWhen } from '@/lib/dates';
import { arrivesIn } from '@/lib/pages';
import { routes } from '@/lib/routes';
import { ImportBatchView } from './import-batch';
import { ImportUpload } from './import-center';
import { BATCH_STATUS } from './words';

const LATER = [
  { name: 'Certifications', phase: 6 as const },
  { name: 'Skills', phase: 6 as const },
  { name: 'Time off balances', phase: 5 as const },
  { name: 'Plan inputs', phase: 7 as const },
];

/** `/import` (docs/crew/SPEC.md section 7): the People stream now, the other streams with their phases. */
export async function ImportsPage() {
  const { ctx, can, locked, access } = await pageFor('/import');
  if (locked) return null;
  if (!can('import:run')) return <BlockedPage title="Import" role={access.role} />;
  const batches = await listImportBatches(ctx);
  return (
    <Page
      title="Import"
      icon={<FileSpreadsheet aria-hidden className="size-6 text-icon" />}
      subtitle="Bring people in from a spreadsheet. Every row is checked first, with a plain message on the exact cell."
      actions={can('export:run') ? <ButtonLink href={routes.exportCenter()} variant="secondary">Export</ButtonLink> : null}
    >
      <div className="flex flex-col gap-4">
        <ImportUpload canSeePay={can('pay:manage')} canSeePrivate={access.canSeePrivate} />
        <Panel title="More files">
          <ul className="grid gap-2 sm:grid-cols-4">
            {LATER.map((stream) => (
              <li key={stream.name} className="rounded-lg border border-border-subtle bg-sunken p-3">
                <p className="text-sm font-medium text-fg">{stream.name}</p>
                <p className="text-xs text-fg-muted">{arrivesIn(stream.phase)}</p>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Past imports">
          {batches.length === 0 ? (
            <p className="text-sm text-fg-muted">No imports yet.</p>
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>File</TableHeaderCell>
                  <TableHeaderCell>State</TableHeaderCell>
                  <TableHeaderCell numeric>Rows</TableHeaderCell>
                  <TableHeaderCell numeric>New</TableHeaderCell>
                  <TableHeaderCell numeric>Changed</TableHeaderCell>
                  <TableHeaderCell numeric>Errors</TableHeaderCell>
                  <TableHeaderCell>Who and when</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {batches.map((batch) => (
                  <TableRow key={batch.id}>
                    <TableCell>
                      <Link href={routes.importBatch(batch.id)} className="font-medium text-fg-link hover:underline">
                        {batch.fileName ?? 'File'}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge tone={BATCH_STATUS[batch.status]?.tone ?? 'neutral'}>{BATCH_STATUS[batch.status]?.label ?? batch.status}</Badge>
                    </TableCell>
                    <TableCell numeric>{batch.totalRows}</TableCell>
                    <TableCell numeric>{batch.counts.create}</TableCell>
                    <TableCell numeric>{batch.counts.update}</TableCell>
                    <TableCell numeric>{batch.counts.error}</TableCell>
                    <TableCell className="text-fg-secondary">
                      {batch.createdByName} · {formatWhen(batch.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>
      </div>
    </Page>
  );
}

/** `/import/[batchId]`: one file, row by row, with commit, undo and PIN slips. */
export async function ImportBatchPage({ batchId }: { readonly batchId: string }) {
  const { ctx, can, locked, access } = await pageFor(routes.importBatch(batchId));
  if (locked) return null;
  if (!can('import:run')) return <BlockedPage title="Import" role={access.role} />;
  let detail;
  try {
    detail = await getImportBatch(ctx, batchId);
  } catch (error) {
    if (isDomainError(error) && error.code === 'NOT_FOUND') return <BlockedPage title="Import" role={access.role} />;
    throw error;
  }
  return (
    <Page title={detail.batch.fileName ?? 'Import'} breadcrumbs={[{ label: 'Import', href: routes.importCenter() }, { label: detail.batch.fileName ?? 'File' }]} icon={<FileSpreadsheet aria-hidden className="size-6 text-icon" />} subtitle="What was added, changed, left out and why.">
      <ImportBatchView detail={detail} />
    </Page>
  );
}
