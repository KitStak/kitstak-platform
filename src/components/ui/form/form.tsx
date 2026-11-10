"use client";

/**
 * Form system (BUILD_PLAN 0.3 / F4.2): react-hook-form + zod.
 *
 *   const form = useZodForm(schema, defaults);
 *   <Form form={form} onSubmit={save} guardUnsaved>
 *     <FormField name="name" label="Name" required>{(c) => <TextField {...c} />}</FormField>
 *     <SubmitBar />
 *   </Form>
 *
 * - Inline error text under each invalid field (FormField).
 * - On an invalid submit, focus moves to the first invalid field in DOM order.
 * - Server `fieldErrors` from `useApiMutation({ form })` land on the same fields.
 * - `guardUnsaved` blocks reload / in-app navigation while the form is dirty.
 */
import * as React from "react";
import { useForm, FormProvider, type DefaultValues, type FieldErrors, type FieldValues, type UseFormProps, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { cn } from "@/lib/utils";
import { UnsavedChangesGuard } from "../unsaved-changes";

export type ZodFormSchema = z.ZodType<FieldValues, FieldValues>;
export type ZodForm<S extends ZodFormSchema> = UseFormReturn<z.input<S>, unknown, z.output<S>>;

export function useZodForm<S extends ZodFormSchema>(
  schema: S,
  defaultValues: DefaultValues<z.input<S>>,
  options: Omit<UseFormProps<z.input<S>, unknown, z.output<S>>, "resolver" | "defaultValues"> = {}
): ZodForm<S> {
  return useForm<z.input<S>, unknown, z.output<S>>({
    resolver: zodResolver(schema as never) as never,
    defaultValues,
    mode: "onTouched",
    reValidateMode: "onChange",
    shouldFocusError: false,
    ...options,
  });
}

/** Focuses the first invalid control inside `root` (DOM order), else the first error key. */
export function focusFirstError(root: HTMLElement | null, errors: FieldErrors, setFocus?: (name: string) => void): boolean {
  const target = root?.querySelector<HTMLElement>('[aria-invalid="true"]:not([disabled]), [data-invalid="true"] input:not([disabled]), [data-invalid="true"] button:not([disabled])');
  if (target) {
    target.focus();
    target.scrollIntoView?.({ block: "center", behavior: "smooth" });
    return true;
  }
  const first = Object.keys(errors)[0];
  if (first && setFocus) {
    try {
      setFocus(first);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export interface FormProps<TIn extends FieldValues, TOut> extends Omit<React.FormHTMLAttributes<HTMLFormElement>, "onSubmit" | "onInvalid"> {
  readonly form: UseFormReturn<TIn, unknown, TOut>;
  readonly onSubmit: (values: TOut) => unknown | Promise<unknown>;
  readonly onInvalid?: (errors: FieldErrors<TIn>) => void;
  /** Block navigation away while dirty and not yet submitted successfully. */
  readonly guardUnsaved?: boolean;
  readonly children: React.ReactNode;
}

export function Form<TIn extends FieldValues, TOut>({ form, onSubmit, onInvalid, guardUnsaved, className, children, ...props }: FormProps<TIn, TOut>) {
  const { isDirty, isSubmitSuccessful } = form.formState;

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.stopPropagation();
    const root = event.currentTarget;
    const handle = form.handleSubmit(
      async (values) => {
        await onSubmit(values);
      },
      (errors) => {
        // Wait a frame so FormField has rendered aria-invalid on the controls.
        requestAnimationFrame(() => focusFirstError(root, errors, (name) => form.setFocus(name as never)));
        onInvalid?.(errors);
      }
    );
    void handle(event).catch(() => {
      // Submission errors are surfaced by the caller (useApiMutation toasts + field errors).
      requestAnimationFrame(() => focusFirstError(root, form.formState.errors));
    });
  };

  return (
    <FormProvider {...form}>
      <form
        noValidate
        className={cn("flex flex-col gap-5", className)}
        onSubmit={submit}
        {...props}
      >
        {children}
      </form>
      {guardUnsaved ? <UnsavedChangesGuard when={isDirty && !isSubmitSuccessful} /> : null}
    </FormProvider>
  );
}
