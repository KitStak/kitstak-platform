'use client';

/**
 * KitStak Projects health for a WMS client: one line with the projects that serve this client
 * (shared core customer), how many are at risk or off track, open tasks and progress. Every
 * part links into Projects filtered to this customer. Hidden when Projects isn't available or
 * no project serves the client.
 */
import * as React from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { BridgeHealth } from '@kitstak/pm-bridge/types';
import { useApiQuery } from '@/lib/query-client';
import { cn } from '@/lib/utils';
import type { ClientProjectsDto } from '@/server/projects/bridge';

const HEALTH: Readonly<Record<BridgeHealth, { label: string; dot: string }>> = {
  on_track: { label: 'On track', dot: 'var(--success)' },
  at_risk: { label: 'At risk', dot: 'var(--warning)' },
  off_track: { label: 'Off track', dot: 'var(--danger)' },
};

function ProjectsMark({ size = 14 }: { readonly size?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="30 44 140 112">
      <rect x="38" y="52" width="80" height="26" fill="#C8102E" />
      <rect x="68" y="87" width="80" height="26" fill="#D65A6E" />
      <rect x="98" y="122" width="64" height="26" fill="#C8102E" />
    </svg>
  );
}

export function ClientProjectsStrip({ clientId }: { readonly clientId: string }) {
  const query = useApiQuery<ClientProjectsDto>(['client-projects', clientId], `/api/clients/${encodeURIComponent(clientId)}/projects`, {
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const data = query.data?.data;
  if (!data?.available) return null;
  const live = data.projects.filter((project) => !project.archived && project.status !== 'completed');
  if (live.length === 0) return null;
  const risky = live.filter((project) => project.health !== 'on_track').length;
  // Open work across this client's live projects (not only tasks linked to the client itself).
  const openTasks = live.reduce((sum, project) => sum + Math.max(0, project.progress.total - project.progress.done), 0) || data.openTasks;
  const shown = live.slice(0, 3);
  return (
    <section
      aria-label="KitStak Projects"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-surface px-4 py-3 shadow-xs"
      data-testid="client-projects"
    >
      <a
        href={data.filteredUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 text-sm font-semibold text-foreground hover:underline"
      >
        <ProjectsMark />
        {live.length} active {live.length === 1 ? 'project' : 'projects'}
      </a>
      <span className={cn('text-sm', risky > 0 ? 'font-medium text-warning' : 'text-secondary')}>
        {risky > 0 ? `${risky} at risk or off track` : live.length === 1 ? 'On track' : 'All on track'}
      </span>
      <span className="text-sm text-secondary">
        {openTasks} open {openTasks === 1 ? 'task' : 'tasks'}
      </span>
      <ul className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
        {shown.map((project) => (
          <li key={project.id}>
            <a
              href={project.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex max-w-[260px] items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-body hover:border-border-strong"
              title={`${project.name}: ${HEALTH[project.health].label}, ${project.progress.percent}% done`}
            >
              <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: HEALTH[project.health].dot }} />
              <span className="font-mono text-2xs text-faint">{project.key}</span>
              <span className="truncate">{project.name}</span>
              <span className="tabular-nums text-faint">{project.progress.percent}%</span>
              <ArrowUpRight aria-hidden className="size-3 shrink-0 opacity-0 group-hover:opacity-100" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
