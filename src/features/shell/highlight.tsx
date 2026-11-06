import { highlightParts } from '@/server/services/shell-search-model';

/** Marks every occurrence of the query's words inside `text` (case-insensitive). */
export function HighlightText({ text, query }: { readonly text: string; readonly query: string }) {
  if (!query.trim()) return <>{text}</>;
  return (
    <>
      {highlightParts(text, query).map((part, index) =>
        part.match ? (
          <mark
            key={index}
            className="rounded-xs bg-[var(--mark-bg)] font-semibold text-[var(--mark-fg)] shadow-[0_0_0_1px_var(--mark-bg)]"
          >
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}
