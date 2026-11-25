/**
 * Predicates: one rule over strings, however it is written. A regular
 * expression (a literal, or one built with `new RegExp` from a string or a
 * template), a chain of `startsWith`, `endsWith`, `includes` and `===` tests
 * over one string, and a literal set tested for membership are each a
 * predicate; two of them are one rule when they accept the same strings.
 *
 * Equality of two regular languages is decidable but costly; the reading
 * uses the cheap method instead. Each predicate is run over a probe set:
 * strings drawn from each regular expression and each chain (what it
 * accepts, and near misses of those), and the project's own literals that
 * share an atom with it. Two predicates with the same acceptance vector are
 * one rule; one whose accepted strings are a strict part of the other's is
 * a derivation of it, recorded as such and never as drift.
 *
 * Candidates are found through atoms, the literal words a predicate is made
 * of (`jsonl`, `jsonseq` in `\.[0-9a-f]{8}\.(jsonl|jsonseq)`): two
 * predicates are compared only when the atoms they share are rare enough to
 * be one fact (rarity.ts). A bare `[0-9a-f]{8}` holds no atom, so it never
 * groups by itself: the shard token and a record id's suffix are the same
 * pattern with different referents, and only the words around it say which.
 *
 * Pure: mirrors.ts collects the sites from its parse.
 */

import type { Rarity } from "./rarity.ts";

/* ------------------------------------------------------- regular syntax */

type Node =
  | { t: "seq"; items: Node[] }
  | { t: "alt"; options: Node[] }
  | { t: "char"; c: string }
  | { t: "class"; chars: string[]; negated: boolean }
  | { t: "any" }
  | { t: "repeat"; node: Node; min: number; max: number }
  | { t: "empty" };

const CLASS_ESCAPES: Record<string, string[]> = {
  d: ["0", "5", "9"],
  w: ["a", "Z", "_", "7"],
  s: [" "],
  D: ["a"],
  W: ["-"],
  S: ["a"],
};

