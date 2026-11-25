/**
 * Program notifications (docs/programs/SPEC.md 4.9): sent by the sweep (end of day reminder,
 * minimum watch, version reminder) and by publishing and review. This module names the
 * recipients: program owners, or a build's assignee with the owner as the fallback.
 */
import 'server-only';
import { and, eq } from 'drizzle-orm';
import type { Executor } from '@/server/db';
import { projectMembers } from '@/server/db/schema';

export async function programOwners(executor: Executor, programId: string): Promise<string[]> {
  const rows = await executor.select({ userId: projectMembers.userId }).from(projectMembers).where(and(eq(projectMembers.projectId, programId), eq(projectMembers.role, 'owner')));
  return rows.map((row) => row.userId);
}

export function buildRecipient(input: { readonly assigneeId: string | null; readonly ownerId: string | null }): string | null {
  return input.assigneeId ?? input.ownerId;
}
