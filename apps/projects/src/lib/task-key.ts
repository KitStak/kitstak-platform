/** Human task ids: `${projectKey}-${number}` (OPS-42). */
export function taskKey(projectKey: string, number: number): string {
  return `${projectKey}-${number}`;
}

const TASK_REF = /^([A-Za-z][A-Za-z0-9]{1,5})-(\d{1,9})$/;

/** Parses "OPS-42" / "ops-42" → { projectKey: 'OPS', number: 42 }, else null. */
export function parseTaskKey(value: string): { projectKey: string; number: number } | null {
  const match = TASK_REF.exec(value.trim());
  if (!match) return null;
  return { projectKey: match[1].toUpperCase(), number: Number(match[2]) };
}

/** Suggests a project key from a name: "Warehouse go-live" → "WGL", "Operations" → "OPER". */
export function suggestProjectKey(name: string, taken: ReadonlySet<string> = new Set()): string {
  const words = name
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  let base: string;
  if (words.length >= 2) base = words.map((word) => word[0]).join('').slice(0, 4);
  else base = (words[0] ?? 'PRJ').slice(0, 4);
  base = base.toUpperCase().replace(/^[^A-Z]+/, '');
  if (base.length < 2) base = `${base}PRJ`.slice(0, 3);
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i += 1) {
    const candidate = `${base.slice(0, 6 - String(i).length)}${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, 3)}${Date.now() % 1000}`;
}
