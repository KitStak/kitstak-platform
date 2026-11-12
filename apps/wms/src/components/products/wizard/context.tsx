'use client';

import * as React from 'react';
import { useWatch } from 'react-hook-form';
import { useApiQuery } from '@/lib/query-client';
import type { ProductCategory } from '@/lib/grid-defs/products/catalog-options';
import type { WizardOptions } from '@/server/repositories/products-options';

export interface ProductWizardCtx {
  readonly category: ProductCategory;
  readonly mode: 'create' | 'edit';
  readonly productId: string | null;
  readonly clientName: string | null;
  readonly options: WizardOptions;
  readonly optionsLoading: boolean;
  readonly optionsError: boolean;
  readonly refetchOptions: () => void;
}

const EMPTY: WizardOptions = {
  clients: [],
  productTypes: [],
  productGroups: [],
  packTypes: [],
  shipmentPackages: [],
  channels: [],
  warehouses: [],
};

const Ctx = React.createContext<ProductWizardCtx | null>(null);

export function useProductWizard(): ProductWizardCtx {
  const value = React.useContext(Ctx);
  if (!value) throw new Error('useProductWizard must be used inside ProductWizardProvider');
  return value;
}

/** Loads client-scoped option lists for the client currently chosen in the form. */
export function useWizardOptions(clientId: string | null): {
  options: WizardOptions;
  loading: boolean;
  error: boolean;
  refetch: () => void;
} {
  // Keep the previous answer while a new client's options load, so the client list (and the
  // selected client's name) never blanks into "Loading clients…". Client-scoped lookups from the
  // previous client are dropped until the new ones arrive.
  const q = useApiQuery<WizardOptions>(['product-wizard-options', clientId ?? ''], '/api/products/options', {
    query: { for: 'wizard', clientId: clientId ?? undefined },
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  const data = q.data?.data;
  const options = React.useMemo<WizardOptions>(() => {
    if (!data) return EMPTY;
    return q.isPlaceholderData ? { ...data, productTypes: [], productGroups: [], channels: [] } : data;
  }, [data, q.isPlaceholderData]);
  const { refetch } = q;
  const doRefetch = React.useCallback(() => void refetch(), [refetch]);
  return { options, loading: q.isPending || q.isPlaceholderData, error: q.isError, refetch: doRefetch };
}

/** Provider used inside the wizard's FormProvider (reads the live client id). */
export function ProductWizardProvider({
  category,
  mode,
  productId,
  clientName,
  children,
}: {
  readonly category: ProductCategory;
  readonly mode: 'create' | 'edit';
  readonly productId: string | null;
  readonly clientName: string | null;
  readonly children: React.ReactNode;
}) {
  const clientId = useWatch({ name: 'clientId' }) as string | undefined;
  const { options, loading, error, refetch } = useWizardOptions(clientId || null);
  const value = React.useMemo<ProductWizardCtx>(
    () => ({
      category,
      mode,
      productId,
      clientName,
      options,
      optionsLoading: loading,
      optionsError: error,
      refetchOptions: refetch,
    }),
    [category, mode, productId, clientName, options, loading, error, refetch],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Starts loading the wizard option lists (clients, pack types, boxes…) before the wizard mounts,
 * e.g. while the page checks permissions or shows the category chooser, so the Client field
 * never opens on "Loading clients…". Same query key as the wizard, so it reuses the answer.
 */
export function usePrefetchWizardOptions(clientId: string | null, enabled = true): void {
  useApiQuery<WizardOptions>(
    ['product-wizard-options', clientId ?? ''],
    enabled ? '/api/products/options' : null,
    {
      query: { for: 'wizard', clientId: clientId ?? undefined },
      staleTime: 30_000,
    },
  );
}
