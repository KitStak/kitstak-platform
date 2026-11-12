'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Lightweight dropdown/popover. Closes on outside click and Escape.
 * `align` controls which edge of the trigger the panel attaches to.
 */
export function Dropdown({
  trigger,
  children,
  align = 'start',
  className,
  panelClassName,
  onOpenChange,
}: {
  trigger: (open: boolean) => React.ReactNode;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  align?: 'start' | 'end';
  className?: string;
  panelClassName?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  const setOpenNotify = React.useCallback(
    (next: boolean) => {
      setOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpenNotify(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenNotify(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpenNotify]);

  const close = React.useCallback(() => setOpenNotify(false), [setOpenNotify]);

  return (
    <div ref={rootRef} className={cn('relative inline-block', className)}>
      <div role="button" tabIndex={-1} onClick={() => setOpenNotify(!open)} className="inline-flex">
        {trigger(open)}
      </div>
      {open ? (
        <div
          className={cn(
            'absolute z-50 mt-1 min-w-[180px] overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg',
            align === 'end' ? 'right-0' : 'left-0',
            panelClassName,
          )}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      ) : null}
    </div>
  );
}

export function DropdownItem({
  className,
  destructive,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { destructive?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-body transition-colors hover:bg-surface-sunken',
        destructive && 'text-danger hover:bg-danger-soft',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownSeparator() {
  return <div className="my-1 h-px bg-border" />;
}
