/**
 * Server entry for /programs (docs/programs/SPEC.md 5.1, 5.3): loads the programs (archived too,
 * so the Archived status filter works without a round trip), the person's wizard drafts and the
 * saved views of the `programs` surface, kicks the program sweep, then renders the directory.
 */
import 'server-only';
import { listDrafts, listPrograms, scheduleProgramSweep } from '@/server/domain/programs';
import { listSavedViews } from '@/server/domain/views';
import { pageContext } from '@/server/page';
import { ProgramsDirectory } from './programs-directory';

export async function ProgramsPage() {
  const { ctx } = await pageContext('/programs');
  scheduleProgramSweep(ctx);
  const [programs, drafts, views] = await Promise.all([
    listPrograms(ctx, { includeArchived: true }),
    listDrafts(ctx).catch(() => []),
    listSavedViews(ctx, null, { surface: 'programs' }).catch(() => []),
  ]);
  // eslint-disable-next-line react-hooks/purity -- one timestamp per server render seeds React Query
  const loadedAt = Date.now();
  return <ProgramsDirectory initialPrograms={programs} initialDrafts={drafts} savedViews={views} loadedAt={loadedAt} />;
}
