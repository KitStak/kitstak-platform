'use client';
/**
 * DashSection, ActionList, ActionRow and EmptyNote (docs/design/UI-CLEANUP.md sections 1 and 2).
 *
 * A section has one header action and it is a real link. A row is a link to its record, with fixed
 * value and pill columns so the numbers line up. An empty state always names the next step.
 */
import * as React from 'react';
// Each piece imports the stylesheet itself: the package is side effect free apart from CSS, so a bundler may skip index.ts.
import './dashboard.css';
import { DashLink, type DashAction } from './link';
import { cx, type PillTone } from './pill';

export interface DashSectionProps {
  readonly title: string;
  readonly description?: React.ReactNode;
  /** The one header action ("All open jobs"). */
  readonly action?: DashAction;
  /** Tabs or a small control that belongs in the header, left of the action. */
  readonly aside?: React.ReactNode;
  readonly footer?: React.ReactNode;
  /** Lists and tables sit edge to edge; everything else gets padding. */
  readonly flush?: boolean;
  readonly children: React.ReactNode;
  readonly id?: string;
  readonly className?: string;
  readonly 'data-testid'?: string;
}

export function DashSection({ title, description, action, aside, footer, flush = false, children, id, className, ...rest }: DashSectionProps) {
  const headingId = React.useId();
  return (
    <section id={id} className={cx('ks-dash-section', className)} aria-labelledby={headingId} data-testid={rest['data-testid']}>
      <header className="ks-dash-section-head">
        <div className="ks-dash-section-titles">
          <h2 id={headingId} className="ks-dash-section-title">
            {title}
          </h2>
          {description ? <p className="ks-dash-section-desc">{description}</p> : null}
        </div>
        {aside ? <div className="ks-dash-section-aside">{aside}</div> : null}
        {action ? (
          <DashLink href={action.href} className="ks-dash-section-action">
            {action.label}
            <ArrowRight />
          </DashLink>
        ) : null}
      </header>
      <div className={flush ? 'ks-dash-section-body ks-dash-flush' : 'ks-dash-section-body'}>{children}</div>
      {footer ? <footer className="ks-dash-section-foot">{footer}</footer> : null}
    </section>
  );
}

export function ActionList({ children, label, className }: { readonly children: React.ReactNode; readonly label?: string; readonly className?: string }) {
  return (
    <ul className={cx('ks-dash-list', className)} aria-label={label}>
      {children}
    </ul>
  );
}

export type ValueTone = 'neutral' | 'positive' | 'critical';

export interface ActionRowProps {
  /** The record this row is about. Required: rows are never dead ends. */
  readonly href: string;
  readonly title: React.ReactNode;
  /** A neutral identity in front of the title: "J-1026". */
  readonly tag?: string;
  /** Why it is here, in one sentence. Do not repeat the value. */
  readonly reason?: React.ReactNode;
  /** Who or what it belongs to: the client, the warehouse. */
  readonly meta?: React.ReactNode;
  readonly value?: React.ReactNode;
  readonly valueTone?: ValueTone;
  /** What the value is, when the section does not say: "projected". */
  readonly valueCaption?: React.ReactNode;
  readonly pill?: React.ReactNode;
  /** A small dot before the title in a status tone, for lists where the pill column would be too wide. */
  readonly marker?: PillTone;
  /** For a row whose only job is to lead somewhere: the words of the link ("Add the hours"). */
  readonly cta?: string;
  /**
   * Which right-hand columns the row keeps. Rows in one list must share a shape so the numbers line
   * up; by default it follows what the row was given.
   */
  readonly shape?: 'full' | 'value' | 'pill' | 'plain';
  readonly 'data-testid'?: string;
}

export function ActionRow({ href, title, tag, reason, meta, value, valueTone = 'neutral', valueCaption, pill, marker, cta, shape, ...rest }: ActionRowProps) {
  const hasValue = value !== undefined && value !== null && value !== false;
  const hasPill = pill !== undefined && pill !== null && pill !== false;
  const resolved = shape ?? (hasValue || cta ? (hasPill ? 'full' : 'value') : hasPill ? 'pill' : 'plain');
  const showValue = resolved === 'full' || resolved === 'value';
  const showPill = resolved === 'full' || resolved === 'pill';
  return (
    <li className="ks-dash-row-item">
      <DashLink href={href} className="ks-dash-row" data-shape={resolved} data-testid={rest['data-testid']}>
        <span className="ks-dash-row-main">
          <span className="ks-dash-row-title">
            {marker ? <span aria-hidden className="ks-dash-row-marker" data-tone={marker} /> : null}
            {tag ? <span className="ks-dash-tag">{tag}</span> : null}
            <span className="ks-dash-row-name">{title}</span>
          </span>
          {reason ? <span className="ks-dash-row-reason">{reason}</span> : null}
          {meta ? <span className="ks-dash-row-meta">{meta}</span> : null}
        </span>
        {showValue ? (
          <span className="ks-dash-row-value" data-tone={valueTone}>
            {hasValue ? value : null}
            {cta && !hasValue ? (
              <span className="ks-dash-row-cta">
                {cta}
                <ArrowRight />
              </span>
            ) : null}
            {valueCaption ? <span className="ks-dash-row-caption">{valueCaption}</span> : null}
          </span>
        ) : null}
        {showPill ? <span className="ks-dash-row-pill">{pill}</span> : null}
      </DashLink>
    </li>
  );
}

export interface EmptyNoteProps {
  readonly children: React.ReactNode;
  /** The next step. Pass `null` only when there truly is none, and say why in the words. */
  readonly action: DashAction | null;
}

export function EmptyNote({ children, action }: EmptyNoteProps) {
  return (
    <div className="ks-dash-empty">
      <p>{children}</p>
      {action ? (
        <DashLink href={action.href} className="ks-dash-section-action">
          {action.label}
          <ArrowRight />
        </DashLink>
      ) : null}
    </div>
  );
}

function ArrowRight() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="ks-dash-arrow">
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}
