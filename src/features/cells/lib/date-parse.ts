/**
 * Natural-language date and time input for the date picker ("next fri", "in 3 days", "12/5",
 * "Dec 5 2026", "tomorrow"). Pure; returns local calendar dates.
 */
import { startOfDay } from './format';

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function addMonths(date: Date, months: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), lastDay));
}

function matchPrefix(word: string, list: readonly string[], min = 3): number {
  if (word.length < min) return -1;
  return list.findIndex((entry) => entry.startsWith(word));
}

function validDate(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null;
}

function parseKeyword(text: string, today: Date): Date | null {
  switch (text) {
    case 'today':
    case 'tod':
    case 'now':
      return today;
    case 'tomorrow':
    case 'tmr':
    case 'tom':
      return addDays(today, 1);
    case 'yesterday':
      return addDays(today, -1);
    case 'next week':
      return addDays(today, 7 - ((today.getDay() + 6) % 7)); // next Monday
    case 'next month':
      return new Date(today.getFullYear(), today.getMonth() + 1, 1);
    case 'end of month':
    case 'eom':
      return new Date(today.getFullYear(), today.getMonth() + 1, 0);
    case 'end of week':
    case 'eow':
      return addDays(today, (5 - today.getDay() + 7) % 7); // this Friday
    default:
      return null;
  }
}

function parseOffset(text: string, today: Date): Date | null {
  const match = /^(?:in\s+)?\+?(\d{1,3})\s*(d|day|days|w|wk|week|weeks|m|mo|month|months)(?:\s+from now)?$/.exec(text);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2] ?? 'd';
  if (unit.startsWith('w')) return addDays(today, amount * 7);
  if (unit.startsWith('m')) return addMonths(today, amount);
  return addDays(today, amount);
}

function parseWeekday(text: string, today: Date): Date | null {
  const match = /^(next\s+|this\s+)?([a-z]+)$/.exec(text);
  if (!match || match[2] === undefined) return null;
  const index = matchPrefix(match[2], WEEKDAYS);
  if (index < 0) return null;
  const delta = (index - today.getDay() + 7) % 7;
  // "fri" = the coming Friday (today if it is Friday); "next fri" never means today.
  return addDays(today, delta === 0 && match[1]?.startsWith('next') ? 7 : delta);
}

function parseNumeric(text: string, today: Date): Date | null {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const us = /^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?$/.exec(text);
  if (!us) return null;
  const yearText = us[3];
  let year = yearText ? Number(yearText) : today.getFullYear();
  if (yearText && yearText.length === 2) year += 2000;
  return validDate(year, Number(us[1]) - 1, Number(us[2]));
}

function parseMonthName(text: string, today: Date): Date | null {
  const tokens = text.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 3) return null;
  let month = -1;
  let day = Number.NaN;
  let year = today.getFullYear();
  for (const token of tokens) {
    const asMonth = matchPrefix(token, MONTHS);
    if (asMonth >= 0 && month < 0) month = asMonth;
    else if (/^\d{4}$/.test(token)) year = Number(token);
    else if (/^\d{1,2}(st|nd|rd|th)?$/.test(token)) day = Number.parseInt(token, 10);
    else return null;
  }
  if (month < 0 || Number.isNaN(day)) return null;
  return validDate(year, month, day);
}

/** Parse free text into a local date, or null when it isn't recognised. */
export function parseDateInput(input: string, now: Date): Date | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!text) return null;
  const today = startOfDay(now);
  return (
    parseKeyword(text, today) ??
    parseOffset(text, today) ??
    parseNumeric(text, today) ??
    parseMonthName(text, today) ??
    parseWeekday(text, today)
  );
}

/** "3pm", "3:30 pm", "15:30", "0930" → "HH:MM" (24h), or null. */
export function parseTimeInput(input: string): string | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, '');
  if (!text) return null;
  const match = /^(\d{1,2})(?::?(\d{2}))?(am|pm|a|p)?$/.exec(text);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3];
  if (minutes > 59) return null;
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem.startsWith('p') && hours !== 12) hours += 12;
    if (meridiem.startsWith('a') && hours === 12) hours = 0;
  }
  if (hours > 23) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
