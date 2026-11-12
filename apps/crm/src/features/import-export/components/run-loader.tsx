'use client';
/**
 * `/import?run=<batchId>`: shows a past import's summary (and its Undo). Uses the run held in
 * this tab, then the session copy, then the server's audit-backed summary.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { EmptyState, Skeleton, buttonVariants } from '@/components/ui';
import { errorMessage, useOrgId } from '@/lib/hooks';
import { useOrg } from '@/features/shell/org-context';
import type { ImportRunSummary } from '@/server/services/import-export-contracts';
import { importApi } from '../api';
import { loadStoredRun, useRunStore, type ImportRun } from '../store';

export function runFromSummary(summary: ImportRunSummary, scope: string, orgId: string, orgSlug: string): ImportRun {
  return {
    batchId: summary.batchId,
    scope,
    orgId,
    orgSlug,
    boardId: summary.boardDeleted ? null : summary.boardId,
    boardName: summary.boardName,
    boardCreated: summary.boardCreated,
    schemaAdded: 0,
    fileName: summary.fileName,
    terminology: summary.itemTerminology,
    status: summary.undone ? 'undone' : 'done',
    total: summary.created + summary.updated + summary.failed,
    processed: summary.created + summary.updated + summary.failed,
    created: summary.created,
    updated: summary.updated,
    skipped: 0,
    linkedCreated: 0,
    failures: [],
    clientIssues: [],
    clientSkipped: 0,
    error: null,
    errorDetail: null,
    resumable: false,
    undo: summary.undone
      ? { ...summary.undone, removedColumns: 0, removedLabels: 0, boardDeleted: summary.boardDeleted }
      : null,
    startedAt: Date.parse(summary.startedAt),
    finishedAt: Date.parse(summary.finishedAt),
    cancelRequested: false,
  };
}

export function RunLoader({ scope, batchId }: { readonly scope: string; readonly batchId: string }) {
  const orgId = useOrgId();
  const { org } = useOrg();
  const attach = useRunStore((state) => state.attach);
  const inMemory = useRunStore((state) => state.runs[batchId]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (inMemory) {
      attach(scope, inMemory);
      return;
    }
    const stored = loadStoredRun(orgId, batchId);
    if (stored) {
      attach(scope, { ...stored, scope });
      return;
    }
    let cancelled = false;
    importApi(orgId)
      .run(batchId)
      .then((summary) => {
        if (!cancelled) attach(scope, runFromSummary(summary, scope, orgId, org.slug));
      })
      .catch((thrown: unknown) => {
        if (!cancelled) setError(errorMessage(thrown, "We couldn't load this import."));
      });
    return () => {
      cancelled = true;
    };
  }, [attach, batchId, inMemory, orgId, org.slug, scope]);

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-6" data-testid="import-run-missing">
        <EmptyState
          title="This import isn't available"
          description={`${error} Imports can be reviewed by the person who ran them.`}
          illustration="search"
          actions={
            <Link href={`/${org.slug}/import?step=upload`} className={buttonVariants({ variant: 'primary' })}>
              Start a new import
            </Link>
          }
        />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4 p-6 sm:p-8" data-skeleton>
      <Skeleton height={28} width={280} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} height={72} rounded="lg" />
        ))}
      </div>
    </div>
  );
}
