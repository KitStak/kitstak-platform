/**
 * Build forms (docs/programs/SPEC.md 5.17, 9.2 "a build form makes a build"): a form on a
 * program whose settings map a variant question and a qty question makes one build per answer.
 */
import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { matchVariant } from '@kitstak/programs-engine/import';
import { db } from '@/server/db';
import { programVariants, type Project } from '@/server/db/schema';
import { invalid } from '@/server/errors';
import type { DomainContext } from '../_shared';
import { loadSettings, todayInZone } from './_program';
import { insertBuild } from './builds';

export async function formBuild(
  ctx: DomainContext,
  program: Project,
  input: { readonly variantAnswer: string; readonly qtyAnswer: string; readonly dateAnswer: string | null; readonly title: string | null; readonly description: string | null },
): Promise<{ taskId: string; number: number }> {
  const settings = await loadSettings(db, program.id);
  const variants = await db.select().from(programVariants).where(and(eq(programVariants.programId, program.id), isNull(programVariants.deletedAt), eq(programVariants.status, 'active')));
  const match = matchVariant(input.variantAnswer, variants.map((v) => ({ id: v.id, key: v.key, name: v.name, sku: v.sku })));
  if (!match) throw invalid('Pick one of the kits this program makes.', { variant: 'Pick one of the kits this program makes.' });
  const qty = input.qtyAnswer.trim();
  if (!/^\d{1,8}(\.\d{1,3})?$/.test(qty) || Number(qty) <= 0) throw invalid('Enter how many to build.', { qty: 'Enter how many to build.' });
  return db.transaction((tx) =>
    insertBuild(tx, ctx, { project: program, settings, programId: program.id, seesMoney: true, timezone: settings.timezone }, {
      variantId: match.id,
      buildDate: input.dateAnswer ?? todayInZone(settings.timezone),
      plannedQty: qty,
      title: input.title,
      description: input.description,
      plannedFrom: 'form',
    }),
  );
}
