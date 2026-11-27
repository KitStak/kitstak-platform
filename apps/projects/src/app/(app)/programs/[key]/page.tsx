import { OverviewTab } from '@/features/programs/overview/overview-tab';
import { draftProgramUpdate, getProgramSummary } from '@/server/domain/programs';
import { pageContext } from '@/server/page';

type Params = Promise<{ key: string }>;

/**
 * Program Overview (docs/programs/SPEC.md 5.6). The layout loads the program; this page reads the
 * month summary and the status update draft on the server so the first paint has every number.
 * `?statement=YYYY-MM` and `?close=YYYY-MM` open the statement and month close sheets.
 */
async function loadOverview(programKey: string) {
  const { ctx } = await pageContext(`/programs/${programKey}`);
  const [summary, draft] = await Promise.all([getProgramSummary(ctx, programKey), draftProgramUpdate(ctx, programKey)]);
  return { summary, draft, loadedAt: Date.now() };
}

export default async function Page({ params }: { readonly params: Params }) {
  const { key } = await params;
  const { summary, draft, loadedAt } = await loadOverview(decodeURIComponent(key).toUpperCase());
  return <OverviewTab initialSummary={summary} updateDraft={draft} loadedAt={loadedAt} />;
}
