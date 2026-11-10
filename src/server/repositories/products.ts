/**
 * Products grid (M09): `/api/products` list with the KitStaks grid grammar. Field keys come
 * from `@/lib/grid-defs/products/products-grid` so the filter builder and SQL agree.
 * Products are client-scoped (not warehouse-scoped); stock columns sum the viewer's
 * warehouses only.
 */
import { and, sql, type SQL } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { AppError } from "@/server/api/errors";
import { scopedWhere, type Scope } from "@/server/auth/scope";
import { schema } from "@/server/db";
import { compileFilters, escapeLike, type FilterFieldDef } from "@/server/query/filters";
import type { GridQuery } from "@/server/query/grid-query";
import { compileSort, type SortableMap } from "@/server/query/sort";
import { CUSTOM_FIELD_FILTERS, PRODUCT_GRID_FIELDS, PRODUCT_SORT_FIELDS } from "@/lib/grid-defs/products/products-grid";

const p = schema.products;

export interface ProductListRow {
  readonly id: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly clientCode: string;
  readonly sku: string;
  readonly barcode: string;
  readonly barcodes: string;
  readonly name: string;
  readonly imageUrl: string | null;
  readonly status: "Active" | "Inactive";
  readonly productCategory: string;
  readonly kitType: string | null;
  readonly isKit: boolean;
  readonly isFragile: boolean;
  readonly isOversized: boolean;
  readonly isDigital: boolean;
  readonly isHazmat: boolean;
  readonly isInsert: boolean;
  readonly isLiquid: boolean;
  readonly isNonReturnable: boolean;
  readonly isPackagingMaterial: boolean;
  readonly isPoster: boolean;
  readonly isFoldable: boolean;
  readonly isStackable: boolean;
  readonly salesPrice: number;
  readonly purchasePrice: number;
  readonly currency: string;
  readonly uom: string;
  readonly packTypeCount: number;
  readonly trackLot: boolean;
  readonly trackExpiry: boolean;
  readonly trackProductionDate: boolean;
  readonly trackSerial: boolean;
  readonly productType: string | null;
  readonly productGroup: string | null;
  readonly description: string | null;
  readonly taxRate: number;
  readonly fnsku: string | null;
  readonly createdAt: string;
  readonly onHand: number;
  readonly allocated: number;
  readonly available: number;
  readonly version: number;
}

function warehouseList(scope: Scope): SQL {
  if (scope.warehouseIds.length === 0) return sql`(NULL)`;
  return sql`(${sql.join(scope.warehouseIds.map((w) => sql`${w}`), sql`, `)})`;
}

/** Field → SQL expression (correlated, so it works in the list and the count query). */
export function productExpressions(scope: Scope): Readonly<Record<string, SQL>> {
  const wh = warehouseList(scope);
  const onHand = sql`(SELECT COALESCE(SUM(i.on_hand), 0) FROM inventory i WHERE i.product_id = ${p.id} AND i.warehouse_id IN ${wh})`;
  const allocated = sql`(SELECT COALESCE(SUM(i.allocated), 0) FROM inventory i WHERE i.product_id = ${p.id} AND i.warehouse_id IN ${wh})`;
  const damaged = sql`(SELECT COALESCE(SUM(i.damaged), 0) FROM inventory i WHERE i.product_id = ${p.id} AND i.warehouse_id IN ${wh})`;
  return {
    clientId: sql`${p.clientId}`,
    clientName: sql`(SELECT c.name FROM clients c WHERE c.id = ${p.clientId})`,
    sku: sql`${p.sku}`,
    barcode: sql`${p.barcode}`,
    name: sql`${p.name}`,
    status: sql`${p.status}`,
    productCategory: sql`${p.productCategory}`,
    isKit: sql`${p.isKit}`,
    isFragile: sql`${p.isFragile}`,
    isOversized: sql`${p.isOversized}`,
    isDigital: sql`${p.isDigital}`,
    isHazmat: sql`${p.isHazmat}`,
    isInsert: sql`${p.isInsert}`,
    isLiquid: sql`${p.isLiquid}`,
    isNonReturnable: sql`${p.isNonReturnable}`,
    isReturnable: sql`(CASE WHEN ${p.isNonReturnable} = 1 THEN 0 ELSE 1 END)`,
    isPackagingMaterial: sql`(CASE WHEN ${p.productCategory} = 'Packaging Material' THEN 1 ELSE 0 END)`,
    isPoster: sql`${p.isPoster}`,
    isFoldable: sql`${p.isFoldable}`,
    isStackable: sql`${p.isStackable}`,
    salesPrice: sql`${p.price}`,
    purchasePrice: sql`${p.purchasePrice}`,
    uom: sql`${p.uom}`,
    packType: sql`${p.uom}`,
    trackLot: sql`${p.trackLot}`,
    trackExpiry: sql`${p.trackExpiry}`,
    trackProductionDate: sql`${p.trackProductionDate}`,
    trackSerial: sql`${p.trackSerial}`,
    productType: sql`(SELECT lv.name FROM lookup_values lv WHERE lv.id = ${p.productTypeId})`,
    productGroup: sql`(SELECT lv.name FROM lookup_values lv WHERE lv.id = ${p.productGroupId})`,
    description: sql`${p.description}`,
    taxRate: sql`${p.taxRate}`,
    fnsku: sql`${p.fnsku}`,
    shelfLifeDays: sql`${p.shelfLifeDays}`,
    createdAt: sql`${p.createdAt}`,
    onHand,
    allocated,
    available: sql`(${onHand} - ${allocated} - ${damaged})`,
  };
}

