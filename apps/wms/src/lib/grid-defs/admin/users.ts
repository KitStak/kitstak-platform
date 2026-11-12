/** Users grid + Add/Edit User wizard schemas (M14). PURE. */
import { z } from 'zod';
import { USER_TYPES } from '@/lib/enums';
import { emailField, idField, requiredText, versionField, type AdminField } from './common';

export const USERS_GRID_KEY = 'users';

/** Logiwa offers Operation / Client on create; Owner is the account owner (seeded). */
export const CREATABLE_USER_TYPES = ['Operation', 'Client'] as const;
export const USER_STATUS = ['Active', 'Inactive'] as const;

export const USER_FIELDS: readonly AdminField[] = [
  { field: 'name', label: 'Display name', type: 'text' },
  { field: 'email', label: 'Email', type: 'text' },
  { field: 'roleId', label: 'Role', type: 'enum' },
  { field: 'warehouseId', label: 'Warehouse', type: 'enum' },
  { field: 'userType', label: 'User type', type: 'enum', options: USER_TYPES },
  { field: 'status', label: 'User status', type: 'enum', options: USER_STATUS },
  { field: 'isApiUser', label: 'Is API user?', type: 'boolean' },
  { field: 'lastLoginAt', label: 'Last sign-in', type: 'date' },
  { field: 'createdAt', label: 'Created date', type: 'date' },
];

export const USER_SORT_FIELDS = [
  'name',
  'email',
  'userType',
  'status',
  'isApiUser',
  'lastLoginAt',
  'createdAt',
  'roleNames',
  'warehouseCodes',
] as const;
export const USER_SEARCH_FIELDS = ['email', 'name'] as const;

/* ---------------- wizard ---------------- */

const nameShape = {
  firstName: requiredText('First name', 60),
  lastName: requiredText('Last name', 60),
  email: emailField,
  userType: z.enum(USER_TYPES, { error: 'Choose a user type' }),
  sendWelcomeEmail: z.boolean().default(false),
  isActive: z.boolean().default(true),
};

const passwordShape = {
  password: z.string().max(200).default(''),
  confirmPassword: z.string().max(200).default(''),
};

export interface PasswordPolicyLike {
  readonly minLength: number;
  readonly requireUpper: boolean;
  readonly requireNumber: boolean;
  readonly requireSymbol: boolean;
}

/** Unmet policy rules for a password, as short phrases (pure; mirrors the server policy). */
export function unmetPasswordRules(pw: string, policy: PasswordPolicyLike): string[] {
  const out: string[] = [];
  if (pw.length < policy.minLength) out.push(`at least ${policy.minLength} characters`);
  if (policy.requireUpper && !/[A-Z]/.test(pw)) out.push('an uppercase letter');
  if (policy.requireUpper && !/[a-z]/.test(pw)) out.push('a lowercase letter');
  if (policy.requireNumber && !/[0-9]/.test(pw)) out.push('a number');
  if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(pw)) out.push('a symbol');
  return out;
}

function checkPasswords(requirePassword: boolean, policy?: PasswordPolicyLike) {
  return (v: { password?: unknown; confirmPassword?: unknown }, ctx: z.RefinementCtx) => {
    const password = typeof v.password === 'string' ? v.password : '';
    const confirm = typeof v.confirmPassword === 'string' ? v.confirmPassword : '';
    if (requirePassword && password.length === 0)
      ctx.addIssue({ code: 'custom', path: ['password'], message: 'Password is required' });
    else if (password.length > 0 && policy) {
      const unmet = unmetPasswordRules(password, policy);
      if (unmet.length)
        ctx.addIssue({ code: 'custom', path: ['password'], message: `Password needs ${unmet.join(', ')}` });
    }
    if ((requirePassword || password.length > 0) && confirm.length === 0)
      ctx.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'Confirm password is required' });
    else if (password.length > 0 && confirm !== password)
      ctx.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'Passwords do not match' });
  };
}

/**
 * Step 1 schema. Password + confirm are validated together with the name fields, so every
 * required field reports together on the first Next.
 */
export function userInfoSchemaFor(
  isEdit: boolean,
  policy?: PasswordPolicyLike,
  takenEmails?: ReadonlySet<string>,
) {
  return z.object({ ...nameShape, ...passwordShape }).superRefine((v, ctx) => {
    checkPasswords(!isEdit, policy)(v, ctx);
    if (takenEmails && takenEmails.has(normalizeEmail(v.email)))
      ctx.addIssue({ code: 'custom', path: ['email'], message: EMAIL_TAKEN_MESSAGE });
  });
}

