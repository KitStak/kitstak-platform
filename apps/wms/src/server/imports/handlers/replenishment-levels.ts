/** Import handler "replenishment-levels" (owner M09). Per-warehouse min/max replenishment levels. */
import { applyReplenishmentImport } from '@/server/repositories/products-import';
import type { ImportHandler } from '../types';

export const handler: ImportHandler = {
  configured: true,
  owner: 'M09',
  apply: async (ctx, row) => await applyReplenishmentImport(ctx, row),
};
