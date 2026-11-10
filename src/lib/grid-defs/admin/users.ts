/** Users grid + Add/Edit User wizard schemas (M14). PURE. */
import { z } from "zod";
import { USER_TYPES } from "@/lib/enums";
import { emailField, idField, requiredText, versionField, type AdminField } from "./common";

export const USERS_GRID_KEY = "users";

/** Logiwa offers Operation / Client on create; Owner is the account owner (seeded). */
export const CREATABLE_USER_TYPES = ["Operation", "Client"] as const;
export const USER_STATUS = ["Active", "Inactive"] as const;

export const USER_FIELDS: readonly AdminField[] = [
  { field: "name", label: "Display name", type: "text" },
  { field: "email", label: "Email", type: "text" },
  { field: "roleId", label: "Role", type: "enum" },
  { field: "warehouseId", label: "Warehouse", type: "enum" },
  { field: "userType", label: "User type", type: "enum", options: USER_TYPES },
  { field: "status", label: "User status", type: "enum", options: USER_STATUS },
  { field: "isApiUser", label: "Is API user?", type: "boolean" },
  { field: "lastLoginAt", label: "Last sign-in", type: "date" },
  { field: "createdAt", label: "Created date", type: "date" },
];

export const USER_SORT_FIELDS = ["name", "email", "userType", "status", "isApiUser", "lastLoginAt", "createdAt", "roleNames", "warehouseCodes"] as const;
export const USER_SEARCH_FIELDS = ["email", "name"] as const;

/* ---------------- wizard ---------------- */

const nameShape = {
  firstName: requiredText("First name", 60),
  lastName: requiredText("Last name", 60),
  email: emailField,
  userType: z.enum(USER_TYPES, { error: "Choose a user type" }),
  sendWelcomeEmail: z.boolean().default(false),
  isActive: z.boolean().default(true),
};

const passwordShape = {
  password: z.string().max(200).default(""),
  confirmPassword: z.string().max(200).default(""),
};

function checkPasswords(requirePassword: boolean) {
  return (v: { password: string; confirmPassword: string }, ctx: z.RefinementCtx) => {
    if (requirePassword && v.password.length === 0) ctx.addIssue({ code: "custom", path: ["password"], message: "Password is required" });
    if (v.password.length > 0 && v.confirmPassword !== v.password) ctx.addIssue({ code: "custom", path: ["confirmPassword"], message: "Passwords do not match" });
  };
}

/** Step 1 (create): the password is required. */
export const userInfoCreateSchema = z.object({ ...nameShape, ...passwordShape }).superRefine(checkPasswords(true));
/** Step 1 (edit): leave the password blank to keep it. */
export const userInfoEditSchema = z.object({ ...nameShape, ...passwordShape }).superRefine(checkPasswords(false));

export const userRolesStepSchema = z.object({ roleIds: z.array(idField).min(1, "Assign at least one role") });
export const userWarehousesStepSchema = z.object({ warehouseIds: z.array(idField).min(1, "Give access to at least one warehouse") });
export const userClientsStepSchema = z
  .object({ allClients: z.boolean(), clientIds: z.array(idField).max(5000) })
  .superRefine((v, ctx) => {
    if (!v.allClients && v.clientIds.length === 0) ctx.addIssue({ code: "custom", path: ["clientIds"], message: "Select at least one client, or give access to all clients" });
  });

const fullShape = {
  ...nameShape,
  ...passwordShape,
  roleIds: z.array(idField).min(1, "Assign at least one role").max(50),
  warehouseIds: z.array(idField).min(1, "Give access to at least one warehouse").max(200),
  allClients: z.boolean(),
  clientIds: z.array(idField).max(5000).default([]),
  version: versionField,
};

function checkClients(v: { allClients: boolean; clientIds: readonly string[] }, ctx: z.RefinementCtx) {
  if (!v.allClients && v.clientIds.length === 0) ctx.addIssue({ code: "custom", path: ["clientIds"], message: "Select at least one client, or give access to all clients" });
}

export const userCreateSchema = z.object(fullShape).superRefine((v, ctx) => { checkPasswords(true)(v, ctx); checkClients(v, ctx); });
export const userUpdateSchema = z.object(fullShape).superRefine((v, ctx) => { checkPasswords(false)(v, ctx); checkClients(v, ctx); });

export type UserFormValues = z.input<typeof userCreateSchema>;
export type UserSave = z.output<typeof userCreateSchema>;

export const USER_FORM_DEFAULTS: UserFormValues = {
  firstName: "", lastName: "", email: "", userType: "Operation", password: "", confirmPassword: "",
  sendWelcomeEmail: true, isActive: true, roleIds: [], warehouseIds: [], allClients: true, clientIds: [],
};

export const userStatusSchema = z.object({ isActive: z.boolean(), version: versionField });
