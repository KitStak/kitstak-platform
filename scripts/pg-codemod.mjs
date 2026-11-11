#!/usr/bin/env node
/**
 * SQLite (sync better-sqlite3) -> Postgres (async) codemod. docs/POSTGRES_MIGRATION.md §3.
 *
 *   node scripts/pg-codemod.mjs src/server/repositories/orders tests/unit/orders-outbound [--dry] [--passes 8]
 *
 * Arguments are files or directories (recursively *.ts / *.tsx). Only those files are edited.
 * Type-aware (TypeScript compiler API over tsconfig.json); repeats passes until nothing changes:
 *
 *   builder .get()                 -> (await q.limit(1))[0]      ((await q)[0] when q has .limit/.returning)
 *   builder .all()                 -> (await q)
 *   builder .run()                 -> await q          (.run().changes -> rowCount(await q))
 *   db.get<T>(sql) / all / run     -> (await dbGet<T>(db, sql)) / dbAll / dbRun   (.changes -> .rowCount)
 *   db.transaction(cb)             -> (await withWriteTx(db, async cb))
 *   call of a function that became async (or of an unconverted function that takes a db/tx argument)
 *                                  -> (await call)
 *   function containing await      -> async, return type T -> Promise<T>
 *   arr.map/flatMap/filter/forEach/some/every/find(cb) whose callback became async
 *                                  -> (await mapSeq(arr, async cb)) ... (sequential helpers in @/server/db/sql)
 *   expect(() => x).toThrow(...)   -> await expect(async () => x).rejects.toThrow(...)   (when x became async)
 *
 * It never touches SQL text: review every raw sql`` against the semantics checklist (§5) by hand.
 * At the end it prints WARNINGS (things it could not do safely) and the remaining tsc errors in the
 * target files. Re-run it after a callee module is converted to pick up new awaits.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const dry = args.includes("--dry");
const passesArg = args.indexOf("--passes");
const MAX_PASSES = passesArg >= 0 ? Number(args[passesArg + 1]) : 10;
const targetsArg = args.filter((a, i) => !a.startsWith("--") && !(passesArg >= 0 && i === passesArg + 1));
if (targetsArg.length === 0) {
  console.error("usage: node scripts/pg-codemod.mjs <file|dir>... [--dry] [--passes N]");
  process.exit(2);
}

function walk(p, out) {
  const abs = path.resolve(ROOT, p);
  if (!fs.existsSync(abs)) { console.error(`missing: ${p}`); return; }
  if (fs.statSync(abs).isDirectory()) {
    for (const e of fs.readdirSync(abs)) if (e !== "node_modules" && !e.startsWith(".")) walk(path.join(abs, e), out);
  } else if (/\.(ts|tsx|mts)$/.test(abs) && !abs.endsWith(".d.ts")) out.add(path.normalize(abs));
}
const targets = new Set();
for (const t of targetsArg) walk(t, targets);
// Hand-written foundation plumbing: never rewritten (it already is the async API).
for (const f of ["src/server/db/sql.ts", "src/server/db/index.ts", "src/server/db/migrate.ts", "src/server/api/db.ts", "src/server/api/define-route.ts", "tests/setup/test-db.ts", "scripts/pg-codemod.mjs"]) {
  targets.delete(path.normalize(path.resolve(ROOT, f)));
}
const norm = (f) => path.normalize(path.resolve(f));

// ---------------------------------------------------------------- program
const configPath = path.join(ROOT, "tsconfig.json");
const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
const options = { ...parsed.options, noEmit: true, incremental: false, tsBuildInfoFile: undefined };
const rootNames = parsed.fileNames;
let program;
function buildProgram() {
  program = ts.createProgram({ rootNames, options, oldProgram: program });
  return program.getTypeChecker();
}

// ---------------------------------------------------------------- helpers
const warnings = new Map();
function warn(sf, node, msg) {
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  warnings.set(`${path.relative(ROOT, sf.fileName)}:${line + 1}  ${msg}`, true);
}

const SYNC_MARKER = /\.(get|all|run)\(\s*\)|\b(db|tx|database|handle)\.(get|all|run)\s*(<|\()|\.transaction\(\s*\(?\s*\w*\s*\)?\s*=>/;
const unconvertedCache = new Map();
function fileUnconverted(file) {
  if (!unconvertedCache.has(file)) {
    let text = "";
    try { text = fs.readFileSync(file, "utf8"); } catch { /* */ }
    unconvertedCache.set(file, SYNC_MARKER.test(text));
  }
  return unconvertedCache.get(file);
}

