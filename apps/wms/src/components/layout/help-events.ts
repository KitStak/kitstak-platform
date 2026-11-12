/** Window event that opens the Help panel (optionally on one article) from anywhere in the shell. */
export const HELP_EVENT = 'kitstak:open-help';

export interface HelpEventDetail {
  readonly articleId?: string;
}

export function openHelpArticle(articleId?: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<HelpEventDetail>(HELP_EVENT, { detail: { articleId } }));
}
