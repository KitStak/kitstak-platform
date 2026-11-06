/**
 * View tab ordering helpers. Pure and client-safe.
 */
import type { ViewDto } from '@/server/services/contracts/dto';

export function sortViews(views: readonly ViewDto[]): ViewDto[] {
  return [...views].sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : a.id < b.id ? -1 : 1));
}

/** Placement for moving the view at `from` to index `to` (in the list without it). */
export function placementForMove(
  views: readonly Pick<ViewDto, 'id'>[],
  from: number,
  to: number,
): { afterId?: string; beforeId?: string } | null {
  if (from === to || from < 0 || from >= views.length) return null;
  const rest = views.filter((_, index) => index !== from);
  const clamped = Math.max(0, Math.min(rest.length, to));
  if (clamped === 0) {
    const first = rest[0];
    return first ? { beforeId: first.id } : null;
  }
  const before = rest[clamped - 1];
  return before ? { afterId: before.id } : null;
}

/** The view a board opens on: explicit (URL) → default → first table → first. */
export function resolveActiveView(views: readonly ViewDto[], requestedId: string | null): ViewDto | null {
  const sorted = sortViews(views);
  return (
    (requestedId ? sorted.find((view) => view.id === requestedId) : undefined) ??
    sorted.find((view) => view.isDefault) ??
    sorted.find((view) => view.type === 'table') ??
    sorted[0] ??
    null
  );
}

/** "Kanban", "Kanban 2", "Kanban 3"… */
export function uniqueViewName(base: string, views: readonly Pick<ViewDto, 'name'>[]): string {
  const names = new Set(views.map((view) => view.name.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base} ${index}`;
    if (!names.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} ${Date.now()}`;
}
