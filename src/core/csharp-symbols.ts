// DOM-free scanner that discovers the symbols a LEARNER declared in their own
// source, so the editor can offer them as completions.
//
// WHY THIS EXISTS: the course is static hosting - there is no C# language
// server in the browser, so Monaco has no real IntelliSense. The completion
// provider therefore served a fixed, hand-written list, which meant a learner
// who wrote `class Dog` never saw `Dog` offered back to them. This module reads
// the buffer and closes that gap with plain text analysis.
//
// It is deliberately a HEURISTIC, not a parser. It must never throw and never
// block typing; when it cannot tell, it stays quiet rather than guessing loudly.

export type TypeKind = "class" | "interface" | "record" | "struct" | "enum";
export type MemberKind = "method" | "property" | "field" | "enumMember";

export interface MemberSymbol {
  name: string;
  kind: MemberKind;
  /** Declared return/value type, when the declaration made it plain. */
  type?: string;
  /** Human-readable signature for the completion detail line. */
  detail: string;
  /** true for `static` members, which read off the TYPE not an instance. */
  isStatic: boolean;
}

export interface TypeSymbol {
  name: string;
  kind: TypeKind;
  members: MemberSymbol[];
  /** Base class and implemented interfaces, in declaration order, stripped of
   *  generic arguments. Empty when the type declared no base list. */
  bases: string[];
}

export interface VarSymbol {
  name: string;
  /** The type name this variable holds, when it could be determined. */
  type?: string;
}

export interface CSharpSymbols {
  types: TypeSymbol[];
  /** Locals and fields visible for a bare-word completion. */
  vars: VarSymbol[];
}

// Words that can precede `(` or `{` and look exactly like a declaration.
// Without this guard `if (ready)` registers a method named `ready`.
const NOT_A_DECLARATION = new Set([
  "if", "else", "for", "foreach", "while", "do", "switch", "case", "catch",
  "try", "finally", "using", "lock", "return", "throw", "new", "in", "is",
  "as", "and", "or", "not", "when", "where", "select", "from", "let", "yield",
  "checked", "unchecked", "fixed", "unsafe", "default", "sizeof", "typeof",
  "nameof", "await", "base", "this", "get", "set", "add", "remove", "value",
]);

const MODIFIERS = new Set([
  "public", "private", "protected", "internal", "static", "abstract", "virtual",
  "override", "sealed", "readonly", "const", "extern", "partial", "async",
  "unsafe", "volatile", "new", "required", "file",
]);

const TYPE_KEYWORDS = new Set<TypeKind>(["class", "interface", "record", "struct", "enum"]);

/** Blank out comments and string/char literals, preserving offsets and newlines,
 *  so a declaration written inside a comment or a string is never registered. */
export function stripCommentsAndStrings(src: string): string {
  const out = src.split("");
  const n = src.length;
  let i = 0;
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      blank(i, j); i = j; continue;
    }
    if (c === "/" && d === "*") {
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
      blank(i, Math.min(j + 2, n)); i = j + 2; continue;
    }
    // verbatim / raw-ish string: @"..." with "" escapes
    if (c === "@" && d === '"') {
      let j = i + 2;
      while (j < n) {
        if (src[j] === '"' && src[j + 1] === '"') { j += 2; continue; }
        if (src[j] === '"') { j++; break; }
        j++;
      }
      blank(i, j); i = j; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === c) { j++; break; }
        if (src[j] === "\n") break;
        j++;
      }
      blank(i, j); i = j; continue;
    }
    i++;
  }
  return out.join("");
}

/** Index of the `}` matching the `{` at `open`, or -1. Input must be stripped. */
function matchBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function isIdent(s: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s);
}

/** The `: A, B` base list of a declaration, given the text between the type
 *  name and the body. Positional record parameters and a generic `where`
 *  constraint clause are dropped first so neither is mistaken for a base. */
function baseList(segment: string): string[] {
  const noParams = segment.replace(/\([^)]*\)/g, "");
  const noWhere = noParams.split(/\bwhere\b/)[0];
  const colon = noWhere.indexOf(":");
  if (colon === -1) return [];
  return noWhere
    .slice(colon + 1)
    .split(",")
    .map((part) => bareType(part))
    .filter(isIdent);
}

/** A usable type name for completion purposes (strips generics/arrays/nullable). */
function bareType(raw: string): string {
  return raw.replace(/<.*>/, "").replace(/\[[\s,]*\]/g, "").replace(/\?$/, "").trim();
}

// --- members inside one type body ------------------------------------------

