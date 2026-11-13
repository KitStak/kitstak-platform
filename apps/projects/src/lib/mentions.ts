/**
 * Comment mention markup: `@[Maya Lopez](user:5f0c…)`. The editor inserts this token; the server
 * extracts ids to notify; renderers split the body into text + mention segments.
 */
const MENTION = /@\[([^\]\n]{1,80})\]\(user:([0-9a-f-]{36})\)/gi;

export function mentionToken(name: string, userId: string): string {
  return `@[${name.replace(/[[\]\n]/g, '')}](user:${userId})`;
}

/** Unique mentioned user ids, in order of appearance. */
export function extractMentions(body: string): string[] {
  const ids: string[] = [];
  for (const match of body.matchAll(MENTION)) {
    const id = match[2].toLowerCase();
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

export type MentionSegment =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'mention'; readonly name: string; readonly userId: string };

export function splitMentions(body: string): MentionSegment[] {
  const out: MentionSegment[] = [];
  let last = 0;
  for (const match of body.matchAll(MENTION)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ type: 'text', text: body.slice(last, index) });
    out.push({ type: 'mention', name: match[1], userId: match[2].toLowerCase() });
    last = index + match[0].length;
  }
  if (last < body.length) out.push({ type: 'text', text: body.slice(last) });
  return out;
}

/** Body with mention tokens replaced by "@Name" (notifications, previews). */
export function plainMentions(body: string): string {
  return body.replace(MENTION, (_all, name: string) => `@${name}`);
}
