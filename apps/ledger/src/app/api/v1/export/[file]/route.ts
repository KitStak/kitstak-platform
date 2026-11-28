import { apiCsvRoute } from '@/server/http/api';
import { exportSetupStream } from '@/server/domain/setup-csv';
import { SETUP_STREAMS, STREAMS } from '@/server/csv/streams';
import { DomainError } from '@/server/errors';

/** `GET /api/v1/export/<stream>.csv` for the setup streams (SPEC 7.1): the same columns the import reads. */
export const GET = apiCsvRoute<{ file: string }>(
  async ({ ctx, params }) => {
    const stream = SETUP_STREAMS.find((id) => STREAMS[id].file === params.file);
    if (!stream) throw new DomainError('NOT_FOUND', 'There is no export by that name.');
    return exportSetupStream(ctx, stream);
  },
  { rights: ['export:run'] },
);
