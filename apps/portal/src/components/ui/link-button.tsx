import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import type { VariantProps } from 'class-variance-authority';
import { buttonVariants } from './button-variants';
import { cn } from './cn';

export interface LinkButtonProps
  extends Omit<ComponentProps<typeof Link>, 'className' | 'children'>, VariantProps<typeof buttonVariants> {
  readonly children: ReactNode;
  readonly className?: string;
  readonly leadingIcon?: ReactNode;
  readonly trailingIcon?: ReactNode;
}

/** A link that looks like a button. Use it for navigation; use `Button` for actions. */
export function LinkButton({ variant, size, fullWidth, className, children, leadingIcon, trailingIcon, ...props }: LinkButtonProps) {
  return (
    <Link className={cn(buttonVariants({ variant, size, fullWidth }), className)} {...props}>
      {leadingIcon}
      {children}
      {trailingIcon}
    </Link>
  );
}
