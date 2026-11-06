'use client';
import { useState, type KeyboardEvent } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Presentation,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Dialog, DialogContent, IconButton, cn, labelColorStyle, type LabelColor } from '@/components/ui';
import type { FileDto } from '@/server/services/contracts/dto';
import { fileKind, formatBytes, type FileKind } from '../lib/format';

const KIND_COLOR: Readonly<Record<FileKind, LabelColor>> = {
  pdf: 'red',
  sheet: 'green',
  doc: 'dark-blue',
  slides: 'peach',
  archive: 'yellow',
  image: 'sky',
  media: 'sky',
  text: 'gray',
  other: 'gray',
};

const KIND_ICON: Readonly<Record<FileKind, typeof File>> = {
  pdf: FileText,
  sheet: FileSpreadsheet,
  doc: FileText,
  slides: Presentation,
  archive: FileArchive,
  image: FileImage,
  media: FileVideo,
  text: FileText,
  other: File,
};

export function kindOf(file: Pick<FileDto, 'mime' | 'name'>): FileKind {
  return fileKind(file.mime, file.name);
}

/** 24px (or 32px) file-type tile; images render a real thumbnail. */
export function FileThumb({
  file,
  url,
  size = 'sm',
}: {
  readonly file: Pick<FileDto, 'mime' | 'name'> | null;
  readonly url?: string;
  readonly size?: 'sm' | 'md';
}) {
  const kind = file ? kindOf(file) : 'other';
  const Icon = KIND_ICON[kind];
  const box = size === 'md' ? 'size-8' : 'size-6';
  if (kind === 'image' && url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- authenticated API file URL, not a static asset
      <img src={url} alt="" loading="lazy" className={cn(box, 'shrink-0 rounded-xs border border-border-subtle bg-muted object-cover')} />
    );
  }
  return (
    <span
      aria-hidden
      style={labelColorStyle(KIND_COLOR[kind])}
      className={cn(box, 'inline-flex shrink-0 items-center justify-center rounded-xs bg-[var(--lc-bg)] text-[var(--lc-fg)]')}
    >
      <Icon className={size === 'md' ? 'size-4' : 'size-3.5'} />
    </span>
  );
}

export interface FileLightboxProps {
  readonly files: readonly FileDto[];
  readonly index: number | null;
  readonly onIndexChange: (index: number | null) => void;
  readonly fileUrl?: (fileId: string, download?: boolean) => string;
}

/** File viewer: ←/→ to move, zoom for images, download. */
export function FileLightbox({ files, index, onIndexChange, fileUrl }: FileLightboxProps) {
  const [zoom, setZoom] = useState(1);
  const file = index === null ? undefined : files[index];
  const go = (delta: number) => {
    if (index === null || files.length === 0) return;
    setZoom(1);
    onIndexChange((index + delta + files.length) % files.length);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowRight') go(1);
    if (event.key === 'ArrowLeft') go(-1);
  };
  const kind = file ? kindOf(file) : 'other';
  const url = file && fileUrl ? fileUrl(file.id) : undefined;
  return (
    <Dialog open={Boolean(file)} onOpenChange={(open) => !open && onIndexChange(null)}>
      <DialogContent size="xl" onKeyDown={onKeyDown} aria-describedby={undefined} className="h-[min(760px,calc(100dvh-48px))]">
        {file ? (
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center gap-3 border-b border-border-subtle px-5 py-3 pr-14">
              <FileThumb file={file} size="md" />
              <div className="min-w-0 flex-1">
                <DialogPrimitive.Title className="truncate text-base font-medium text-fg">{file.name}</DialogPrimitive.Title>
                <p className="text-xs text-fg-muted">
                  {formatBytes(file.size)} · {index !== null ? index + 1 : 0} of {files.length}
                </p>
              </div>
              {kind === 'image' ? (
                <>
                  <IconButton size="sm" label="Zoom out" icon={<ZoomOut aria-hidden />} disabled={zoom <= 0.5} onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} />
                  <IconButton size="sm" label="Zoom in" icon={<ZoomIn aria-hidden />} disabled={zoom >= 3} onClick={() => setZoom((z) => Math.min(3, z + 0.25))} />
                </>
              ) : null}
              {fileUrl ? (
                <a
                  href={fileUrl(file.id, true)}
                  className="inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-sm font-medium text-primary-text hover:bg-primary-subtle focus-visible:outline-2 focus-visible:outline-focus"
                >
                  <Download aria-hidden className="size-4" /> Download
                </a>
              ) : null}
            </div>
            <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto bg-sunken">
              {kind === 'image' && url ? (
                // eslint-disable-next-line @next/next/no-img-element -- authenticated API file URL
                <img src={url} alt={file.name} className="max-h-full max-w-full object-contain transition-transform duration-[var(--duration-normal)]" style={{ transform: `scale(${zoom})` }} />
              ) : kind === 'pdf' && url ? (
                <iframe title={file.name} src={url} className="size-full border-0 bg-panel" />
              ) : (
                <div className="flex flex-col items-center gap-3 text-center">
                  <FileThumb file={file} size="md" />
                  <p className="text-sm text-fg-secondary">No preview for this file type.</p>
                </div>
              )}
              {files.length > 1 ? (
                <>
                  <IconButton round variant="outline" label="Previous file" icon={<ChevronLeft aria-hidden />} onClick={() => go(-1)} className="absolute top-1/2 left-3 -translate-y-1/2 shadow-md" />
                  <IconButton round variant="outline" label="Next file" icon={<ChevronRight aria-hidden />} onClick={() => go(1)} className="absolute top-1/2 right-3 -translate-y-1/2 shadow-md" />
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
