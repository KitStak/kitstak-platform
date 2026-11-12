import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq, inArray } from 'drizzle-orm';
import { desc } from '@/server/db/order';
import { getAppDb } from '@/server/api/db';
import { getSessionUser } from '@/server/auth/session';
import { can, loadPermissions } from '@/server/auth/permissions';
import { isPermissionKey } from '@/server/auth/permission-catalog';
import { files, importBatches, users } from '@/server/db/schema';
import { IMPORT_DEFINITIONS } from '@/server/imports';
import { PageHeader } from '@/components/layout/page-header';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { groupImports, importTitle, unavailableReason } from '@/components/integrations/imports-hub';
import { ImportsRecentList } from '@/components/integrations/imports-recent';

export const metadata: Metadata = { title: 'Data Import' };

const QA_FILE = /^ks-(crit|test)[-_]/i;

async function Hub() {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=%2Fimports');
  const db = await getAppDb();
  const grant = await loadPermissions(db, user);
  const allowed = IMPORT_DEFINITIONS.filter((d) => isPermissionKey(d.permission) && can(grant, d.permission));
  if (allowed.length === 0) redirect('/forbidden?from=%2Fimports');
  const titleByKey = new Map(allowed.map((d) => [d.key, d.title]));
  const recent = (
    await db
      .select({ b: importBatches, by: users.name, fileName: files.name })
      .from(importBatches)
      .leftJoin(users, eq(users.id, importBatches.uploadedBy))
      .leftJoin(files, eq(files.id, importBatches.fileId))
      .where(
        inArray(
          importBatches.importKey,
          allowed.map((d) => d.key),
        ),
      )
      .orderBy(desc(importBatches.createdAt))
      .limit(40)
  )
    // QA harness uploads (ks-crit-*, ks-test-*) are kept in the DB but not shown to buyers.
    .filter((r) => !QA_FILE.test(r.fileName ?? ''))
    .slice(0, 15);
  const groups = groupImports(
    allowed.map((d) => ({
      key: d.key,
      title: d.title,
      area: d.backLabel.replace(/^Go back to /, ''),
      href: d.backHref,
      configured: d.handler.configured,
      columns: d.templateColumns.length,
    })),
  );

  return (
    <div className="pb-8">
      <PageHeader
        breadcrumbs={[{ label: 'Data Import' }]}
        title="Data Import"
        helper="Bulk load or update data from Excel. Pick an entity, download its template, then upload. Every upload is validated row by row and kept in the history below."
      />
      <div className="grid gap-6 px-6 pt-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section aria-labelledby="entities" className="space-y-4">
          <h2 id="entities" className="text-sm font-semibold text-foreground">
            Importable entities
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {groups.map((g) => (
              <div key={g.area} className="rounded-lg border border-border bg-surface p-4">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold capitalize text-foreground">{g.area}</h3>
                  <Link href={g.href} className="text-xs text-primary hover:underline">
                    Open {g.area}
                  </Link>
                </div>
                <ul className="divide-y divide-border">
                  {g.items.map((it) => (
                    <li key={it.key} className="flex items-center justify-between gap-3 py-2">
                      {it.configured ? (
                        <Link
                          href={`/imports/${it.key}`}
                          className="min-w-0 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
                        >
                          {importTitle(it.title)}
                        </Link>
                      ) : (
                        <span className="min-w-0 text-sm font-medium text-faint" aria-disabled="true">
                          {importTitle(it.title)}
                        </span>
                      )}
                      <span className="flex shrink-0 items-center gap-2">
                        {it.configured ? (
                          <a
                            href={`/api/imports/${it.key}/template`}
                            className="text-xs text-secondary hover:text-foreground hover:underline"
                            aria-label={`Download template for ${importTitle(it.title)}`}
                          >
                            Template ({it.columns} cols)
                          </a>
                        ) : (
                          <Tooltip content={unavailableReason(it)}>
                            <span
                              tabIndex={0}
                              className="rounded-full bg-neutral-soft px-2 py-0.5 text-2xs text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            >
                              Coming soon
                            </span>
                          </Tooltip>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
        <section aria-labelledby="recent" className="space-y-3">
          <h2 id="recent" className="text-sm font-semibold text-foreground">
            Recent import jobs
          </h2>
          <ImportsRecentList
            rows={recent.map(({ b, by, fileName }) => ({
              id: b.id,
              importKey: b.importKey,
              title: titleByKey.get(b.importKey) ?? b.importKey,
              status: b.status,
              fileName: fileName ?? null,
              fileId: b.fileId,
              errorFileId: b.errorFileId,
              createdAt: b.createdAt,
              uploadedBy: by ?? null,
              successCount: b.successCount,
              errorCount: b.errorCount,
              masterRowCount: b.masterRowCount,
            }))}
          />
        </section>
      </div>
    </div>
  );
}

/** `/imports` — Data Import hub: every importable entity the user may load, plus recent jobs. */
export default function ImportsHubPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Hub />
    </Suspense>
  );
}
