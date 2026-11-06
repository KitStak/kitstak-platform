'use client';

/**
 * Which dashboard filters are active, so empty states can say *why* nothing matched and offer
 * the right fix ("No items match “acme”" + Clear search), instead of a generic hint.
 */
import { createContext, useContext } from 'react';

export interface DashboardFilterHint {
  readonly search: string;
  readonly hasPeople: boolean;
  readonly hasRange: boolean;
  readonly rangeLabel: string;
  /** Resolved dashboard date window (inclusive YYYY-MM-DD), when a range is active. */
  readonly from?: string;
  readonly to?: string;
  readonly onClearSearch?: () => void;
  readonly onClearAll?: () => void;
}

export const DashboardFilterContext = createContext<DashboardFilterHint | null>(null);

export function useFilterHint(): DashboardFilterHint | null {
  return useContext(DashboardFilterContext);
}

/** Title + description for a filtered-empty widget (pure, tested). */
export function describeFilteredEmpty(hint: DashboardFilterHint | null): { title: string; description: string } {
  if (!hint) return { title: 'No items match the current filters', description: 'Clear the dashboard filters to see everything.' };
  const others = [hint.hasPeople ? 'the person filter' : null, hint.hasRange ? `the date range (${hint.rangeLabel})` : null].filter(
    (part): part is string => part !== null,
  );
  if (hint.search) {
    return {
      title: `No items match “${hint.search}”`,
      description: others.length > 0 ? `Also filtered by ${others.join(' and ')}.` : 'Check the spelling or try a shorter search.',
    };
  }
  if (others.length === 0) return { title: 'No items match the current filters', description: 'Clear the dashboard filters to see everything.' };
  return { title: 'No items in this view', description: `Nothing matches ${others.join(' and ')}. Try widening it.` };
}
