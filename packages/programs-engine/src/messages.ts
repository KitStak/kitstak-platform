/**
 * One message table for qty, scrap and rate problems (SPEC Appendix B.2.3). Imports, the variant
 * generator's paste, the planner and the price card editor all build their words here, so the
 * same problem reads the same everywhere. Plain words, no dashes.
 */

/** The kind of value a cell holds. `build_rate` is a rate typed on one build. */
export type ValueField = 'qty' | 'scrap' | 'rate' | 'build_rate';

/**
 * What can be wrong with a typed value: not a number, a price typed where a count belongs, below
 * 0, too many decimals, or more than the database holds.
 */
export type ValueProblem = 'not_a_number' | 'price' | 'negative' | 'decimals' | 'too_large';

/** The most a qty or scrap can be, as people read it. */
export const MAX_QTY_TEXT = '99,999,999';
/** The most a rate can be, as people read it. */
export const MAX_RATE_TEXT = '$999,999.9999';

/** " (Nov 30)" for a message about one cell of a grid, or "" when no place is given. */
export function placeNote(where?: string): string {
  const text = where?.trim() ?? '';
  return text === '' ? '' : ` (${text})`;
}

const NOUN: Readonly<Record<ValueField, string>> = { qty: 'qty', scrap: 'scrap', rate: 'rate', build_rate: 'build rate' };

/**
 * The words for one value problem. `where` names the cell of a grid ("Nov 30"); `cell` is the text
 * as typed, for the messages that quote it.
 *
 * - qty and scrap: "The qty 5. is not a number (Nov 30).", "The qty $10 looks like a price. Type
 *   only how many units.", "The qty cannot be less than 0.", "Use up to 3 decimals." (scrap: "Use
 *   up to 3 decimals for scrap."), "The qty is too large. Use up to 99,999,999."
 * - rate and build rate: "The rate abc is not a number.", "A rate cannot be less than $0.", "Use
 *   up to 4 decimals for a rate.", "The rate is too large. Use up to $999,999.9999." A rate has no
 *   "looks like a price" problem, so `price` reads as not a number.
 */
export function valueMessage(field: ValueField, problem: ValueProblem, where?: string, cell = ''): string {
  const at = placeNote(where);
  const text = cell.trim();
  const noun = NOUN[field];
  const quoted = text === '' ? '' : ` ${text}`;
  if (field === 'qty' || field === 'scrap') {
    switch (problem) {
      case 'not_a_number':
        return `The ${noun}${quoted} is not a number${at}.`;
      case 'price':
        return `The ${noun}${quoted} looks like a price${at}. Type only how many units.`;
      case 'negative':
        return `The ${noun} cannot be less than 0${at}.`;
      case 'decimals':
        return field === 'qty' ? `Use up to 3 decimals${at}.` : `Use up to 3 decimals for scrap${at}.`;
      case 'too_large':
        return `The ${noun} is too large${at}. Use up to ${MAX_QTY_TEXT}.`;
    }
  }
  switch (problem) {
    case 'not_a_number':
    case 'price':
      return `The ${noun}${quoted} is not a number${at}.`;
    case 'negative':
      return `A ${noun} cannot be less than $0${at}.`;
    case 'decimals':
      return `Use up to 4 decimals for a ${noun}${at}.`;
    case 'too_large':
      // One limit for every rate column (CHECK `< 1000000`), so a build rate reads the same.
      return `The rate is too large${at}. Use up to ${MAX_RATE_TEXT}.`;
  }
}
