/** Words for import states and row actions (pure, server and client). */
export const BATCH_STATUS: Readonly<Record<string, { readonly label: string; readonly tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }>> = {
  uploading: { label: 'Sending', tone: 'neutral' },
  mapped: { label: 'Mapped', tone: 'neutral' },
  checked: { label: 'Checked, not in yet', tone: 'info' },
  committed: { label: 'Brought in', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  undone: { label: 'Undone', tone: 'neutral' },
};

export const ROW_ACTION: Readonly<Record<string, { readonly label: string; readonly tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }>> = {
  create: { label: 'New', tone: 'success' },
  update: { label: 'Changes', tone: 'info' },
  unchanged: { label: 'No change', tone: 'neutral' },
  lookalike: { label: 'Looks the same', tone: 'warning' },
  error: { label: 'Error', tone: 'danger' },
};
