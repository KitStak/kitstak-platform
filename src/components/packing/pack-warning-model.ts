/** Packing Warning gating on the pack screen (PURE, unit tested). */
export type PackWarningTrigger = "order_displayed" | "close_pack" | "product_scanned";

export interface PackWarningInfo {
  readonly id: string;
  readonly name: string;
  readonly text: string;
  readonly trigger: PackWarningTrigger;
  readonly triggerLabel: string;
  readonly skipConfirmation: boolean;
  readonly mediaLinks: readonly string[];
}

/** The warning is due at this trigger and the packer has not seen it for the open order yet. */
export function warningDue(w: PackWarningInfo | null | undefined, trigger: PackWarningTrigger, seen: ReadonlySet<string>): w is PackWarningInfo {
  return Boolean(w) && w?.trigger === trigger && !seen.has(`${w.id}:${trigger}`);
}

export const seenKey = (w: PackWarningInfo): string => `${w.id}:${w.trigger}`;

const IMAGE = /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i;
const VIDEO = /\.(mp4|webm|mov)(\?.*)?$/i;

/** How a media link is shown in the warning: inline image / video, or a link. */
export function mediaKind(url: string): "image" | "video" | "link" {
  if (IMAGE.test(url)) return "image";
  if (VIDEO.test(url)) return "video";
  return "link";
}
