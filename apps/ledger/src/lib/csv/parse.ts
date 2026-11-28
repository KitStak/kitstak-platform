/**
 * CSV reader (RFC 4180 and the files people really have). Handles a UTF-8 byte order mark, CRLF,
 * LF and lone CR line ends, quoted cells with commas, quotes and line breaks inside, and comma,
 * semicolon or tab separated files (auto detected). Blank lines are skipped. Pure TypeScript: the
 * same code runs in the browser (a web worker) and on the server.
 */

export type Delimiter = ',' | ';' | '\t';

export const DELIMITERS: readonly Delimiter[] = [',', ';', '\t'];

/** The words people see for each separator. */
export const DELIMITER_LABELS: Readonly<Record<Delimiter, string>> = { ',': 'Comma', ';': 'Semicolon', '\t': 'Tab' };

/** File limits from docs/ledger/SPEC.md section 7 (copied from Pulse). */
export const CSV_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  maxRows: 50_000,
  maxColumns: 200,
  maxCellLength: 2_000,
} as const;

export interface CsvProblem {
  readonly level: 'error' | 'warning';
  readonly code:
    | 'empty_file'
    | 'file_too_large'
    | 'too_many_rows'
    | 'too_many_columns'
    | 'cell_too_long'
    | 'unclosed_quote'
    | 'duplicate_header'
    | 'blank_header'
    | 'extra_cells'
    | 'missing_column';
  /** Spreadsheet row number (the header row is row 1), when the problem is on one row. */
  readonly row: number | null;
  /** Plain words, ready to show. */
  readonly message: string;
}

export interface ParseOptions {
  /** Force a separator. Default: auto detect. */
  readonly delimiter?: Delimiter;
  readonly maxRows?: number;
  readonly maxColumns?: number;
  readonly maxCellLength?: number;
  readonly maxBytes?: number;
}

export interface ParsedCsv {
  readonly delimiter: Delimiter;
  /** True when the file started with a byte order mark. */
  readonly hadBom: boolean;
  /** Header cells, trimmed. */
  readonly headers: string[];
  /** Data rows, each padded or cut to the header length. Cells are raw text: not trimmed. */
  readonly rows: string[][];
  /** The spreadsheet row number of each data row (the header row is row 1). */
  readonly rowNumbers: number[];
  readonly problems: CsvProblem[];
}

interface RawRecord {
  cells: string[];
  /** 1 based position among all records of the file, blank ones included. */
  row: number;
  /** True when any cell was written in quotes. A quoted empty cell is still a real row. */
  quoted: boolean;
}

/** Removes a leading byte order mark. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Guesses the separator from the first lines of a file: the one of comma, semicolon and tab that
 * splits those lines into the same number of cells, more than one. Quoted text is ignored.
 * Falls back to a comma.
 */
export function sniffDelimiter(text: string): Delimiter {
  const sample = stripBom(text);
  const counts: Record<Delimiter, number[]> = { ',': [], ';': [], '\t': [] };
  let line: Record<Delimiter, number> = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  let lineHasText = false;
  let lines = 0;
  const endLine = (): void => {
    if (lineHasText) {
      for (const delimiter of DELIMITERS) counts[delimiter].push(line[delimiter]);
      lines += 1;
    }
    line = { ',': 0, ';': 0, '\t': 0 };
    lineHasText = false;
  };
  for (let i = 0; i < sample.length && lines < 20; i += 1) {
    const char = sample[i] as string;
    if (char === '"') {
      inQuotes = !inQuotes;
      lineHasText = true;
    } else if (!inQuotes && (char === '\n' || char === '\r')) {
      endLine();
    } else {
      if (!inQuotes && (char === ',' || char === ';' || char === '\t')) line[char] += 1;
      if (char !== ' ') lineHasText = true;
    }
  }
  if (lines < 20) endLine();
  let best: Delimiter = ',';
  let bestScore = 0;
  for (const delimiter of DELIMITERS) {
    const list = counts[delimiter];
    const first = list[0] ?? 0;
    if (first === 0) continue;
    const same = list.filter((count) => count === first).length;
    // steady lines count most, then how many cells the separator makes
    const score = (same / list.length) * 1000 + first;
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}

function readRecords(text: string, delimiter: Delimiter): { records: RawRecord[]; unclosedAt: number | null } {
  const records: RawRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let inQuotes = false;
  let cellQuoted = false;
  let recordQuoted = false;
  let quoteOpenedAt: number | null = null;
  let row = 1;
  const endCell = (): void => {
    cells.push(cell);
    cell = '';
    cellQuoted = false;
  };
  const endRecord = (): void => {
    endCell();
    records.push({ cells, row, quoted: recordQuoted });
    cells = [];
    recordQuoted = false;
    row += 1;
  };
  const length = text.length;
  for (let i = 0; i < length; i += 1) {
    const char = text[i] as string;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
          quoteOpenedAt = null;
        }
      } else {
        cell += char;
      }
    } else if (char === '"' && cell === '' && !cellQuoted) {
      inQuotes = true;
      cellQuoted = true;
      recordQuoted = true;
      quoteOpenedAt = row;
    } else if (char === delimiter) {
      endCell();
    } else if (char === '\n') {
      endRecord();
    } else if (char === '\r') {
      if (text[i + 1] === '\n') i += 1;
      endRecord();
    } else {
      // A quote in the middle of a plain cell, or text after a closing quote, is kept as typed.
      cell += char;
    }
  }
  if (cell !== '' || cells.length > 0 || cellQuoted) endRecord();
  return { records, unclosedAt: inQuotes ? quoteOpenedAt : null };
}