const headCache = new Map();
/** Names of functions that were already async (or returned a Promise) in git HEAD. */
function headAsyncNames(file) {
  if (headCache.has(file)) return headCache.get(file);
  const names = { asyncNames: new Set(), syncNames: new Set(), existed: false };
  try {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    const text = execFileSync("git", ["show", `HEAD:${rel}`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
    names.existed = true;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (n) => {
      let name, fn;
      if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isMethodSignature(n)) && n.name) { name = n.name.getText(sf); fn = n; }
      else if ((ts.isVariableDeclaration(n) || ts.isPropertyAssignment(n) || ts.isPropertySignature(n)) && n.name && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) { name = n.name.getText(sf); fn = n.initializer; }
      if (name && fn) {
        const isAsync = (ts.getModifiers(fn) ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) || (fn.type && /^Promise</.test(fn.type.getText(sf)));
        (isAsync ? names.asyncNames : names.syncNames).add(name);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  } catch { /* new file */ }
  headCache.set(file, names);
  return names;
}

function isFunctionLike(n) {
  return ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n) || ts.isConstructorDeclaration(n);
}
function containingFunction(n) {
  for (let p = n.parent; p; p = p.parent) if (isFunctionLike(p)) return p;
  return undefined;
}
const isAsyncFn = (fn) => (ts.getModifiers(fn) ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);

function isDbType(checker, type) {
  if (!type) return false;
  if (type.isUnion()) return type.types.some((t) => isDbType(checker, t));
  return Boolean(type.getProperty("transaction") && type.getProperty("select") && type.getProperty("insert") && type.getProperty("execute"));
}
function isBuilderType(type) {
  if (!type) return false;
  if (type.isUnion()) return type.types.every((t) => isBuilderType(t));
  return Boolean(type.getProperty("toSQL") && type.getProperty("then"));
}
function isPromiseType(checker, type) {
  if (!type) return false;
  if (type.isUnion()) return type.types.some((t) => isPromiseType(checker, t));
  const s = type.getSymbol();
  return Boolean(s && (s.getName() === "Promise" || s.getName() === "PromiseLike")) || Boolean(type.getProperty("then") && type.getProperty("catch") && type.getProperty("finally") && !type.getProperty("toSQL"));
}

/** Method names along a builder chain (outermost last). */
function chainMethods(expr) {
  const names = [];
  let e = expr;
  while (true) {
    if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) { names.push(e.expression.name.text); e = e.expression.expression; }
    else if (ts.isPropertyAccessExpression(e)) { e = e.expression; }
    else if (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e)) { e = e.expression; }
    else break;
  }
  return names;
}

