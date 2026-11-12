'use client';

/**
 * In-memory twin of `useGridUrlState` for grids inside modals and drawers (record
 * pickers), where the page URL must not change. Same `GridUrlState` interface.
 */
import * as React from 'react';
import { patchGridQuery, type GridUrlState } from '@/lib/use-url-state';
import { EMPTY_GRID_QUERY, serializeGridQuery, type GridQuery } from '@/server/query/grid-query';

export function useLocalGridState(gridKey: string, initial: Partial<GridQuery> = {}): GridUrlState {
  const [query, setQueryState] = React.useState<GridQuery>(() => ({ ...EMPTY_GRID_QUERY, ...initial }));
  const setQuery = React.useCallback(
    (patch: Partial<GridQuery>) => setQueryState((current) => patchGridQuery(current, patch)),
    [],
  );
  return React.useMemo<GridUrlState>(
    () => ({
      gridKey,
      query,
      queryString: serializeGridQuery(query),
      setQuery,
      setSearch: (q, qm) => setQuery({ q: q.trim() || undefined, ...(qm ? { qm } : {}) }),
      setFilters: (filters) => setQuery({ filters }),
      upsertFilter: (filter) =>
        setQuery({ filters: [...query.filters.filter((f) => f.field !== filter.field), filter] }),
      removeFilter: (field) => setQuery({ filters: query.filters.filter((f) => f.field !== field) }),
      setSort: (sort) => setQuery({ sort }),
      setPage: (page) => setQuery({ page }),
      setPageSize: (pageSize) => setQuery({ pageSize }),
      reset: () => setQueryState({ ...EMPTY_GRID_QUERY }),
    }),
    [gridKey, query, setQuery],
  );
}
