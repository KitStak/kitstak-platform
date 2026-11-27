'use client';
/**
 * Build facts on project cards and rows (docs/programs/SPEC.md 5.17): a build that lives in a
 * project shows its qty progress and, when it bills nowhere, "Not billed". Program pages pass
 * their own richer facts through the card extras instead.
 */
import type { TaskSummary } from '@/lib/types';
import { RevenueGoesToChip } from '@/features/programs/kit/chips';
import { QtyProgress } from '@/features/programs/kit/numbers';

const UNITS = { singular: 'unit', plural: 'units' } as const;

export function ProjectBuildFacts({ task }: { readonly task: TaskSummary }) {
  const build = task.kind === 'build' ? task.build : null;
  if (!build) return null;
  const unbilled = build.posting === 'unbilled' || (build.posting === null && !build.programId);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="project-build-facts">
      <QtyProgress built={build.builtQty} planned={build.plannedQty} unit={UNITS} />
      {unbilled ? <RevenueGoesToChip posting="unbilled" /> : null}
    </div>
  );
}
