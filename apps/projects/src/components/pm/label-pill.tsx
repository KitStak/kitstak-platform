import { labelColorStyle, PILL_TEXT_CLASS, toLabelColor } from '@/components/ui/label-color';
import { cn } from '@/components/ui/cn';

/** Task label chip in its palette color. */
export function LabelPill({ name, color, className }: { readonly name: string; readonly color: string; readonly className?: string }) {
  return (
    <span
      style={labelColorStyle(toLabelColor(color))}
      className={cn(
        'inline-flex h-5 max-w-40 shrink-0 items-center gap-1 truncate rounded-full bg-[var(--lc-subtle)] px-2 text-2xs font-medium',
        PILL_TEXT_CLASS,
        className,
      )}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--lc-bg)]" />
      <span className="truncate">{name}</span>
    </span>
  );
}
