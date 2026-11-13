'use server';
import { z } from 'zod';
import { recordVisit, setFavorite, updateUserPrefs } from '@/server/domain';
import { FAVORITE_ENTITY_TYPES, RECENT_ENTITY_TYPES } from '@/server/db/schema';
import { runAction } from './_action';
import { jsonObject, uuid } from './schemas';

export async function updatePrefsAction(input: Record<string, unknown>) {
  return runAction(jsonObject, input, (data, ctx) => updateUserPrefs(ctx, data), { revalidate: false });
}

const favoriteSchema = z.object({ entityType: z.enum(FAVORITE_ENTITY_TYPES), entityId: uuid, starred: z.boolean() });
export async function setFavoriteAction(input: z.input<typeof favoriteSchema>) {
  return runAction(favoriteSchema, input, (data, ctx) => setFavorite(ctx, data.entityType, data.entityId, data.starred));
}

const visitSchema = z.object({ entityType: z.enum(RECENT_ENTITY_TYPES), entityId: uuid });
export async function recordVisitAction(input: z.input<typeof visitSchema>) {
  return runAction(visitSchema, input, (data, ctx) => recordVisit(ctx, data.entityType, data.entityId), { revalidate: false });
}
