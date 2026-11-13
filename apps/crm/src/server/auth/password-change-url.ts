/** Portal change-password URL that returns to `orgSlug`'s CRM home afterwards. */
export function portalChangePasswordUrl(portalUrl: string, crmUrl: string, orgSlug: string): string {
  const target = new URL('/change-password', portalUrl);
  target.searchParams.set('next', new URL(`/${encodeURIComponent(orgSlug)}`, crmUrl).toString());
  return target.toString();
}
