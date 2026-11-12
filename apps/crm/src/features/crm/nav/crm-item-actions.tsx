'use client';
/**
 * CRM entry points for the item panel header: "Convert" on Leads boards, "360 view" and
 * "Log activity" on Contacts / Accounts / Deals boards. Renders nothing on other boards.
 */
import { useState } from 'react';
import Link from 'next/link';
import { NotebookPen, PanelTop, UserCheck } from 'lucide-react';
import { Button, IconButton, Tooltip, buttonVariants, cn } from '@/components/ui';
import { useOrg } from '@/features/shell/org-context';
import { ConvertLeadDialog } from '../convert/convert-lead-dialog';
import { LogActivityDialog } from '../records/log-activity-dialog';

export interface CrmItemActionsProps {
  readonly itemId: string;
  readonly itemName: string;
  readonly boardKind: string | undefined;
  readonly canEdit: boolean;
  /** Item is a subitem (CRM actions only apply to top-level records). */
  readonly isSubitem?: boolean;
}

export function CrmItemActions({ itemId, itemName, boardKind, canEdit, isSubitem }: CrmItemActionsProps) {
  const { org } = useOrg();
  const [converting, setConverting] = useState(false);
  const [logging, setLogging] = useState(false);
  if (isSubitem || !boardKind) return null;

  if (boardKind === 'leads') {
    if (!canEdit) return null;
    return (
      <>
        <Button size="sm" variant="secondary" leadingIcon={<UserCheck aria-hidden />} onClick={() => setConverting(true)} data-testid="crm-convert-lead">
          Convert
        </Button>
        <ConvertLeadDialog itemId={itemId} open={converting} onOpenChange={setConverting} />
      </>
    );
  }

  if (!['contacts', 'accounts', 'deals'].includes(boardKind)) return null;
  const has360 = boardKind === 'contacts' || boardKind === 'accounts';
  return (
    <span className="flex items-center gap-0.5">
      {has360 ? (
        <Tooltip content="Open 360 view">
          <Link
            href={`/${org.slug}/crm/${boardKind}/${itemId}`}
            aria-label="Open 360 view"
            data-testid="crm-open-360"
            className={cn(buttonVariants({ variant: 'ghost', size: 'md' }), 'w-8 px-0')}
          >
            <PanelTop aria-hidden />
          </Link>
        </Tooltip>
      ) : null}
      {canEdit ? (
        <>
          <IconButton label="Log activity" icon={<NotebookPen aria-hidden />} onClick={() => setLogging(true)} data-testid="crm-item-log-activity" />
          <LogActivityDialog open={logging} onOpenChange={setLogging} itemId={itemId} recordName={itemName} />
        </>
      ) : null}
    </span>
  );
}
