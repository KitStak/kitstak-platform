const ROLE_LABELS: Readonly<Record<string, string>> = { admin: "Administrator", manager: "Supervisor", operator: "Operator", viewer: "Viewer" };

/** Display label for a legacy users.role value (shared by the user menu and My Profile). */
export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role.charAt(0).toUpperCase() + role.slice(1);
}
