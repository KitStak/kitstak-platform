/**
 * Auto-mapping of file columns onto board columns (by name similarity + type compatibility),
 * and validation of a user-edited mapping.
 */
import { isComputedColumnType, type ColumnType } from '@/server/db/schema/cell-values';
import { detectExportHelpers, helperCompanions, type ExportHelpers } from './export-headers';
import { isNameLike, nameSimilarity } from './text';
import type {
  ColumnMapping,
  ColumnProfile,
  CreatableType,
  InferredType,
  MappingTarget,
  TargetColumn,
} from './types';

/** How well values of an inferred type land in a column type (0 = incompatible). */
export function typeCompatibility(inferred: InferredType, target: ColumnType): number {
  switch (target) {
    case 'text':
      return inferred === 'text' ? 1 : 0.8;
    case 'long_text':
      return inferred === 'long_text' ? 1 : inferred === 'text' ? 0.9 : 0.7;
    case 'status':
    case 'dropdown':
      return inferred === 'status' ? 1 : inferred === 'text' || inferred === 'checkbox' || inferred === 'tags' ? 0.7 : 0.3;
    case 'email':
      return inferred === 'email' ? 1 : inferred === 'text' ? 0.3 : 0;
    case 'phone':
      return inferred === 'phone' ? 1 : inferred === 'number' ? 0.6 : inferred === 'text' ? 0.3 : 0;
    case 'number':
    case 'rating':
      return inferred === 'number' ? 1 : inferred === 'currency' ? 0.8 : 0;
    case 'currency':
      return inferred === 'currency' ? 1 : inferred === 'number' ? 0.9 : 0;
    case 'date':
      return inferred === 'date' ? 1 : 0;
    case 'timeline':
      return inferred === 'date' ? 0.6 : inferred === 'text' ? 0.3 : 0;
    case 'people':
      return inferred === 'people' ? 1 : inferred === 'email' ? 0.75 : inferred === 'text' ? 0.5 : 0;
    case 'link':
      return inferred === 'link' ? 1 : inferred === 'text' ? 0.4 : 0;
    case 'tags':
      return inferred === 'tags' ? 1 : inferred === 'text' || inferred === 'status' ? 0.7 : 0.2;
    case 'checkbox':
      return inferred === 'checkbox' ? 1 : 0;
    case 'country':
      return inferred === 'country' ? 1 : inferred === 'text' || inferred === 'status' ? 0.6 : 0;
    case 'location':
      return inferred === 'text' ? 0.8 : inferred === 'long_text' ? 0.6 : 0.2;
    case 'connect_boards':
      return inferred === 'text' || inferred === 'status' ? 0.8 : 0.2;
    default:
      return 0;
  }
}

/** Board columns a file column can be mapped onto. */
export function isMappableColumn(column: TargetColumn): boolean {
  return column.type !== 'name' && column.type !== 'files' && !isComputedColumnType(column.type);
}

export function suggestedNewType(profile: ColumnProfile): CreatableType {
  switch (profile.inferred) {
    case 'tags':
      return 'tags';
    case 'long_text':
      return 'long_text';
    default:
      return profile.inferred;
  }
}

function pickNameColumn(profiles: readonly ColumnProfile[], excluded: ReadonlySet<number>): number {
  const candidates = profiles.filter((profile) => !excluded.has(profile.index));
  const named = candidates.find((profile) => profile.nonEmpty > 0 && isNameLike(profile.header));
  if (named) return named.index;
  const text = candidates
    .filter((profile) => profile.nonEmpty > 0 && profile.inferred === 'text')
    .sort((a, b) => b.distinctCount - a.distinctCount)[0];
  return text?.index ?? candidates.find((profile) => profile.nonEmpty > 0)?.index ?? 0;
}

/** Apply KitStak export helper columns (Group, "(emails)", "(currency)") to a mapping. */
function applyExportHelpers(
  mappings: ColumnMapping[],
  profiles: readonly ColumnProfile[],
  boardColumns: readonly TargetColumn[],
  helpers: ExportHelpers,
): ColumnMapping[] {
  const peopleColumns = boardColumns.filter((column) => column.type === 'people');
  const replace = (index: number, target: MappingTarget, confidence = 1): void => {
    const position = mappings.findIndex((mapping) => mapping.sourceIndex === index);
    if (position >= 0) mappings[position] = { sourceIndex: index, target, confidence, auto: true };
  };
  const nameIndex = mappings.find((mapping) => mapping.target.kind === 'name')?.sourceIndex;
  if (helpers.group !== null && helpers.group !== nameIndex) replace(helpers.group, { kind: 'group' });
  for (const [base, companion] of helpers.peopleEmails) {
    const header = profiles[base]?.header ?? 'People';
    const inferred = profiles[companion]?.inferred;
    if (base === nameIndex || (inferred !== 'people' && inferred !== 'email')) continue;
    const existing = peopleColumns
      .map((column) => ({ column, score: nameSimilarity(header, column.title) }))
      .filter((entry) => entry.score >= AUTO_MAP_THRESHOLD)
      .sort((a, b) => b.score - a.score)[0]?.column;
    replace(companion, existing ? { kind: 'existing', columnKey: existing.key } : { kind: 'new', type: 'people', title: header });
    replace(base, { kind: 'skip' });
  }
  for (const [base, companion] of helpers.currencyCodes) {
    replace(companion, { kind: 'skip' });
    const current = mappings.find((mapping) => mapping.sourceIndex === base);
    if (current?.target.kind === 'new') replace(base, { ...current.target, type: 'currency' }, current.confidence);
  }
  return mappings;
}

