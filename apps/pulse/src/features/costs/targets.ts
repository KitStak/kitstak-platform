'use client';
/**
 * "What is this row for?" for ledgers that show more than one job or client: the list of jobs
 * and clients to pick from, and the name of a row's job or client.
 */
import { useMemo } from 'react';
import { useClients, useJobs } from '@/lib/hooks/use-data';

export interface EntryTargets {
  readonly loading: boolean;
  /** Options for a "For" select. Values are `company`, `client:<id>` or `job:<id>`. */
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly jobLabel: (jobId: string | null) => string | null;
  readonly jobNumber: (jobId: string | null) => string | null;
  readonly clientLabel: (clientId: string | null) => string | null;
}

/** `enabled` false skips the reads (a ledger fixed to one job does not need the lists). */
export function useEntryTargets(enabled: boolean, include: { company?: boolean; clients?: boolean; jobs?: boolean; clientId?: string | null } = { company: true, clients: true, jobs: true }): EntryTargets {
  const jobs = useJobs({ tab: 'all', limit: 500, clientId: include.clientId ?? undefined }, { enabled });
  const clients = useClients({}, { enabled });
  return useMemo(() => {
    const jobById = new Map((jobs.data ?? []).map((job) => [job.id, job]));
    const clientById = new Map((clients.data ?? []).map((client) => [client.id, client]));
    const options: { value: string; label: string }[] = [];
    if (include.company) options.push({ value: 'company', label: 'The whole company' });
    if (include.clients) for (const client of clients.data ?? []) if (!include.clientId || client.id === include.clientId) options.push({ value: `client:${client.id}`, label: `Client: ${client.name}` });
    if (include.jobs) for (const job of jobs.data ?? []) options.push({ value: `job:${job.id}`, label: `${job.number} ${job.name}` });
    return {
      loading: enabled && (jobs.isLoading || clients.isLoading),
      options,
      jobLabel: (jobId) => (jobId ? (jobById.has(jobId) ? `${jobById.get(jobId)!.number} ${jobById.get(jobId)!.name}` : 'A job') : null),
      jobNumber: (jobId) => (jobId ? (jobById.get(jobId)?.number ?? null) : null),
      clientLabel: (clientId) => (clientId ? (clientById.get(clientId)?.name ?? 'A client') : null),
    };
  }, [jobs.data, clients.data, jobs.isLoading, clients.isLoading, enabled, include.company, include.clients, include.jobs, include.clientId]);
}

/** Splits a "For" value into the ids a save needs. */
export function readTarget(value: string): { jobId: string | null; clientId: string | null } | null {
  if (value === 'company') return { jobId: null, clientId: null };
  if (value.startsWith('job:')) return { jobId: value.slice(4), clientId: null };
  if (value.startsWith('client:')) return { jobId: null, clientId: value.slice(7) };
  return null;
}
