import { withApi } from '@/server/api';
import { buildTemplateGallery } from '@/server/services/wizards-gallery';

/** Template center gallery: every board template and solution with preview data. */
export const GET = withApi({ permission: 'board:read' }, () => buildTemplateGallery());
