/** Shared fixtures for F6 platform-service tests. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildAuthContext, type AuthContext } from "@/server/auth/context";
import type { SessionUser } from "@/server/auth/session-store";
import { users } from "@/server/db/schema";
import { createFileStore, type FileStore } from "@/server/files/files";
import { seededDb, type SeededDb } from "../foundation-f3/fixtures";

export { seededDb, type SeededDb };

export function sessionUserFor(db: SeededDb["db"], id: string): SessionUser {
  const row = db.select().from(users).all().find((u) => u.id === id);
  if (!row) throw new Error(`no user ${id}`);
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    userType: row.userType,
    allClients: row.allClients,
    isApiUser: row.isApiUser,
    sessionId: "s-test",
    sessionVersion: row.sessionVersion,
    sessionExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  };
}

export function authFor(testDb: SeededDb, id: string): AuthContext {
  return buildAuthContext(testDb.db, sessionUserFor(testDb.db, id));
}

export interface TempStore {
  readonly store: FileStore;
  readonly root: string;
  cleanup(): void;
}

export function tempStore(now?: () => Date): TempStore {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kitstak-f6-"));
  return {
    store: createFileStore({ root, ...(now ? { now } : {}) }),
    root,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/** Minimal valid PNG (1x1). */
export const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
