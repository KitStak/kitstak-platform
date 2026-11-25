import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * The two inline marks the article copy uses: `[text](/path)` and `**bold**`. Anything else is
 * plain text. A link to another site opens normally, with no referrer.
 */
export function InlineText({ text }: { readonly text: string }) {
  const parts: ReactNode[] = [];
  const pattern = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const [, label, href, bold] = match;
    if (bold !== undefined) {
      parts.push(<strong key={match.index}>{bold}</strong>);
    } else if (label !== undefined && href !== undefined) {
      parts.push(
        href.startsWith('/') ? (
          <Link key={match.index} href={href}>
            {label}
          </Link>
        ) : (
          <a key={match.index} href={href} rel="noreferrer">
            {label}
          </a>
        ),
      );
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
