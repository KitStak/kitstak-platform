import { describe, expect, it } from 'vitest';
import { sanitizeRichText } from './sanitize';

describe('sanitizeRichText', () => {
  it('keeps formatting, lists and mentions', () => {
    const html = '<p><strong>Ship</strong> <em>it</em></p><ul><li>one</li></ul><span data-type="mention" data-id="u1" data-label="Maya">@Maya</span>';
    expect(sanitizeRichText(html)).toBe(html);
  });

  it('strips scripts, event handlers and unknown tags', () => {
    const out = sanitizeRichText('<p onclick="x()">hi</p><script>alert(1)</script><iframe src="x"></iframe><img src=x onerror=alert(1)>');
    expect(out).toBe('<p>hi</p>');
  });

  it('drops unsafe link targets and forces safe rel/target', () => {
    expect(sanitizeRichText('<a href="javascript:alert(1)">x</a>')).toBe('<a target="_blank" rel="noopener noreferrer nofollow">x</a>');
    expect(sanitizeRichText('<a href="https://kitstak.app">x</a>')).toBe(
      '<a href="https://kitstak.app" target="_blank" rel="noopener noreferrer nofollow">x</a>',
    );
  });

  it('keeps task-list checkboxes but no other inputs', () => {
    expect(sanitizeRichText('<label><input type="checkbox" checked></label>')).toContain('type="checkbox"');
    expect(sanitizeRichText('<p>a</p><input type="text" value="x">')).toBe('<p>a</p>');
  });

  it('returns null for empty documents', () => {
    expect(sanitizeRichText('<p></p>')).toBeNull();
    expect(sanitizeRichText(null)).toBeNull();
  });
});
