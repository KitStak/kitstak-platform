import * as React from 'react';
import { Pill, Tag, type PillTone } from '@kitstak/ui/dashboard';

/**
 * Badge tones. `outline` is an identity (a code, a type, a role name) and draws as the shared
 * neutral `Tag`; every other tone is a state and draws as the shared `Pill`
 * (docs/design/UI-CLEANUP.md "Pills": five flat tones, one size, sentence case).
 */
export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'outline';

const PILL_TONE: Readonly<Record<Exclude<BadgeTone, 'outline'>, PillTone>> = {
  neutral: 'neutral',
  success: 'positive',
  warning: 'caution',
  danger: 'critical',
  info: 'info',
};

export interface BadgeProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children' | 'color'> {
  readonly tone?: BadgeTone | null;
  readonly icon?: React.ComponentType<{ className?: string }>;
  readonly children: React.ReactNode;
}

/** Pill tone for a badge tone (`outline` reads as neutral where a pill is needed). */
export function badgePillTone(tone: BadgeTone | null | undefined): PillTone {
  return !tone || tone === 'outline' ? 'neutral' : PILL_TONE[tone];
}

/**
 * Generic label/state badge, drawn with the shared pieces. Statuses use `StatusPill` instead.
 * Extra attributes (`data-*`, `aria-*`, `role`) land on a `display: contents` wrapper, so they
 * stay queryable without adding a box.
 */
export function Badge({ className, tone = 'neutral', icon: Icon, title, children, ...rest }: BadgeProps) {
  const body =
    tone === 'outline' ? (
      <Tag title={title} className={className}>
        {children}
      </Tag>
    ) : Icon ? (
      <Pill
        tone={badgePillTone(tone)}
        icon={<Icon className="h-3 w-3" />}
        title={title}
        className={className}
      >
        {children}
      </Pill>
    ) : (
      <Pill tone={badgePillTone(tone)} title={title} className={className}>
        {children}
      </Pill>
    );
  if (Object.keys(rest).length === 0) return body;
  return (
    <span className="contents" {...rest}>
      {body}
    </span>
  );
}
