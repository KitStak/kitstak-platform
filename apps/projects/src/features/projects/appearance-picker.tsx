'use client';
/** Color + icon picker for projects (wizard and settings). The trigger is the project's icon tile. */
import { useState } from 'react';
import { ColorPicker, Popover, PopoverContent, PopoverTrigger, cn, toLabelColor, type LabelColor } from '@/components/ui';
import { EntityIcon, ENTITY_ICON_NAMES } from '@/components/pm';
import { LABEL_COLORS } from '@/lib/constants';

export const PROJECT_COLORS: readonly LabelColor[] = LABEL_COLORS.filter((color) => !color.endsWith('-light'));

export function IconGrid({ value, color, onChange, className }: { readonly value: string; readonly color: string; readonly onChange: (icon: string) => void; readonly className?: string }) {
  return (
    <div role="radiogroup" aria-label="Icon" className={cn('grid grid-cols-8 gap-1', className)}>
      {ENTITY_ICON_NAMES.map((name) => (
        <button
          key={name}
          type="button"
          role="radio"
          aria-checked={value === name}
          aria-label={name.replace(/-/g, ' ')}
          title={name.replace(/-/g, ' ')}
          onClick={() => onChange(name)}
          className={cn(
            'inline-flex items-center justify-center rounded-md p-1 outline-none transition-colors duration-[var(--duration-fast)] focus-visible:outline-2 focus-visible:outline-focus',
            value === name ? 'bg-selected ring-1 ring-primary' : 'hover:bg-hover',
          )}
        >
          <EntityIcon icon={name} color={color} size={26} />
        </button>
      ))}
    </div>
  );
}

export function AppearancePicker({
  color,
  icon,
  onChange,
  size = 40,
  disabled,
}: {
  readonly color: string;
  readonly icon: string;
  readonly onChange: (next: { color?: string; icon?: string }) => void;
  readonly size?: number;
  readonly disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label="Change color and icon"
          title="Change color and icon"
          className="shrink-0 rounded-lg outline-none transition-transform duration-[var(--duration-fast)] hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:pointer-events-none motion-reduce:hover:scale-100"
          data-testid="appearance-trigger"
        >
          <EntityIcon icon={icon} color={color} size={size} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[300px] p-3">
        <p className="mb-2 text-xs font-medium text-fg-secondary">Color</p>
        <ColorPicker value={toLabelColor(color)} onChange={(next) => onChange({ color: next })} colors={PROJECT_COLORS} columns={8} />
        <p className="mt-3 mb-2 text-xs font-medium text-fg-secondary">Icon</p>
        <IconGrid value={icon} color={color} onChange={(next) => onChange({ icon: next })} className="max-h-48 overflow-y-auto" />
      </PopoverContent>
    </Popover>
  );
}
