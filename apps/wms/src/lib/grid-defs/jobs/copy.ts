/** Operation- and task-type-specific help copy for M03 wizards and dialogs (pure). */

/** "Select job types" help, specific to the wave operation. */
export function jobTypesCopy(op: string): string {
  switch (op) {
    case 'AI Job':
      return 'Select at least one picking job type; orders are matched top to bottom and allocated with its algorithm. The AI then regroups them into AI-SingleItemBatchPick, AI-IdenticalOrderBatchPick and AI-OrderBasedPickPack jobs and sequences every pick for the shortest walk.';
    case 'Cycle Count':
      return 'Select at least one count job type. Each run builds a count plan from the first checked type whose location or SKU conditions match; drag to change the precedence.';
    case 'Replenishment':
      return 'Select at least one replenishment job type. Each run compares pick faces with their min / max levels and creates replenishment tasks with the first checked type (its FEFO / FIFO / LIFO method, flow and LP swap settings); drag to change the precedence.';
    default:
      return 'Select at least one job type. Orders are matched to the checked types from top to bottom; drag to change the precedence.';
  }
}

/** Execute "Target location" help, specific to the task type(s) selected. */
export function targetHint(types: readonly string[]): string {
  const kinds = new Set(types);
  if (kinds.size !== 1) return 'Where the units of the selected tasks go, e.g. a staging location.';
  switch ([...kinds][0]) {
    case 'Picking':
      return 'Where the picked units go, e.g. the packing station or a staging location.';
    case 'Packing':
      return 'Where the packed cartons go, e.g. the shipping dock or a staging lane.';
    case 'Sorting':
      return 'The sort location or putwall slot that receives the units.';
    case 'Loading':
      return 'The loading dock or trailer location the packages are loaded into.';
    case 'Kitting':
      return 'Where the kit components go for assembly, e.g. the kitting station.';
    case 'Replenishment':
      return 'The pick face (or the cart, during the pick phase) that receives the replenished units.';
    case 'Count':
      return 'The location being counted.';
    default:
      return 'Where the units of the selected task go.';
  }
}
