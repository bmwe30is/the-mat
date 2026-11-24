// Load report .sql files and turn their `:named` params into pg's positional
// `$1, $2…` binds.
//
// Why a scanner and not a regex: a naive /:(\w+)/ would also match the `::date`
// cast, a ':00' inside a string literal, or a colon in a comment. We walk the
// SQL once, skip over literals/comments, and only rewrite real parameters.
// Values are never placed into the SQL text — they go to pg separately.
import fs from "node:fs";

export interface BoundQuery {
  /** SQL with `:name` replaced by `$n`. */
  text: string;
  /** Values in `$1…$n` order. */
  values: unknown[];
  /** Param names in `$1…$n` order. */
  names: string[];
}

export interface DeclaredParam {
  name: string;
  type?: string;
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_CHAR = /\w/;

/** Find every `:name` outside literals/comments; return each as [start, end, name]. */
export function findNamedParams(sql: string): Array<[number, number, string]> {
  const found: Array<[number, number, string]> = [];
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];

    // -- line comment
    if (c === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? n : end + 1;
      continue;
    }

    // /* block comment */ — Postgres allows nesting.
    if (c === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") (depth++, (i += 2));
        else if (sql[i] === "*" && sql[i + 1] === "/") (depth--, (i += 2));
        else i++;
      }
      continue;
    }

    // 'string' (with '' escape). E'...' strings also allow backslash escapes.
    if (c === "'") {
      const escaped = i > 0 && /[eE]/.test(sql[i - 1]) && (i < 2 || !IDENT_CHAR.test(sql[i - 2]));
      i++;
      while (i < n) {
        if (escaped && sql[i] === "\\") i += 2;
        else if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") {
          i++;
          break;
        } else i++;
      }
      continue;
    }

    // "quoted identifier" (with "" escape)
    if (c === '"') {
      i++;
      while (i < n) {
        if (sql[i] === '"' && sql[i + 1] === '"') i += 2;
        else if (sql[i] === '"') {
          i++;
          break;
        } else i++;
      }
      continue;
    }

    // $tag$ dollar-quoted string $tag$ (tag may be empty: $$...$$).
    // `$1` is a positional param, not a dollar quote, so the tag can't start with a digit.
    if (c === "$" && (i === 0 || !IDENT_CHAR.test(sql[i - 1]))) {
      const m = /^\$([A-Za-z_]\w*)?\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        i = end === -1 ? n : end + tag.length;
        continue;
      }
    }

    // `::type` cast — skip both colons.
    if (c === ":" && next === ":") {
      i += 2;
      continue;
    }

    // :name parameter
    if (c === ":" && next !== undefined && IDENT_START.test(next)) {
      let j = i + 2;
      while (j < n && IDENT_CHAR.test(sql[j])) j++;
      found.push([i, j, sql.slice(i + 1, j)]);
      i = j;
      continue;
    }

    i++;
  }
  return found;
}

/**
 * Parse an optional header comment like `-- params: from (date), to (date)`.
 * Returns undefined if the file has no such line; `-- params: none` returns [].
 */
export function parseParamsHeader(sql: string): DeclaredParam[] | undefined {
  const m = /^\s*--\s*params:\s*(.*)$/im.exec(sql);
  if (!m) return undefined;
  const body = m[1].trim();
  if (body === "" || body.toLowerCase() === "none") return [];
  return body.split(",").map((part) => {
    const pm = /^\s*([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?\s*$/.exec(part);
    if (!pm) throw new Error(`Can't parse params header entry "${part.trim()}"`);
    return { name: pm[1], type: pm[2]?.trim() };
  });
}

/**
 * Replace `:name` params with `$n` and collect the values in order.
 * The same name used twice reuses the same `$n`.
 * Throws if the SQL references a param that has no value.
 */
export function bindNamedParams(sql: string, params: Record<string, unknown>): BoundQuery {
  const occurrences = findNamedParams(sql);
  const names: string[] = [];
  const index = new Map<string, number>();
  const missing = new Set<string>();

  let text = "";
  let last = 0;
  for (const [start, end, name] of occurrences) {
    if (!(name in params) || params[name] === undefined) missing.add(name);
    let pos = index.get(name);
    if (pos === undefined) {
      names.push(name);
      pos = names.length;
      index.set(name, pos);
    }
    text += sql.slice(last, start) + "$" + pos;
    last = end;
  }
  text += sql.slice(last);

  if (missing.size > 0) {
    const list = [...missing].map((m) => `:${m}`).join(", ");
    throw new Error(`Missing value for ${list}. Pass --param name=value (or --from/--to).`);
  }
  return { text, values: names.map((nm) => params[nm]), names };
}

export function loadSqlFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}
