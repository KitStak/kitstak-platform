/**
 * The stale tab rule for billing actions (review round 2, docs/billing/CONTRACTS.md section 25).
 *
 * A billing page is made for one organization. A person in two organizations can switch in another
 * tab and then press a button in the first one. The action runs for the session's active
 * organization, which is no longer the one on the screen. So every billing page sends back the id
 * of the organization it was made for, and the server compares it with the active one.
 *
 * The id from the browser is only ever compared. It never picks the organization an action runs
 * for: that is always the session's active organization (SPEC 12.3).
 */
/**
 * The organization a page was made for, sent back with every action from that page. `null` or
 * anything that is not the active organization's id means the page is stale.
 */
export type RenderedOrgId = string | null | undefined;

export function sameOrganization(renderedOrgId: unknown, activeOrgId: string): boolean {
  return typeof renderedOrgId === 'string' && renderedOrgId.length > 0 && renderedOrgId === activeOrgId;
}
