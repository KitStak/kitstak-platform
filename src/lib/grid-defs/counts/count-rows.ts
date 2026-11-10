/** Row shapes of the count grids (M07). PURE: shared by the API and the UI. */
import type { CountLineStatus, CountPlanStatus } from "@/lib/enums";
import type { CountOperationType, CountType } from "./count-grids";

export interface CountPlanListRow {
  readonly id: string;
  readonly code: string;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly description: string | null;
  readonly scheduledAt: string;
  readonly lockLocations: boolean;
  readonly countType: CountType;
  readonly operationType: CountOperationType;
  readonly status: CountPlanStatus;
  readonly isAi: boolean;
  readonly jobCodes: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly skuCount: number;
  readonly countedSkuCount: number;
  readonly locationCount: number;
  readonly countedLocationCount: number;
  readonly lineCount: number;
  readonly countedLineCount: number;
  readonly countObject: string | null;
  readonly countObjectTotal: number;
  readonly createdAt: string;
  readonly createdByName: string | null;
  readonly inventoryUpdatedAt: string | null;
  readonly inventoryUpdatedByName: string | null;
  readonly version: number;
}

export interface CountLineListRow {
  readonly id: string;
  readonly planId: string;
  readonly planCode: string;
  readonly planStatus: CountPlanStatus;
  readonly countType: CountType;
  readonly lockLocations: boolean;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly locationId: string | null;
  readonly locationCode: string | null;
  readonly productId: string | null;
  readonly sku: string | null;
  readonly productName: string | null;
  readonly jobId: string | null;
  readonly jobCode: string | null;
  readonly operationType: CountOperationType;
  readonly createdByName: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly status: CountLineStatus;
  readonly skuCount: number;
  readonly approvedStockQty: number | null;
  readonly initialStockQty: number;
  readonly approvedCountQty: number | null;
  readonly countedQty: number | null;
  readonly isRecountLine: boolean;
  readonly recounted: boolean;
  readonly difference: number | null;
  readonly countUserName: string | null;
  readonly note: string | null;
  readonly inventoryUpdatedAt: string | null;
  readonly inventoryUpdatedByName: string | null;
  readonly version: number;
}
