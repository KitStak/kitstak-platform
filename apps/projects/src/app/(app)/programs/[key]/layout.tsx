import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { ProjectProvider } from '@/features/projects/project-context';
import { ProgramProvider } from '@/features/programs/program-context';
import { ProgramFrame } from '@/features/programs/frame/program-frame';
import { getProjectDetail, listOrgPeople, recordVisit } from '@/server/domain';
import { getProgramDetail, listBuilds, listVariants, scheduleProgramSweep } from '@/server/domain/programs';
import { isDomainError } from '@/server/errors';
import { pageContext } from '@/server/page';

/** One program load per request, shared by the layout and its metadata (docs/programs/SPEC.md 5.1). */
const loadProgram = cache(async (key: string) => {
  const { ctx } = await pageContext(`/programs/${key}`);
  const program = await getProgramDetail(ctx, key.toUpperCase()).catch((error: unknown) => {
    if (isDomainError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) notFound();
    throw error;
  });
  return { ctx, program };
});

/** The project view of the program (statuses, members for shared views), its variants, builds of today minus 14 to plus 14 days, and the org people. */
async function loadTabData(ctx: Awaited<ReturnType<typeof loadProgram>>['ctx'], program: { readonly id: string; readonly key: string }) {
  const [project, variants, builds, people] = await Promise.all([
    getProjectDetail(ctx, { id: program.id }),
    listVariants(ctx, program.key, { includeRetired: true }),
    listBuilds(ctx, program.key, {}),
    listOrgPeople(ctx),
  ]);
  return { project, variants, builds, people, loadedAt: Date.now() };
}

export async function generateMetadata({ params }: { readonly params: Promise<{ key: string }> }): Promise<Metadata> {
  const { key } = await params;
  const { program } = await loadProgram(decodeURIComponent(key));
  // Tabs read "Builds · Glove kits · KitStak Projects"; the overview reads "Glove kits · Overview".
  return { title: { default: `${program.name} · Overview`, template: `%s · ${program.name} · KitStak Projects` } };
}

/**
 * Loads the program once for every tab: the detail, variants and the builds of today minus 14 to
 * plus 14 days (never every build). Seeds ProgramProvider and ProjectProvider so shared views and
 * the task drawer work, records the visit and kicks the lazy program sweep (4.9).
 */
export default async function ProgramLayout({ children, params }: { readonly children: React.ReactNode; readonly params: Promise<{ key: string }> }) {
  const { key } = await params;
  const { ctx, program } = await loadProgram(decodeURIComponent(key));
  const [{ project, variants, builds, people, loadedAt }] = await Promise.all([loadTabData(ctx, program), recordVisit(ctx, 'project', program.id)]);
  scheduleProgramSweep(ctx);
  return (
    <ProgramProvider initial={program} initialVariants={variants} loadedAt={loadedAt}>
      <ProjectProvider initial={project} initialTasks={builds.items} initialPeople={people} loadedAt={loadedAt}>
        <ProgramFrame>{children}</ProgramFrame>
      </ProjectProvider>
    </ProgramProvider>
  );
}
