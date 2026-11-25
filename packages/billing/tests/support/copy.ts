/**
 * The copy rules as code (docs/billing/SPEC.md section 0): plain words, short sentences, no em dash,
 * no en dash, no double dash, no "coming soon", no lorem ipsum. Used by the copy rules tests and by
 * the email render test.
 */

/** Built from char codes so this file passes its own check. */
export const EM_DASH = String.fromCharCode(0x2014);
export const EN_DASH = String.fromCharCode(0x2013);
export const DOUBLE_DASH = '-'.repeat(2);
export const MAX_SENTENCE_WORDS = 20;

export interface CopyProblem {
  readonly rule: 'em dash' | 'en dash' | 'double dash' | 'coming soon' | 'lorem' | 'long sentence';
  readonly text: string;
}

/** Splits on a full stop, question mark or exclamation mark that ends a sentence. "$395.20" stays whole. */
export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.?!])\s+|\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function wordCount(sentence: string): number {
  return sentence.split(/\s+/).filter((word) => /[A-Za-z0-9$]/.test(word)).length;
}

/** The dash and placeholder rules. They hold for every string a person can see. */
export function forbiddenIn(text: string): CopyProblem[] {
  const problems: CopyProblem[] = [];
  if (text.includes(EM_DASH)) problems.push({ rule: 'em dash', text });
  if (text.includes(EN_DASH)) problems.push({ rule: 'en dash', text });
  if (text.includes(DOUBLE_DASH)) problems.push({ rule: 'double dash', text });
  if (/coming soon/i.test(text)) problems.push({ rule: 'coming soon', text });
  if (/\blorem\b/i.test(text)) problems.push({ rule: 'lorem', text });
  return problems;
}

/** The dash rules plus the 20 word limit per sentence. For full sentences of UI copy. */
export function copyProblems(text: string): CopyProblem[] {
  const problems = forbiddenIn(text);
  for (const sentence of sentencesOf(text)) {
    if (wordCount(sentence) > MAX_SENTENCE_WORDS) problems.push({ rule: 'long sentence', text: sentence });
  }
  return problems;
}
