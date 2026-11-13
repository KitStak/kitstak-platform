import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from '@/server/db';
import { integrationLinks } from '@/server/db/schema';
import { listProjects, listSpaces } from '@/server/domain';
import { getCustomers } from '@/server/integrations/customers';
import { pageContext } from '@/server/page';
import { PROJECT_HEALTHS, type ProjectHealth } from '@/lib/constants';
import { ProjectsDirectory, type CustomerFilter } from './projects-directory';

export async function ProjectsPage({ space, customer, health }: { readonly space?: string; readonly customer?: string; readonly health?: string }) {
  const { ctx } = await pageContext('/projects');
  const [projects, spaces] = await Promise.all([listProjects(ctx), listSpaces(ctx)]);
  let customerFilter: CustomerFilter | undefined;
  if (customer && /^[0-9a-f-]{36}$/i.test(customer)) {
    const [found, links] = await Promise.all([
      getCustomers(ctx, [customer]),
      db
        .select({ projectId: integrationLinks.projectId })
        .from(integrationLinks)
        .where(and(eq(integrationLinks.orgId, ctx.orgId), eq(integrationLinks.targetType, 'core_customer'), eq(integrationLinks.targetId, customer), isNotNull(integrationLinks.projectId))),
    ]);
    const projectIds = new Set(links.map((link) => link.projectId).filter((id): id is string => Boolean(id)));
    for (const project of projects) if (project.crmCustomerId === customer) projectIds.add(project.id);
    customerFilter = { id: customer, name: found.get(customer)?.name ?? 'This customer', projectIds: [...projectIds] };
  }
  const healthFilter = (PROJECT_HEALTHS as readonly string[]).includes(health ?? '') ? (health as ProjectHealth) : undefined;
  return <ProjectsDirectory initialProjects={projects} initialSpaces={spaces} spaceFilter={space} customerFilter={customerFilter} healthFilter={healthFilter} />;
}
