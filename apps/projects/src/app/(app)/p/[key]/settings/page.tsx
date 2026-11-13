import type { Metadata } from 'next';
import { ProjectSettings } from '@/features/projects';

export const metadata: Metadata = { title: 'Settings' };

export default function Page() {
  return <ProjectSettings />;
}
