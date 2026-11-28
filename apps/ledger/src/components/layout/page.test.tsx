/**
 * One page frame: the title sits in the same place on every route, whatever the body width.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import { Page } from './page';

function headerClass(html: string): string {
  const match = /<header class="([^"]*)"/.exec(html);
  return match?.[1] ?? '';
}

describe('Page frame', () => {
  const widths = ['default', 'narrow', 'full'] as const;
  const html = Object.fromEntries(widths.map((width) => [width, renderToStaticMarkup(<Page title="Title" width={width}>body</Page>)]));

  it('puts the header in the same frame for every width, so the title never jumps sideways', () => {
    expect(headerClass(html.default!)).toBe(headerClass(html.full!));
    expect(headerClass(html.narrow!)).toBe(headerClass(html.full!));
  });

  it('a narrow page keeps its body under the title instead of centering it', () => {
    expect(html.narrow).toContain('max-w-[880px]');
    expect(html.narrow).not.toMatch(/mx-auto w-full max-w-\[880px\]/);
  });
});
