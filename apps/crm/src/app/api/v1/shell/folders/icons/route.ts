import { withApi } from '@/server/api';
import { listFolderIcons } from '@/server/services/shell-folders';
import { svc } from '../../../_lib/route-helpers';

/** Folder id -> custom icon for the org. */
export const GET = withApi({ permission: 'workspace:read' }, (ctx) => listFolderIcons(svc(ctx)));
