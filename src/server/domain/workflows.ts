/**
 * Workflow engine (BUILD_PLAN F5 `workflows.ts`): evaluates the active workflows of a
 * trigger in sequence (honouring stop-processing), dispatches matched actions to
 * `src/server/workflows/actions` (M12) and writes `workflow_runs`.
 */
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import type { WORKFLOW_TRIGGERS } from "@/lib/enums";
import * as schema from "@/server/db/schema";
import {
  getWorkflowActionExecutor, type WorkflowActionExecutor, type WorkflowActionName, type WorkflowEntityRef,
} from "@/server/workflows/actions";
import { evaluateConditions, type Facts } from "./conditions";
import { describeError, DomainError } from "./errors";
import { orderFacts } from "./facts";
import { nowIso, type DomainCtx, type Tx } from "./types";

export type WorkflowTrigger = (typeof WORKFLOW_TRIGGERS)[number];

export interface WorkflowRunSummary {
  readonly workflowId: string;
  readonly name: string;
  readonly matched: boolean;
  readonly actionsApplied: readonly string[];
  readonly blockType: "Fully" | "Partially" | null;
  readonly errors: readonly string[];
}

export interface RunWorkflowsOptions {
  /** Overrides the registered executors (tests, previews). */
  readonly executors?: Partial<Record<WorkflowActionName, WorkflowActionExecutor>>;
}

/** Facts + scope of a workflow entity (also used by the M12 builder test). */
export function workflowEntityScope(tx: Tx, entity: WorkflowEntityRef): { facts: Facts; warehouseId: string; clientId: string } {
  if (entity.type === "shipment_order") {
    const order = tx.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, entity.id)).get();
    if (!order) throw new DomainError("NOT_FOUND", "Shipment order not found");
    return { facts: orderFacts(tx, order), warehouseId: order.warehouseId, clientId: order.clientId };
  }
  const po = tx.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, entity.id)).get();
  if (!po) throw new DomainError("NOT_FOUND", "Purchase order not found");
  // Purchase-order facts (M12 workflow catalog `purchaseOrder`, rule-fields.ts).
  const lines = tx.select({ sku: schema.products.sku }).from(schema.purchaseOrderLines)
    .innerJoin(schema.products, eq(schema.products.id, schema.purchaseOrderLines.productId))
    .where(eq(schema.purchaseOrderLines.purchaseOrderId, po.id)).all();
  return {
    facts: {
      client: po.clientId, warehouse: po.warehouseId, vendor: po.vendorId, vendorName: po.vendorName, poType: po.poType, orderQuantity: po.totalQuantity,
      code: po.code, referenceNumber: po.referenceNumber, poDate: po.poDate, plannedReceivingDate: po.plannedReceivingDate,
      plannedArrivalDate: po.plannedArrivalDate, sku: [...new Set(lines.map((l) => l.sku))], lineCount: lines.length, purchasePrice: po.purchasePrice,
    },
    warehouseId: po.warehouseId, clientId: po.clientId,
  };
}

export function runWorkflows(tx: Tx, ctx: DomainCtx, trigger: WorkflowTrigger, entity: WorkflowEntityRef, opts: RunWorkflowsOptions = {}): WorkflowRunSummary[] {
  const { facts, warehouseId, clientId } = workflowEntityScope(tx, entity);
  const w = schema.workflows;
  const active = tx.select().from(w).where(and(
    eq(w.trigger, trigger), eq(w.isActive, true),
    or(isNull(w.warehouseId), eq(w.warehouseId, warehouseId)), or(isNull(w.clientId), eq(w.clientId, clientId)),
  )).orderBy(asc(w.sequence), asc(w.createdAt)).all();
  const summaries: WorkflowRunSummary[] = [];
  for (const wf of active) {
    const matched = evaluateConditions(wf.conditions, facts, wf.match);
    const applied: string[] = [];
    const errors: string[] = [];
    let blockType: "Fully" | "Partially" | null = null;
    if (matched) {
      for (const action of wf.actions) {
        const executor = opts.executors?.[action.action] ?? getWorkflowActionExecutor(action.action);
        if (!executor) { errors.push(`Action '${action.action}' is not configured yet.`); continue; }
        try {
          const result = tx.transaction((inner) => executor(inner, ctx, { entity, params: action.params, workflowId: wf.id, workflowName: wf.name }));
          if (result.applied) applied.push(action.action);
          if (result.blockType && blockType !== "Fully") blockType = result.blockType;
          if (result.message && !result.applied) errors.push(result.message);
        } catch (error) {
          errors.push(`${action.action}: ${describeError(error).message}`);
        }
      }
      tx.update(w).set({ runCount: sql`${w.runCount} + 1`, lastRunAt: nowIso() }).where(eq(w.id, wf.id)).run();
    }
    tx.insert(schema.workflowRuns).values({
      workflowId: wf.id, entityType: entity.type, entityId: entity.id, matched, actionsApplied: applied,
      blockType, error: errors.length > 0 ? errors.join(" ") : null,
    }).run();
    summaries.push({ workflowId: wf.id, name: wf.name, matched, actionsApplied: applied, blockType, errors });
    if (matched && wf.stopProcessing) break;
  }
  return summaries;
}