export const EMAIL_TAKEN_MESSAGE = 'A user with this email already exists';

/** Lower-cased, trimmed email used for uniqueness checks (mirrors the server). */
export function normalizeEmail(email: unknown): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

/** Shape check worth asking the server about (cheap; the real rule is `emailField`). */
export function looksLikeEmail(email: unknown): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizeEmail(email));
}

/** Step 1 (create): the password is required. */
export const userInfoCreateSchema = userInfoSchemaFor(false);
/** Step 1 (edit): leave the password blank to keep it. */
export const userInfoEditSchema = userInfoSchemaFor(true);

export const userRolesStepSchema = z.object({ roleIds: z.array(idField).min(1, 'Assign at least one role') });
export const userWarehousesStepSchema = z.object({
  warehouseIds: z.array(idField).min(1, 'Give access to at least one warehouse'),
});
export const userClientsStepSchema = z
  .object({ allClients: z.boolean(), clientIds: z.array(idField).max(5000) })
  .superRefine((v, ctx) => {
    if (!v.allClients && v.clientIds.length === 0)
      ctx.addIssue({
        code: 'custom',
        path: ['clientIds'],
        message: 'Select at least one client, or give access to all clients',
      });
  });

const fullShape = {
  ...nameShape,
  ...passwordShape,
  roleIds: z.array(idField).min(1, 'Assign at least one role').max(50),
  warehouseIds: z.array(idField).min(1, 'Give access to at least one warehouse').max(200),
  allClients: z.boolean(),
  clientIds: z.array(idField).max(5000).default([]),
  version: versionField,
};

function checkClients(v: { allClients: boolean; clientIds: readonly string[] }, ctx: z.RefinementCtx) {
  if (!v.allClients && v.clientIds.length === 0)
    ctx.addIssue({
      code: 'custom',
      path: ['clientIds'],
      message: 'Select at least one client, or give access to all clients',
    });
}

export const userCreateSchema = z.object(fullShape).superRefine((v, ctx) => {
  checkPasswords(true)(v, ctx);
  checkClients(v, ctx);
});
export const userUpdateSchema = z.object(fullShape).superRefine((v, ctx) => {
  checkPasswords(false)(v, ctx);
  checkClients(v, ctx);
});

/** Company password-policy check (server: `validatePassword` with the stored policy). */
export type PasswordPolicyCheck = (password: string, email: string) => readonly string[];

/**
 * Save schema with the company password policy folded into the same `superRefine`, so one
 * request reports every field error at once (roles, warehouses, clients AND password rules)
 * instead of the policy surfacing only on a second submit.
 */
export function userSaveSchemaWithPolicy(mode: 'create' | 'update', check: PasswordPolicyCheck) {
  return z.object(fullShape).superRefine((v, ctx) => {
    checkPasswords(mode === 'create')(v, ctx);
    checkClients(v, ctx);
    const password = typeof v.password === 'string' ? v.password : '';
    if (password.length > 0)
      for (const message of check(password, typeof v.email === 'string' ? v.email : ''))
        ctx.addIssue({ code: 'custom', path: ['password'], message });
  });
}

export type UserFormValues = z.input<typeof userCreateSchema>;
export type UserSave = z.output<typeof userCreateSchema>;

export const USER_FORM_DEFAULTS: UserFormValues = {
  firstName: '',
  lastName: '',
  email: '',
  userType: 'Operation',
  password: '',
  confirmPassword: '',
  sendWelcomeEmail: true,
  isActive: true,
  roleIds: [],
  warehouseIds: [],
  allClients: true,
  clientIds: [],
};

export const userStatusSchema = z.object({ isActive: z.boolean(), version: versionField });

/** One header for both Users & Roles tabs (only the tab underline moves). */
export const USERS_ROLES_TITLE = 'Users & Roles';
export const USERS_ROLES_HELPER =
  'Add users, manage the warehouses and clients each one can access, and assign roles that control what they can do.';

/**
 * Edit user drawer: true once the detail query holds data fetched after this drawer opened. A
 * cached copy from an earlier open is never used to seed the form (it held pre-save values,
 * and saving it silently reverted the earlier edit).
 */
export function isFreshDetail(dataUpdatedAt: number, openedAt: number, isFetching: boolean): boolean {
  return openedAt > 0 && dataUpdatedAt >= openedAt && !isFetching;
}
