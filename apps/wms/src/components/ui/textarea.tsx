'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { controlVariants } from './control-styles';
import { CharacterCount } from './text-field';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** "0 / 500" counter; defaults to on when maxLength is set. */
  readonly showCount?: boolean;
  readonly invalid?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, showCount, invalid, maxLength, value, defaultValue, onChange, rows = 3, ...props }, ref) => {
    const isControlled = value !== undefined;
    const [inner, setInner] = React.useState(String(defaultValue ?? ''));
    const length = (isControlled ? String(value ?? '') : inner).length;
    const counter = (showCount ?? maxLength !== undefined) && maxLength !== undefined;
    return (
      <div className="flex w-full flex-col gap-1">
        <textarea
          ref={ref}
          rows={rows}
          maxLength={maxLength}
          value={value}
          defaultValue={defaultValue}
          aria-invalid={invalid || props['aria-invalid'] || undefined}
          onChange={(e) => {
            if (!isControlled) setInner(e.target.value);
            onChange?.(e);
          }}
          className={cn(
            controlVariants({ size: 'md' }),
            'h-auto min-h-[64px] resize-y py-1.5 leading-5',
            className,
          )}
          {...props}
        />
        {counter ? <CharacterCount length={length} max={maxLength} /> : null}
      </div>
    );
  },
);
Textarea.displayName = 'Textarea';
