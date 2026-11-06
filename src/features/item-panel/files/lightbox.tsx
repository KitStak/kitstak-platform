'use client';

/**
 * File viewer: images at full size with prev/next (arrow keys), PDFs and other documents as
 * a preview card that opens the browser's native viewer in a new tab, plus download.
 */
import { useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ChevronLeft, ChevronRight, Download, ExternalLink, X } from 'lucide-react';
import { Button, IconButton, Spinner } from '@/components/ui';
import type { FileDto } from '@/server/services/contracts/dto';
import { formatBytes, formatExact, panelFileKind } from '../lib/format';
import { FileKindIcon } from '../parts/common';

export interface LightboxProps {
  readonly files: readonly FileDto[];
  readonly index: number | null;
  readonly onIndexChange: (index: number | null) => void;
  readonly fileUrl: (fileId: string, download?: boolean) => string;
  readonly uploaderName?: (userId: string | null) => string | null;
}

export function Lightbox({ files, index, onIndexChange, fileUrl, uploaderName }: LightboxProps) {
  const file = index === null ? null : (files[index] ?? null);
  if (!file || index === null) return null;
  const kind = panelFileKind(file.mime, file.name);
  const go = (delta: number) => onIndexChange((index + delta + files.length) % files.length);
  const by = uploaderName?.(file.uploadedBy);

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => (open ? undefined : onIndexChange(null))}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[var(--z-modal)] bg-overlay/80 data-[state=open]:animate-fade-in" />
        <DialogPrimitive.Content
          data-testid="file-lightbox"
          aria-describedby={undefined}
          onKeyDown={(event) => {
            if (files.length < 2) return;
            if (event.key === 'ArrowRight') go(1);
            if (event.key === 'ArrowLeft') go(-1);
          }}
          className="fixed inset-0 z-[var(--z-modal)] flex flex-col outline-none data-[state=open]:animate-fade-in"
        >
          <header className="flex items-center gap-3 bg-raised px-4 py-2.5 shadow-sm">
            <FileKindIcon mime={file.mime} name={file.name} size={28} />
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="truncate text-base font-medium text-fg">{file.name}</DialogPrimitive.Title>
              <p className="truncate text-xs text-fg-muted">
                {formatBytes(file.size)} · {by ? `${by} · ` : ''}
                {formatExact(file.createdAt)}
                {files.length > 1 ? ` · ${index + 1} of ${files.length}` : ''}
              </p>
            </div>
            <Button variant="secondary" size="sm" leadingIcon={<ExternalLink aria-hidden />} onClick={() => window.open(fileUrl(file.id), '_blank', 'noopener')}>
              <span className="hidden sm:inline">Open</span>
            </Button>
            <a
              href={fileUrl(file.id, true)}
              download={file.name}
              className="inline-flex h-7 items-center gap-1.5 rounded-sm bg-primary px-2.5 text-sm font-medium text-primary-fg transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:bg-primary-active"
            >
              <Download aria-hidden className="size-4" />
              <span className="hidden sm:inline">Download</span>
            </a>
            <DialogPrimitive.Close asChild>
              <IconButton label="Close viewer" icon={<X aria-hidden />} shortcut={['Esc']} />
            </DialogPrimitive.Close>
          </header>
          <div
            className="relative flex min-h-0 flex-1 items-center justify-center p-4 sm:p-10"
            onClick={(event) => {
              if (event.target === event.currentTarget) onIndexChange(null);
            }}
          >
            {kind === 'image' ? (
              <LightboxImage key={file.id} file={file} fileUrl={fileUrl} />
            ) : (
              <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-xl bg-raised p-8 text-center shadow-lg">
                <FileKindIcon mime={file.mime} name={file.name} size={64} className="rounded-xl" />
                <div className="flex flex-col gap-1">
                  <p className="font-heading text-md font-semibold break-all text-fg">{file.name}</p>
                  <p className="text-sm text-fg-secondary">
                    {kind === 'pdf'
                        ? 'PDFs open in your browser’s viewer, so you can search, zoom and print.'
                        : 'No inline preview for this file type.'}
                  </p>
                </div>
                <div className="flex gap-2">
                  {kind === 'pdf' || kind === 'media' || kind === 'text' ? (
                    <Button variant="primary" leadingIcon={<ExternalLink aria-hidden />} onClick={() => window.open(fileUrl(file.id), '_blank', 'noopener')}>
                      Open preview
                    </Button>
                  ) : null}
                  <a
                    href={fileUrl(file.id, true)}
                    download={file.name}
                    className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-border-input bg-panel px-3 text-base font-medium text-fg transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    <Download aria-hidden className="size-4" />
                    Download
                  </a>
                </div>
              </div>
            )}
            {files.length > 1 ? (
              <>
                <IconButton
                  label="Previous file"
                  icon={<ChevronLeft aria-hidden />}
                  size="lg"
                  round
                  variant="outline"
                  className="absolute left-3 shadow-md sm:left-5"
                  shortcut={['←']}
                  onClick={() => go(-1)}
                />
                <IconButton
                  label="Next file"
                  icon={<ChevronRight aria-hidden />}
                  size="lg"
                  round
                  variant="outline"
                  className="absolute right-3 shadow-md sm:right-5"
                  shortcut={['→']}
                  onClick={() => go(1)}
                />
              </>
            ) : null}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function LightboxImage({ file, fileUrl }: { readonly file: FileDto; readonly fileUrl: (fileId: string, download?: boolean) => string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-xl bg-raised p-8 text-center shadow-lg">
        <FileKindIcon mime={file.mime} name={file.name} size={64} className="rounded-xl" />
        <p className="text-sm text-fg-secondary">This image could not be displayed. Try downloading it instead.</p>
      </div>
    );
  }
  return (
    <>
      {!loaded ? <Spinner size="lg" className="absolute text-fg-inverse" label="Loading image" /> : null}
      {/* eslint-disable-next-line @next/next/no-img-element -- authenticated file URL, not optimizable */}
      <img
        src={fileUrl(file.id)}
        alt={file.name}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className="max-h-full max-w-full rounded-md object-contain shadow-lg transition-opacity duration-[var(--duration-normal)]"
        style={{ opacity: loaded ? 1 : 0 }}
      />
    </>
  );
}
