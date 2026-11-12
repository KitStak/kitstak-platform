"use client";

/** Shared state for the order wizard steps: mode, option lists, field locks, saved detail. */
import * as React from "react";
import type { OrderDetail, OrderFormOptions } from "../orders-client";

export interface OrderLocks {
  /** Everything except notes / return info is read-only (shipped / cancelled orders). */
  readonly header: string | null;
  /** Product lines are read-only (allocated / picking started). */
  readonly lines: string | null;
}

export interface OrderWizardContextValue {
  readonly mode: "create" | "edit";
  readonly options: OrderFormOptions | undefined;
  readonly optionsLoading: boolean;
  /** A warehouse/client-scoped refetch is running; the lists shown are the previous scope's. */
  readonly optionsRefreshing: boolean;
  readonly locks: OrderLocks;
  readonly detail: OrderDetail | null;
  readonly canCreateProduct: boolean;
  readonly canManageCustomFields: boolean;
}

const Ctx = React.createContext<OrderWizardContextValue | null>(null);

export function OrderWizardProvider({ value, children }: { readonly value: OrderWizardContextValue; readonly children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOrderWizard(): OrderWizardContextValue {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useOrderWizard must be used inside OrderWizardProvider");
  return v;
}

export const LOCKED_FIELD_REASON = "Warehouse and client can't be changed on a saved order.";
