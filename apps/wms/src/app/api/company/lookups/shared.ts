/** Shared params / guards for the Data Setup lookup routes (`/api/company/lookups/[type]`). */
import { z } from 'zod';
import { LOOKUP_TYPES } from '@/lib/enums';
import { lookupByType, type LookupDef } from '@/lib/grid-defs/admin/lookups';
import { AppError } from '@/server/api/errors';
import { idSchema } from '@/server/repositories/platform-common';

export const DATA_SETUP_PERMISSION = 'settings.data_setup.view';

export const typeParams = z.object({ type: z.enum(LOOKUP_TYPES) });
export const itemParams = typeParams.extend({ id: idSchema });

export function defOf(type: string): LookupDef {
  const def = lookupByType(type);
  if (!def) throw new AppError('NOT_FOUND', 'Lookup not found');
  return def;
}
