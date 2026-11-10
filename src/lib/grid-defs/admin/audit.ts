/** Audit Log grid (security events) definitions (M14). PURE. */
import { AUDIT_OUTCOMES } from "@/lib/enums";
import type { AdminField } from "./common";

export const AUDIT_GRID_KEY = "audit-log";

export const AUDIT_CATEGORIES = ["Sign-in", "Session", "Password", "CSRF rejected", "Permission denied", "User change", "Role change", "Settings change", "Other"] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

/** Maps an action key to its category (mirrors the SQL CASE in the repository). */
export function auditCategory(action: string): AuditCategory {
  if (action.startsWith("auth.login")) return "Sign-in";
  if (action.startsWith("auth.logout") || action.startsWith("session.")) return "Session";
  if (action.startsWith("auth.password") || action === "user.password_reset") return "Password";
  if (action.startsWith("security.csrf")) return "CSRF rejected";
  if (action.startsWith("security.permission")) return "Permission denied";
  if (action.startsWith("user.")) return "User change";
  if (action.startsWith("role.")) return "Role change";
  if (action.startsWith("company.") || action.startsWith("app.") || action.startsWith("printout.") || action.startsWith("screen_config.") || action.startsWith("lookup.") || action.startsWith("sequence.")) return "Settings change";
  return "Other";
}

const ACTION_LABELS: Readonly<Record<string, string>> = {
  "auth.login": "Sign in",
  "auth.login.rate_limited": "Sign in blocked (too many attempts)",
  "auth.logout": "Sign out",
  "auth.logout_all": "Signed out of all devices",
  "auth.password_change": "Password changed",
  "auth.password_reset.request": "Password reset requested",
  "auth.password_reset.complete": "Password reset completed",
  "security.csrf_rejected": "Request blocked (CSRF)",
  "security.permission_denied": "Permission denied",
  "session.revoke": "Session revoked",
  "session.revoke_all": "All sessions revoked",
  "user.create": "User created",
  "user.update": "User updated",
  "user.activate": "User activated",
  "user.deactivate": "User deactivated",
  "user.password_reset": "Password reset by administrator",
  "user.profile_update": "Profile updated",
  "role.create": "Role created",
  "role.update": "Role permissions updated",
  "role.duplicate": "Role duplicated",
  "role.delete": "Role deleted",
  "role.restrictions": "Role restrictions changed",
  "company.update": "Company settings updated",
  "company.security": "Password policy changed",
  "app.activate": "App activated",
  "app.deactivate": "App deactivated",
};

export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/[._]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export const AUDIT_FIELDS: readonly AdminField[] = [
  { field: "at", label: "Date", type: "date" },
  { field: "category", label: "Event type", type: "enum", options: AUDIT_CATEGORIES },
  { field: "action", label: "Action", type: "text" },
  { field: "outcome", label: "Outcome", type: "enum", options: AUDIT_OUTCOMES },
  { field: "userId", label: "User", type: "enum" },
  { field: "userEmail", label: "User email", type: "text" },
  { field: "ip", label: "IP address", type: "text" },
  { field: "entityLabel", label: "Target", type: "text" },
];

export const AUDIT_SORT_FIELDS = ["at", "category", "action", "outcome", "userName", "ip"] as const;
export const AUDIT_SEARCH_FIELDS = ["userEmail", "action", "ip", "entityLabel"] as const;
