import type { ReactNode } from 'react';
import { Pill, type PillTone } from '@kitstak/ui/dashboard';

/**
 * A state label. Drawn by the shared Pill (`@kitstak/ui/dashboard`, docs/design/UI-CLEANUP.md):
 * flat tint, sentence case, no border, the same in every KitStak app.
 */
export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const TONE: Readonly<Record<BadgeTone, PillTone>> = {
  neutral: 'neutral',
  success: 'positive',
  warning: 'caution',
  danger: 'critical',
  info: 'info',
};

export interface BadgeProps {
  readonly tone?: BadgeTone | null;
  readonly children: ReactNode;
  readonly className?: string;
  /** Native tooltip, e.g. to explain a read-only state. */
  readonly title?: string;
}

export function Badge({ tone, children, className, title }: BadgeProps) {
  return (
    <Pill tone={TONE[tone ?? 'neutral']} className={className} title={title}>
      {children}
    </Pill>
  );
}
