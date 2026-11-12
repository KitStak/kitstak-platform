/**
 * M12 export providers for the pre-registered grid keys: "integration-logs" (Channel History),
 * "integration-monitoring" (Missing Shipment Orders) and "carrier-errors" (Label Generation).
 * They read the same repository queries as the grids, so exports match the filtered view.
 */
import type { ExportColumn, ExportProvider } from '@/server/exports/types';
import { listCallLogs } from './carriers';
import { listHistory } from './integration-logs';
import { listMissing } from './monitoring';

const col = (key: string, label: string, type?: ExportColumn['type']): ExportColumn =>
  type ? { key, label, type } : { key, label };

export const historyExport: ExportProvider = {
  columns: [
    col('storeName', 'Store name'),
    col('provider', 'Channel'),
    col('method', 'Method'),
    col('startedAt', 'Date', 'datetime'),
    col('status', 'Status'),
    col('successCount', 'Success', 'integer'),
    col('errorCount', 'Error', 'integer'),
    col('totalCount', 'Total', 'integer'),
  ],
  async fetchPage(ctx, page, pageSize) {
    const { rows, total } = await listHistory(ctx.db, ctx.auth, { ...ctx.query, page, pageSize });
    return { rows: rows.map((r) => ({ ...r })), total };
  },
};

export const missingOrdersExport: ExportProvider = {
  columns: [
    col('orderCode', 'Order code'),
    col('channelOrderNumber', 'Channel order number'),
    col('storeName', 'Channel setup name'),
    col('provider', 'Channel'),
    col('clientName', 'Client'),
    col('orderDate', 'Order date', 'datetime'),
    col('lastUpdated', 'Last updated', 'datetime'),
    col('lastErrorCode', 'Last error code'),
    col('status', 'Status'),
  ],
  async fetchPage(ctx, page, pageSize) {
    const { rows, total } = await listMissing(ctx.db, ctx.auth, { ...ctx.query, page, pageSize });
    return { rows: rows.map((r) => ({ ...r })), total };
  },
};

export const labelErrorsExport: ExportProvider = {
  columns: [
    col('at', 'Timestamp', 'datetime'),
    col('step', 'Integration step'),
    col('orderCode', 'Shipment order'),
    col('destinationType', 'Destination type'),
    col('status', 'Status'),
    col('httpCode', 'HTTP code', 'integer'),
    col('error', 'Error'),
    col('responseMs', 'Response time (ms)', 'integer'),
    col('provider', 'Carrier'),
    col('serviceName', 'Shipping option'),
    col('connectionLabel', 'Carrier connection'),
    col('setupName', 'Carrier setup'),
    col('clientName', 'Client'),
    col('userEmail', 'User'),
    col('source', 'Source'),
    col('labelType', 'Label type'),
    col('rateShoppingName', 'Rate shopping name'),
  ],
  async fetchPage(ctx, page, pageSize) {
    const { rows, total } = await listCallLogs(ctx.db, ctx.auth, 'LabelGeneration', {
      ...ctx.query,
      page,
      pageSize,
    });
    return { rows: rows.map((r) => ({ ...r })), total };
  },
};
