'use client';
/** The Profit tabs (Jobs, Clients, Job types, ...). Each is a URL that keeps the period and the filters. */
import { useSearchParams } from 'next/navigation';
import { RouteTabs } from '@/components/pulse/route-tabs';
import { PROFIT_VIEWS, routes, type ProfitView } from '@/lib/routes';
import { VIEW_LABELS } from './profit-model';
import { buildQuery } from './use-query-state';

export function ProfitTabs({ active }: { readonly active: ProfitView }) {
  const params = useSearchParams();
  return (
    <RouteTabs
      label="Profit views"
      active={active}
      tabs={PROFIT_VIEWS.map((id) => {
        // A new grouping starts from its own default view, sort and columns.
        const query = buildQuery(params, { by: id === 'job' ? null : id, view: null, sort: null, cols: null, entries: null, day: null, pivot: null });
        return { id, label: VIEW_LABELS[id], href: query ? `${routes.profit()}?${query}` : routes.profit() };
      })}
    />
  );
}
