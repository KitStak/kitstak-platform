'use client';
/**
 * Data hook for the item panel's Programs tab and health line (KitStak Programs linked to a
 * deal or account). Server: src/server/services/programs-bridge.ts via
 * /api/v1/crm/items/:id/programs. Numbers come from the CRM server, never from the browser.
 */
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import { useOrgId } from '@/lib/hooks/org-context';
import type { ItemProgramsDto } from '@/server/services/programs-bridge';

export const programsKeys = {
  item: (orgId: string, itemId: string) => ['org', orgId, 'crm', 'programs', 'item', itemId] as const,
};

/** Programs for one record. Refreshes when the window regains focus (builds change in Projects all day). */
export function useItemPrograms(itemId: string | null, enabled = true) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: programsKeys.item(orgId, itemId ?? ''),
    queryFn: ({ signal }) => apiRequest<ItemProgramsDto>(`/crm/items/${itemId}/programs`, { orgId, signal }),
    enabled: enabled && Boolean(itemId),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}