function scanMembers(body: string): MemberSymbol[] {
  const members: MemberSymbol[] = [];
  const seen = new Set<string>();
  const push = (m: MemberSymbol): void => {
    const key = m.kind + ":" + m.name;
    if (m.name && isIdent(m.name) && !seen.has(key)) { seen.add(key); members.push(m); }
  };

  // Walk statements at depth 0 of this body only, so a local inside a method is
  // not mistaken for a field.
  let depth = 0;
  let stmt = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "{") {
      if (depth === 0) { takeDeclaration(stmt, push, true); stmt = ""; }
      depth++; continue;
    }
    if (c === "}") { depth = Math.max(0, depth - 1); if (depth === 0) stmt = ""; continue; }
    if (depth > 0) continue;
    if (c === ";") { takeDeclaration(stmt, push, false); stmt = ""; continue; }
    stmt += c;
  }
  return members;
}

/** Interpret one member-level statement. `blockFollows` = a `{` came next, so a
 *  method body or a property accessor list. */
function takeDeclaration(
  stmt: string,
  push: (m: MemberSymbol) => void,
  blockFollows: boolean,
): void {
  const text = stmt.replace(/\s+/g, " ").trim();
  if (!text) return;
  if (/^\[/.test(text)) return; // attribute
  const isStatic = /\bstatic\b/.test(text);

  // method: ... Ret Name(params)
  const method = text.match(/([A-Za-z_][A-Za-z0-9_<>,.\[\]\?]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(<[^>]*>)?\s*\(([^)]*)\)\s*$/);
  if (method) {
    const name = method[2];
    // `public Dog(...)` also matches this shape, with "public" landing in the
    // return-type slot. A real method's return type is never a modifier, so
    // that mismatch is what tells a constructor apart - let it fall through.
    const looksLikeCtor = MODIFIERS.has(method[1]);
    if (!looksLikeCtor && !NOT_A_DECLARATION.has(name) && !MODIFIERS.has(name)) {
      const ret = bareType(method[1]);
      push({ name, kind: "method", type: ret, isStatic, detail: `${ret} ${name}(${method[4].trim()})` });
      return;
    }
  }
  // constructor: Modifiers Name(params) - no return type
  const ctor = text.match(/^(?:[a-z]+\s+)*([A-Z][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*$/);
  if (ctor && blockFollows) return; // constructors are offered via the type name

  // property: ... Type Name  (a block follows: { get; set; })
  if (blockFollows) {
    const prop = text.match(/([A-Za-z_][A-Za-z0-9_<>,.\[\]\?]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/);
    if (prop) {
      const name = prop[2];
      if (!NOT_A_DECLARATION.has(name) && !MODIFIERS.has(name) && !TYPE_KEYWORDS.has(name as TypeKind)) {
        const t = bareType(prop[1]);
        push({ name, kind: "property", type: t, isStatic, detail: `${t} ${name} { get; set; }` });
      }
    }
    return;
  }
  // field: ... Type Name;  or  ... Type Name = value;
  const field = text.match(/([A-Za-z_][A-Za-z0-9_<>,.\[\]\?]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(=.*)?$/);
  if (field) {
    const name = field[2];
    if (NOT_A_DECLARATION.has(name) || MODIFIERS.has(name)) return;
    const t = bareType(field[1]);
    if (TYPE_KEYWORDS.has(t as TypeKind) || NOT_A_DECLARATION.has(t)) return;
    push({ name, kind: "field", type: t, isStatic, detail: `${t} ${name}` });
  }
}

// --- top level --------------------------------------------------------------

/** Discover every type the learner declared, plus the variables in scope-ish. */
export function scanCSharp(source: string): CSharpSymbols {
  const types: TypeSymbol[] = [];
  const vars: VarSymbol[] = [];
  if (!source) return { types, vars };
  let src: string;
  try { src = stripCommentsAndStrings(source); } catch { return { types, vars }; }

  const declRe = /\b(class|interface|record|struct|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  const claimed: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(src)) !== null) {
    const kind = m[1] as TypeKind;
    const name = m[2];
    // `record Animal(string Name, int Legs);` - positional record parameters
    const after = src.slice(m.index + m[0].length);
    const positional = after.match(/^\s*\(([^)]*)\)/);
    const open = src.indexOf("{", m.index + m[0].length);
    // The declaration ends at whichever comes first: its body, or the `;` of a
    // bodyless record. Anything after that belongs to the NEXT declaration.
    const semi = src.indexOf(";", m.index + m[0].length);
    const declEnd =
      open === -1
        ? (semi === -1 ? src.length : semi)
        : (semi === -1 ? open : Math.min(open, semi));
    const bases = baseList(src.slice(m.index + m[0].length, declEnd));
    let members: MemberSymbol[] = [];
    if (positional) {
      members = positional[1].split(",").map((p) => p.trim()).filter(Boolean).map((p) => {
        const parts = p.split(/\s+/);
        const nm = parts[parts.length - 1];
        const t = bareType(parts.slice(0, -1).join(" ")) || "object";
        return { name: nm, kind: "property" as MemberKind, type: t, isStatic: false, detail: `${t} ${nm}` };
      }).filter((p) => isIdent(p.name));
    }
    if (open !== -1) {
      const close = matchBrace(src, open);
      const body = close === -1 ? src.slice(open + 1) : src.slice(open + 1, close);
      // A brace-body only belongs to this declaration when nothing else opened first.
      const between = src.slice(m.index + m[0].length, open);
      if (!/[;}]/.test(between)) {
        claimed.push([open, close === -1 ? src.length : close]);
        if (kind === "enum") {
          members = body.split(",").map((s) => s.split("=")[0].trim()).filter(isIdent)
            .map((nm) => ({ name: nm, kind: "enumMember" as MemberKind, isStatic: true, detail: `${name}.${nm}` }));
        } else {
          members = members.concat(scanMembers(body));
        }
      }
    }
    if (isIdent(name) && !types.some((t) => t.name === name)) types.push({ name, kind, members, bases });
  }

  // Locals: `var x = new Dog()`, `Dog d = ...`, `Dog d;` anywhere.
  const seenVar = new Set<string>();
  const varRe = /\bvar\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*new\s+([A-Za-z_][A-Za-z0-9_<>,.\[\]]*)/g;
  while ((m = varRe.exec(src)) !== null) {
    if (!seenVar.has(m[1])) { seenVar.add(m[1]); vars.push({ name: m[1], type: bareType(m[2]) }); }
  }
  const typedRe = /(?:^|[;{}()]|\bfor\s*\(|\bforeach\s*\()\s*([A-Za-z_][A-Za-z0-9_<>,.\[\]\?]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:=[^=]|;|\bin\b)/g;
  while ((m = typedRe.exec(src)) !== null) {
    const t = bareType(m[1]); const name = m[2];
    if (!isIdent(t) || NOT_A_DECLARATION.has(t) || MODIFIERS.has(t) || TYPE_KEYWORDS.has(t as TypeKind)) continue;
    if (NOT_A_DECLARATION.has(name) || MODIFIERS.has(name)) continue;
    if (t === "var") { if (!seenVar.has(name)) { seenVar.add(name); vars.push({ name }); } continue; }
    if (!seenVar.has(name)) { seenVar.add(name); vars.push({ name, type: t }); }
  }
  // Fields of declared types are also plain identifiers in scope.
  for (const t of types) {
    for (const mem of t.members) {
      if (mem.kind === "field" && !seenVar.has(mem.name)) {
        seenVar.add(mem.name); vars.push({ name: mem.name, type: mem.type });
      }
    }
  }
  return { types, vars };
}

// --- member-aware completion ------------------------------------------------

/** The receiver expression immediately left of a trailing `.`, or null.
 *  `"  var x = dog."` -> "dog";  `"Dog."` -> "Dog";  `"x.X."` -> null (chained). */
export function receiverBefore(lineUpToCursor: string): string | null {
  const m = lineUpToCursor.match(/([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*[A-Za-z0-9_]*$/);
  if (!m) return null;
  const before = lineUpToCursor.slice(0, lineUpToCursor.lastIndexOf(m[1]));
  if (/[.\]]\s*$/.test(before)) return null; // chained access - out of scope
  return m[1];
}

/** Members to offer after `receiver.`, or null when the receiver is unknown -
 *  null means "say nothing", which is the honest answer for a heuristic. */
export function membersOf(symbols: CSharpSymbols, receiver: string): MemberSymbol[] | null {
  if (!receiver) return null;
  const asType = symbols.types.find((t) => t.name === receiver);
  if (asType) {
    // A type name on the left reads static members (and every enum member).
    const statics = asType.members.filter((mm) => mm.isStatic || mm.kind === "enumMember");
    return statics.length ? statics : null;
  }
  const v = symbols.vars.find((x) => x.name === receiver);
  if (!v || !v.type) return null;
  const t = symbols.types.find((x) => x.name === v.type);
  if (!t) return null;
  const instance = t.members.filter((mm) => !mm.isStatic && mm.kind !== "enumMember");
  return instance.length ? instance : null;
}
