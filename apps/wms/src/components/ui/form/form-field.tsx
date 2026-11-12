'use client';

/**
 * FormField: label (+ required `*`, info tip), the control, inline error, description.
 * The render prop receives everything a primitive needs, already wired for a11y:
 *
 *   <FormField name="qty" label="Quantity" required>
 *     {(c) => <NumberInput {...c} value={c.value} onChange={c.onChange} />}
 *   </FormField>
 */
import * as React from 'react';
import {
  Controller,
  useFormContext,
  type ControllerFieldState,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form';
import { cn } from '@/lib/utils';
import { errorTextClass, helpTextClass, labelClass } from '../control-styles';
import { InfoTip } from '../info-tip';

export interface FieldControlProps {
  readonly id: string;
  readonly name: string;
  // The field value is whatever the schema says; primitives narrow it themselves.
  readonly value: never;
  readonly onChange: (...event: unknown[]) => void;
  readonly onBlur: () => void;
  readonly ref: React.RefCallback<HTMLElement | null>;
  readonly disabled?: boolean;
  readonly invalid: boolean;
  readonly 'aria-invalid': boolean | undefined;
  readonly 'aria-describedby': string | undefined;
  readonly 'aria-required': boolean | undefined;
}

export interface FormFieldProps<T extends FieldValues> {
  readonly name: FieldPath<T>;
  readonly label?: React.ReactNode;
  readonly required?: boolean;
  readonly info?: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly disabled?: boolean;
  /** Put the label beside the control (switches, yes/no). */
  readonly inline?: boolean;
  readonly className?: string;
  readonly children: (control: FieldControlProps, state: ControllerFieldState) => React.ReactNode;
}

export function FieldLabel({
  htmlFor,
  required,
  info,
  children,
  id,
}: {
  readonly htmlFor?: string;
  readonly required?: boolean;
  readonly info?: React.ReactNode;
  readonly children: React.ReactNode;
  readonly id?: string;
}) {
  return (
    <span className="flex items-center gap-1">
      <label htmlFor={htmlFor} id={id} className={labelClass}>
        {children}
        {required ? (
          <span className="ml-0.5 text-danger" aria-hidden>
            *
          </span>
        ) : null}
      </label>
      {info ? <InfoTip content={info} /> : null}
    </span>
  );
}

export function FieldError({ id, message }: { readonly id: string; readonly message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className={errorTextClass}>
      {message}
    </p>
  );
}

export function FormField<T extends FieldValues>({
  name,
  label,
  required,
  info,
  description,
  disabled,
  inline,
  className,
  children,
}: FormFieldProps<T>) {
  const { control } = useFormContext<T>();
  const baseId = React.useId();
  const id = `${baseId}-control`;
  const errorId = `${baseId}-error`;
  const descriptionId = `${baseId}-description`;

  return (
    <Controller
      control={control}
      name={name}
      disabled={disabled}
      render={({ field, fieldState }) => {
        const message = fieldState.error?.message;
        const describedBy =
          [message ? errorId : null, description ? descriptionId : null].filter(Boolean).join(' ') ||
          undefined;
        const controlProps: FieldControlProps = {
          id,
          name: field.name,
          value: field.value as never,
          onChange: field.onChange,
          onBlur: field.onBlur,
          ref: field.ref,
          disabled: field.disabled,
          invalid: Boolean(message),
          'aria-invalid': message ? true : undefined,
          'aria-describedby': describedBy,
          'aria-required': required || undefined,
        };
        return (
          <div
            className={cn(
              inline ? 'flex items-center justify-between gap-3' : 'flex flex-col gap-1.5',
              className,
            )}
            data-field={field.name}
          >
            {label ? (
              <FieldLabel htmlFor={id} required={required} info={info}>
                {label}
              </FieldLabel>
            ) : null}
            <div className={cn(inline ? 'shrink-0' : 'flex flex-col gap-1')}>
              {children(controlProps, fieldState)}
              {!inline ? <FieldError id={errorId} message={message} /> : null}
              {!inline && description && !message ? (
                <p id={descriptionId} className={helpTextClass}>
                  {description}
                </p>
              ) : null}
            </div>
            {inline && message ? <FieldError id={errorId} message={message} /> : null}
          </div>
        );
      }}
    />
  );
}
