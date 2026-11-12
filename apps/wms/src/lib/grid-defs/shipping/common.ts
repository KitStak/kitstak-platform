/**
 * Shared shapes for the M02 grid definitions (pure TS: imported by the client grids and by
 * the server list endpoints, so both agree on every `f.<field>` / `sort=<field>` key).
 * Structurally compatible with `FilterFieldDef` from `@/components/grid/grid-types`.
 */

export type ShippingFieldType = "enum" | "text" | "number" | "boolean" | "date";

export interface ShippingFieldOption {
  readonly value: string;
  readonly label: string;
}

export interface ShippingField {
  /** Grid-query field name. */
  readonly field: string;
  readonly label: string;
  readonly type: ShippingFieldType;
  readonly options?: readonly ShippingFieldOption[];
  readonly allowEmpty?: boolean;
  readonly decimals?: number;
  readonly group?: string;
  readonly description?: string;
  /** Options are filled at runtime from `/api/shipments/facets` (warehouses, clients, carriers). */
  readonly facet?: ShippingFacetKey;
}

export const SHIPPING_FACET_KEYS = ["warehouses", "clients", "carriers", "carrierAccounts", "services"] as const;
export type ShippingFacetKey = (typeof SHIPPING_FACET_KEYS)[number];

export type ShippingFacets = Readonly<Record<ShippingFacetKey, readonly ShippingFieldOption[]>>;

export const optionsOf = (values: readonly string[]): readonly ShippingFieldOption[] => values.map((value) => ({ value, label: value }));

/** Fills facet-driven enum options; fields whose facet is still loading fall back to text search. */
export function withFacets(fields: readonly ShippingField[], facets: ShippingFacets | null | undefined): readonly ShippingField[] {
  return fields.map((f) => {
    if (!f.facet) return f;
    const options = facets?.[f.facet];
    return options && options.length > 0 ? { ...f, type: "enum" as const, options } : { ...f, type: "text" as const };
  });
}

export const YES_NO_OPTIONS: readonly ShippingFieldOption[] = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];
