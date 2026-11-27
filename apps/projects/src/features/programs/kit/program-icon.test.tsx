import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProgramIcon } from './chips';

describe('ProgramIcon', () => {
  it('draws the glyph in KitStak red with no tile behind it', () => {
    const html = renderToStaticMarkup(<ProgramIcon icon={null} color="orange" size={32} />);
    expect(html).toContain('color:var(--primary)');
    expect(html).not.toContain('background');
    expect(html).not.toContain('rounded');
    expect(html).not.toContain('--label-orange');
  });

  it('is the same red mark whatever the program color', () => {
    const orange = renderToStaticMarkup(<ProgramIcon color="orange" />);
    const blue = renderToStaticMarkup(<ProgramIcon color="blue" />);
    expect(orange).toBe(blue);
  });

  it('keeps its size box so rows stay aligned', () => {
    expect(renderToStaticMarkup(<ProgramIcon size={18} />)).toContain('width:18px;height:18px');
  });
});
