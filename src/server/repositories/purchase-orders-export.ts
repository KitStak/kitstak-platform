/**
 * Export providers for the M05 grids (wired by `src/server/exports/providers/{purchase-orders,
 * receiving-history,vendors}.ts`). Each reads the same repository query as the list
 * endpoint, so "Export As Excel" matches the filtered grid exactly.
 */
import type { ExportProvider, ExportRow } from "@/server/exports/types";
import { listPurchaseOrders } from "./purchase-orders";
import { listReceipts } from "./receipts";
import { listVendors } from "./vendors";
import { listPutawayTasks } from "./putaway-worklist";

export const purchaseOrdersExport: ExportProvider = {
  columns: [
    { key: "code", label: "PO Number" }, { key: "vendorName", label: "Vendor" }, { key: "referenceNumber", label: "Reference Number" },
    { key: "purchasePrice", label: "Purchase Price", type: "money" }, { key: "totalQuantity", label: "Total Quantity", type: "integer" },
    { key: "status", label: "Status" }, { key: "poType", label: "PO Type" }, { key: "tagNames", label: "Tags" },
    { key: "poDate", label: "PO Date", type: "datetime" }, { key: "clientName", label: "Client" }, { key: "warehouseName", label: "Warehouse" },
    { key: "createdAt", label: "Created Date", type: "datetime" }, { key: "plannedReceivingDate", label: "Planned Receiving Date", type: "datetime" },
    { key: "receivedAt", label: "Actual Receiving Date", type: "datetime" }, { key: "plannedArrivalDate", label: "Planned Arrival Date", type: "datetime" },
    { key: "actualArrivalDate", label: "Actual Arrival Date", type: "datetime" },
  ],
  fetchPage(ctx, page, pageSize) {
    const { rows, total } = listPurchaseOrders(ctx.db, ctx.auth, { ...ctx.query, page, pageSize });
    const out: readonly ExportRow[] = rows.map((r) => ({ ...r, tagNames: r.tags.map((t) => t.name).join(", ") }));
    return { rows: out, total };
  },
};

export const receivingHistoryExport: ExportProvider = {
  columns: [
    { key: "masterId", label: "Master Id", type: "integer" }, { key: "poCode", label: "PO Number" }, { key: "poType", label: "PO Type" },
    { key: "sku", label: "SKU" }, { key: "productName", label: "Product Name" }, { key: "barcode", label: "Barcode" },
    { key: "lotNumber", label: "Lot/Batch Number" }, { key: "expiryDate", label: "Expiry Date", type: "date" }, { key: "quantity", label: "Quantity", type: "integer" },
    { key: "imageUrl", label: "Product Photo(s)" }, { key: "packType", label: "Pack Type" }, { key: "uomPackType", label: "UOM Pack Type" },
    { key: "uomQuantity", label: "UOM Quantity", type: "integer" }, { key: "receivedAt", label: "Receiving Date", type: "datetime" },
    { key: "type", label: "Receiving Type" }, { key: "skuDetailsUpdated", label: "SKU Details Updated", type: "boolean" }, { key: "note", label: "Note" },
    { key: "lineNote", label: "Purchase Order Line Note" }, { key: "actualReturnReason", label: "Actual Return Reason" },
    { key: "customerReturnReason", label: "Customer Return Reason" }, { key: "clientName", label: "Client" }, { key: "warehouseName", label: "Warehouse" },
    { key: "locationCode", label: "Location" }, { key: "workOrderCode", label: "Work Order Code" }, { key: "shipmentOrderCode", label: "Shipment Order Code" },
    { key: "rmaNumber", label: "RMA Number" }, { key: "lpNumber", label: "LPN" }, { key: "lpType", label: "LP Type" }, { key: "parentLpNumber", label: "Parent LP" },
    { key: "parentLpType", label: "Parent LP Type" }, { key: "damageReason", label: "Damage Reason" }, { key: "damageImage", label: "Damage Image" },
    { key: "receivedBy", label: "Receiving User" }, { key: "productionDate", label: "Production Date", type: "date" },
  ],
  fetchPage(ctx, page, pageSize) {
    const { rows, total } = listReceipts(ctx.db, ctx.auth, { ...ctx.query, page, pageSize });
    const out: readonly ExportRow[] = rows.map((r) => ({ ...r, damageImage: r.damageImageFileId ? "Yes" : "" }));
    return { rows: out, total };
  },
};

export const vendorsExport: ExportProvider = {
  columns: [
    { key: "displayName", label: "Vendor Display Name" }, { key: "vendorName", label: "Vendor Name" }, { key: "clientName", label: "Client" },
    { key: "isActive", label: "Active", type: "boolean" }, { key: "openPoCount", label: "Open POs", type: "integer" },
    { key: "city", label: "City" }, { key: "state", label: "State" },
  ],
  fetchPage(ctx, page, pageSize) {
    const { rows, total } = listVendors(ctx.db, ctx.auth, { ...ctx.query, page, pageSize });
    const out: readonly ExportRow[] = rows.map((r) => ({ ...r }));
    return { rows: out, total };
  },
};

/** Putaway worklist (`putaway-worklist`): wired by `src/server/exports/providers/putaway-worklist.ts`. */
export const putawayWorklistExport: ExportProvider = {
  columns: [
    { key: "warehouseName", label: "Warehouse" }, { key: "clientName", label: "Client" }, { key: "sku", label: "SKU" },
    { key: "productName", label: "Product Name" }, { key: "barcode", label: "Barcode" }, { key: "fromLocationCode", label: "Location" },
    { key: "qty", label: "Quantity", type: "integer" }, { key: "packType", label: "Pack Type" }, { key: "lotNumber", label: "Lot/Batch Number" },
    { key: "expiryDate", label: "Expiry Date", type: "date" }, { key: "lpNumber", label: "LPN" }, { key: "poNumber", label: "PO Number" },
    { key: "receivedAt", label: "Receiving Date", type: "datetime" }, { key: "dwellHours", label: "Waiting (Hours)", type: "integer" },
    { key: "blockedReason", label: "Blocked Reason" },
  ],
  fetchPage(ctx, page, pageSize) {
    const { rows, total } = listPutawayTasks(ctx.db, ctx.auth, { ...ctx.query, page, pageSize });
    return { rows: rows.map((r) => ({ ...r })) as readonly ExportRow[], total };
  },
};
