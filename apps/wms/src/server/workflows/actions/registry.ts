/**
 * Workflow action executors (BUILD_PLAN 0.6 handoff, owner M12). One executor per
 * WORKFLOW_ACTIONS entry; `runWorkflows()` dispatches matched actions here.
 */
import type { WorkflowActionExecutor, WorkflowActionName } from './types';
import { blockOrder, partiallyBlockOrder } from './block';
import { addNote, addTag, notifyUsers, setOrderType, setPriority, setWarehouse } from './order-fields';
import { setCarrierService, setRateShoppingPreset, setShipmentPackage } from './shipping';

/** Built lazily: executors import order commands, which import the workflow engine (import cycle). */
const build = (): Readonly<Record<WorkflowActionName, WorkflowActionExecutor>> => ({
  'Block Order': blockOrder,
  'Partially Block Order': partiallyBlockOrder,
  'Set Carrier Service': setCarrierService,
  'Set Rate Shopping Preset': setRateShoppingPreset,
  'Set Priority': setPriority,
  'Add Tag': addTag,
  'Set Warehouse': setWarehouse,
  'Set Shipment Package': setShipmentPackage,
  'Set Order Type': setOrderType,
  'Add Note': addNote,
  'Notify Users': notifyUsers,
});

let cache: Readonly<Record<WorkflowActionName, WorkflowActionExecutor>> | null = null;
export function workflowActionExecutors(): Readonly<Record<WorkflowActionName, WorkflowActionExecutor>> {
  cache ??= build();
  return cache;
}

export function getWorkflowActionExecutor(action: WorkflowActionName): WorkflowActionExecutor | undefined {
  return workflowActionExecutors()[action];
}