export function productFilterDefs(scope: Scope): readonly FilterFieldDef[] {
  const exprs = productExpressions(scope);
  return PRODUCT_GRID_FIELDS.map((f): FilterFieldDef => {
    const slot = CUSTOM_FIELD_FILTERS[f.field];
    const base = { key: f.field, label: f.label, type: f.type, nullable: true };
    if (slot) return { ...base, customField: { column: p.customFields, key: slot } };
    const expr = exprs[f.field];
    if (!expr) throw new Error(`products grid: no SQL for "${f.field}"`);
    return { ...base, sql: expr, ...(f.options ? { options: f.options.map((v) => ({ value: v, label: v })) } : {}) };
  });
}

/** Quick search: SKU / name, or any pack-type barcode (Equal / Starts With). */
export function productQuickSearch(q: string | undefined, mode: "eq" | "sw"): SQL | undefined {
  const text = q?.trim();
  if (!text) return undefined;
  const match = (expr: SQL): SQL => (mode === "eq" ? sql`lower(${expr}) = lower(${text})` : sql`${expr} LIKE ${`${escapeLike(text)}%`} ESCAPE '\\'`);
  const barcode = match(sql`b.barcode`);
  return sql`(${match(sql`${p.sku}`)} OR ${match(sql`${p.name}`)} OR ${match(sql`${p.barcode}`)} OR ${match(sql`${p.fnsku}`)}
    OR EXISTS (SELECT 1 FROM product_barcodes b WHERE b.product_id = ${p.id} AND ${barcode}))`;
}

export function productWhere(scope: Scope, query: GridQuery): SQL | undefined {
  const parts = [scopedWhere(p, scope), productQuickSearch(query.q, query.qm), compileFilters(productFilterDefs(scope), query.filters)]
    .filter((x): x is SQL => x !== undefined);
  return parts.length ? and(...parts) : undefined;
}

export function productOrderBy(scope: Scope, query: GridQuery): SQL[] {
  const exprs = productExpressions(scope);
  const sortable: SortableMap = Object.fromEntries(PRODUCT_SORT_FIELDS.map((f) => {
    const e = exprs[f];
    if (!e) throw new AppError("VALIDATION", `Cannot sort by "${f}"`);
    return [f, e];
  }));
  // Newest first by default (Logiwa: a created product appears first).
  return compileSort(sortable, query.sort, { defaultSort: [{ field: "createdAt", dir: "desc" }], tiebreaker: p.id, nullsLast: true });
}

type RawRow = Record<string, unknown>;

const bool = (v: unknown): boolean => v === 1 || v === true || v === "1";
const numOf = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0) || 0);

