'use client';
/** Project health pill (On track / At risk / Off track), shared by the directory, header, overview and dashboards. */
import { AlertTriangle, CheckCircle2, OctagonAlert } from 'lucide-react';
import { Badge } from '@/components/ui';
import { PROJECT_HEALTH_LABELS, type ProjectHealth } from '@/lib/constants';

export const HEALTH_TONE: Readonly<Record<ProjectHealth, 'success' | 'warning' | 'danger'>> = {
  on_track: 'success',
  at_risk: 'warning',
  off_track: 'danger',
};

export const HEALTH_HELP: Readonly<Record<ProjectHealth, string>> = {
  on_track: 'Going as planned',
  at_risk: 'Might slip without help',
  off_track: 'Behind and needs attention',
};

export function HealthIcon({ health, className = 'size-3' }: { readonly health: ProjectHealth; readonly className?: string }) {
  const Icon = health === 'on_track' ? CheckCircle2 : health === 'at_risk' ? AlertTriangle : OctagonAlert;
  return <Icon aria-hidden className={className} />;
}

export function HealthBadge({ health, size = 'md' }: { readonly health: ProjectHealth; readonly size?: 'sm' | 'md' }) {
  return (
    <Badge tone={HEALTH_TONE[health]} size={size} icon={<HealthIcon health={health} />}>
      {PROJECT_HEALTH_LABELS[health]}
    </Badge>
  );
}
