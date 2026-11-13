'use client';
/**
 * Compact KitStak Projects health line under a CRM record's name: how many projects serve this
 * deal or account and whether any are at risk or off track. Clicking it opens the Projects tab.
 * Reads the same query as the tab (no extra request); renders nothing without linked projects.
 */
import type { BridgeHealth, BridgeProject } from '@kitstak/pm-bridge/types';
import { ProjectsMark } from './projects-mark';

const HEALTH_DOT: Readonly<Record<BridgeHealth, string>> = {
  on_track: 'var(--success)',
  at_risk: 'var(--warning)',
  off_track: 'var(--danger)',
};

export function projectsHealthSummary(projects: readonly BridgeProject[]): { label: string; worst: BridgeHealth } | null {
  const live = projects.filter((project) => !project.archived && project.status !== 'completed');
  const list = live.length > 0 ? live : projects;
  if (list.length === 0) return null;
  const off = list.filter((project) => project.health === 'off_track').length;
  const risk = list.filter((project) => project.health === 'at_risk').length;
  const noun = list.length === 1 ? 'project' : 'projects';
  const worst: BridgeHealth = off > 0 ? 'off_track' : risk > 0 ? 'at_risk' : 'on_track';
  const parts = [`${list.length} ${live.length > 0 ? 'active ' : ''}${noun}`];
  if (off > 0) parts.push(`${off} off track`);
  if (risk > 0) parts.push(`${risk} at risk`);
  if (off === 0 && risk === 0) parts.push(list.length === 1 ? 'on track' : 'all on track');
  return { label: parts.join(' · '), worst };
}

export function ProjectsHealthLine({
  projects,
  openTasks,
  onOpen,
}: {
  readonly projects: readonly BridgeProject[];
  readonly openTasks: number;
  readonly onOpen: () => void;
}) {
  const summary = projectsHealthSummary(projects);
  if (!summary) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex max-w-full items-center gap-2 rounded-full border border-border-subtle bg-panel px-2.5 py-1 text-xs font-medium text-fg-secondary hover:border-border-default hover:text-fg"
      data-testid="crm-projects-health"
    >
      <ProjectsMark size={12} />
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: HEALTH_DOT[summary.worst] }} />
      <span className="truncate">
        {summary.label}
        {openTasks > 0 ? ` · ${openTasks} open ${openTasks === 1 ? 'task' : 'tasks'}` : ''}
      </span>
    </button>
  );
}
