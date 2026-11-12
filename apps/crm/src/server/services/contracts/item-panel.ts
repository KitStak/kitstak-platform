/** Item panel DTOs and pure helpers (client-safe, no server imports). Served by `/api/v1/item-panel/*`. */
import type { UserSummaryDto } from './dto';

export interface ItemSubscribersDto {
  readonly itemId: string;
  readonly userIds: readonly string[];
  readonly users: readonly UserSummaryDto[];
  readonly subscribedByMe: boolean;
}

export interface UpdateReaderDto extends UserSummaryDto {
  readonly readAt: string;
}

/** Explicit subscribe / unsubscribe choices stored per item in board settings. */
export interface ExplicitSubscribers {
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

/** Cap per list so a board's settings jsonb stays bounded. */
export const MAX_EXPLICIT_SUBSCRIBERS = 500;

/** Pure: apply add / remove to the explicit lists (an add cancels an earlier remove and vice versa). */
export function applySubscriberChange(
  current: ExplicitSubscribers,
  change: { readonly add: readonly string[]; readonly remove: readonly string[] },
): ExplicitSubscribers {
  const added = new Set(current.added);
  const removed = new Set(current.removed);
  for (const id of change.add) {
    added.add(id);
    removed.delete(id);
  }
  for (const id of change.remove) {
    removed.add(id);
    added.delete(id);
  }
  return { added: [...added].slice(0, MAX_EXPLICIT_SUBSCRIBERS), removed: [...removed].slice(0, MAX_EXPLICIT_SUBSCRIBERS) };
}
