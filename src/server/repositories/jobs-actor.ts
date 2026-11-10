/**
 * Consistent change-log actor for M03 records (critic R5). The foundation convention stores the
 * user's email in `change_log.source` (plus `user_id`), while system settles store "System" and
 * the wave log stores display names, so Excel exports of a job's history mixed raw emails and
 * names. Every M03 mutation route runs inside `withM03Actor`: the change-log rows the request
 * wrote for M03-owned entities (job, wave_rule, job_type) are stamped with the user's display
 * name in the same request; `user_id` keeps the identity. Rows of other modules' entities
 * (orders, lines) keep the foundation convention until request R6b-1 changes it app-wide.
 */
import { sql } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import type { AuthContext } from "@/server/auth/context";

export const M03_ACTOR_ENTITIES = ["job", "wave_rule", "job_type", "wave"] as const;

/** Display actor for a signed-in user: name, else email, else "System". PURE. */
export function actorDisplayName(user: { readonly name?: string | null; readonly email?: string | null } | null | undefined): string {
  const name = user?.name?.trim();
  if (name) return name;
  const email = user?.email?.trim();
  return email || "System";
}

type Actor = { readonly userId: string | null; readonly source: string };

function maxRowId(db: AppDb): number {
  return Number(db.get<{ n: number | null }>(sql`SELECT MAX(rowid) AS n FROM change_log`)?.n ?? 0);
}

/** Rewrites the email source of this request's M03 change-log rows to the display name. */
export function stampM03Actor(db: AppDb, actor: Actor, auth: AuthContext, sinceRowId: number): number {
  const name = actorDisplayName(auth.user);
  if (!actor.userId || !actor.source || name === actor.source) return 0;
  const list = sql.join(M03_ACTOR_ENTITIES.map((e) => sql`${e}`), sql`, `);
  const res = db.run(sql`UPDATE change_log SET source = ${name}
    WHERE rowid > ${sinceRowId} AND user_id = ${actor.userId} AND source = ${actor.source} AND entity_type IN (${list})`);
  return Number((res as { changes?: number }).changes ?? 0);
}

/** Runs an M03 mutation and stamps its change-log actor (sync or async handlers). */
export function withM03Actor<R>(db: AppDb, actor: Actor, auth: AuthContext, fn: () => R): R {
  const since = maxRowId(db);
  const out = fn();
  if (out instanceof Promise) {
    return out.then((v) => {
      stampM03Actor(db, actor, auth, since);
      return v;
    }) as R;
  }
  stampM03Actor(db, actor, auth, since);
  return out;
}
