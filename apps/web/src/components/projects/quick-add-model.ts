/**
 * A small stand-in for KitStak Projects' quick add, for the illustration on /projects: it reads a
 * date word, `!priority`, `@person` and `#label` out of a task typed as one line. It is a demo of
 * the idea, not the app's parser.
 */
export const PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];

const DATE_WORDS: Readonly<Record<string, string>> = {
  today: 'Today',
  tomorrow: 'Tomorrow',
  mon: 'Monday',
  monday: 'Monday',
  tue: 'Tuesday',
  tuesday: 'Tuesday',
  wed: 'Wednesday',
  wednesday: 'Wednesday',
  thu: 'Thursday',
  thursday: 'Thursday',
  fri: 'Friday',
  friday: 'Friday',
};

export interface QuickTask {
  readonly title: string;
  readonly due: string | null;
  readonly priority: Priority | null;
  readonly assignee: string | null;
  readonly labels: readonly string[];
}

const MAX_INPUT = 140;

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Splits one typed line into a task title and the fields named in it. */
export function parseQuickAdd(input: string): QuickTask {
  const words = input.slice(0, MAX_INPUT).trim().split(/\s+/).filter(Boolean);
  const title: string[] = [];
  let due: string | null = null;
  let priority: Priority | null = null;
  let assignee: string | null = null;
  const labels: string[] = [];

  for (const word of words) {
    const lower = word.toLowerCase();
    const body = lower.slice(1).replace(/[^a-z0-9-]/g, '');
    if (word.startsWith('!') && PRIORITIES.includes(body as Priority)) {
      priority = body as Priority;
    } else if (word.startsWith('@') && body !== '') {
      assignee = capitalize(body);
    } else if (word.startsWith('#') && body !== '') {
      if (!labels.includes(body)) labels.push(body);
    } else if (due === null && DATE_WORDS[lower] !== undefined) {
      due = DATE_WORDS[lower]!;
    } else {
      title.push(word);
    }
  }

  return { title: title.join(' '), due, priority, assignee, labels };
}
