/** @mention candidate ranking: prefix matches on first/last name beat substring matches. */
import type { UserSummaryDto } from '@/server/services/contracts/dto';

export const MENTION_LIMIT = 8;

export function rankMentionCandidates(
  users: readonly UserSummaryDto[],
  query: string,
  limit = MENTION_LIMIT,
): UserSummaryDto[] {
  const q = query.trim().toLowerCase();
  const scored = users
    .map((user) => {
      const name = user.name.toLowerCase();
      const words = name.split(/\s+/);
      const email = user.email.toLowerCase();
      let score = -1;
      if (!q) score = 1;
      else if (name.startsWith(q)) score = 4;
      else if (words.some((word) => word.startsWith(q))) score = 3;
      else if (email.startsWith(q)) score = 2;
      else if (name.includes(q) || email.includes(q)) score = 1;
      return { user, score };
    })
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score || a.user.name.localeCompare(b.user.name));
  return scored.slice(0, limit).map((entry) => entry.user);
}
