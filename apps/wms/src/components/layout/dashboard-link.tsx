'use client';

import Link from 'next/link';
import type { DashLinkProps } from '@kitstak/ui/dashboard';

/** next/link for the shared dashboard pieces (`@kitstak/ui/dashboard`), so tiles and rows navigate client side. */
export function DashboardNextLink({ href, children, ...rest }: DashLinkProps) {
  return (
    <Link href={href} {...rest}>
      {children}
    </Link>
  );
}
