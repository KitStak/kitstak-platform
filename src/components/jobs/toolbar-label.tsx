/**
 * Button text for grid-toolbar actions. Below 1600px ListShell moves the bulk actions to their
 * own row, so the labels stay visible from 640px (critic R3: unlabeled icons at 768px); only
 * phones fall back to icon-only buttons, which keep their accessible name via aria-label.
 */
export function ToolbarLabel({ children, always = false }: { readonly children: string; readonly always?: boolean }) {
  return <span className={always ? undefined : "hidden min-[640px]:inline"}>{children}</span>;
}
