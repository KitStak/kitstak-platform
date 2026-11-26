/**
 * DashboardFrame, DashboardHeader and DashColumns (docs/design/UI-CLEANUP.md sections 2 and 3).
 *
 * The frame is the same in every app. `app` changes the feel only: the data color, the density and
 * the gaps, through CSS custom properties in dashboard.css.
 */
import * as React from 'react';
import { cx } from './pill';

export type DashboardApp = 'portal' | 'crm' | 'wms' | 'projects' | 'pulse';

export interface DashboardFrameProps {
  readonly app: DashboardApp;
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly 'data-testid'?: string;
}

export function DashboardFrame({ app, children, className, ...rest }: DashboardFrameProps) {
  return (
    <div className={cx('ks-dash', className)} data-app={app} data-testid={rest['data-testid']}>
      {children}
    </div>
  );
}

export interface DashboardHeaderProps {
  /** Small line above the title: "Wednesday, November 25 · KitStak". */
  readonly eyebrow?: React.ReactNode;
  readonly title: React.ReactNode;
  /** One line under the title. */
  readonly subtitle?: React.ReactNode;
  /** Period picker, filters. Sit left of the actions. */
  readonly controls?: React.ReactNode;
  /** One primary button at most, one secondary. */
  readonly actions?: React.ReactNode;
}

export function DashboardHeader({ eyebrow, title, subtitle, controls, actions }: DashboardHeaderProps) {
  return (
    <header className="ks-dash-header">
      <div className="ks-dash-header-titles">
        {eyebrow ? <p className="ks-dash-eyebrow">{eyebrow}</p> : null}
        <h1 className="ks-dash-title">{title}</h1>
        {subtitle ? <p className="ks-dash-subtitle">{subtitle}</p> : null}
      </div>
      {controls || actions ? (
        <div className="ks-dash-header-tools">
          {controls ? <div className="ks-dash-header-controls">{controls}</div> : null}
          {actions ? <div className="ks-dash-header-actions">{actions}</div> : null}
        </div>
      ) : null}
    </header>
  );
}

/** Work on the left (two thirds), a rail of small cards on the right. Stacks below 1024 px. */
export function DashColumns({ main, rail, className }: { readonly main: React.ReactNode; readonly rail?: React.ReactNode; readonly className?: string }) {
  if (!rail) return <div className={cx('ks-dash-stack', className)}>{main}</div>;
  return (
    <div className={cx('ks-dash-columns', className)}>
      <div className="ks-dash-stack">{main}</div>
      <div className="ks-dash-stack">{rail}</div>
    </div>
  );
}
