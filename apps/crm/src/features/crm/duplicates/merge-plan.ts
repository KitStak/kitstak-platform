/** Pure merge-planning helpers for the duplicates page (unit tested). */
import type { DuplicateClusterDto } from '@/server/services/crm-contracts';

/**
 * Records pre-ticked for merging: every non-kept record for high-confidence matches (same
 * email / domain), none for "Possible" ones — the user must opt in.
 */
export function initialIncluded(cluster: DuplicateClusterDto, primaryId: string): string[] {
  if (cluster.confidence !== 'high') return [];
  return cluster.records.map((record) => record.id).filter((id) => id !== primaryId);
}

/** Field winner per compared column: the kept record when it has a value, else the first donor. */
export function initialChoices(cluster: DuplicateClusterDto, primaryId: string): Record<string, string> {
  const primary = cluster.records.find((record) => record.id === primaryId);
  const choices: Record<string, string> = {};
  for (const field of cluster.fields) {
    if (primary?.fields[field.key]) {
      choices[field.key] = primaryId;
      continue;
    }
    const donor = cluster.records.find((record) => record.fields[field.key]);
    if (donor) choices[field.key] = donor.id;
  }
  return choices;
}

/** Choices to send: only conflicting fields whose winner is a merged duplicate. */
export function fieldChoicesToSend(
  cluster: DuplicateClusterDto,
  choices: Readonly<Record<string, string>>,
  primaryId: string,
  mergeIds: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of cluster.fields) {
    const winner = choices[field.key];
    if (field.conflict && winner && winner !== primaryId && mergeIds.includes(winner)) out[field.key] = winner;
  }
  return out;
}

/** Titles of fields whose value on `recordId` differs from the kept record's. */
export function differingFields(cluster: DuplicateClusterDto, recordId: string, primaryId: string): string[] {
  if (recordId === primaryId) return [];
  const record = cluster.records.find((entry) => entry.id === recordId);
  const primary = cluster.records.find((entry) => entry.id === primaryId);
  if (!record || !primary) return [];
  return cluster.fields
    .filter((field) => {
      const a = record.fields[field.key];
      const b = primary.fields[field.key];
      return Boolean(a && b && a.toLowerCase() !== b.toLowerCase());
    })
    .map((field) => field.title);
}
