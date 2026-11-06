/** Turn engine errors into plain language with a next step. */
export function explainRunError(error: string | null): { title: string; hint: string } | null {
  if (!error) return null;
  const lower = error.toLowerCase();
  if (lower.includes('column') && (lower.includes('not exist') || lower.includes('deleted')))
    return {
      title: 'A column used by this automation was deleted',
      hint: 'Edit the automation and pick another column.',
    };
  if (lower.includes('group') && (lower.includes('not exist') || lower.includes('not found')))
    return {
      title: 'The target group no longer exists',
      hint: 'Edit the automation and choose another group.',
    };
  if (lower.includes('permission') || lower.includes('view-only') || lower.includes('cannot'))
    return {
      title: 'Missing permissions',
      hint: 'The automation’s creator no longer has edit access to a target board.',
    };
  if (lower.includes('not found')) return { title: 'Something it depends on was removed', hint: error };
  return { title: 'The automation stopped with an error', hint: error };
}
