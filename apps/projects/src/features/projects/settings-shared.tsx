'use client';
/** Small helpers shared by the project Settings sections. */
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Popover, PopoverContent, PopoverTrigger, ColorPicker, toLabelColor, toast, cn, type LabelColor } from '@/components/ui';
import { qk } from '@/lib/query-keys';
import { useCurrentProject } from './project-context';
import { PROJECT_COLORS } from './appearance-picker';

type Result<T> = { ok: true; data: T } | { ok: false; error: { message: string } };

/** Runs an action, toasts the outcome and refreshes the project (all tabs) on success. */
export function useSettingsRunner() {
  const queryClient = useQueryClient();
  const { project } = useCurrentProject();
  return async function run<T>(promise: Promise<Result<T>>, success?: string, failure = "Couldn't save that"): Promise<T | undefined> {
    const result = await promise;
    if (!result.ok) {
      toast.error(failure, result.error.message);
      return undefined;
    }
    if (success) toast.success(success);
    await queryClient.invalidateQueries({ queryKey: qk.project(project.key) });
    void queryClient.invalidateQueries({ queryKey: qk.projects() });
    return result.data;
  };
}

export function SettingsSection({
  id,
  title,
  description,
  action,
  children,
  highlight,
}: {
  readonly id: string;
  readonly title: string;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  readonly children: ReactNode;
  readonly highlight?: boolean;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn('scroll-mt-4 rounded-xl border border-border-subtle bg-panel shadow-xs transition-shadow duration-[var(--duration-slow)]', highlight && 'shadow-[0_0_0_3px_var(--focus-ring-soft)]')}
      data-testid={`settings-${id}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border-subtle px-5 py-4">
        <div className="min-w-0 flex-1 basis-64">
          <h2 id={`${id}-title`} className="text-base font-semibold text-fg">
            {title}
          </h2>
          {description ? <p className="mt-0.5 text-sm text-fg-muted">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

/** Color dot that opens the label palette. */
export function ColorDot({ color, onChange, label, disabled }: { readonly color: string; readonly onChange: (color: LabelColor) => void; readonly label: string; readonly disabled?: boolean }) {
  return (
    <Popover>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={label}
          title={label}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus disabled:pointer-events-none"
        >
          <span className="size-3.5 rounded-full ring-2 ring-[var(--surface-panel)]" style={{ background: `var(--label-${toLabelColor(color)})` }} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3">
        <ColorPicker value={toLabelColor(color)} onChange={onChange} colors={PROJECT_COLORS} columns={8} size="sm" label={label} />
      </PopoverContent>
    </Popover>
  );
}
