'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { buttonVariants, type ButtonSize, type ButtonVariant } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';

/** A link that looks like a Button. Use it when the action is "go to a page" (works without JavaScript, opens in a new tab). */
export function ButtonLink({
  href,
  children,
  variant = 'primary',
  size = 'md',
  icon,
  className,
  testId,
}: {
  readonly href: string;
  readonly children: ReactNode;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly icon?: ReactNode;
  readonly className?: string;
  readonly testId?: string;
}) {
  return (
    <Link href={href} data-testid={testId} className={cn(buttonVariants({ variant, size }), 'no-underline', className)}>
      {icon}
      {children}
    </Link>
  );
}
