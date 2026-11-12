/**
 * Safe formula engine for `formula` columns (pure, no `eval`).
 *
 * Grammar (spreadsheet-like, case-insensitive functions):
 *   expr     := compare
 *   compare  := concat (( '=' | '!=' | '<>' | '<' | '<=' | '>' | '>=' ) concat)*
 *   concat   := additive ('&' additive)*
 *   additive := term (('+' | '-') term)*
 *   term     := unary (('*' | '/' | '%') unary)*
 *   unary    := '-' unary | power
 *   power    := primary ('^' unary)?
 *   primary  := number | string | TRUE | FALSE | {column_key} | NAME '(' args ')' | '(' expr ')'
 */

export type FormulaScalar = number | string | boolean | null;

export class FormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormulaError';
  }
}

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'ref'; value: string }
  | { kind: 'ident'; value: string }
  | { kind: 'op'; value: string }
  | { kind: 'paren'; value: '(' | ')' }
  | { kind: 'comma' };

type Node =
  | { type: 'literal'; value: FormulaScalar }
  | { type: 'ref'; key: string }
  | { type: 'unary'; operand: Node }
  | { type: 'binary'; op: string; left: Node; right: Node }
  | { type: 'call'; name: string; args: Node[] };

const MAX_EXPRESSION_LENGTH = 4_000;
const MAX_DEPTH = 64;
const OPERATORS = ['<=', '>=', '!=', '<>', '=', '<', '>', '+', '-', '*', '/', '%', '^', '&'];

export function tokenize(source: string): Token[] {
  if (source.length > MAX_EXPRESSION_LENGTH) throw new FormulaError('Formula is too long');
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index] as string;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      const match = /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(source.slice(index));
      if (!match) throw new FormulaError(`Unexpected "${char}"`);
      tokens.push({ kind: 'number', value: Number(match[0]) });
      index += match[0].length;
      continue;
    }
    if (char === '"') {
      let end = index + 1;
      let value = '';
      while (end < source.length && source[end] !== '"') {
        if (source[end] === '\\' && end + 1 < source.length) end += 1;
        value += source[end];
        end += 1;
      }
      if (end >= source.length) throw new FormulaError('Unterminated string');
      tokens.push({ kind: 'string', value });
      index = end + 1;
      continue;
    }
    if (char === '{') {
      const end = source.indexOf('}', index);
      if (end === -1) throw new FormulaError('Unterminated column reference');
      const key = source.slice(index + 1, end).trim();
      if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new FormulaError(`Invalid column reference "{${key}}"`);
      tokens.push({ kind: 'ref', value: key });
      index = end + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(index));
      const name = (match?.[0] ?? char).toUpperCase();
      tokens.push({ kind: 'ident', value: name });
      index += match?.[0].length ?? 1;
      continue;
    }
    if (char === '(' || char === ')') {
      tokens.push({ kind: 'paren', value: char });
      index += 1;
      continue;
    }
    if (char === ',') {
      tokens.push({ kind: 'comma' });
      index += 1;
      continue;
    }
    const op = OPERATORS.find((candidate) => source.startsWith(candidate, index));
    if (op) {
      tokens.push({ kind: 'op', value: op });
      index += op.length;
      continue;
    }
    throw new FormulaError(`Unexpected "${char}"`);
  }
  return tokens;
}

