"use client";

import * as React from "react";
import { useWatch } from "react-hook-form";
import { useApiQuery } from "@/lib/query-client";
import type { ProductCategory } from "@/lib/grid-defs/products/catalog-options";
import type { WizardOptions } from "@/server/repositories/products-options";

export interface ProductWizardCtx {
  readonly category: ProductCategory;
  readonly mode: "create" | "edit";
  readonly productId: string | null;
  readonly clientName: string | null;
  readonly options: WizardOptions;
  readonly optionsLoading: boolean;
  readonly refetchOptions: () => void;
}

const EMPTY: WizardOptions = { clients: [], productTypes: [], productGroups: [], packTypes: [], shipmentPackages: [], channels: [], warehouses: [] };

const Ctx = React.createContext<ProductWizardCtx | null>(null);

export function useProductWizard(): ProductWizardCtx {
  const value = React.useContext(Ctx);
  if (!value) throw new Error("useProductWizard must be used inside ProductWizardProvider");
  return value;
}

/** Loads client-scoped option lists for the client currently chosen in the form. */
export function useWizardOptions(clientId: string | null): { options: WizardOptions; loading: boolean; refetch: () => void } {
  const q = useApiQuery<WizardOptions>(["product-wizard-options", clientId ?? ""], "/api/products/options", { query: { for: "wizard", clientId: clientId ?? undefined }, staleTime: 30_000 });
  return { options: q.data?.data ?? EMPTY, loading: q.isPending, refetch: () => void q.refetch() };
}

/** Provider used inside the wizard's FormProvider (reads the live client id). */
export function ProductWizardProvider({ category, mode, productId, clientName, children }: { readonly category: ProductCategory; readonly mode: "create" | "edit"; readonly productId: string | null; readonly clientName: string | null; readonly children: React.ReactNode }) {
  const clientId = useWatch({ name: "clientId" }) as string | undefined;
  const { options, loading, refetch } = useWizardOptions(clientId || null);
  const value = React.useMemo<ProductWizardCtx>(() => ({ category, mode, productId, clientName, options, optionsLoading: loading, refetchOptions: refetch }), [category, mode, productId, clientName, options, loading, refetch]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
