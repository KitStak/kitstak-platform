/** Block Order / Partially Block Order (M12). Fully = not allocatable until released; Partially = soft hold listed for review. */
import type { WorkflowActionExecutor } from "./types";
import { loadOrder, patchOrder } from "./order-patch";

const block = (kind: "Fully" | "Partially"): WorkflowActionExecutor => async (tx, ctx, input) => {
  const order = await loadOrder(tx, input);
  if (order.workflowBlocked === "Fully" && kind === "Partially") return { applied: false, blockType: "Fully", message: `Order ${order.code} is already fully blocked.` };
  await patchOrder(tx, ctx, order, { workflowBlocked: kind }, input.workflowName);
  return { applied: true, blockType: kind, message: `Blocked ${kind.toLowerCase()} by ${input.workflowName}` };
};

export const blockOrder = block("Fully");
export const partiallyBlockOrder = block("Partially");
