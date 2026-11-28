'use server';
/** Import actions (SPEC 7): the commit of a checked setup import. The check is `POST /api/v1/import`. */
import { z } from 'zod';
import { commitSetupImport, type ImportCounts } from '@/server/domain/setup-import';
import { runAction, type ActionResult } from './_action';

const commitSchema = z.object({ batchId: z.uuid(), skipBadRows: z.boolean() });

export async function commitImportAction(input: z.input<typeof commitSchema>): Promise<ActionResult<ImportCounts>> {
  return runAction(commitSchema, input, (data, ctx) => commitSetupImport(ctx, data.batchId, { skipBadRows: data.skipBadRows }));
}
