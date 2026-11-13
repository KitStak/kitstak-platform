/** Marks every occurrence of the query words in `text` (case-insensitive). */
import { Fragment } from 'react';

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function Highlight({ text, query, className }: { readonly text: string; readonly query: string; readonly className?: string }) {
  const words = [...new Set(query.trim().split(/\s+/).filter((w) => w.length > 0))].sort((a, b) => b.length - a.length);
  if (!words.length) return <span className={className}>{text}</span>;
  const re = new RegExp(`(${words.map(escape).join('|')})`, 'gi');
  const parts = text.split(re);
  return (
    <span className={className}>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <mark key={index} className="rounded-[2px] bg-[var(--label-yellow-subtle)] px-px font-medium text-inherit">
            {part}
          </mark>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </span>
  );
}
