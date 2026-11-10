/**
 * Import handler "po-serials" — STUB (BUILD_PLAN 0.6), owner M05.
 *
 * Foundation owns the template columns (`../registry`) and the pipeline; M05 replaces
 * this file with a configured handler whose `apply` writes through its repositories
 * and the foundation domain functions. Until then uploads are refused as "not configured".
 */
import { createStubHandler, type ImportHandler } from "../types";

export const handler: ImportHandler = createStubHandler("M05", "Purchase order serial number import");
