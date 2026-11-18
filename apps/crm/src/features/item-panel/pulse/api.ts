'use client';
/**
 * Data hook for the item panel's Profit tab (KitStak Pulse profit for a deal or an account).
 * Server: src/server/services/pulse-bridge.ts via /api/v1/crm/items/:id/pulse.
 */
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import { useOrgId } from '@/lib/hooks/org-context';
import type { ItemPulseDto } from '@/server/services/pulse-bridge';

export const pulseKeys = {
  item: (orgId: string, itemId: string) => ['org', orgId, 'crm', 'pulse', 'item', itemId] as const,
};

/** Pulse profit for one record. Refreshes when the tab regains focus (numbers change in Pulse). */
export function useItemPulse(itemId: string | null, enabled = true) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: pulseKeys.item(orgId, itemId ?? ''),
    queryFn: ({ signal }) => apiRequest<ItemPulseDto>(`/crm/items/${itemId}/pulse`, { orgId, signal }),
    enabled: enabled && Boolean(itemId),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}
