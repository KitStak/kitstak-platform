/**
 * Excel export provider for the Shipment Orders grids (`orders-backlog`, `orders-shipped`):
 * the same scoped query as the list endpoint, every column of the view in grid order.
 */
import type { ExportColumn, ExportColumnType, ExportProvider } from '@/server/exports/types';
import { columnsForView, type OrderColumnKind, type OrderView } from '@/lib/grid-defs/orders/shipment-orders';
import { listOrders } from './orders';

const TYPE: Readonly<Record<OrderColumnKind, ExportColumnType>> = {
  text: 'text',
  integer: 'integer',
  number: 'number',
  money: 'money',
  date: 'date',
  datetime: 'datetime',
  boolean: 'boolean',
};

export function exportColumnsFor(view: OrderView): readonly ExportColumn[] {
  return columnsForView(view).map((c) => ({ key: c.id, label: c.label, type: TYPE[c.kind] }));
}

export function createOrdersExportProvider(view: OrderView): ExportProvider {
  return {
    columns: exportColumnsFor(view),
    async fetchPage(ctx, page, pageSize) {
      const { rows, total } = await listOrders(ctx.db, ctx.auth.viewScope, {
        view,
        query: { ...ctx.query, page, pageSize },
      });
      return {
        total,
        rows: rows.map((r) => ({ ...r, tags: r.tags.map((t) => t.name).join(', ') })),
      };
    },
  };
}

export const backlogExportProvider = createOrdersExportProvider('backlog');
export const shippedExportProvider = createOrdersExportProvider('shipped');
