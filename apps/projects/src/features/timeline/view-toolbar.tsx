'use client';
/** Toolbar + "Options" popover shared by the Timeline, Calendar and Workload views. */
import type { ReactNode } from 'react';
import { CircleHelp, SlidersHorizontal } from 'lucide-react';
import { Button, IconButton, Popover, PopoverContent, PopoverTrigger, Select, Switch, cn, type SelectOption } from '@/components/ui';

export function ViewToolbar({ children, className, testId }: { readonly children: ReactNode; readonly className?: string; readonly testId?: string }) {
  return (
    <div
      role="toolbar"
      data-testid={testId}
      className={cn('flex shrink-0 flex-wrap items-center gap-2 border-b border-border-subtle bg-panel px-4 py-2 sm:px-6', className)}
    >
      {children}
    </div>
  );
}

export function ToolbarSpacer() {
  return <span aria-hidden className="min-w-0 flex-1" />;
}

export function OptionsMenu({ children, title, testId }: { readonly children: ReactNode; readonly title: string; readonly testId?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" leadingIcon={<SlidersHorizontal aria-hidden />} data-testid={testId} aria-label={title}>
          <span className="max-[639px]:sr-only">Options</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72" aria-label={title}>
        <h3 className="mb-3 text-sm font-semibold text-fg">{title}</h3>
        <div className="flex flex-col gap-3">{children}</div>
      </PopoverContent>
    </Popover>
  );
}

export function OptionSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly (SelectOption & { value: T })[];
  readonly onChange: (value: T) => void;
  readonly testId?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm text-fg-secondary" data-testid={testId}>
      <span className="shrink-0">{label}</span>
      <span className="w-40">
        <Select size="sm" aria-label={label} value={value} onValueChange={(next) => onChange(next as T)} options={options} />
      </span>
    </label>
  );
}

export function OptionSwitch({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  readonly label: string;
  readonly description?: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
}) {
  return <Switch size="sm" label={label} description={description} checked={checked} onCheckedChange={onChange} disabled={disabled} />;
}

export function OptionsDivider() {
  return <hr className="border-border-subtle" />;
}

/** "How this works" tips for a view, in plain words. */
export function ViewTips({ title, tips, testId }: { readonly title: string; readonly tips: readonly { readonly icon: ReactNode; readonly text: ReactNode }[]; readonly testId?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton size="sm" label={title} icon={<CircleHelp aria-hidden />} data-testid={testId} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80" aria-label={title}>
        <h3 className="mb-2 text-sm font-semibold text-fg">{title}</h3>
        <ul className="flex flex-col gap-2.5">
          {tips.map((tip, index) => (
            <li key={index} className="flex gap-2.5 text-sm text-fg-secondary">
              <span aria-hidden className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm bg-muted text-icon [&_svg]:size-3.5">
                {tip.icon}
              </span>
              <span>{tip.text}</span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
