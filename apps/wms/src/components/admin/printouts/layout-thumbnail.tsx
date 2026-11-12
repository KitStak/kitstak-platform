'use client';

/**
 * Miniature schematic of a printout layout (template radio cards, step 2). Draws the enabled
 * sections in order, the logo position, and the line-table columns, from the same layout
 * model the PDF renderer honors, so the thumbnail matches what prints.
 */
import { cn } from '@/lib/utils';
import type { PrintoutLayout } from '@/lib/grid-defs/admin/printouts';

const LOGO_JUSTIFY = {
  left: 'justify-start',
  center: 'justify-center',
  right: 'justify-end',
  hidden: 'hidden',
} as const;

function Bar({ w, tone = 'muted' }: { readonly w: string; readonly tone?: 'muted' | 'strong' }) {
  return (
    <span
      className={cn(
        'block h-[3px] rounded-full',
        tone === 'strong' ? 'bg-foreground/60' : 'bg-foreground/20',
      )}
      style={{ width: w }}
    />
  );
}

function Section({ k, layout }: { readonly k: string; readonly layout: PrintoutLayout }) {
  switch (k) {
    case 'logo':
      return (
        <span className={cn('flex', LOGO_JUSTIFY[layout.logoPosition])}>
          <span className="block h-3 w-7 rounded-sm" style={{ background: layout.accentColor }} />
        </span>
      );
    case 'header':
    case 'title':
      return (
        <span className="flex flex-col gap-0.5">
          <Bar w="55%" tone="strong" />
          <Bar w="35%" />
        </span>
      );
    case 'barcode':
      return (
        <span className="flex h-3 w-16 gap-[1px]">
          {Array.from({ length: 16 }, (_, i) => (
            <span key={i} className="block h-full bg-foreground/70" style={{ width: i % 3 === 0 ? 2 : 1 }} />
          ))}
        </span>
      );
    case 'code':
      return <Bar w="30%" tone="strong" />;
    case 'addresses':
      return (
        <span className="grid grid-cols-2 gap-2">
          <span className="flex flex-col gap-0.5">
            <Bar w="80%" />
            <Bar w="60%" />
          </span>
          <span className="flex flex-col gap-0.5">
            <Bar w="80%" />
            <Bar w="60%" />
          </span>
        </span>
      );
    case 'lines': {
      const cols = layout.columns.filter((c) => c.enabled);
      return (
        <span className="flex flex-col gap-[2px] rounded-sm border border-foreground/15 p-[2px]">
          <span className="flex gap-[2px]" style={{ background: `${layout.accentColor}22` }}>
            {cols.map((c) => (
              <span key={c.key} className="h-[4px] flex-1 bg-foreground/40" />
            ))}
          </span>
          {[0, 1, 2].map((r) => (
            <span key={r} className="flex gap-[2px]">
              {cols.map((c) => (
                <span key={c.key} className="h-[3px] flex-1 bg-foreground/15" />
              ))}
            </span>
          ))}
        </span>
      );
    }
    case 'totals':
      return (
        <span className="flex justify-end">
          <Bar w="30%" tone="strong" />
        </span>
      );
    case 'details':
    case 'notes':
      return (
        <span className="flex flex-col gap-0.5">
          <Bar w="70%" />
          <Bar w="50%" />
        </span>
      );
    case 'footer':
      return (
        <span className="flex justify-center">
          <Bar w="40%" />
        </span>
      );
    default:
      return <Bar w="50%" />;
  }
}

export function LayoutThumbnail({
  layout,
  className,
}: {
  readonly layout: PrintoutLayout;
  readonly className?: string;
}) {
  const label = layout.family === 'label';
  return (
    <div
      aria-hidden
      className={cn(
        'mx-auto flex flex-col gap-1.5 overflow-hidden rounded-sm border border-border bg-white p-2 shadow-xs',
        label
          ? layout.paper === '4x2'
            ? 'aspect-[2/1] w-full'
            : 'aspect-[2/3] w-24'
          : 'aspect-[17/22] w-28',
        className,
      )}
    >
      {layout.sections
        .filter((s) => s.enabled)
        .map((s) => (
          <Section key={s.key} k={s.key} layout={layout} />
        ))}
    </div>
  );
}
