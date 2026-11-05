/** Client-side shapes for the Settings module (mirrors API payloads). */

export type UserRole = "admin" | "manager" | "operator" | "viewer";

export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
}

export interface AuditRow {
  id: string;
  userName: string | null;
  action: string;
  entity: string;
  entityId: string;
  detail: string | null;
  at: string;
}

/** Computed server-side in the settings page and passed down. */
export interface WarehouseCard {
  id: string;
  code: string;
  name: string;
  addressLine: string;
  city: string;
  state: string;
  isDefault: boolean;
  binCount: number;
  zoneCount: number;
  capacityUnits: number;
}

export interface SettingsCounts {
  users: number;
  warehouses: number;
  carriers: number;
  audit: number;
}
