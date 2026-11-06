import { withApi } from '@/server/api';
import { listBoardTemplates } from '@/server/services/boards';

export const GET = withApi({ permission: 'board:read' }, () => listBoardTemplates());
