'use client';
/**
 * Mounts an inline picker only after its trigger is first used, so a list of hundreds of rows
 * doesn't carry hundreds of idle popovers. Once mounted it stays (focus returns to the trigger
 * on close).
 *
 *   <LazyPicker picker={(p) => <StatusPicker {...p} value={...} onChange={...}>{p.trigger}</StatusPicker>}>
 *     <button>…</button>
 *   </LazyPicker>
 */
import { cloneElement, useState, type MouseEvent, type ReactElement } from 'react';

export interface LazyPickerRenderProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly trigger: ReactElement;
}

type TriggerProps = { onClick?: (event: MouseEvent<HTMLElement>) => void };

export function LazyPicker({ children, picker, disabled }: { readonly children: ReactElement<TriggerProps>; readonly picker: (props: LazyPickerRenderProps) => ReactElement; readonly disabled?: boolean }) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  if (disabled) return children;
  if (!mounted) {
    return cloneElement(children, {
      onClick: (event: MouseEvent<HTMLElement>) => {
        children.props.onClick?.(event);
        setMounted(true);
        setOpen(true);
      },
    });
  }
  return picker({ open, onOpenChange: setOpen, trigger: children });
}
