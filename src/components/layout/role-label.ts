/** Same names as the system roles in the Roles grid (permission-catalog SYSTEM_ROLES). */
const ROLE_LABELS: Readonly<Record<string, string>> = { admin: "Admin", manager: "Supervisor", operator: "Warehouse Clerk", viewer: "Viewer" };

/** Display label for a legacy users.role value (shared by the user menu and My Profile). */
export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role.charAt(0).toUpperCase() + role.slice(1);
}
