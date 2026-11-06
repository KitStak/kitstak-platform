/** Curated emoji sets (native Unicode, no image assets). */

export const QUICK_REACTIONS = ['👍', '🎉', '❤️', '😄', '👀', '🚀', '✅', '🙏'] as const;

export interface EmojiGroup {
  readonly label: string;
  readonly emojis: readonly { readonly char: string; readonly name: string }[];
}

export const EMOJI_GROUPS: readonly EmojiGroup[] = [
  {
    label: 'Reactions',
    emojis: [
      { char: '👍', name: 'thumbs up' },
      { char: '👎', name: 'thumbs down' },
      { char: '👏', name: 'clap' },
      { char: '🙌', name: 'raised hands' },
      { char: '🙏', name: 'thanks' },
      { char: '💪', name: 'strong' },
      { char: '👀', name: 'eyes looking' },
      { char: '🤝', name: 'handshake deal' },
    ],
  },
  {
    label: 'Smileys',
    emojis: [
      { char: '😄', name: 'smile happy' },
      { char: '😂', name: 'laugh joy' },
      { char: '🙂', name: 'slight smile' },
      { char: '😉', name: 'wink' },
      { char: '😍', name: 'love eyes' },
      { char: '🤔', name: 'thinking' },
      { char: '😅', name: 'sweat smile' },
      { char: '😮', name: 'surprised wow' },
      { char: '😢', name: 'sad cry' },
      { char: '😬', name: 'grimace' },
    ],
  },
  {
    label: 'Work',
    emojis: [
      { char: '✅', name: 'check done' },
      { char: '❌', name: 'cross no' },
      { char: '⚠️', name: 'warning' },
      { char: '📌', name: 'pin' },
      { char: '📎', name: 'paperclip attach' },
      { char: '📅', name: 'calendar date' },
      { char: '📈', name: 'chart up growth' },
      { char: '📉', name: 'chart down' },
      { char: '💰', name: 'money bag' },
      { char: '💡', name: 'idea bulb' },
      { char: '🔥', name: 'fire hot' },
      { char: '⏰', name: 'alarm clock time' },
    ],
  },
  {
    label: 'Celebrate',
    emojis: [
      { char: '🎉', name: 'party tada' },
      { char: '🚀', name: 'rocket launch' },
      { char: '🏆', name: 'trophy win' },
      { char: '⭐', name: 'star' },
      { char: '❤️', name: 'heart love' },
      { char: '💯', name: 'hundred' },
      { char: '🥳', name: 'party face' },
      { char: '🍾', name: 'champagne' },
    ],
  },
];

export function searchEmojis(query: string): { char: string; name: string }[] {
  const q = query.trim().toLowerCase();
  const all = EMOJI_GROUPS.flatMap((group) => group.emojis);
  return q ? all.filter((emoji) => emoji.name.includes(q)) : all;
}
