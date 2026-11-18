/**
 * How a job is named on a chart axis: its number and its name ("J-1005 Holiday gift kits"), so a
 * reader does not have to look the number up. Long names are cut at a word with an ellipsis.
 */
const MAX_NAME = 28;

export function jobChartLabel(number: string, name: string | null | undefined): string {
  const clean = (name ?? '').trim();
  if (!clean) return number;
  if (clean.length <= MAX_NAME) return `${number} ${clean}`;
  const cut = clean.slice(0, MAX_NAME);
  const space = cut.lastIndexOf(' ');
  return `${number} ${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
