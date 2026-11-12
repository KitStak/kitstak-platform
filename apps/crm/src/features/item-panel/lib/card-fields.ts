import type { ColumnDto } from '@/server/services/contracts/dto';

/**
 * Columns shown as editable fields on the item card: only the scope that applies to this
 * item (subitem columns for subitems, item columns otherwise), and never the name column.
 */
export function cardFields(columns: readonly ColumnDto[], parentItemId: string | null): ColumnDto[] {
  const scope = parentItemId ? 'subitem' : 'item';
  return columns.filter((column) => column.scope === scope && column.type !== 'name');
}
