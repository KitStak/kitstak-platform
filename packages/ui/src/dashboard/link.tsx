'use client';
/**
 * Links inside the dashboard pieces. The package cannot import `next/link`, so each app hands its
 * link component in once (`<DashboardLinkProvider component={Link}>` in its client providers) and
 * every tile, row and section action navigates client side. Without a provider a plain `<a>` is used.
 */
import * as React from 'react';

export interface DashLinkProps {
  readonly href: string;
  readonly className?: string;
  readonly children: React.ReactNode;
  readonly title?: string;
  readonly 'aria-label'?: string;
  readonly 'data-testid'?: string;
}

export type DashLinkComponent = React.ComponentType<DashLinkProps>;

function PlainLink({ href, children, ...rest }: DashLinkProps) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

const LinkContext = React.createContext<DashLinkComponent>(PlainLink);

export function DashboardLinkProvider({ component, children }: { readonly component: DashLinkComponent; readonly children: React.ReactNode }) {
  return <LinkContext.Provider value={component}>{children}</LinkContext.Provider>;
}

/** A link that uses the app's link component. */
export function DashLink(props: DashLinkProps) {
  const Component = React.useContext(LinkContext);
  return <Component {...props} />;
}

/** The one shape of a link a dashboard piece accepts: words and where they go. */
export interface DashAction {
  readonly label: string;
  readonly href: string;
}
