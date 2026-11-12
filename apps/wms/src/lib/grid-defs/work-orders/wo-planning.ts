/**
 * Work order planning gate (Logiwa parity: planners create/edit/delete work orders; floor
 * operators only execute picking and kitting). Until the foundation catalog drops
 * `inventory.work_orders.{create,edit,delete}` from the operator role (request R2-13), M08 also
 * denies them to users whose only roles are the system Operator/Viewer roles. Custom roles keep
 * whatever the catalog grants them.
 */
export const WO_PLANNING_DENIED_ROLES: ReadonlySet<string> = new Set(['operator', 'viewer']);

export const WO_PLANNING_DENIED_MESSAGE =
  "Warehouse clerks run picking and kitting but can't create, edit or delete work orders";

export function planningDeniedForRoles(roleKeys: readonly string[] | null | undefined): boolean {
  if (!roleKeys || roleKeys.length === 0) return false;
  return roleKeys.every((k) => WO_PLANNING_DENIED_ROLES.has(k));
}
