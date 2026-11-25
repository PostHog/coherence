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
  | { t: "class"; ranges: [number, number][]; kinds: string[]; negated: boolean; samples: string[] }
  | { t: "any" }
  | { t: "assert"; a: "bol" | "eol" | "wb" | "nwb" }
  | { t: "repeat"; node: Node; min: number; max: number }
  | { t: "empty" };

/** The class escapes, by what they match and a few members to draw from. */
const CLASS_KINDS: Record<string, { test: (c: string) => boolean; samples: string[] }> = {
  d: { test: (c) => c >= "0" && c <= "9", samples: ["0", "5", "9"] },
  w: { test: (c) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_", samples: ["a", "Z", "_", "7"] },
  s: { test: (c) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v", samples: [" "] },
  D: { test: (c) => !(c >= "0" && c <= "9"), samples: ["a"] },
  W: { test: (c) => !CLASS_KINDS["w"]!.test(c), samples: ["-"] },
  S: { test: (c) => !CLASS_KINDS["s"]!.test(c), samples: ["a"] },
};

/** A regular expression's syntax, as far as drawing strings from it and running it needs; undefined for a back reference or anything else it cannot. */
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
      if (q !== undefined) {
        if (atom.t === "assert") return fail();
        atom = { t: "repeat", node: atom, ...q };
      }
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
  const escape = (inClass: boolean): Node => {
    const c = source[i++];
    if (c === undefined) return fail();
    const kind = CLASS_KINDS[c];
    if (kind !== undefined) return { t: "class", ranges: [], kinds: [c], negated: false, samples: kind.samples };
    if (c === "b") return inClass ? { t: "char", c: "\b" } : { t: "assert", a: "wb" };
    if (c === "B") return inClass ? fail() : { t: "assert", a: "nwb" };
    if (/[1-9]/.test(c) || c === "k" || c === "p" || c === "P") return fail();
    if (c === "n") return { t: "char", c: "\n" };
    if (c === "t") return { t: "char", c: "\t" };
    if (c === "r") return { t: "char", c: "\r" };
    if (c === "0") return { t: "char", c: "\0" };
    if (c === "u" || c === "x") {
      const m = (c === "u" ? /^[0-9a-fA-F]{4}/ : /^[0-9a-fA-F]{2}/).exec(source.slice(i));
      if (m === null) return fail();
      i += m[0].length;
      return { t: "char", c: String.fromCharCode(parseInt(m[0], 16)) };
    }
    return { t: "char", c };
  };
  const charClass = (): Node => {
    i++;
    const negated = source[i] === "^";
    if (negated) i++;
    const ranges: [number, number][] = [];
    const kinds: string[] = [];
    const samples: string[] = [];
    while (i < source.length && source[i] !== "]") {
      let lo: string;
      if (source[i] === "\\") {
        i++;
        const e = escape(true);
        if (e.t === "class") {
          kinds.push(...e.kinds);
          samples.push(...e.samples);
          continue;
        }
        if (e.t !== "char") return fail();
        lo = e.c;
      } else lo = source[i++]!;
      if (source[i] === "-" && source[i + 1] !== "]" && source[i + 1] !== undefined) {
        i++;
        let hi: string;
        if (source[i] === "\\") {
          i++;
          const e = escape(true);
          if (e.t !== "char") return fail();
          hi = e.c;
        } else hi = source[i++]!;
        const a = lo.charCodeAt(0);
        const b = hi.charCodeAt(0);
        if (b < a) return fail();
        ranges.push([a, b]);
        samples.push(lo, hi, String.fromCharCode(Math.floor((a + b) / 2)));
      } else {
        ranges.push([lo.charCodeAt(0), lo.charCodeAt(0)]);
        samples.push(lo);
      }
    }
    if (source[i] !== "]") return fail();
    i++;
    return { t: "class", ranges, kinds, negated, samples: samples.length === 0 ? ["a"] : samples };
  };
  const term = (): Node | undefined => {
    const c = source[i];
    if (c === "^" || c === "$") {
      i++;
      return { t: "assert", a: c === "^" ? "bol" : "eol" };
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
        else return fail();
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

/* ------------------------------------------------------------- matching */

type State =
  | { k: "char"; test: (c: string) => boolean; out: number }
  | { k: "split"; outs: number[] }
  | { k: "assert"; a: "bol" | "eol" | "wb" | "nwb"; out: number }
  | { k: "match" };

/** The most states a pattern compiles to before it is refused: a bound on the work a match does. */
const STATE_LIMIT = 4000;

/**
 * A pattern compiled to a Thompson automaton, run over a string in time
 * linear in the string and the pattern: no backtracking, so no pattern a
 * project writes, or an agent is about to write, can make a hook run long.
 */
export interface Matcher {
  test: (s: string) => boolean;
}

export function matcherOf(node: Node, flags = ""): Matcher | undefined {
  const fold = flags.includes("i");
  const states: State[] = [{ k: "match" }];
  const add = (st: State): number => {
    if (states.length >= STATE_LIMIT) throw new Error("too large");
    states.push(st);
    return states.length - 1;
  };
  const same = (a: string, b: string): boolean => a === b || (fold && a.toLowerCase() === b.toLowerCase());
  const classTest = (n: Extract<Node, { t: "class" }>): ((c: string) => boolean) => (c) => {
    const code = c.charCodeAt(0);
    const variants = fold ? [code, c.toLowerCase().charCodeAt(0), c.toUpperCase().charCodeAt(0)] : [code];
    const hit = variants.some((v) => n.ranges.some(([lo, hi]) => v >= lo && v <= hi)) || n.kinds.some((k) => CLASS_KINDS[k]!.test(c));
    return n.negated ? !hit : hit;
  };
  // Built backwards: each node is compiled given the state it continues to.
  const build = (n: Node, next: number): number => {
    switch (n.t) {
      case "seq": {
        let at = next;
        for (let k = n.items.length - 1; k >= 0; k--) at = build(n.items[k]!, at);
        return at;
      }
      case "alt":
        return add({ k: "split", outs: n.options.map((o) => build(o, next)) });
      case "char":
        return add({ k: "char", test: (c) => same(c, n.c), out: next });
      case "class":
        return add({ k: "char", test: classTest(n), out: next });
      case "any":
        return add({ k: "char", test: (c) => c !== "\n" && c !== "\r", out: next });
      case "assert":
        return add({ k: "assert", a: n.a, out: next });
      case "empty":
        return next;
      case "repeat": {
        let at = next;
        if (n.max === Infinity) {
          const loop = add({ k: "split", outs: [] });
          const body = build(n.node, loop);
          (states[loop] as Extract<State, { k: "split" }>).outs = [body, next];
          at = loop;
        } else {
          for (let k = 0; k < n.max - n.min; k++) at = add({ k: "split", outs: [build(n.node, at), next] });
        }
        for (let k = 0; k < n.min; k++) at = build(n.node, at);
        return at;
      }
    }
  };
  let start: number;
  try {
    start = build(node, 0);
  } catch {
    return undefined;
  }
  const word = (c: string | undefined): boolean => c !== undefined && CLASS_KINDS["w"]!.test(c);
  return {
    test: (s: string): boolean => {
      // Every position may start a match: RegExp.prototype.test's search.
      let current = new Set<number>();
      const close = (into: Set<number>, from: number, pos: number): void => {
        const stack = [from];
        while (stack.length > 0) {
          const id = stack.pop()!;
          if (into.has(id)) continue;
          into.add(id);
          const st = states[id]!;
          if (st.k === "split") stack.push(...st.outs);
          else if (st.k === "assert") {
            const ok = st.a === "bol" ? pos === 0 : st.a === "eol" ? pos === s.length : st.a === "wb" ? word(s[pos - 1]) !== word(s[pos]) : word(s[pos - 1]) === word(s[pos]);
            if (ok) stack.push(st.out);
          }
        }
      };
      for (let pos = 0; pos <= s.length; pos++) {
        close(current, start, pos);
        if (current.has(0)) return true;
        if (pos === s.length) break;
        const next = new Set<number>();
        for (const id of current) {
          const st = states[id]!;
          if (st.k === "char" && st.test(s[pos]!)) close(next, st.out, pos + 1);
        }
        current = next;
      }
      return current.has(0);
    },
  };
}

/** A pattern with the anchors, boundaries and wildcards at its ends dropped: what it looks for, wherever it is. */
function coreOf(node: Node): Node {
  if (node.t !== "seq") return node;
  const items = [...node.items];
  const loose = (n: Node | undefined): boolean => n !== undefined && (n.t === "assert" || (n.t === "repeat" && n.min === 0 && n.max === Infinity && n.node.t === "any"));
  while (loose(items[0])) items.shift();
  while (loose(items[items.length - 1])) items.pop();
  return { t: "seq", items };
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
          return n.negated ? "~" : n.samples[pick(n.samples.length)]!;
        case "assert":
          return "";
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
    // Run by the reading's own automaton, never compiled as a RegExp: a pattern is the project's text, or what an agent is about to write.
    const flags = site.flags ?? "";
    const re = matcherOf(node, flags);
    const core = matcherOf(coreOf(node), flags);
    if (re === undefined || core === undefined) return undefined;
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
