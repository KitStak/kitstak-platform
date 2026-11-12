/** Import handler "lp-numbers" (owner M10). Creates a custom LP number per row through createLpNumbers. */
import { applyLpNumberImport } from '@/server/repositories/lp-numbers-import';
import type { ImportHandler } from '../types';

export const handler: ImportHandler = {
  configured: true,
  owner: 'M10',
  apply: async (ctx, row) => await applyLpNumberImport(ctx, row),
};