/** A regular expression's syntax, as far as drawing strings from it needs; undefined for a back reference or anything else it cannot draw from. */
export function parseRegex(source: string): Node | undefined {
  let i = 0;
  const fail = (): never => {
    throw new Error("unparsed");
  };
  const alt = (): Node => {
    const options = [seq()];
    while (source[i] === "|") {
      i++;
      options.push(seq());
    }
    return options.length === 1 ? options[0]! : { t: "alt", options };
  };
  const seq = (): Node => {
    const items: Node[] = [];
    while (i < source.length && source[i] !== "|" && source[i] !== ")") {
      let atom = term();
      if (atom === undefined) continue;
      const q = quantifier();
      if (q !== undefined) atom = { t: "repeat", node: atom, ...q };
      items.push(atom);
    }
    return { t: "seq", items };
  };
  const quantifier = (): { min: number; max: number } | undefined => {
    const c = source[i];
    let q: { min: number; max: number } | undefined;
    if (c === "*") q = { min: 0, max: Infinity };
    else if (c === "+") q = { min: 1, max: Infinity };
    else if (c === "?") q = { min: 0, max: 1 };
    else if (c === "{") {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(source.slice(i));
      if (m === null) return undefined;
      i += m[0].length - 1;
      q = { min: Number(m[1]), max: m[2] === undefined ? Number(m[1]) : m[3] === "" ? Infinity : Number(m[3]) };
    }
    if (q === undefined) return undefined;
    i++;
    if (source[i] === "?") i++;
    return q;
  };
  const escape = (inClass: boolean): Node | undefined => {
    const c = source[i++];
    if (c === undefined) return fail();
    if (CLASS_ESCAPES[c] !== undefined) return { t: "class", chars: CLASS_ESCAPES[c]!, negated: false };
    if (c === "b" || c === "B") return inClass ? { t: "char", c: "\b" } : undefined;
    if (/[1-9]/.test(c) || c === "k") return fail();
    if (c === "n") return { t: "char", c: "\n" };
    if (c === "t") return { t: "char", c: "\t" };
    if (c === "u") {
      const m = /^[0-9a-fA-F]{4}/.exec(source.slice(i));
      if (m === null) return fail();
      i += 4;
      return { t: "char", c: String.fromCharCode(parseInt(m[0], 16)) };
    }
    if (c === "x") {
      const m = /^[0-9a-fA-F]{2}/.exec(source.slice(i));
      if (m === null) return fail();
      i += 2;
      return { t: "char", c: String.fromCharCode(parseInt(m[0], 16)) };
    }
    return { t: "char", c };
  };
  const charClass = (): Node => {
    i++;
    const negated = source[i] === "^";
    if (negated) i++;
    const chars: string[] = [];
    let first = true;
    while (i < source.length && (source[i] !== "]" || first)) {
      first = false;
      let lo: string;
      if (source[i] === "\\") {
        i++;
        const e = escape(true);
        if (e === undefined || e.t !== "char") {
          if (e !== undefined && e.t === "class") chars.push(...e.chars);
          continue;
        }
        lo = e.c;
      } else lo = source[i++]!;
      if (source[i] === "-" && source[i + 1] !== "]" && source[i + 1] !== undefined) {
        i++;
        const hi = source[i] === "\\" ? source[(i += 2) - 1]! : source[i++]!;
        const a = lo.charCodeAt(0);
        const b = hi.charCodeAt(0);
        if (b < a) return fail();
        chars.push(lo, hi, String.fromCharCode(Math.floor((a + b) / 2)));
      } else chars.push(lo);
    }
    if (source[i] !== "]") return fail();
    i++;
    return { t: "class", chars: chars.length === 0 ? ["a"] : chars, negated };
  };
  const term = (): Node | undefined => {
    const c = source[i];
    if (c === "^" || c === "$") {
      i++;
      return undefined;
    }
    if (c === "\\") {
      i++;
      return escape(false);
    }
    if (c === "[") return charClass();
    if (c === ".") {
      i++;
      return { t: "any" };
    }
    if (c === "(") {
      i++;
      if (source[i] === "?") {
        const m = /^\?(?::|<[A-Za-z_]\w*>)/.exec(source.slice(i));
        if (m !== null) i += m[0].length;
        else {
          // A lookaround says where, not what: drawing ignores it.
          let depth = 1;
          while (i < source.length && depth > 0) {
            if (source[i] === "\\") i++;
            else if (source[i] === "(") depth++;
            else if (source[i] === ")") depth--;
            i++;
          }
          return undefined;
        }
      }
      const inner = alt();
      if (source[i] !== ")") return fail();
      i++;
      return inner;
    }
    if (c === "*" || c === "+" || c === "?" || c === ")") return fail();
    i++;
    return { t: "char", c: c! };
  };
  try {
    const node = alt();
    if (i !== source.length) return undefined;
    return node;
  } catch {
    return undefined;
  }
}

/** The literal words a pattern is made of: runs of characters it writes outright, outside classes and repetition. */
export function regexAtoms(node: Node): string[] {
  const out: string[] = [];
  const walk = (n: Node): void => {
    if (n.t === "seq") {
      let run = "";
      for (const item of n.items) {
        if (item.t === "char") run += item.c;
        else {
          if (run !== "") out.push(run);
          run = "";
          walk(item);
        }
      }
      if (run !== "") out.push(run);
    } else if (n.t === "alt") n.options.forEach(walk);
    else if (n.t === "repeat" && n.min >= 1) walk(n.node);
    else if (n.t === "char") out.push(n.c);
  };
  walk(node);
  return wordsIn(out);
}

/** The words a predicate's literal parts hold, each once: `.jsonl` and `jsonl` are one atom, whichever form wrote it. */
export function wordsIn(parts: readonly string[]): string[] {
  return [...new Set(parts.flatMap((p) => p.match(/[A-Za-z][A-Za-z0-9_]+/g) ?? []))];
}