/** Does `await <x>` need parentheses at this position? */
function needsParens(node) {
  const p = node.parent;
  if (!p) return false;
  if (ts.isExpressionStatement(p) || ts.isVariableDeclaration(p) || ts.isReturnStatement(p) || ts.isParenthesizedExpression(p) ||
      ts.isArrayLiteralExpression(p) || ts.isPropertyAssignment(p) || ts.isSpreadElement(p) || ts.isTemplateSpan(p) ||
      ts.isIfStatement(p) || ts.isConditionalExpression(p) || ts.isArrowFunction(p) || ts.isForOfStatement(p) || ts.isWhileStatement(p) ||
      ts.isThrowStatement(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression?.(p)) return false;
  if (ts.isCallExpression(p) || ts.isNewExpression(p)) return p.expression === node;
  if (ts.isBinaryExpression(p)) {
    const k = p.operatorToken.kind;
    return !(k === ts.SyntaxKind.EqualsToken || k === ts.SyntaxKind.QuestionQuestionToken || k === ts.SyntaxKind.BarBarToken || k === ts.SyntaxKind.AmpersandAmpersandToken || k === ts.SyntaxKind.CommaToken);
  }
  return true;
}
const awaitText = (node, inner) => (needsParens(node) ? `(await ${inner})` : `await ${inner}`);

function sqlImportPath(sf) {
  const usesAlias = /from\s+["']@\//.test(sf.text);
  if (usesAlias && !sf.fileName.includes(`${path.sep}src${path.sep}server${path.sep}db${path.sep}`)) return "@/server/db/sql";
  let rel = path.relative(path.dirname(sf.fileName), path.join(ROOT, "src", "server", "db", "sql")).split(path.sep).join("/");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

// ---------------------------------------------------------------- one pass over one file
const SEQ = { map: "mapSeq", flatMap: "flatMapSeq", filter: "filterSeq", forEach: "forEachSeq", some: "someSeq", every: "everySeq", find: "findSeq" };

function passFile(checker, sf) {
  const edits = []; // { start, end, text, kind }
  const needImports = new Set();
  const text = sf.text;
  const add = (start, end, t, kind, node) => {
    edits.push({ start, end, text: t, kind });
    // The enclosing function must become async in the same pass (one pass per call-depth level).
    if (node && kind === "replace" && /\bawait\b/.test(t)) {
      const fn = containingFunction(node);
      if (fn && !isAsyncFn(fn)) markAsync(fn);
    }
  };

  const visit = (node) => {
    // ---- .get() / .all() / .run() / raw db.get(sql)
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const m = node.expression.name.text;
      const recv = node.expression.expression;
      if (m === "get" || m === "all" || m === "run" || m === "values") {
        const rtype = checker.getTypeAtLocation(recv);
        if (node.arguments.length === 0 && m !== "values" && isBuilderType(rtype)) {
          const r = recv.getText(sf);
          const chain = chainMethods(recv);
          if (m === "get") {
            const inner = chain.includes("limit") || chain.includes("returning") ? r : `${r}.limit(1)`;
            add(node.getStart(sf), node.getEnd(), `(await ${inner})[0]`, "replace", node);
          } else if (m === "all") {
            add(node.getStart(sf), node.getEnd(), needsParens(node) ? `(await ${r})` : `await ${r}`, "replace", node);
          } else {
            const p = node.parent;
            if (ts.isPropertyAccessExpression(p) && p.name.text === "changes") {
              needImports.add("rowCount");
              add(p.getStart(sf), p.getEnd(), `rowCount(await ${r})`, "replace", p);
            } else add(node.getStart(sf), node.getEnd(), awaitText(node, r), "replace", node);
          }
          return;
        }
        if (node.arguments.length >= 1 && m !== "values" && isDbType(checker, rtype)) {
          const helper = { get: "dbGet", all: "dbAll", run: "dbRun" }[m];
          needImports.add(helper);
          const targs = node.typeArguments ? `<${node.typeArguments.map((t) => t.getText(sf)).join(", ")}>` : "";
          const call = `${helper}${targs}(${recv.getText(sf)}, ${node.arguments.map((a) => a.getText(sf)).join(", ")})`;
          const p = node.parent;
          if (m === "run" && ts.isPropertyAccessExpression(p) && p.name.text === "changes") {
            add(p.getStart(sf), p.getEnd(), `(await ${call}).rowCount`, "replace", p);
          } else add(node.getStart(sf), node.getEnd(), awaitText(node, call), "replace", node);
          return;
        }
      }
      // ---- db.transaction(cb)
      if (m === "transaction" && node.arguments.length >= 1 && isDbType(checker, checker.getTypeAtLocation(recv)) && !ts.isAwaitExpression(node.parent)) {
        const cb = node.arguments[0];
        needImports.add("withWriteTx");
        const cbText = (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) && !isAsyncFn(cb) ? `async ${cb.getText(sf)}` : cb.getText(sf);
        add(node.getStart(sf), node.getEnd(), awaitText(node, `withWriteTx(${recv.getText(sf)}, ${cbText})`), "replace", node);
        return;
      }
      // ---- array method with an async callback -> sequential helper
      if (SEQ[m] && node.arguments.length >= 1) {
        const cb = node.arguments[0];
        if ((ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) && (isAsyncFn(cb) || containsOwnAwait(cb))) {
          const rtype = checker.getTypeAtLocation(recv);
          if (checker.isArrayLikeType ? checker.isArrayLikeType(rtype) || rtype.getProperty("forEach") : true) {
            needImports.add(SEQ[m]);
            const cbText = isAsyncFn(cb) ? cb.getText(sf) : `async ${cb.getText(sf)}`;
            const extra = node.arguments.slice(1).map((a) => `, ${a.getText(sf)}`).join("");
            add(node.getStart(sf), node.getEnd(), awaitText(node, `${SEQ[m]}(${recv.getText(sf)}, ${cbText}${extra})`), "replace", node);
            return;
          }
        }
      }
      // ---- Array.from(src, asyncCb) -> mapSeq(Array.from(src), asyncCb)
      if (m === "from" && ts.isIdentifier(recv) && recv.text === "Array" && node.arguments.length === 2) {
        const cb = node.arguments[1];
        if ((ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) && (isAsyncFn(cb) || containsOwnAwait(cb))) {
          needImports.add("mapSeq");
          const cbText = isAsyncFn(cb) ? cb.getText(sf) : `async ${cb.getText(sf)}`;
          add(node.getStart(sf), node.getEnd(), awaitText(node, `mapSeq(Array.from(${node.arguments[0].getText(sf)}), ${cbText})`), "replace", node);
          return;
        }
      }
      // ---- expect(() => asyncThing).toThrow(...)
      if ((m === "toThrow" || m === "toThrowError") && ts.isCallExpression(recv) && ts.isIdentifier(recv.expression) && recv.expression.text === "expect") {
        const fnArg = recv.arguments[0];
        if (fnArg && (ts.isArrowFunction(fnArg) || ts.isFunctionExpression(fnArg)) && (isAsyncFn(fnArg) || containsOwnAwait(fnArg) || returnsPromise(checker, fnArg))) {
          const cbText = isAsyncFn(fnArg) ? fnArg.getText(sf) : `async ${fnArg.getText(sf)}`;
          const argsText = node.arguments.map((a) => a.getText(sf)).join(", ");
          add(node.getStart(sf), node.getEnd(), awaitText(node, `expect(${cbText}).rejects.toThrow(${argsText})`), "replace", node);
          return;
        }
      }
    }
    // ---- calls that now return a promise
    if (ts.isCallExpression(node) && !ts.isAwaitExpression(node.parent) && !isVoided(node)) {
      const decision = callNeedsAwait(checker, sf, node);
      if (decision) {
        add(node.getStart(sf), node.getEnd(), awaitText(node, node.getText(sf)), "replace", node);
        return;
      }
    }
    // ---- ReturnType<typeof dbFn> of a now-async function -> Awaited<ReturnType<...>>
    if (ts.isTypeReferenceNode(node) && node.typeName.getText(sf) === "ReturnType" && node.typeArguments?.length === 1) {
      const p = node.parent;
      if (!(ts.isTypeReferenceNode(p) && p.typeName.getText(sf) === "Awaited")) {
        const s = checker.getTypeFromTypeNode(node).getSymbol();
        if (s && s.getName() === "Promise") { add(node.getStart(sf), node.getEnd(), `Awaited<${node.getText(sf)}>`, "replace"); return; }
      }
    }
    // ---- await inside a non-async function -> async
    if (ts.isAwaitExpression(node)) {
      const fn = containingFunction(node);
      if (fn && !isAsyncFn(fn)) markAsync(fn);
      else if (!fn && !/\.(test|spec)\.tsx?$/.test(sf.fileName)) warn(sf, node, "top-level await (wrap the script body in an async main())");
    }
    ts.forEachChild(node, visit);
  };

  const marked = new Set();
  function markAsync(fn) {
    if (marked.has(fn)) return;
    marked.add(fn);
    if (ts.isGetAccessorDeclaration(fn) || ts.isSetAccessorDeclaration(fn) || ts.isConstructorDeclaration(fn)) { warn(sf, fn, "await inside an accessor/constructor: refactor by hand"); return; }
    if (fn.asteriskToken) { warn(sf, fn, "await inside a generator: refactor by hand"); return; }
    let at;
    if (ts.isArrowFunction(fn)) at = fn.getStart(sf);
    else if (ts.isMethodDeclaration(fn)) at = fn.name.getStart(sf);
    else at = text.indexOf("function", fn.getStart(sf));
    add(at, at, "async ", "insert");
    if (fn.type) {
      const t = fn.type.getText(sf);
      if (ts.isTypePredicateNode(fn.type)) warn(sf, fn, "async type predicate is impossible: refactor by hand");
      else if (!/^Promise</.test(t)) add(fn.type.getStart(sf), fn.type.getEnd(), `Promise<${t}>`, "replace");
    }
    const p = fn.parent;
    if (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression) && !SEQ[p.expression.name.text] && ["reduce", "sort", "reduceRight", "findIndex", "findLast", "toSorted"].includes(p.expression.name.text)) {
      warn(sf, fn, `async callback passed to .${p.expression.name.text}(): rewrite as a for...of loop`);
    }
  }

  visit(sf);
  return { edits, needImports };
}

function isVoided(node) {
  const p = node.parent;
  return ts.isVoidExpression(p) || (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression) && false);
}

