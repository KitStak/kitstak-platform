import { apiRoute } from '@/server/http/api';
import { listTaskAttachments } from '@/server/domain';

export const GET = apiRoute<{ id: string }>(async ({ ctx, params }) => listTaskAttachments(ctx, params.id));
