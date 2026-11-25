'use client';
/** next/link for the shared dashboard pieces (`@kitstak/ui/dashboard`), so tiles and rows navigate client side. */
import Link from 'next/link';
import type { DashLinkProps } from '@kitstak/ui/dashboard';

export function DashNextLink({ href, children, ...rest }: DashLinkProps) {
  return (
    <Link href={href} {...rest}>
      {children}
    </Link>
  );
}
