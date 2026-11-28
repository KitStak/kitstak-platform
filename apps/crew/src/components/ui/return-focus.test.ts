// @vitest-environment jsdom
/**
 * Where keyboard focus goes when a dialog closes (`returnFocusTarget` in dialog.tsx). Round four
 * found focus on the page body after Settings "Add a client", the delete day question, "Set the
 * price" and "Save the day". Each case below is one way the control that opened a dialog can be
 * found again, or replaced by something close to it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rememberOpener, returnFocusTarget } from './dialog';

beforeEach(() => {
  // jsdom draws nothing, so every element would look hidden. Here every element is on screen.
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
  document.body.innerHTML = '<main id="main-content" tabindex="-1"></main>';
});
afterEach(() => {
  document.body.innerHTML = '';
});

const main = () => document.getElementById('main-content') as HTMLElement;

describe('returnFocusTarget', () => {
  it('goes back to the control that opened the dialog', () => {
    main().innerHTML = '<div><button data-testid="client-add">Add a client</button></div>';
    const opener = rememberOpener(document.querySelector('button'));
    expect(returnFocusTarget(opener)?.textContent).toBe('Add a client');
  });

  it('finds the same control drawn again after the list refreshed', () => {
    main().innerHTML = '<ul><li><button data-testid="work-delete-2026-11-12">Delete</button></li></ul>';
    const opener = rememberOpener(document.querySelector('button'));
    main().innerHTML = '<ul><li><button data-testid="work-delete-2026-11-12">Delete again</button></li></ul>';
    expect(returnFocusTarget(opener)?.textContent).toBe('Delete again');
  });

  it('goes to the menu button when the dialog opened from a menu row', () => {
    main().innerHTML = '<button id="more">More</button><div role="menu" aria-labelledby="more"><div role="menuitem" tabindex="-1">Edit</div></div>';
    const opener = rememberOpener(document.querySelector('[role="menuitem"]'));
    document.querySelector('[role="menu"]')?.remove();
    expect(returnFocusTarget(opener)?.id).toBe('more');
  });

  it('goes to the next control in the same list when the row it sat on was deleted', () => {
    main().innerHTML = '<ul id="days"><li id="a"><button>Delete day A</button></li><li id="b"><button>Edit day B</button></li></ul>';
    const opener = rememberOpener(document.querySelector('#a button'));
    document.getElementById('a')?.remove();
    expect(returnFocusTarget(opener)?.textContent).toBe('Edit day B');
  });

  it('prefers the same kind of control on the next row over the first control there', () => {
    main().innerHTML = '<table><tbody id="days"><tr id="a"><td><span tabindex="0">Mike</span><button data-testid="work-delete-2026-11-12">Delete</button></td></tr><tr><td><span tabindex="0">Mike</span><button data-testid="work-edit-2026-11-11">Edit</button><button data-testid="work-delete-2026-11-11">Delete next</button></td></tr></tbody></table>';
    const opener = rememberOpener(document.querySelector('[data-testid="work-delete-2026-11-12"]'));
    document.getElementById('a')?.remove();
    expect(returnFocusTarget(opener)?.textContent).toBe('Delete next');
  });

  it('skips a control that is turned off', () => {
    main().innerHTML = '<div><button id="go" disabled>Save</button><button>Cancel</button></div>';
    const opener = rememberOpener(document.getElementById('go'));
    expect(returnFocusTarget(opener)?.textContent).toBe('Cancel');
  });

  it('lands on the page content when nothing near it is left', () => {
    main().innerHTML = '<section id="s"><button>Set the price</button></section>';
    const opener = rememberOpener(document.querySelector('button'));
    document.getElementById('s')?.remove();
    expect(returnFocusTarget(opener)).toBe(main());
  });

  it('remembers nothing when focus was on the page itself', () => {
    expect(rememberOpener(document.body)).toBeNull();
    expect(returnFocusTarget(null)).toBeNull();
  });
});
