/** Row shapes of the count grids (M07). PURE: shared by the API and the UI. */
import type { CountLineStatus, CountPlanStatus } from '@/lib/enums';
import type { CountOperationType, CountType } from './count-grids';

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
  /** Cycle Count wave rule that generated the plan (scheduled / recurring counts). */
  readonly waveRuleId?: string | null;
  readonly waveRuleName?: string | null;
  readonly jobCodes: string | null;
  /** "id|code;id|code" (list endpoint only; parse with `parseJobRefs`). */
  readonly jobRefs?: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly skuCount: number;
  readonly countedSkuCount: number;
  readonly locationCount: number;
  readonly countedLocationCount: number;
  readonly lineCount: number;
  readonly countedLineCount: number;
  /** Ready to Count / Count Started lines with no live (pending or started) count task: their job was cancelled. */
  readonly orphanedLineCount?: number;
  /** Lines in Cancelled status; Number of SKU / Location and lineCount exclude them. */
  readonly cancelledLineCount?: number;
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
  /** The real count line id (SKU Details rows from location plans are per-SKU slices of a line). */
  readonly lineId: string;
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
  /** Item Type / Item Group lookups of the line's product (SKU lines). */
  readonly productType?: string | null;
  readonly productGroup?: string | null;
  /** Loc Type / Loc Group of the line's location, LP Type of its license plate. */
  readonly locationType?: string | null;
  readonly locationGroup?: string | null;
  readonly lpType?: string | null;
  /** SKUs the line covers ("A, B, C"): its SKU, else counted SKUs, else SKUs on hand in its location. */
  readonly skuList?: string | null;
  /** LP count lines: the license plate counted (its location is the line location). */
  readonly lpId?: string | null;
  readonly lpNumber?: string | null;
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
  /** Waiting to be counted with no live count task (its job was cancelled). */
  readonly orphaned?: boolean;
  /** Newest recount raised from this line: its job and status (Location / SKU Details link it). */
  readonly recountJobId?: string | null;
  readonly recountJobCode?: string | null;
  readonly recountLineStatus?: string | null;
  /** On a recount line: the job of the line it recounts. */
  readonly recountOfJobCode?: string | null;
  readonly difference: number | null;
  readonly countUserName: string | null;
  readonly note: string | null;
  readonly inventoryUpdatedAt: string | null;
  readonly inventoryUpdatedByName: string | null;
  readonly version: number;
}
