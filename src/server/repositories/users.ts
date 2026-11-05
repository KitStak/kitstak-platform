import { and, asc, count, eq, like, or, type SQL } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { likePattern, offsetOf, type ListResult } from "./shared";

const { users } = schema;

export type UserRole = (typeof users.$inferSelect)["role"];

export const USER_ROLES = ["admin", "manager", "operator", "viewer"] as const;

export interface UserListParams {
  page: number;
  pageSize: number;
  search?: string;
  role?: UserRole;
}

/** Public user shape — never exposes passwordHash. */
export interface UserListRow {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
}

export function listUsers(params: UserListParams): ListResult<UserListRow> {
  const conds: Array<SQL | undefined> = [];
  if (params.role) conds.push(eq(users.role, params.role));
  if (params.search) {
    const p = likePattern(params.search);
    conds.push(or(like(users.name, p), like(users.email, p)));
  }
  const where = and(...conds);
  const rows = db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      isActive: users.isActive,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(where)
    .orderBy(asc(users.name))
    .limit(params.pageSize)
    .offset(offsetOf(params.page, params.pageSize))
    .all();
  const total = db.select({ n: count() }).from(users).where(where).get()?.n ?? 0;
  return { rows, total };
}