function containsOwnAwait(fn) {
  let found = false;
  const v = (n) => {
    if (found) return;
    if (n !== fn && isFunctionLike(n)) return;
    if (ts.isAwaitExpression(n)) { found = true; return; }
    ts.forEachChild(n, v);
  };
  ts.forEachChild(fn, v);
  return found;
}
function returnsPromise(checker, fn) {
  const sig = checker.getSignatureFromDeclaration(fn);
  return sig ? isPromiseType(checker, checker.getReturnTypeOfSignature(sig)) : false;
}

function resolveDecl(checker, expr) {
  let sym = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(expr) ? expr.name : expr);
  for (let i = 0; sym && i < 8; i++) {
    if (sym.flags & ts.SymbolFlags.Alias) { sym = checker.getAliasedSymbol(sym); continue; }
    const d = sym.valueDeclaration ?? sym.declarations?.[0];
    if (!d) return undefined;
    if (ts.isShorthandPropertyAssignment(d)) { sym = checker.getShorthandAssignmentValueSymbol(d); continue; }
    if (ts.isPropertyAssignment(d) && (ts.isIdentifier(d.initializer) || ts.isPropertyAccessExpression(d.initializer))) { sym = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(d.initializer) ? d.initializer.name : d.initializer); continue; }
    return { decl: d, name: sym.getName() };
  }
  return undefined;
}

