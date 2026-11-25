import { listForms, listProjects } from '@/server/domain';
import { listPrograms, listVariants } from '@/server/domain/programs';
import { pageContext } from '@/server/page';
import type { FormProgram } from './build-form';
import { FormsView } from './forms-view';

export async function FormsPage() {
  const { ctx } = await pageContext('/forms');
  const [forms, projects, programList] = await Promise.all([listForms(ctx), listProjects(ctx), listPrograms(ctx).catch(() => [])]);
  // Programs can hold build forms (docs/programs/SPEC.md 5.17).
  const live = programList.filter((program) => program.status === 'active' || program.status === 'on_hold' || program.status === 'planning');
  const variantLists = await Promise.all(live.map((program) => listVariants(ctx, program.key).catch(() => [])));
  const programs: FormProgram[] = live.map((program, index) => ({
    id: program.id,
    key: program.key,
    name: program.name,
    color: program.color,
    icon: program.icon,
    unit: program.unit,
    variants: (variantLists[index] ?? []).map((variant) => ({ id: variant.id, name: variant.name, sku: variant.sku })),
  }));
  return <FormsView forms={forms} projects={projects} programs={programs} />;
}
