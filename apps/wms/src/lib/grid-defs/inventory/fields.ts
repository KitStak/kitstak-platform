/**
 * Shared shape of the inventory grid definitions (pure TS, imported by the client
 * filter builder and by the server grid compiler in `src/server/repositories/inventory-grid.ts`).
 *
 * `field` is the `f.<field>` / `sort=<field>` key AND the SQL alias in the server's
 * inner select, so client, URL and SQL always agree on a name. `filterAlias` lets a
 * display column filter on a different alias (Warehouse shows the name, filters by id).
 */
export type InventoryFieldType = 'enum' | 'text' | 'number' | 'date';

/** Enum fields whose options come from the viewer's scope / lookups at runtime. */
export type DynamicOptions = 'warehouse' | 'client' | 'damageReason';

export interface InventoryGridField {
  readonly field: string;
  readonly label: string;
  readonly type: InventoryFieldType;
  readonly options?: readonly string[];
  readonly dynamicOptions?: DynamicOptions;
  /** Offer an "Empty" choice in the enum editor. */
  readonly allowEmpty?: boolean;
  /** Alias the filter compares against (defaults to `field`). */
  readonly filterAlias?: string;
  /** Stored as YYYY-MM-DD. */
  readonly dateOnly?: boolean;
}

export interface InventoryGridDef {
  readonly gridKey: string;
  readonly fields: readonly InventoryGridField[];
  /** Aliases the grid may sort on. */
  readonly sortable: readonly string[];
  /** Quick search (Equal / Starts With) targets. */
  readonly search: readonly string[];
  /** Applied when the URL carries no sort. "-x" = descending. */
  readonly defaultSort: readonly string[];
}

export interface InventoryExportColumn {
  readonly key: string;
  readonly label: string;
  readonly type?: 'text' | 'integer' | 'number' | 'date' | 'datetime';
}