function callNeedsAwait(checker, sf, call) {
  const callee = call.expression;
  if (!ts.isIdentifier(callee) && !ts.isPropertyAccessExpression(callee)) return false;
  const resolved = resolveDecl(checker, callee);
  if (!resolved) return false;
  const declFile = norm(resolved.decl.getSourceFile().fileName);
  if (declFile.includes(`${path.sep}node_modules${path.sep}`) || !declFile.startsWith(norm(ROOT))) return false;
  const p = call.parent;
  // Promise.all([...]) / .then chains keep their promise.
  if (ts.isPropertyAccessExpression(p) && ["then", "catch", "finally"].includes(p.name.text)) return false;
  // expect(promise).rejects / .resolves keeps its promise.
  if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === "expect" && ts.isPropertyAccessExpression(p.parent) && ["rejects", "resolves"].includes(p.parent.name.text)) return false;
  if (ts.isArrayLiteralExpression(p) && ts.isCallExpression(p.parent) && /Promise\.(all|allSettled|race|any)/.test(p.parent.expression.getText(sf))) return false;
  const type = checker.getTypeAtLocation(call);
  // A floating promise statement of a project function (e.g. ctx.audit(...), a callback typed
  // through an interface) is always awaited in server code: inside a transaction it would run
  // after COMMIT ("Transaction is closed").
  if (isPromiseType(checker, type) && ts.isExpressionStatement(p) && containingFunction(call) && !/^\s*["']use client["']/.test(sf.text)) return true;
  if (isPromiseType(checker, type)) {
    // Only functions that were SYNCHRONOUS in git HEAD: new async code (and deliberate
    // un-awaited promises such as singletons) is left alone.
    const head = headAsyncNames(declFile);
    if (head.asyncNames.has(resolved.name)) return false;
    return head.syncNames.has(resolved.name);
  }
  // Not yet converted: a project function that takes a db/tx argument WILL become async.
  if (fileUnconverted(declFile) && call.arguments.some((a) => isDbType(checker, checker.getTypeAtLocation(a)))) {
    const head = headAsyncNames(declFile);
    if (head.asyncNames.has(resolved.name)) return false;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- apply
function applyEdits(sf, { edits, needImports }) {
  if (edits.length === 0) return null;
  // Innermost-first: drop any replace edit that strictly contains another edit (it is redone next pass).
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  const keep = [];
  for (const e of sorted) {
    const containsOther = sorted.some((o) => o !== e && o.start >= e.start && o.end <= e.end && (o.start > e.start || o.end < e.end || (o.kind === "insert" && e.kind === "replace" && o.start > e.start)));
    if (e.kind === "replace" && containsOther) continue;
    if (keep.some((k) => k.kind === "replace" && e.start > k.start && e.start < k.end)) continue;
    if (keep.some((k) => k.start === e.start && k.end === e.end && k.text === e.text)) continue;
    keep.push(e);
  }
  let text = sf.text;
  for (const e of [...keep].sort((a, b) => b.start - a.start || b.end - a.end)) text = text.slice(0, e.start) + e.text + text.slice(e.end);
  if (needImports.size > 0) text = addImports(text, sf, needImports);
  return text;
}

function addImports(text, sf, names) {
  const mod = sqlImportPath(sf);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const re = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*["']${mod.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}["'];?`);
  const m = re.exec(text);
  if (m) {
    const existing = new Set(m[1].split(",").map((s) => s.trim()).filter(Boolean));
    for (const n of names) existing.add(n);
    return text.slice(0, m.index) + `import { ${[...existing].sort().join(", ")} } from "${mod}";` + text.slice(m.index + m[0].length);
  }
  const line = `import { ${[...names].sort().join(", ")} } from "${mod}";`;
  const importRe = /^import[\s\S]*?from\s+["'][^"']+["'];?[ \t]*$|^import\s+["'][^"']+["'];?[ \t]*$/gm;
  let last = -1;
  for (let mm; (mm = importRe.exec(text));) last = mm.index + mm[0].length;
  if (last < 0) return line + eol + text;
  return text.slice(0, last) + eol + line + text.slice(last);
}

// ---------------------------------------------------------------- main loop
const t0 = Date.now();
let changedFiles = new Set();
for (let pass = 1; pass <= MAX_PASSES; pass++) {
  const checker = buildProgram();
  let changes = 0;
  for (const file of targets) {
    const sf = program.getSourceFile(file) ?? program.getSourceFiles().find((s) => norm(s.fileName) === file);
    if (!sf) { if (pass === 1) console.error(`not in program: ${path.relative(ROOT, file)}`); continue; }
    const result = passFile(checker, sf);
    const next = applyEdits(sf, result);
    if (next !== null && next !== sf.text) {
      changes++;
      changedFiles.add(file);
      unconvertedCache.delete(file);
      if (!dry) fs.writeFileSync(file, next);
    }
  }
  console.log(`pass ${pass}: ${changes} file(s) changed (${Math.round((Date.now() - t0) / 1000)}s)`);
  if (changes === 0 || dry) break;
}

// ---------------------------------------------------------------- report
const checker = buildProgram();
void checker;
const diags = [];
for (const file of targets) {
  const sf = program.getSourceFile(file) ?? program.getSourceFiles().find((s) => norm(s.fileName) === file);
  if (!sf) continue;
  for (const d of [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)]) {
    const { line } = sf.getLineAndCharacterOfPosition(d.start ?? 0);
    diags.push(`${path.relative(ROOT, file)}:${line + 1}  TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, " ").slice(0, 220)}`);
  }
}
console.log(`\nchanged ${changedFiles.size} file(s)${dry ? " (dry run, nothing written)" : ""}`);
if (warnings.size) { console.log(`\nWARNINGS (${warnings.size}) - fix by hand:`); for (const w of warnings.keys()) console.log(`  ${w}`); }
console.log(`\nremaining type errors in target files: ${diags.length}`);
for (const d of diags.slice(0, 400)) console.log(`  ${d}`);
if (diags.length > 400) console.log(`  ... ${diags.length - 400} more`);