/** A small deterministic generator, so a reading draws the same strings every time. */
function chooser(seed: number): (n: number) => number {
  let x = seed * 2654435761 + 1;
  return (n) => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return n <= 1 ? 0 : x % n;
  };
}

/** Strings the pattern accepts, drawn from its syntax: every alternative, the fewest repetitions and a few more. */
export function drawn(node: Node, count = 8): string[] {
  const out = new Set<string>();
  for (let k = 0; k < count; k++) {
    const pick = chooser(k + 1);
    const gen = (n: Node): string => {
      switch (n.t) {
        case "seq":
          return n.items.map(gen).join("");
        case "alt":
          return gen(n.options[(k + pick(n.options.length)) % n.options.length]!);
        case "char":
          return n.c;
        case "class":
          return n.negated ? "~" : n.chars[pick(n.chars.length)]!;
        case "any":
          return "xq"[pick(2)]!;
        case "repeat": {
          const extra = Math.min(n.max - n.min, k % 3);
          return Array.from({ length: n.min + extra }, () => gen(n.node)).join("");
        }
        case "empty":
          return "";
      }
    };
    out.add(gen(node));
  }
  return [...out];
}

/** Near misses of accepted strings: one character gone at either end, a character added at either end, one changed in the middle. */
export function nearMisses(samples: readonly string[]): string[] {
  const out: string[] = [];
  for (const s of samples) {
    out.push(s.slice(1), s.slice(0, -1), `${s}x`, `Z${s}`, `${s}.x`);
    if (s.length > 2) out.push(`${s.slice(0, s.length >> 1)}~${s.slice((s.length >> 1) + 1)}`);
  }
  return out;
}

/* --------------------------------------------------------- predicates */

export type PredicateForm = "regex" | "chain" | "set";

/** One leaf of a chain: a string method tested against a literal, or an equality. */
export interface ChainLeaf {
  op: "startsWith" | "endsWith" | "includes" | "equals";
  value: string;
  negated: boolean;
}

/** A chain: leaves joined by one operator, `||` or `&&`, over one receiver. */
export interface Chain {
  join: "or" | "and";
  leaves: ChainLeaf[];
}

/** One predicate where it is written. */
export interface PredicateSite {
  file: string;
  line: number;
  form: PredicateForm;
  /** The constant or function the predicate is bound to, when one names it. */
  bound?: string;
  /** For a regex: its source, a substitution in a template written as `.*`; for a chain, how it reads; for a set, its members joined. */
  text: string;
  flags?: string;
  chain?: Chain;
  members?: string[];
  /** Whether the source was a template with substitutions: a rule built around a runtime value. */
  templated?: boolean;
  /** Written in a test: a copy that can import its source, never a rule's only production site. */
  test?: boolean;
  /** Bound to a constant at the module's top level, and whether it is exported. */
  topLevel?: boolean;
  exported?: boolean;
}

/** A predicate made runnable, with what it is made of and what it accepts by construction. */
export interface Predicate {
  site: PredicateSite;
  accepts: (s: string) => boolean;
  /** The same rule read as a search with the ^, $ and boundaries at its ends dropped: an anchored match and a search for its core are one rule. */
  core?: (s: string) => boolean;
  atoms: string[];
  samples: string[];
}

/** The ^, $, boundaries and wildcards at either end of a pattern, dropped: what it looks for, wherever it is. */
function coreSource(source: string): string {
  return source.replace(/^(?:\^|\\b|\.\*|\(\?:\.\*\))+/, "").replace(/(?:\$|\\b|\.\*)+$/, "");
}

function leafAccepts(leaf: ChainLeaf, s: string): boolean {
  const hit = leaf.op === "startsWith" ? s.startsWith(leaf.value) : leaf.op === "endsWith" ? s.endsWith(leaf.value) : leaf.op === "includes" ? s.includes(leaf.value) : s === leaf.value;
  return leaf.negated ? !hit : hit;
}

