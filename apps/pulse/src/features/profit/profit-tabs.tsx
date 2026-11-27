'use client';
/** The Profit tabs (Jobs, Clients, Job types, ...). Each is a URL that keeps the period and the filters. */
import { useSearchParams } from 'next/navigation';
import { RouteTabs } from '@/components/pulse/route-tabs';
import { PROFIT_VIEWS, routes, type ProfitView } from '@/lib/routes';
import { useShell } from '@/features/shell/shell-context';
import { VIEW_LABELS } from './profit-model';
import { buildQuery } from './use-query-state';

export function ProfitTabs({ active }: { readonly active: ProfitView }) {
  const params = useSearchParams();
  const shell = useShell();
  // Programs come from KitStak Projects: the tab shows when Projects is connected.
  const views = PROFIT_VIEWS.filter((id) => id !== 'program' || shell.integrations.projects || active === 'program');
  return (
    <RouteTabs
      label="Profit views"
      active={active}
      tabs={views.map((id) => {
        // A new grouping starts from its own default view, sort and columns.
        const query = buildQuery(params, { by: id === 'job' ? null : id, view: null, sort: null, cols: null, entries: null, day: null, pivot: null });
        return { id, label: VIEW_LABELS[id], href: query ? `${routes.profit()}?${query}` : routes.profit() };
      })}
    />
  );
}
