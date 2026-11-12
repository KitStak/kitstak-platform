/** Pure re-exports shared by contracts (client-safe: zod + pure schema modules only). */
export type {
  ColumnSettings,
  ColumnType,
  ItemValues,
  StoredCellValue,
  Label,
  LabelColor,
} from '@/server/db/schema/cell-values';

export type ColumnScopeName = 'item' | 'subitem';
