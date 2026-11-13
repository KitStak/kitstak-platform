import type { Metadata } from 'next';
import { ProjectActivity } from '@/features/projects';

export const metadata: Metadata = { title: 'Activity' };

export default function Page() {
  return <ProjectActivity />;
}
