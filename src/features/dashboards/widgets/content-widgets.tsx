'use client';

/** Text (rich note with inline editing), Countdown and Section header widgets. */
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { PencilLine } from 'lucide-react';
import { Button, Textarea, cn, toLabelColor } from '@/components/ui';
import { cssColor, cssSubtle } from '../lib/colors';
import { countdownParts, parseRichText, type Inline } from '../lib/rich-text';
import type { WidgetRenderProps } from './types';

function renderInline(parts: readonly Inline[]): ReactNode {
  return parts.map((part, index) => {
    switch (part.kind) {
      case 'bold':
        return <strong key={index} className="font-semibold text-fg">{part.text}</strong>;
      case 'italic':
        return <em key={index}>{part.text}</em>;
      case 'link':
        return (
          <a key={index} href={part.href} target={part.href.startsWith('/') ? undefined : '_blank'} rel="noopener noreferrer" className="text-fg-link underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus">
            {part.text}
          </a>
        );
      default:
        return <Fragment key={index}>{part.text}</Fragment>;
    }
  });
}

export function RichText({ source }: { readonly source: string }) {
  const blocks = parseRichText(source);
  return (
    <div className="flex flex-col gap-2 text-base leading-6 text-fg-secondary">
      {blocks.map((block, index) =>
        block.kind === 'heading' ? (
          <h4 key={index} className="font-heading text-md font-semibold text-fg">{renderInline(block.inline)}</h4>
        ) : block.kind === 'list' ? (
          <ul key={index} className="flex list-disc flex-col gap-1 pl-5 marker:text-fg-muted">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{renderInline(item)}</li>
            ))}
          </ul>
        ) : (
          <p key={index}>{renderInline(block.inline)}</p>
        ),
      )}
    </div>
  );
}

export function TextWidget({ settings, editable, onUpdateConfig }: WidgetRenderProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(settings.text ?? '');
  const source = settings.text ?? '';
  const save = () => {
    setEditing(false);
    if (draft !== source) onUpdateConfig?.({ text: draft });
  };
  if (editing) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-2">
        <Textarea
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setDraft(source);
              setEditing(false);
            }
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) save();
          }}
          aria-label="Widget text"
          className="min-h-0 flex-1 resize-none font-mono text-sm"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-fg-muted">**bold**, _italic_, - list, # heading, [link](https://…)</span>
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => { setDraft(source); setEditing(false); }}>
              Cancel
            </Button>
            <Button size="sm" onClick={save}>
              Save
            </Button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div
      className={cn('group/text relative h-full min-h-0 overflow-y-auto', editable && 'cursor-text')}
      onDoubleClick={editable ? () => { setDraft(source); setEditing(true); } : undefined}
    >
      {source.trim() ? (
        <RichText source={source} />
      ) : (
        <p className="text-sm text-fg-muted">{editable ? 'Double-click to write a note for your team.' : 'No text yet.'}</p>
      )}
      {editable ? (
        <Button
          size="xs"
          variant="secondary"
          leadingIcon={<PencilLine />}
          className="absolute top-0 right-0 opacity-0 transition-opacity duration-[var(--duration-fast)] group-hover/text:opacity-100 focus-visible:opacity-100"
          onClick={() => { setDraft(source); setEditing(true); }}
        >
          Edit
        </Button>
      ) : null}
    </div>
  );
}

function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function CountdownWidget({ settings }: WidgetRenderProps) {
  const now = useNow(1000);
  const color = toLabelColor(settings.color, 'berry');
  const targetIso = settings.targetDate ? `${settings.targetDate}T${settings.targetTime ?? '00:00'}:00` : null;
  const target = targetIso ? new Date(targetIso) : null;
  if (!target || Number.isNaN(target.getTime())) {
    return <p className="flex h-full items-center justify-center text-sm text-fg-muted">Pick a target date in settings.</p>;
  }
  const parts = countdownParts(target, now);
  const units = [
    { key: 'days', label: 'Days', value: parts.days },
    { key: 'hours', label: 'Hours', value: parts.hours },
    { key: 'minutes', label: 'Min', value: parts.minutes },
    { key: 'seconds', label: 'Sec', value: parts.seconds },
  ];
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 [container-type:inline-size]" data-testid="countdown-widget">
      <div className="flex w-full justify-center gap-2" role="timer" aria-live="off" aria-label={`${parts.days} days ${parts.hours} hours ${parts.minutes} minutes left`}>
        {units.map((unit) => (
          <div key={unit.key} className="flex min-w-0 flex-1 flex-col items-center gap-1" style={{ maxWidth: 88 }}>
            <span
              // Digits in the body text color on the tint (AA in both themes for every palette
              // color); the palette color carries the identity as a top accent.
              className="flex w-full items-center justify-center rounded-lg border-t-2 py-2 font-heading font-medium text-fg tabular-nums"
              style={{ background: cssSubtle(color), borderTopColor: cssColor(color), fontSize: 'clamp(18px, 7cqw, 34px)' }}
            >
              <span key={unit.key === 'seconds' ? unit.value : undefined} className={unit.key === 'seconds' ? 'ks-dash-tick' : undefined}>
                {String(unit.value).padStart(2, '0')}
              </span>
            </span>
            <span className="text-[11px] font-medium tracking-wide text-fg-muted uppercase">{unit.label}</span>
          </div>
        ))}
      </div>
      <p className="text-center text-sm text-fg-secondary">
        {parts.past ? 'Reached on ' : 'Until '}
        <span className="font-medium text-fg">
          {target.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
        </span>
      </p>
    </div>
  );
}

export function SectionWidget({ title, settings }: WidgetRenderProps) {
  return (
    <div className="flex h-full flex-col justify-end gap-0.5 border-b-2 border-border-default pb-2">
      <h2 className="truncate font-heading text-xl font-semibold tracking-[-0.01em] text-fg">{title}</h2>
      {settings.description ? <p className="truncate text-sm text-fg-secondary">{settings.description}</p> : null}
    </div>
  );
}
