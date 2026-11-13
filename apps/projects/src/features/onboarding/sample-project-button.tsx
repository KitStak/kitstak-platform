'use client';
/**
 * "Create sample project": makes a practice project from the Product launch template (with a few
 * tasks assigned to you) and opens its board. Used by teaching empty states everywhere.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { Button, toast, type ButtonProps } from '@/components/ui';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import { createSampleProjectAction } from '@/server/actions/onboarding';
import { useShell } from '@/features/shell/shell-context';

export function SampleProjectButton({
  children = 'Create sample project',
  variant = 'secondary',
  size,
  className,
  onCreated,
  openTab = 'board',
}: {
  readonly children?: React.ReactNode;
  readonly variant?: ButtonProps['variant'];
  readonly size?: ButtonProps['size'];
  readonly className?: string;
  /** Called instead of navigating to the new project. */
  readonly onCreated?: (project: { id: string; key: string; name: string }) => void;
  readonly openTab?: 'board' | 'overview' | 'list';
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can } = useShell();
  const [pending, setPending] = useState(false);
  if (!can('project:create')) return null;
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      leadingIcon={<Sparkles aria-hidden />}
      loading={pending}
      data-testid="create-sample-project"
      onClick={async () => {
        setPending(true);
        const result = await createSampleProjectAction({});
        setPending(false);
        if (!result.ok) {
          toast.error("Couldn't create the sample project", result.error.message);
          return;
        }
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: qk.projects() }),
          queryClient.invalidateQueries({ queryKey: ['my-tasks'] }),
          queryClient.invalidateQueries({ queryKey: qk.spaces() }),
        ]);
        toast.success(
          'Sample project ready',
          'Look around, drag some cards, and delete it whenever you like.',
        );
        if (onCreated) onCreated(result.data);
        else
          router.push(
            openTab === 'overview'
              ? routes.project(result.data.key)
              : routes.projectTab(result.data.key, openTab),
          );
      }}
    >
      {children}
    </Button>
  );
}
