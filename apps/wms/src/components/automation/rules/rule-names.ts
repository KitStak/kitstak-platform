'use client';

/** Resolves ids inside rule values (clients, warehouses, Data Setup lookups) to readable names. */
import * as React from 'react';
import {
  useClientOptions,
  useEntityOptions,
  useLookups,
  useWarehouseOptions,
} from '@/components/integrations/shared/shared';

export type NameOf = (id: string) => string;

export function useRuleNames(): NameOf {
  const clients = useClientOptions();
  const warehouses = useWarehouseOptions();
  const pg = useLookups('product_group');
  const pt = useLookups('product_type');
  const lg = useLookups('location_group');
  const lz = useLookups('location_zone');
  const st = useLookups('so_type');
  const retailers = useEntityOptions('retailer');
  const packages = useEntityOptions('package');
  return React.useMemo(() => {
    const map = new Map<string, string>();
    for (const o of [
      ...clients,
      ...warehouses.short,
      ...pg.options,
      ...pt.options,
      ...lg.options,
      ...lz.options,
      ...st.options,
      ...retailers,
      ...packages,
    ])
      map.set(o.value, o.label);
    return (id: string) => map.get(id) ?? id;
  }, [
    clients,
    warehouses.short,
    pg.options,
    pt.options,
    lg.options,
    lz.options,
    st.options,
    retailers,
    packages,
  ]);
}
