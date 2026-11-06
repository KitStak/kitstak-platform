'use client';
import { useRef, useState, type ReactNode } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Plus } from 'lucide-react';
import { TooltipContent, cn } from '@/components/ui';

/** Single-line text that ellipsizes and shows the full value in a tooltip only when truncated. */
export function TruncText({
  children,
  tooltip,
  className,
}: {
  readonly children: ReactNode;
  readonly tooltip?: ReactNode;
  readonly className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <TooltipPrimitive.Root
      open={open}
      delayDuration={500}
      onOpenChange={(next) => {
        const node = ref.current;
        setOpen(next && Boolean(node && node.scrollWidth > node.clientWidth + 1));
      }}
    >
      <TooltipPrimitive.Trigger asChild>
        <span ref={ref} className={cn('block min-w-0 truncate', className)}>
          {children}
        </span>
      </TooltipPrimitive.Trigger>
      <TooltipContent side="top" className="max-w-sm break-words whitespace-pre-wrap">
        {tooltip ?? children}
      </TooltipContent>
    </TooltipPrimitive.Root>
  );
}

/** Ghost affordance shown on hover of an empty editable cell (icon + small "+" badge). */
export function EmptyGhost({ icon, label }: { readonly icon: ReactNode; readonly label: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 flex items-center justify-center text-icon opacity-0',
        'transition-opacity duration-[var(--duration-fast)] ease-out',
        'group-hover/cell:opacity-100 group-data-[force-hover=true]/cell:opacity-100 group-focus-visible/cell:opacity-100',
      )}
      title={label}
    >
      <span className="relative inline-flex [&>svg]:size-[18px]">
        {icon}
        <span className="absolute -right-1.5 -bottom-1 inline-flex size-3 items-center justify-center rounded-full bg-primary text-primary-fg ring-2 ring-[var(--surface-panel)]">
          <Plus aria-hidden strokeWidth={3.5} className="size-2" />
        </span>
      </span>
    </span>
  );
}

/** Standard picker header: title + optional trailing action. */
export function PickerHeader({ title, aside }: { readonly title: ReactNode; readonly aside?: ReactNode }) {
  return (
    <div className="flex h-8 items-center justify-between gap-2 px-1">
      <span className="text-xs font-semibold tracking-wide text-fg-muted uppercase">{title}</span>
      {aside}
    </div>
  );
}

export function PickerFooter({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  return (
    <div className={cn('-mx-3 -mb-3 mt-3 flex items-center justify-end gap-2 border-t border-border-subtle px-3 py-2.5', className)}>
      {children}
    </div>
  );
}

export function EmptyListMessage({ children }: { readonly children: ReactNode }) {
  return <p className="px-2 py-6 text-center text-sm text-fg-muted">{children}</p>;
}
