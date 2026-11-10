"use client";

/**
 * Saved views client (F7 `/api/saved-views`, `/api/saved-views/[id]`).
 *   GET    ?gridKey=       → SavedView[] (own + shared)
 *   POST   { gridKey, name, query, isShared, isDefault }
 *   PATCH  /[id] { name?, query?, isShared?, isDefault? }
 *   DELETE /[id]
 */
import { z } from "zod";
import { useApiMutation, useApiQuery } from "@/lib/query-client";

export const savedViewSchema = z.object({
  id: z.string(),
  gridKey: z.string(),
  name: z.string(),
  query: z.string(),
  isShared: z.boolean().default(false),
  isDefault: z.boolean().default(false),
  userId: z.string().nullish(),
  isOwner: z.boolean().optional(),
});

export type SavedView = z.infer<typeof savedViewSchema>;

export const savedViewsQueryKey = (gridKey: string) => ["saved-views", gridKey] as const;

export function parseSavedViews(data: unknown): readonly SavedView[] {
  const parsed = z.array(savedViewSchema).safeParse(data);
  return parsed.success ? parsed.data : [];
}

export const SAVED_VIEW_NAME_MAX = 60;

export function validateViewName(name: string, existing: readonly SavedView[], ignoreId?: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Enter a view name";
  if (trimmed.length > SAVED_VIEW_NAME_MAX) return `At most ${SAVED_VIEW_NAME_MAX} characters`;
  if (existing.some((v) => v.id !== ignoreId && v.name.trim().toLowerCase() === trimmed.toLowerCase())) return "A view with this name already exists";
  return null;
}

export interface CreateViewInput {
  readonly name: string;
  readonly query: string;
  readonly isShared: boolean;
  readonly isDefault: boolean;
}

export interface UpdateViewInput {
  readonly id: string;
  readonly name?: string;
  readonly query?: string;
  readonly isShared?: boolean;
  readonly isDefault?: boolean;
}

export function useSavedViews(gridKey: string | undefined) {
  const key = savedViewsQueryKey(gridKey ?? "");
  const list = useApiQuery<unknown>(key, gridKey ? "/api/saved-views" : null, { query: { gridKey } });
  const views = parseSavedViews(list.data?.data);
  const create = useApiMutation<CreateViewInput, unknown>({
    path: "/api/saved-views",
    method: "POST",
    body: (v) => ({ ...v, gridKey }),
    invalidate: [key],
    successMessage: (_d, v) => `View "${v.name}" saved`,
  });
  const update = useApiMutation<UpdateViewInput, unknown>({
    path: (v) => `/api/saved-views/${encodeURIComponent(v.id)}`,
    method: "PATCH",
    body: (v) => ({ name: v.name, query: v.query, isShared: v.isShared, isDefault: v.isDefault }),
    invalidate: [key],
    successMessage: "View updated",
  });
  const remove = useApiMutation<{ readonly id: string; readonly name: string }, unknown>({
    path: (v) => `/api/saved-views/${encodeURIComponent(v.id)}`,
    method: "DELETE",
    body: () => undefined,
    invalidate: [key],
    successMessage: (_d, v) => `View "${v.name}" deleted`,
  });
  return { views, isLoading: list.isPending && Boolean(gridKey), error: list.error, create, update, remove };
}
