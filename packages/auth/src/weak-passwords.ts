/**
 * Passwords that are easy to guess, whatever their length (billing review round 3). PURE and safe
 * for the browser: the signup form runs the same check the server runs, so a person is told before
 * they press the button.
 *
 * The length rule says "15 or more characters is enough by itself". That is true for a few words
 * that do not go together, and false for `passwordpassword`, `aaaaaaaaaaaaaaaa`, `123456789012345`
 * and `qwertyuiopasdfgh`. A guessing program tries those first. So every new password, short or
 * long, is also refused when it is:
 *
 *  1. almost one character: fewer than 5 different characters,
 *  2. one short piece said again and again (`abcabcabcabcabc`, `passwordpassword`),
 *  3. mostly straight runs on the keyboard or in the alphabet (`1234`, `qwerty`, `abcdef`, `9876`),
 *  4. one of the most common passwords, or one or two of them dressed up with digits, symbols,
 *     capitals or look alike characters (`Password123!`, `P@ssw0rd2024`, `iloveyou1234567`),
 *  5. built around the name of the product or of the person's own company.
 *
 * `correct horse battery staple` passes: four words that do not go together.
 */
import { COMMON_PASSWORDS } from './common-passwords';

/** The one kind line a person reads. The same words on every screen and from every endpoint. */
export const EASY_TO_GUESS_MESSAGE = 'That one is too easy to guess. Try a few words that do not go together.';

export type WeakPasswordReason = 'few_characters' | 'repeated' | 'straight_run' | 'common' | 'company_name';

export interface WeakPasswordContext {
  /** Names the password must not be built around, such as the person's company. See `nameWords`. */
  readonly names?: readonly (string | null | undefined)[];
}

/** The product name is never a good base for a password to the product. */
const PRODUCT_NAMES = ['kitstak'] as const;

const MIN_DIFFERENT_CHARACTERS = 5;
const MIN_RUN = 4;
/** Rows a finger can slide along, and the two orders people count in. */
const RUN_ROWS = ['abcdefghijklmnopqrstuvwxyz', '01234567890', '1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1qaz2wsx3edc4rfv5tgb6yhn7ujm8ik9ol0p', 'qazwsxedcrfvtgbyhnujmikolp'];

const LOOK_ALIKE: Readonly<Record<string, string>> = { '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', $: 's', '!': 'i', '|': 'l', '+': 't' };

function differentCharacters(value: string): number {
  return new Set(value).size;
}

/** True when the whole value is one piece of at most half its length, said again and again. */
function isRepeatedPiece(value: string): boolean {
  const length = value.length;
  for (let period = 1; period <= Math.floor(length / 2); period += 1) {
    let same = true;
    for (let index = period; index < length; index += 1) {
      if (value[index] !== value[index - period]) {
        same = false;
        break;
      }
    }
    if (same) return true;
  }
  return false;
}

const RUN_LINES: readonly string[] = RUN_ROWS.flatMap((row) => [row, [...row].reverse().join('')]);

/**
 * How many characters sit inside a straight run of 4 or more: a slide along a keyboard row or
 * through the alphabet or the digits, forward or backward, or one character held down.
 */
function charactersInRuns(value: string): number {
  const covered = new Array<boolean>(value.length).fill(false);
  const mark = (from: number, length: number) => {
    if (length < MIN_RUN) return;
    for (let index = from; index < from + length; index += 1) covered[index] = true;
  };
  for (let start = 0; start < value.length; start += 1) {
    let held = 1;
    while (start + held < value.length && value[start + held] === value[start]) held += 1;
    mark(start, held);
    for (const line of RUN_LINES) {
      for (let at = line.indexOf(value[start]!); at !== -1; at = line.indexOf(value[start]!, at + 1)) {
        let length = 1;
        while (start + length < value.length && at + length < line.length && line[at + length] === value[start + length]) length += 1;
        mark(start, length);
      }
    }
  }
  return covered.filter(Boolean).length;
}

/** `p@ssw0rd` read as letters. A 1 can stand for an l or for an i, so the caller may ask for either. */
function unLookAlike(value: string, one: 'l' | 'i' = 'l'): string {
  let out = '';
  for (const char of value) out += char === '1' ? one : (LOOK_ALIKE[char] ?? char);
  return out;
}