function leafSamples(leaf: ChainLeaf): string[] {
  if (leaf.negated) return [];
  if (leaf.op === "startsWith") return [leaf.value, `${leaf.value}ab`];
  if (leaf.op === "endsWith") return [leaf.value, `ab${leaf.value}`];
  if (leaf.op === "includes") return [leaf.value, `a${leaf.value}b`];
  return [leaf.value];
}

/** A site made runnable; undefined for a pattern the reading cannot run or draw from. */
export function predicateOf(site: PredicateSite): Predicate | undefined {
  if (site.form === "regex") {
    const node = parseRegex(site.text);
    if (node === undefined) return undefined;
    let re: RegExp;
    let core: RegExp;
    try {
      const flags = (site.flags ?? "").replace(/[gy]/g, "");
      re = new RegExp(site.text, flags);
      core = new RegExp(coreSource(site.text), flags);
    } catch {
      return undefined;
    }
    const samples = drawn(node);
    return { site, accepts: (s) => re.test(s), core: (s) => core.test(s), atoms: regexAtoms(node), samples };
  }
  if (site.form === "chain" && site.chain !== undefined) {
    const { join, leaves } = site.chain;
    const accepts = (s: string): boolean => (join === "or" ? leaves.some((l) => leafAccepts(l, s)) : leaves.every((l) => leafAccepts(l, s)));
    const samples = join === "or" ? leaves.flatMap(leafSamples) : [leaves.filter((l) => !l.negated).map((l) => l.value).join("")];
    return { site, accepts, atoms: wordsIn(leaves.map((l) => l.value)), samples };
  }
  if (site.form === "set" && site.members !== undefined) {
    const members = new Set(site.members);
    return { site, accepts: (s) => members.has(s), atoms: wordsIn(site.members), samples: site.members };
  }
  return undefined;
}

/** How two predicates relate over their probes: one rule, one a strict part of the other, or neither. */
export type Relation = "equal" | "a-in-b" | "b-in-a" | "apart";

export function relate(a: Predicate, b: Predicate, extra: readonly string[] = []): Relation {
  const accepted = [...a.samples, ...b.samples];
  const probes = [...new Set([...accepted, ...nearMisses(accepted), ...extra])];
  let aOnly = 0;
  let bOnly = 0;
  let both = 0;
  let coreDiffers = false;
  for (const p of probes) {
    const x = a.accepts(p);
    const y = b.accepts(p);
    if (x && y) both++;
    else if (x) aOnly++;
    else if (y) bOnly++;
    if (a.core !== undefined && b.core !== undefined && a.core(p) !== b.core(p)) coreDiffers = true;
  }
  if (both === 0) return "apart";
  if (aOnly === 0 && bOnly === 0) return "equal";
  // Two patterns that look for the same thing, one anchored and one a search, are one rule.
  if (a.core !== undefined && b.core !== undefined && !coreDiffers) return "equal";
  if (aOnly === 0) return "a-in-b";
  if (bOnly === 0) return "b-in-a";
  return "apart";
}

/** A rule written at two or more sites: its center and the sites equal to it, and the derivations found beside it. */
export interface RuleGroup {
  center: PredicateSite;
  sites: PredicateSite[];
  /** The atoms the sites share, and what they say together in bits. */
  atoms: string[];
  bits: number;
}

export interface Derivation {
  part: PredicateSite;
  whole: PredicateSite;
  atoms: string[];
  bits: number;
}

/**
 * The rules written at more than one site, and the derivations: candidates
 * through shared rare atoms, then related over probes. A group forms around
 * a center, each member equal to the center itself, so A like B and B like C
 * never chain A and C into one group without A like C; a site joins one
 * group at most.
 */
