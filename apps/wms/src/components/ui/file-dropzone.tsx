'use client';

/**
 * File dropzone (BUILD_PLAN F4.2): drag-and-drop or browse, type and size validation,
 * per-file progress. Validation is pure (`validateFiles`) so imports can reuse it.
 */
import * as React from 'react';
import { FileText, UploadCloud, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { errorTextClass } from './control-styles';
import { ProgressBar } from './progress-bar';

export interface FileRejection {
  readonly file: File;
  readonly reason: string;
}

export interface FileValidationOptions {
  /** Extensions (".xlsx") and/or MIME types ("text/csv", "image/*"). */
  readonly accept?: readonly string[];
  readonly maxSizeBytes?: number;
  readonly maxFiles?: number;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function matchesAccept(file: File, accept: readonly string[]): boolean {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return accept.some((rule) => {
    const r = rule.trim().toLowerCase();
    if (r.startsWith('.')) return name.endsWith(r);
    if (r.endsWith('/*')) return type.startsWith(r.slice(0, -1));
    return type === r;
  });
}

export function validateFiles(
  files: readonly File[],
  { accept, maxSizeBytes, maxFiles }: FileValidationOptions,
): { readonly accepted: readonly File[]; readonly rejected: readonly FileRejection[] } {
  const accepted: File[] = [];
  const rejected: FileRejection[] = [];
  for (const file of files) {
    if (accept && accept.length && !matchesAccept(file, accept))
      rejected.push({ file, reason: `${file.name}: file type is not allowed (${accept.join(', ')}).` });
    else if (maxSizeBytes !== undefined && file.size > maxSizeBytes)
      rejected.push({ file, reason: `${file.name}: larger than ${formatBytes(maxSizeBytes)}.` });
    else if (maxFiles !== undefined && accepted.length >= maxFiles)
      rejected.push({
        file,
        reason: `${file.name}: only ${maxFiles} file${maxFiles === 1 ? '' : 's'} allowed.`,
      });
    else accepted.push(file);
  }
  return { accepted, rejected };
}

export interface DropzoneItem {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  /** 0–100; undefined = not started. */
  readonly progress?: number;
  readonly error?: string;
}

export interface FileDropzoneProps extends FileValidationOptions {
  readonly onFiles: (files: readonly File[]) => void;
  readonly multiple?: boolean;
  readonly disabled?: boolean;
  readonly title?: string;
  readonly hint?: string;
  /** Files already chosen/uploading, shown under the zone with progress. */
  readonly items?: readonly DropzoneItem[];
  readonly onRemove?: (id: string) => void;
  readonly id?: string;
  readonly className?: string;
}

export function FileDropzone({
  onFiles,
  accept,
  maxSizeBytes,
  maxFiles,
  multiple = false,
  disabled,
  title = 'Drag and drop a file here, or browse',
  hint,
  items = [],
  onRemove,
  id,
  className,
}: FileDropzoneProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [rejections, setRejections] = React.useState<readonly FileRejection[]>([]);
  const autoHint =
    hint ??
    [
      accept?.length ? `Accepted: ${accept.join(', ')}` : null,
      maxSizeBytes ? `Max ${formatBytes(maxSizeBytes)}` : null,
    ]
      .filter(Boolean)
      .join(' · ');

  const handle = (list: FileList | null) => {
    if (!list || disabled) return;
    const files = Array.from(list).slice(0, multiple ? undefined : 1);
    const result = validateFiles(files, { accept, maxSizeBytes, maxFiles: multiple ? maxFiles : 1 });
    setRejections(result.rejected);
    if (result.accepted.length) onFiles(result.accepted);
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        aria-describedby={id ? `${id}-hint` : undefined}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handle(e.dataTransfer.files);
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-6 py-7 text-center outline-none transition-colors',
          'border-border-strong bg-surface-sunken hover:border-primary/60 hover:bg-primary-soft/40 focus-visible:ring-2 focus-visible:ring-focus/30',
          dragging && 'border-primary bg-primary-soft/60',
          disabled && 'cursor-not-allowed opacity-50 hover:border-border-strong hover:bg-surface-sunken',
        )}
      >
        <UploadCloud className={cn('h-7 w-7', dragging ? 'text-primary' : 'text-faint')} aria-hidden />
        <p className="text-sm font-medium text-body">{title}</p>
        {autoHint ? (
          <p id={id ? `${id}-hint` : undefined} className="text-2xs text-faint">
            {autoHint}
          </p>
        ) : null}
        <input
          ref={inputRef}
          id={id}
          type="file"
          className="sr-only"
          tabIndex={-1}
          multiple={multiple}
          accept={accept?.join(',')}
          disabled={disabled}
          onChange={(e) => {
            handle(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {rejections.map((r) => (
        <p key={r.file.name} role="alert" className={errorTextClass}>
          {r.reason}
        </p>
      ))}
      {items.length ? (
        <ul className="flex flex-col gap-1.5">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-2.5 rounded-md border border-border bg-surface px-3 py-2"
            >
              <FileText className="h-4 w-4 shrink-0 text-secondary" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-medium text-body">{item.name}</span>
                  <span className="shrink-0 tabular-nums text-faint">
                    {item.error
                      ? 'Failed'
                      : item.progress !== undefined
                        ? `${Math.round(item.progress)}%`
                        : formatBytes(item.size)}
                  </span>
                </div>
                {item.error ? (
                  <p className={errorTextClass}>{item.error}</p>
                ) : item.progress !== undefined ? (
                  <ProgressBar
                    value={item.progress}
                    size="sm"
                    className="mt-1"
                    label={`Uploading ${item.name}`}
                  />
                ) : null}
              </div>
              {onRemove ? (
                <button
                  type="button"
                  aria-label={`Remove ${item.name}`}
                  onClick={() => onRemove(item.id)}
                  className="rounded p-1 text-faint hover:bg-neutral-soft hover:text-body"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