function isBlank(record: RawRecord): boolean {
  return !record.quoted && record.cells.every((value) => value.trim() === '');
}

/**
 * Reads CSV text into a header row and data rows. Never throws on bad input: anything wrong with
 * the file comes back in `problems`, in plain words. Rows past the limits are dropped and reported.
 */
export function parseCsv(input: string, options: ParseOptions = {}): ParsedCsv {
  const maxRows = options.maxRows ?? CSV_LIMITS.maxRows;
  const maxColumns = options.maxColumns ?? CSV_LIMITS.maxColumns;
  const maxCellLength = options.maxCellLength ?? CSV_LIMITS.maxCellLength;
  const maxBytes = options.maxBytes ?? CSV_LIMITS.maxBytes;
  const hadBom = input.charCodeAt(0) === 0xfeff;
  const text = hadBom ? input.slice(1) : input;
  const problems: CsvProblem[] = [];
  const delimiter = options.delimiter ?? sniffDelimiter(text);
  if (text.length > maxBytes) {
    problems.push({ level: 'error', code: 'file_too_large', row: null, message: `This file is too big. The limit is ${Math.round(maxBytes / (1024 * 1024))} MB. Split it into smaller files.` });
    return { delimiter, hadBom, headers: [], rows: [], rowNumbers: [], problems };
  }
  const { records, unclosedAt } = readRecords(text, delimiter);
  if (unclosedAt !== null) {
    problems.push({ level: 'error', code: 'unclosed_quote', row: unclosedAt, message: `Row ${unclosedAt} opens a quote that is never closed. Check for a missing " mark.` });
  }
  const filled = records.filter((record) => !isBlank(record));
  const headerRecord = filled[0];
  if (!headerRecord) {
    problems.push({ level: 'error', code: 'empty_file', row: null, message: 'This file is empty. It needs a header row and one or more rows under it.' });
    return { delimiter, hadBom, headers: [], rows: [], rowNumbers: [], problems };
  }
  let headers = headerRecord.cells.map((header) => header.trim());
  while (headers.length > 0 && headers[headers.length - 1] === '') headers.pop();
  if (headers.length > maxColumns) {
    problems.push({ level: 'error', code: 'too_many_columns', row: headerRecord.row, message: `This file has ${headers.length} columns. The limit is ${maxColumns}.` });
    headers = headers.slice(0, maxColumns);
  }
  const seen = new Map<string, number>();
  headers.forEach((header, index) => {
    if (header === '') {
      problems.push({ level: 'warning', code: 'blank_header', row: headerRecord.row, message: `Column ${index + 1} has no name in the header row, so it is ignored.` });
      return;
    }
    const key = header.toLowerCase();
    if (seen.has(key)) problems.push({ level: 'warning', code: 'duplicate_header', row: headerRecord.row, message: `The header "${header}" is there twice. Only the first one is used.` });
    else seen.set(key, index);
  });

  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  const dataRecords = filled.slice(1);
  if (dataRecords.length > maxRows) {
    problems.push({ level: 'error', code: 'too_many_rows', row: null, message: `This file has ${dataRecords.length.toLocaleString('en-US')} rows. The limit is ${maxRows.toLocaleString('en-US')}. Split it into smaller files.` });
  }
  let extraCellRows = 0;
  let longCells = 0;
  let firstExtra: number | null = null;
  let firstLong: number | null = null;
  for (const record of dataRecords.slice(0, maxRows)) {
    const cells = record.cells;
    if (cells.length > headers.length && cells.slice(headers.length).some((value) => value.trim() !== '')) {
      extraCellRows += 1;
      firstExtra = firstExtra ?? record.row;
    }
    const row: string[] = [];
    for (let i = 0; i < headers.length; i += 1) {
      let value = cells[i] ?? '';
      if (value.length > maxCellLength) {
        longCells += 1;
        firstLong = firstLong ?? record.row;
        value = value.slice(0, maxCellLength);
      }
      row.push(value);
    }
    rows.push(row);
    rowNumbers.push(record.row);
  }
  if (extraCellRows > 0) {
    problems.push({
      level: 'warning',
      code: 'extra_cells',
      row: firstExtra,
      message: `${extraCellRows === 1 ? `Row ${firstExtra} has` : `${extraCellRows.toLocaleString('en-US')} rows have`} more cells than the header row. The extra cells are ignored.`,
    });
  }
  if (longCells > 0) {
    problems.push({
      level: 'warning',
      code: 'cell_too_long',
      row: firstLong,
      message: `${longCells === 1 ? `A cell on row ${firstLong} is` : `${longCells.toLocaleString('en-US')} cells are`} longer than ${maxCellLength.toLocaleString('en-US')} characters and ${longCells === 1 ? 'was' : 'were'} cut short.`,
    });
  }
  return { delimiter, hadBom, headers, rows, rowNumbers, problems };
}

/** Turns parsed rows into objects keyed by header text. Later duplicate headers are ignored. */
export function rowsToObjects(parsed: Pick<ParsedCsv, 'headers' | 'rows'>): Record<string, string>[] {
  return parsed.rows.map((row) => {
    const out: Record<string, string> = {};
    parsed.headers.forEach((header, index) => {
      if (header !== '' && !(header in out)) out[header] = row[index] ?? '';
    });
    return out;
  });
}