export function rulesOf(sites: readonly PredicateSite[], rarity: Rarity, minBits: number, literals: readonly string[] = []): { rules: RuleGroup[]; derivations: Derivation[] } {
  const preds = sites.map(predicateOf).filter((p): p is Predicate => p !== undefined && p.atoms.length > 0);
  const byAtom = new Map<string, number[]>();
  preds.forEach((p, i) => {
    for (const a of new Set(p.atoms)) {
      const at = byAtom.get(a);
      if (at === undefined) byAtom.set(a, [i]);
      else at.push(i);
    }
  });
  // Literals that hold an atom are probes too: the project's own strings are what its rules are run on.
  const literalsByAtom = new Map<string, string[]>();
  for (const l of literals) {
    if (l.length > 200) continue;
    for (const a of wordsIn([l])) {
      if (!byAtom.has(a)) continue;
      const at = literalsByAtom.get(a) ?? [];
      if (at.length < 20) at.push(l);
      literalsByAtom.set(a, at);
    }
  }
  const pairs = new Map<string, { i: number; j: number; atoms: string[] }>();
  for (const [atom, at] of byAtom) {
    if (at.length > 50) continue;
    for (let x = 0; x < at.length; x++) {
      for (let y = x + 1; y < at.length; y++) {
        const i = at[x]!;
        const j = at[y]!;
        if (preds[i]!.site.file === preds[j]!.site.file) continue;
        const key = `${i}:${j}`;
        const p = pairs.get(key) ?? { i, j, atoms: [] };
        p.atoms.push(atom);
        pairs.set(key, p);
      }
    }
  }
  const relations: { i: number; j: number; rel: Relation; atoms: string[]; bits: number }[] = [];
  for (const { i, j, atoms } of pairs.values()) {
    const bits = rarity.shared(atoms);
    if (bits < minBits) continue;
    const a = preds[i]!;
    const b = preds[j]!;
    // Two regular expressions written the same are one value, which the literal pass already counts.
    if (a.site.form === "regex" && b.site.form === "regex" && a.site.text === b.site.text && a.site.flags === b.site.flags) continue;
    // Two sets are compared as sets by the mirror reading's matching.
    if (a.site.form === "set" && b.site.form === "set") continue;
    const extra = atoms.flatMap((t) => literalsByAtom.get(t) ?? []);
    const rel = relate(a, b, extra);
    if (rel !== "apart") relations.push({ i, j, rel, atoms, bits });
  }
  // Centers: the site with the most equal neighbors first; each other site joins the first center it equals.
  const equals = new Map<number, Set<number>>();
  for (const r of relations) {
    if (r.rel !== "equal") continue;
    equals.set(r.i, (equals.get(r.i) ?? new Set()).add(r.j));
    equals.set(r.j, (equals.get(r.j) ?? new Set()).add(r.i));
  }
  const placed = new Set<number>();
  const rules: RuleGroup[] = [];
  const order = [...equals.keys()].sort((x, y) => equals.get(y)!.size - equals.get(x)!.size || x - y);
  for (const c of order) {
    if (placed.has(c)) continue;
    const members = [...equals.get(c)!].filter((m) => !placed.has(m) && preds[m]!.site.file !== preds[c]!.site.file);
    if (members.length === 0) continue;
    placed.add(c);
    for (const m of members) placed.add(m);
    const atoms = [...new Set(relations.filter((r) => r.rel === "equal" && ((r.i === c && members.includes(r.j)) || (r.j === c && members.includes(r.i)))).flatMap((r) => r.atoms))];
    rules.push({ center: preds[c]!.site, sites: [preds[c]!.site, ...members.map((m) => preds[m]!.site)], atoms, bits: rarity.shared(atoms) });
  }
  const derivations: Derivation[] = relations
    .filter((r) => r.rel !== "equal")
    .map((r) => (r.rel === "a-in-b" ? { part: preds[r.i]!.site, whole: preds[r.j]!.site, atoms: r.atoms, bits: r.bits } : { part: preds[r.j]!.site, whole: preds[r.i]!.site, atoms: r.atoms, bits: r.bits }));
  return { rules, derivations };
}
