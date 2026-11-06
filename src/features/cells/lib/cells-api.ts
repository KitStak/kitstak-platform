/** Client calls for the cells-module endpoints (`/api/v1/cells/*`). */
import { apiRequest } from '@/lib/api';
import type { ColumnDto } from '@/server/services/contracts/dto';
import type { ConnectCandidate, LabelChange } from '../types';

const MAX_IDS = 500;

export async function fetchLinkedItems(
  orgId: string,
  itemIds: readonly string[],
  signal?: AbortSignal,
): Promise<ConnectCandidate[]> {
  const unique = [...new Set(itemIds)];
  if (unique.length === 0) return [];
  const chunks: string[][] = [];
  for (let start = 0; start < unique.length; start += MAX_IDS) chunks.push(unique.slice(start, start + MAX_IDS));
  const pages = await Promise.all(
    chunks.map((chunk) =>
      apiRequest<ConnectCandidate[]>('/cells/linked-items', { orgId, method: 'POST', body: { itemIds: chunk }, signal }),
    ),
  );
  return pages.flat();
}

export function fetchLabelUsage(orgId: string, boardId: string, columnId: string): Promise<Record<string, number>> {
  return apiRequest<Record<string, number>>(`/cells/boards/${boardId}/columns/${columnId}/labels`, { orgId });
}

export function saveLabelsRequest(orgId: string, boardId: string, columnId: string, change: LabelChange): Promise<ColumnDto> {
  return apiRequest<ColumnDto>(`/cells/boards/${boardId}/columns/${columnId}/labels`, {
    orgId,
    method: 'PUT',
    body: { labels: change.labels, reassign: Object.fromEntries(change.reassign) },
  });
}
