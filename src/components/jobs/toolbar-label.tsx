/**
 * Button text for grid-toolbar actions. The shared toolbar row shrinks its search/filter side
 * instead of wrapping, so on narrower screens the action buttons collapse to icon-only (the
 * button keeps its accessible name via aria-label) and the labels return from 1440px up.
 */
export function ToolbarLabel({ children, always = false }: { readonly children: string; readonly always?: boolean }) {
  return <span className={always ? undefined : "hidden min-[1440px]:inline"}>{children}</span>;
}
