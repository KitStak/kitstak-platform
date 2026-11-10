/**
 * Import handler "user-roles" — STUB (BUILD_PLAN 0.6), owner M14.
 *
 * Foundation owns the template columns (`../registry`) and the pipeline; M14 replaces
 * this file with a configured handler whose `apply` writes through its repositories
 * and the foundation domain functions. Until then uploads are refused as "not configured".
 */
import { createStubHandler, type ImportHandler } from "../types";

export const handler: ImportHandler = createStubHandler("M14", "User-role import");
