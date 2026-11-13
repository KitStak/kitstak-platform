/** dnd-kit modifier: keep dragged rows on the vertical axis (no @dnd-kit/modifiers dependency). */
import type { Modifier } from '@dnd-kit/core';

export const restrictToVerticalAxisModifier: Modifier = ({ transform }) => ({ ...transform, x: 0 });