class Parser {
  private index = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): Node {
    const node = this.compare(0);
    if (this.index < this.tokens.length) throw new FormulaError('Unexpected token after end of formula');
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private isOp(...ops: string[]): string | null {
    const token = this.peek();
    return token?.kind === 'op' && ops.includes(token.value) ? token.value : null;
  }

  private guard(depth: number): void {
    if (depth > MAX_DEPTH) throw new FormulaError('Formula is nested too deeply');
  }

  private binaryLevel(depth: number, ops: string[], next: (depth: number) => Node): Node {
    this.guard(depth);
    let left = next(depth + 1);
    for (let op = this.isOp(...ops); op; op = this.isOp(...ops)) {
      this.index += 1;
      left = { type: 'binary', op, left, right: next(depth + 1) };
    }
    return left;
  }

  private compare = (depth: number): Node =>
    this.binaryLevel(depth, ['=', '!=', '<>', '<', '<=', '>', '>='], this.concat);
  private concat = (depth: number): Node => this.binaryLevel(depth, ['&'], this.additive);
  private additive = (depth: number): Node => this.binaryLevel(depth, ['+', '-'], this.term);
  private term = (depth: number): Node => this.binaryLevel(depth, ['*', '/', '%'], this.unary);

  private unary = (depth: number): Node => {
    this.guard(depth);
    if (this.isOp('-')) {
      this.index += 1;
      return { type: 'unary', operand: this.unary(depth + 1) };
    }
    if (this.isOp('+')) {
      this.index += 1;
      return this.unary(depth + 1);
    }
    const base = this.primary(depth + 1);
    if (this.isOp('^')) {
      this.index += 1;
      return { type: 'binary', op: '^', left: base, right: this.unary(depth + 1) };
    }
    return base;
  };

  private primary(depth: number): Node {
    this.guard(depth);
    const token = this.peek();
    if (!token) throw new FormulaError('Unexpected end of formula');
    this.index += 1;
    switch (token.kind) {
      case 'number':
      case 'string':
        return { type: 'literal', value: token.value };
      case 'ref':
        return { type: 'ref', key: token.value };
      case 'ident': {
        if (token.value === 'TRUE' || token.value === 'FALSE')
          return { type: 'literal', value: token.value === 'TRUE' };
        const open = this.peek();
        if (open?.kind !== 'paren' || open.value !== '(')
          throw new FormulaError(`Unknown name "${token.value}"`);
        this.index += 1;
        const args: Node[] = [];
        const close = this.peek();
        if (!(close?.kind === 'paren' && close.value === ')')) {
          for (;;) {
            args.push(this.compare(depth + 1));
            const next = this.peek();
            if (next?.kind === 'comma') {
              this.index += 1;
              continue;
            }
            break;
          }
        }
        const end = this.peek();
        if (end?.kind !== 'paren' || end.value !== ')') throw new FormulaError('Missing ")"');
        this.index += 1;
        return { type: 'call', name: token.value, args };
      }
      case 'paren': {
        if (token.value !== '(') throw new FormulaError('Unexpected ")"');
        const inner = this.compare(depth + 1);
        const end = this.peek();
        if (end?.kind !== 'paren' || end.value !== ')') throw new FormulaError('Missing ")"');
        this.index += 1;
        return inner;
      }
      default:
        throw new FormulaError('Unexpected token');
    }
  }
}

export function parseFormula(source: string): Node {
  return new Parser(tokenize(source)).parse();
}

/** Column keys referenced by a formula (for dependency checks). */
export function formulaReferences(source: string): string[] {
  try {
    return [...new Set(tokenize(source).flatMap((token) => (token.kind === 'ref' ? [token.value] : [])))];
  } catch {
    return [];
  }
}

function toNumber(value: FormulaScalar): number {
  if (value === null || value === '') return 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) throw new FormulaError(`"${value}" is not a number`);
  return parsed;
}

function toText(value: FormulaScalar): string {
  if (value === null) return '';
  if (typeof value === 'number')
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(10)));
  return String(value);
}

function truthy(value: FormulaScalar): boolean {
  if (typeof value === 'string') return value.length > 0;
  return Boolean(value);
}

function compareValues(op: string, left: FormulaScalar, right: FormulaScalar): boolean {
  const numeric = typeof left === 'number' || typeof right === 'number';
  const a = numeric ? toNumber(left) : toText(left);
  const b = numeric ? toNumber(right) : toText(right);
  switch (op) {
    case '=':
      return a === b;
    case '!=':
    case '<>':
      return a !== b;
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    default:
      return a >= b;
  }
}

const DAY_MS = 86_400_000;

function toDateMs(value: FormulaScalar): number {
  const ms = Date.parse(toText(value));
  if (Number.isNaN(ms)) throw new FormulaError(`"${toText(value)}" is not a date`);
  return ms;
}

function round(value: number, digits: number, mode: 'round' | 'up' | 'down'): number {
  const factor = 10 ** Math.max(0, Math.min(10, Math.trunc(digits)));
  const scaled = value * factor;
  const rounded =
    mode === 'round' ? Math.round(scaled) : mode === 'up' ? Math.ceil(scaled) : Math.floor(scaled);
  return rounded / factor;
}

type Fn = (args: FormulaScalar[]) => FormulaScalar;

