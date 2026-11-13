import type { Metadata } from 'next';
import { ProjectFiles } from '@/features/projects';

export const metadata: Metadata = { title: 'Files' };

export default function Page() {
  return <ProjectFiles />;
}
