'use client';

/** Small shared pieces: ticking clock, relative time with exact tooltip, file icon tile. */
import { useEffect, useState } from 'react';
import { File, FileArchive, FileImage, FileSpreadsheet, FileText, FileVideo, Presentation } from 'lucide-react';
import { Tooltip, cn, labelColorVars, type LabelColor } from '@/components/ui';
import { formatExact, formatRelativeShort, panelFileKind, type PanelFileKind } from '../lib/format';

/** Current time, refreshed every minute so relative stamps stay honest. */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function RelativeTime({ iso, now, className }: { readonly iso: string; readonly now: Date; readonly className?: string }) {
  return (
    <Tooltip content={formatExact(iso)} side="top">
      <time
        dateTime={iso}
        tabIndex={0}
        className={cn(
          'rounded-xs text-xs text-fg-muted tabular-nums outline-none hover:text-fg-secondary focus-visible:outline-2 focus-visible:outline-focus',
          className,
        )}
      >
        {formatRelativeShort(iso, now)}
      </time>
    </Tooltip>
  );
}

const KIND_COLOR: Readonly<Record<PanelFileKind, LabelColor>> = {
  pdf: 'red',
  sheet: 'green',
  doc: 'dark-blue',
  slides: 'orange',
  archive: 'yellow',
  image: 'sky',
  media: 'purple',
  text: 'gray',
  other: 'gray',
};

const KIND_ICON: Readonly<Record<PanelFileKind, typeof File>> = {
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

export function FileKindIcon({
  mime,
  name,
  size = 32,
  className,
}: {
  readonly mime: string;
  readonly name: string;
  readonly size?: number;
  readonly className?: string;
}) {
  const kind = panelFileKind(mime, name);
  const Icon = KIND_ICON[kind];
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center rounded-md', className)}
      style={{ background: labelColorVars(KIND_COLOR[kind]).subtle, color: labelColorVars(KIND_COLOR[kind]).text, width: size, height: size }}
    >
      <Icon style={{ width: size * 0.55, height: size * 0.55 }} />
    </span>
  );
}