export function mapListRow(r: RawRow): ProductListRow {
  return {
    id: String(r.id), clientId: String(r.clientId), clientName: String(r.clientName ?? ""), clientCode: String(r.clientCode ?? ""),
    sku: String(r.sku), barcode: String(r.barcode ?? ""), barcodes: String(r.barcodes ?? ""), name: String(r.name),
    imageUrl: (r.imageUrl as string | null) ?? null, status: r.status === "Inactive" ? "Inactive" : "Active",
    productCategory: String(r.productCategory), kitType: (r.kitType as string | null) ?? null, isKit: bool(r.isKit),
    isFragile: bool(r.isFragile), isOversized: bool(r.isOversized), isDigital: bool(r.isDigital), isHazmat: bool(r.isHazmat),
    isInsert: bool(r.isInsert), isLiquid: bool(r.isLiquid), isNonReturnable: bool(r.isNonReturnable),
    isPackagingMaterial: r.productCategory === "Packaging Material", isPoster: bool(r.isPoster), isFoldable: bool(r.isFoldable),
    isStackable: bool(r.isStackable), salesPrice: numOf(r.salesPrice), purchasePrice: numOf(r.purchasePrice), currency: String(r.currency ?? "USD"),
    uom: String(r.uom ?? ""), packTypeCount: numOf(r.packTypeCount), trackLot: bool(r.trackLot), trackExpiry: bool(r.trackExpiry),
    trackProductionDate: bool(r.trackProductionDate), trackSerial: bool(r.trackSerial),
    productType: (r.productType as string | null) ?? null, productGroup: (r.productGroup as string | null) ?? null,
    description: (r.description as string | null) ?? null, taxRate: numOf(r.taxRate), fnsku: (r.fnsku as string | null) ?? null,
    createdAt: String(r.createdAt), onHand: numOf(r.onHand), allocated: numOf(r.allocated), available: numOf(r.available), version: numOf(r.version),
  };
}

export function listProducts(db: AppDb, scope: Scope, query: GridQuery, idsOnly?: readonly string[]): { rows: ProductListRow[]; total: number } {
  const e = productExpressions(scope);
  const base = productWhere(scope, query);
  const where = idsOnly ? and(base, sql`${p.id} IN (${sql.join(idsOnly.map((id) => sql`${id}`), sql`, `)})`) : base;
  const whereSql = where ? sql`WHERE ${where}` : sql``;
  const order = productOrderBy(scope, query);
  const offset = (Math.max(1, query.page) - 1) * query.pageSize;
  const rows = db.all<RawRow>(sql`
    SELECT ${p.id} AS id, ${p.clientId} AS clientId, ${e.clientName} AS clientName,
      (SELECT c.code FROM clients c WHERE c.id = ${p.clientId}) AS clientCode,
      ${p.sku} AS sku, ${p.barcode} AS barcode,
      (SELECT group_concat(b.barcode, ', ') FROM product_barcodes b WHERE b.product_id = ${p.id}) AS barcodes,
      ${p.name} AS name, ${p.imageUrl} AS imageUrl, ${p.status} AS status, ${p.productCategory} AS productCategory,
      ${p.kitType} AS kitType, ${p.isKit} AS isKit, ${p.isFragile} AS isFragile, ${p.isOversized} AS isOversized,
      ${p.isDigital} AS isDigital, ${p.isHazmat} AS isHazmat, ${p.isInsert} AS isInsert, ${p.isLiquid} AS isLiquid,
      ${p.isNonReturnable} AS isNonReturnable, ${p.isPoster} AS isPoster, ${p.isFoldable} AS isFoldable,
      ${p.isStackable} AS isStackable, ${p.price} AS salesPrice, ${p.purchasePrice} AS purchasePrice, ${p.currency} AS currency,
      ${p.uom} AS uom, (SELECT COUNT(*) FROM product_pack_types pt WHERE pt.product_id = ${p.id}) AS packTypeCount,
      ${p.trackLot} AS trackLot, ${p.trackExpiry} AS trackExpiry, ${p.trackProductionDate} AS trackProductionDate,
      ${p.trackSerial} AS trackSerial, ${e.productType} AS productType, ${e.productGroup} AS productGroup,
      ${p.description} AS description, ${p.taxRate} AS taxRate, ${p.fnsku} AS fnsku, ${p.createdAt} AS createdAt,
      ${e.onHand} AS onHand, ${e.allocated} AS allocated, ${e.available} AS available, ${p.version} AS version
    FROM ${p} ${whereSql}
    ORDER BY ${sql.join(order, sql`, `)}
    LIMIT ${query.pageSize} OFFSET ${offset}`);
  const total = db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM ${p} ${whereSql}`)?.n ?? 0;
  return { rows: rows.map(mapListRow), total: Number(total) };
}
