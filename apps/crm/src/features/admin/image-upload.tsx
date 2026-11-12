'use client';
/**
 * Avatar / logo uploader: click or drop an image, hover shows a "Change" overlay, Enter/Space
 * opens the picker. Validates type + size client-side (the server re-checks magic bytes).
 */
import { useRef, useState, type DragEvent } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { Button, cn, initialsFor, Spinner, toast } from '@/components/ui';
import { errorMessage } from '@/lib/hooks';
import { uploadImage } from './api';

const ACCEPT = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_BYTES = 2 * 1024 * 1024;

export interface ImageUploadProps {
  readonly name: string;
  readonly src: string | null;
  readonly shape: 'circle' | 'square';
  /** Rendered size in px. */
  readonly size: number;
  readonly label: string;
  readonly onChange: (url: string | null) => Promise<unknown> | void;
  readonly disabled?: boolean;
  readonly testId?: string;
  /** Only the image tile (hover overlay changes it); no side buttons or hint. */
  readonly compact?: boolean;
}

export function validateImageFile(file: { type: string; size: number }): string | null {
  if (!ACCEPT.includes(file.type)) return 'Use a PNG, JPG, GIF or WebP image.';
  if (file.size > MAX_BYTES) return 'Images can be up to 2 MB.';
  return null;
}

export function ImageUpload({ name, src, shape, size, label, onChange, disabled, testId, compact = false }: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const radius = shape === 'circle' ? 'rounded-full' : 'rounded-xl';

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const problem = validateImageFile(file);
    if (problem) {
      toast.error("Couldn't use that image", problem);
      return;
    }
    setBusy(true);
    try {
      const asset = await uploadImage(file);
      await onChange(asset.url);
    } catch (error) {
      toast.error('Upload failed', errorMessage(error));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const onDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!disabled && !busy) void handleFile(event.dataTransfer.files[0]);
  };

  return (
    <div className="flex items-center gap-4" data-testid={testId}>
      <button
        type="button"
        aria-label={label}
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'group relative shrink-0 overflow-hidden border border-border-subtle bg-primary-subtle text-primary-text shadow-xs',
          'transition-[box-shadow,transform] duration-[var(--duration-fast)] ease-out',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
          'hover:shadow-sm active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60',
          dragging && 'ring-2 ring-primary ring-offset-2 ring-offset-[var(--surface-panel)]',
          radius,
        )}
        style={{ width: size, height: size }}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- authenticated asset route, not optimizable
          <img src={src} alt="" className="size-full object-cover" />
        ) : (
          <span
            aria-hidden
            className="flex size-full items-center justify-center font-semibold"
            style={{ fontSize: Math.round(size * 0.34) }}
          >
            {initialsFor(name)}
          </span>
        )}
        <span
          aria-hidden
          className={cn(
            'absolute inset-0 flex flex-col items-center justify-center gap-1 bg-[color-mix(in_srgb,var(--surface-inverse)_62%,transparent)] text-xs font-medium text-fg-inverse',
            'opacity-0 transition-opacity duration-[var(--duration-fast)] group-hover:opacity-100 group-focus-visible:opacity-100',
            (busy || dragging) && 'opacity-100',
          )}
        >
          {busy ? <Spinner size="sm" label={null} className="text-fg-inverse" /> : <Camera className="size-4" />}
          {busy ? 'Uploading…' : dragging ? 'Drop to upload' : 'Change'}
        </span>
      </button>
      <div className={cn('flex flex-col gap-1.5', compact && 'hidden')}>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled={disabled || busy} onClick={() => inputRef.current?.click()}>
            Upload image
          </Button>
          {src ? (
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<Trash2 aria-hidden />}
              disabled={disabled || busy}
              onClick={() => void onChange(null)}
            >
              Remove
            </Button>
          ) : null}
        </div>
        <p className="text-sm text-fg-muted">PNG, JPG, GIF or WebP, up to 2 MB. Drag and drop works too.</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT.join(',')}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />
    </div>
  );
}
