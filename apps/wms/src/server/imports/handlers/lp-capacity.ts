/** Import handler "lp-capacity" (owner M10). Adds an LP-type capacity (max LP count) to a location; rejects an existing one. */
import { applyLpCapacityImport } from '@/server/repositories/locations-import';
import type { ImportHandler } from '../types';

export const handler: ImportHandler = {
  configured: true,
  owner: 'M10',
  apply: async (ctx, row) => await applyLpCapacityImport(ctx, row),
};
