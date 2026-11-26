'use server';
/**
 * Program tracker writes (docs/programs/PULSE_PROGRAMS_SPEC.md section 4). Both need `job:manage`
 * (checked in the domain) and return a `TrackedProgramDTO`. After success, invalidate
 * `qk.programsRoot()` and `qk.jobsRoot()`.
 */
import { z } from 'zod';
import { convertToProgramJob, trackProgram } from '@/server/domain';
import { runAction } from './_action';
import { uuid } from './schemas';

const trackSchema = z.object({
  programId: uuid,
  /** The Pulse client for a new program job, when no client matches the program's customer. */
  clientId: uuid.nullable().optional(),
  /** Link this existing job (number or id) instead of making a new one. */
  jobRef: z.string().trim().min(1).max(64).nullable().optional(),
});

/** "Track in Pulse": makes the program job (or links `jobRef`), writes the link and queues a program sync. */
export async function trackProgramAction(input: z.input<typeof trackSchema>) {
  return runAction(trackSchema, input, (data, ctx) => trackProgram(ctx, data.programId, { clientId: data.clientId ?? null, jobRef: data.jobRef ?? null }));
}

const convertSchema = z.object({ jobRef: z.string().trim().min(1).max(64) });

/** Makes a job a program link already points at a program job. Safe to call twice. */
export async function convertToProgramJobAction(input: z.input<typeof convertSchema>) {
  return runAction(convertSchema, input, (data, ctx) => convertToProgramJob(ctx, data.jobRef));
}