export const AUTO_MAP_THRESHOLD = 0.6;

/** Build the initial mapping for a sheet. */
export function autoMap(
  profiles: readonly ColumnProfile[],
  boardColumns: readonly TargetColumn[],
  saved: Readonly<Record<string, string>> = {},
): ColumnMapping[] {
  const helpers = detectExportHelpers(profiles.map((profile) => profile.header));
  const companions = helperCompanions(helpers);
  if (helpers.group !== null) companions.add(helpers.group);
  const nameIndex = pickNameColumn(profiles, companions);
  const mappable = boardColumns.filter(isMappableColumn);
  const used = new Set<string>();
  const result = new Map<number, ColumnMapping>();
  result.set(nameIndex, { sourceIndex: nameIndex, target: { kind: 'name' }, confidence: 1, auto: true });

  // Saved mapping templates win (recurring imports onto the same board).
  for (const profile of profiles) {
    if (result.has(profile.index)) continue;
    const key = saved[profile.header.toLowerCase()];
    const column = key ? mappable.find((entry) => entry.key === key) : undefined;
    if (column && !used.has(column.key)) {
      used.add(column.key);
      result.set(profile.index, {
        sourceIndex: profile.index,
        target: { kind: 'existing', columnKey: column.key },
        confidence: 1,
        auto: true,
      });
    }
  }

  const pairs: { index: number; key: string; score: number }[] = [];
  for (const profile of profiles) {
    if (result.has(profile.index)) continue;
    for (const column of mappable) {
      const similarity = nameSimilarity(profile.header, column.title);
      const compat = typeCompatibility(profile.inferred, column.type);
      if (compat === 0) continue;
      const score = similarity * (0.6 + 0.4 * compat);
      if (similarity >= AUTO_MAP_THRESHOLD && score >= AUTO_MAP_THRESHOLD)
        pairs.push({ index: profile.index, key: column.key, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  for (const pair of pairs) {
    if (result.has(pair.index) || used.has(pair.key)) continue;
    used.add(pair.key);
    result.set(pair.index, {
      sourceIndex: pair.index,
      target: { kind: 'existing', columnKey: pair.key },
      confidence: Math.min(1, pair.score),
      auto: true,
    });
  }

  const initial = profiles.map((profile): ColumnMapping => {
    const mapped = result.get(profile.index);
    if (mapped) return mapped;
    if (profile.nonEmpty === 0) {
      return { sourceIndex: profile.index, target: { kind: 'skip' }, confidence: 0, auto: true };
    }
    return {
      sourceIndex: profile.index,
      target: { kind: 'new', type: suggestedNewType(profile), title: profile.header },
      confidence: profile.confidence,
      auto: true,
    };
  });
  return applyExportHelpers(initial, profiles, boardColumns, helpers);
}

export interface MappingProblem {
  readonly sourceIndex: number | null;
  readonly message: string;
}

export function validateMapping(
  mappings: readonly ColumnMapping[],
  boardColumns: readonly TargetColumn[],
): MappingProblem[] {
  const problems: MappingProblem[] = [];
  const names = mappings.filter((mapping) => mapping.target.kind === 'name');
  if (names.length === 0) problems.push({ sourceIndex: null, message: 'Choose which file column holds the item name.' });
  const groupTargets = mappings.filter((mapping) => mapping.target.kind === 'group');
  for (const mapping of groupTargets.slice(1))
    problems.push({ sourceIndex: mapping.sourceIndex, message: 'Only one column can choose the group.' });
  if (names.length > 1) {
    for (const mapping of names.slice(1))
      problems.push({ sourceIndex: mapping.sourceIndex, message: 'Only one column can be the item name.' });
  }
  const existing = new Map<string, number>();
  const titles = new Set(boardColumns.map((column) => column.title.trim().toLowerCase()));
  const newTitles = new Map<string, number>();
  for (const mapping of mappings) {
    const target: MappingTarget = mapping.target;
    if (target.kind === 'existing') {
      if (!boardColumns.some((column) => column.key === target.columnKey)) {
        problems.push({ sourceIndex: mapping.sourceIndex, message: 'That column no longer exists on the board.' });
      } else if (existing.has(target.columnKey)) {
        problems.push({ sourceIndex: mapping.sourceIndex, message: 'Another file column already maps here.' });
      }
      existing.set(target.columnKey, mapping.sourceIndex);
    }
    if (target.kind === 'new') {
      const title = target.title.trim().toLowerCase();
      if (!title) problems.push({ sourceIndex: mapping.sourceIndex, message: 'Give the new column a name.' });
      else if (newTitles.has(title) || titles.has(title)) {
        problems.push({
          sourceIndex: mapping.sourceIndex,
          message: 'A column with this name already exists. Map onto it or rename the new column.',
        });
      }
      newTitles.set(title, mapping.sourceIndex);
    }
  }
  return problems;
}
