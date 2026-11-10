/**
 * Workflow action executor contract (BUILD_PLAN 0.6 stub-handoff, owner M12).
 * `runWorkflows()` (src/server/domain/workflows.ts) dispatches each matched action here.
 */
import type { WORKFLOW_ACTIONS } from "@/lib/enums";
import type { DomainCtx, Tx } from "@/server/domain/types";

export type WorkflowActionName = (typeof WORKFLOW_ACTIONS)[number];

export interface WorkflowEntityRef {
  readonly type: "shipment_order" | "purchase_order";
  readonly id: string;
}

export interface WorkflowActionInput {
  readonly entity: WorkflowEntityRef;
  readonly params: Readonly<Record<string, unknown>>;
  readonly workflowId: string;
  readonly workflowName: string;
}

export interface WorkflowActionResult {
  readonly applied: boolean;
  /** Block actions report how the entity was blocked. */
  readonly blockType?: "Fully" | "Partially";
  readonly message?: string;
}

export type WorkflowActionExecutor = (tx: Tx, ctx: DomainCtx, input: WorkflowActionInput) => WorkflowActionResult;