/** True when the letters are one or two common passwords glued together, with nothing else of weight. */
function isCommonWords(letters: string): boolean {
  if (letters.length === 0) return false;
  if (COMMON_PASSWORDS.has(letters)) return true;
  for (let cut = 3; cut <= letters.length - 3; cut += 1) {
    if (COMMON_PASSWORDS.has(letters.slice(0, cut)) && COMMON_PASSWORDS.has(letters.slice(cut))) return true;
  }
  // A common password with a little around it (`Good-Password-12`, `mypassword`): once the common
  // word is taken out, fewer than 6 other letters are left to do the work.
  for (let size = Math.min(letters.length, 11); size >= 6; size -= 1) {
    if (letters.length - size >= 6) continue;
    for (let at = 0; at + size <= letters.length; at += 1) {
      if (COMMON_PASSWORDS.has(letters.slice(at, at + size))) return true;
    }
  }
  return false;
}

function isCommon(lowered: string): boolean {
  if (COMMON_PASSWORDS.has(lowered)) return true;
  const compact = lowered.replace(/[^a-z0-9]/g, '');
  if (compact.length > 0 && COMMON_PASSWORDS.has(compact)) return true;
  // The letters alone (`Password123!`), then the letters with look alike characters read as letters
  // (`P@ssw0rd2024`, where the trailing year is still digits).
  const letters = lowered.replace(/[^a-z]/g, '');
  if (letters.length >= 3 && isCommonWords(letters)) return true;
  const core = lowered.replace(/^[^a-z@$]+/, '').replace(/[^a-z]+$/, '');
  for (const one of ['l', 'i'] as const) {
    const read = unLookAlike(core, one).replace(/[^a-z]/g, '');
    if (read.length >= 3 && read !== letters && isCommonWords(read)) return true;
  }
  // Digits only, or digits with a short tail: common numbers and dates dressed up.
  const digits = lowered.replace(/[^0-9]/g, '');
  if (letters.length === 0 && digits.length > 0 && COMMON_PASSWORDS.has(digits)) return true;
  return false;
}

/**
 * The words of a name a password must not be built around: the whole name run together, and its
 * first word, which is nearly always the one that makes it this company ("Whitlock" in "Whitlock
 * Supply Co"). Later words are everyday words ("Supply", "Partners") and stay free to use.
 */
function nameWords(names: readonly (string | null | undefined)[]): string[] {
  const words: string[] = [];
  for (const name of names) {
    if (typeof name !== 'string') continue;
    const lowered = name.toLowerCase();
    const compact = lowered.replace(/[^a-z0-9]/g, '');
    if (compact.length >= 4) words.push(compact);
    const first = lowered.split(/[^a-z0-9]+/).find((part) => part.length > 0);
    if (first && first.length >= 4) words.push(first);
  }
  return words;
}

/** Why a password is easy to guess, or null when it is not. */
export function weakPasswordReason(password: string, context: WeakPasswordContext = {}): WeakPasswordReason | null {
  if (password.length === 0) return null;
  const lowered = password.normalize('NFKC').toLowerCase();
  if (differentCharacters(lowered) < MIN_DIFFERENT_CHARACTERS) return 'few_characters';
  if (isRepeatedPiece(lowered)) return 'repeated';
  const solid = lowered.replace(/[^a-z0-9]/g, '');
  if (solid.length >= MIN_RUN && charactersInRuns(solid) * 2 > solid.length) return 'straight_run';
  if (isCommon(lowered)) return 'common';
  const readings = [lowered, unLookAlike(lowered, 'l'), unLookAlike(lowered, 'i')].map((text) => text.replace(/[^a-z0-9]/g, ''));
  for (const word of [...PRODUCT_NAMES, ...nameWords(context.names ?? [])]) {
    if (readings.some((text) => text.includes(word))) return 'company_name';
  }
  return null;
}

/** True when a guessing program would try this password early. See the list at the top of this file. */
export function isEasyToGuess(password: string, context: WeakPasswordContext = {}): boolean {
  return weakPasswordReason(password, context) !== null;
}
