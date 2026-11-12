'use client';

/**
 * Create Tag modal (BUILD_PLAN F4.4): colour swatch, name (0 / 30), Add.
 * `POST /api/tags { name, color, scope }` → the created tag.
 */
import * as React from 'react';
import { z } from 'zod';
import { useApiMutation } from '@/lib/query-client';
import { Button } from '@/components/ui/button';
import { ColorSwatchPicker, DEFAULT_SWATCHES, contrastOn } from '@/components/ui/color-swatch-picker';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { TextField } from '@/components/ui/text-field';
import { DisabledReason } from '@/components/ui/tooltip';
import { TAG_NAME_MAX, tagSchema, type Tag } from './contracts';

export const TAGS_QUERY_KEY = ['tags'] as const;

export const createTagSchema = z.object({
  name: z.string().trim().min(1, 'Enter a tag name').max(TAG_NAME_MAX, `At most ${TAG_NAME_MAX} characters`),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Choose a colour'),
});

export interface CreateTagModalProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly scope?: string;
  readonly onCreated?: (tag: Tag) => void;
}

export function CreateTagModal({ open, onOpenChange, scope = 'any', onCreated }: CreateTagModalProps) {
  const [name, setName] = React.useState('');
  const [color, setColor] = React.useState<string>(DEFAULT_SWATCHES[0] ?? '#2E5CE6');
  const [touched, setTouched] = React.useState(false);
  const create = useApiMutation<{ name: string; color: string }, unknown>({
    path: '/api/tags',
    method: 'POST',
    body: (v) => ({ ...v, scope }),
    invalidate: [TAGS_QUERY_KEY],
    successMessage: (_d, v) => `Tag "${v.name}" created`,
    onSuccess: (data) => {
      const parsed = tagSchema.safeParse(data);
      if (parsed.success) onCreated?.(parsed.data);
    },
  });
  const result = createTagSchema.safeParse({ name, color });
  const error = result.success ? null : (result.error.issues[0]?.message ?? 'Invalid tag');
  const nameError = result.success
    ? null
    : (result.error.issues.find((i) => i.path[0] === 'name')?.message ?? null);

  const close = (next: boolean) => {
    if (!next) {
      setName('');
      setTouched(false);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent size="sm">
        <DialogHeader title="Create tag" />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (!result.success) return;
            create.mutate(result.data, { onSuccess: () => close(false) });
          }}
        >
          <DialogBody className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <span
                className="inline-flex h-7 max-w-[220px] items-center truncate rounded-full px-3 text-xs font-semibold"
                style={{ backgroundColor: color, color: contrastOn(color) }}
              >
                {name.trim() || 'Tag preview'}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-secondary">Colour</span>
              <ColorSwatchPicker value={color} onChange={setColor} ariaLabel="Tag colour" />
            </div>
            <label className="flex flex-col gap-1 text-xs font-semibold text-secondary">
              <span>
                Name <span className="text-danger">*</span>
              </span>
              <TextField
                autoFocus
                value={name}
                maxLength={TAG_NAME_MAX}
                showCount
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setTouched(true)}
                invalid={touched && Boolean(nameError)}
                aria-describedby="create-tag-name-error"
              />
              {touched && nameError ? (
                <span id="create-tag-name-error" className="text-2xs font-medium text-danger">
                  {nameError}
                </span>
              ) : null}
            </label>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => close(false)}>
              Cancel
            </Button>
            <DisabledReason reason={create.isPending ? 'Saving…' : error}>
              <Button type="submit" variant="primary" disabled={create.isPending || Boolean(error)}>
                Add
              </Button>
            </DisabledReason>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