const FUNCTIONS: Record<string, Fn> = {
  SUM: (args) => args.reduce<number>((sum, value) => sum + toNumber(value), 0),
  AVERAGE: (args) =>
    args.length ? args.reduce<number>((sum, value) => sum + toNumber(value), 0) / args.length : 0,
  MIN: (args) => (args.length ? Math.min(...args.map(toNumber)) : 0),
  MAX: (args) => (args.length ? Math.max(...args.map(toNumber)) : 0),
  ABS: ([value = null]) => Math.abs(toNumber(value)),
  ROUND: ([value = null, digits = 0]) => round(toNumber(value), toNumber(digits), 'round'),
  ROUNDUP: ([value = null, digits = 0]) => round(toNumber(value), toNumber(digits), 'up'),
  ROUNDDOWN: ([value = null, digits = 0]) => round(toNumber(value), toNumber(digits), 'down'),
  MULTIPLY: ([a = null, b = null]) => toNumber(a) * toNumber(b),
  DIVIDE: ([a = null, b = null]) => {
    const divisor = toNumber(b);
    if (divisor === 0) throw new FormulaError('Division by zero');
    return toNumber(a) / divisor;
  },
  MINUS: ([a = null, b = null]) => toNumber(a) - toNumber(b),
  POWER: ([a = null, b = null]) => toNumber(a) ** toNumber(b),
  IF: ([condition = null, whenTrue = null, whenFalse = null]) => (truthy(condition) ? whenTrue : whenFalse),
  AND: (args) => args.every(truthy),
  OR: (args) => args.some(truthy),
  NOT: ([value = null]) => !truthy(value),
  CONCATENATE: (args) => args.map(toText).join(''),
  LEN: ([value = null]) => toText(value).length,
  UPPER: ([value = null]) => toText(value).toUpperCase(),
  LOWER: ([value = null]) => toText(value).toLowerCase(),
  TODAY: () => new Date().toISOString().slice(0, 10),
  DAYS: ([end = null, start = null]) => Math.round((toDateMs(end) - toDateMs(start)) / DAY_MS),
  ISBLANK: ([value = null]) => value === null || value === '',
};

function evaluateNode(node: Node, resolve: (key: string) => FormulaScalar): FormulaScalar {
  switch (node.type) {
    case 'literal':
      return node.value;
    case 'ref':
      return resolve(node.key);
    case 'unary':
      return -toNumber(evaluateNode(node.operand, resolve));
    case 'call': {
      const fn = FUNCTIONS[node.name];
      if (!fn) throw new FormulaError(`Unknown function ${node.name}()`);
      if (node.name === 'IF') {
        const [condition, whenTrue, whenFalse] = node.args;
        const test = condition ? evaluateNode(condition, resolve) : null;
        const branch = truthy(test) ? whenTrue : whenFalse;
        return branch ? evaluateNode(branch, resolve) : null;
      }
      return fn(node.args.map((arg) => evaluateNode(arg, resolve)));
    }
    case 'binary': {
      const left = evaluateNode(node.left, resolve);
      const right = evaluateNode(node.right, resolve);
      switch (node.op) {
        case '+':
          return toNumber(left) + toNumber(right);
        case '-':
          return toNumber(left) - toNumber(right);
        case '*':
          return toNumber(left) * toNumber(right);
        case '/': {
          const divisor = toNumber(right);
          if (divisor === 0) throw new FormulaError('Division by zero');
          return toNumber(left) / divisor;
        }
        case '%': {
          const divisor = toNumber(right);
          if (divisor === 0) throw new FormulaError('Division by zero');
          return toNumber(left) % divisor;
        }
        case '^':
          return toNumber(left) ** toNumber(right);
        case '&':
          return toText(left) + toText(right);
        default:
          return compareValues(node.op, left, right);
      }
    }
  }
}

export interface FormulaResult {
  readonly result: FormulaScalar;
  readonly error?: string;
}

/** Evaluate `source` with column references resolved by `resolve`. Never throws. */
export function evaluateFormula(source: string, resolve: (key: string) => FormulaScalar): FormulaResult {
  if (source.trim().length === 0) return { result: null };
  try {
    const result = evaluateNode(parseFormula(source), resolve);
    if (typeof result === 'number' && !Number.isFinite(result))
      return { result: null, error: 'Result is not finite' };
    return { result };
  } catch (error) {
    return { result: null, error: error instanceof FormulaError ? error.message : 'Invalid formula' };
  }
}

/** Validate syntax only (used when saving column settings). */
export function validateFormula(source: string): { ok: true } | { ok: false; message: string } {
  if (source.trim().length === 0) return { ok: true };
  try {
    const check = (node: Node): void => {
      if (node.type === 'call') {
        if (!FUNCTIONS[node.name]) throw new FormulaError(`Unknown function ${node.name}()`);
        node.args.forEach(check);
      } else if (node.type === 'binary') {
        check(node.left);
        check(node.right);
      } else if (node.type === 'unary') check(node.operand);
    };
    check(parseFormula(source));
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof FormulaError ? error.message : 'Invalid formula' };
  }
}
