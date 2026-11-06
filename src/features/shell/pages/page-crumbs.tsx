'use client';
import { Breadcrumbs, type BreadcrumbItem } from '@/components/ui';
import { useOrg } from '../org-context';
import { routes } from '../routes';

/** "Home › <page>" trail for top-level shell destinations (or a custom trail). */
export function PageCrumbs({ title, items }: { readonly title: string; readonly items?: readonly BreadcrumbItem[] }) {
  const { org } = useOrg();
  return <Breadcrumbs items={items ?? [{ label: 'Home', href: routes.home(org.slug) }, { label: title }]} />;
}
