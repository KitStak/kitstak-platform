import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RichTextView } from './rich-text-view';

function render(doc: Parameters<typeof RichTextView>[0]['doc']): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(<RichTextView doc={doc} meId="u1" />);
  return host;
}

describe('RichTextView', () => {
  it('renders formatting, mentions, task lists and safe links only', () => {
    const host = render({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hi ' },
            { type: 'mention', attrs: { id: 'u1', label: 'Maya' } },
            { type: 'text', text: ' bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' safe', marks: [{ type: 'link', attrs: { href: 'https://kitstak.example' } }] },
            { type: 'text', text: ' evil', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
          ],
        },
        {
          type: 'taskList',
          content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Done thing' }] }] }],
        },
        { type: 'script', content: [{ type: 'text', text: 'nope' }] },
        { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'third' }] }] }] },
      ],
    });
    const mention = host.querySelector('.ks-mention');
    expect(mention?.textContent).toBe('@Maya');
    expect(mention?.getAttribute('data-me')).toBe('true');
    expect(host.querySelector('strong')?.textContent).toBe(' bold');
    const links = host.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe('https://kitstak.example');
    expect(links[0]?.getAttribute('rel')).toBe('noopener noreferrer nofollow');
    expect((host.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
    expect(host.querySelector('ol')?.getAttribute('start')).toBe('3');
    expect(host.textContent).not.toContain('nope');
    expect(host.querySelector('script')).toBeNull();
  });
});
