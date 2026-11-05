/**
 * The rank of the undeclared entrances: the order in which declaring them
 * pays most, so a first adoption declares the few that matter and leaves the
 * rest undeclared, the normal state of a detected entrance and never a spec
 * gap (only a declared entrance can be one).
 *
 * Five signals, each one Coherence computes without a language server, in
 * the order they rank by:
 *   skips        a grouped entrance stands for its siblings and it is not
 *                among them: a declared entrance whose handler is what they
 *                go through (every API route calling parseRequest) covers
 *                more than one detected entrance by that rule, and this one,
 *                detected by the same rule under the folder holding them
 *                all, does not go through it. Of a family declared with one
 *                bullet, the members that skip its handler are the ones a
 *                reader most needs to see.
 *   outside      the trust it carries in comes from off the machine: the
 *                rule that detected it is one a request from the network
 *                reaches (its plugin marks the rule remote). An undeclared
 *                entrance declares no level, so this is the only trust there
 *                is to read, and its trust itself stays unknown.
 *   writes       its handler writes: an HTTP POST, PUT, PATCH or DELETE, a
 *                route's action, a server action, or a mutation or action
 *                function, as the detected shape names it (its symbol, or the
 *                method its rule read and wrote into why).
 *   protects     the invariants whose chokepoint protects a thing the
 *                handler's file reaches by its static imports.
 *   components   how many components the handler's file reaches by its
 *                static imports, its own included.
 * Ties keep file order. The imports are read by the plain scan the economy
 * reads (economy/source.ts), each file once, so ranking a whole project's
 * surface costs one read of what its handlers import.
 *
 * Node-only; the browser bundle never imports it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EntranceCandidate } from "../../adapters/entrance-candidates.ts";
import type { Language } from "../../adapters/index.ts";
import { languageOfFile } from "../../adapters/language-files.ts";
import { declarationsOf, importsOf } from "../../economy/source.ts";
import { componentHolding, type SpecModel } from "../../spec/model.ts";
import { chokepointTargets } from "./component-interfaces.ts";
import { ruleIsRemote } from "./entrance-coverage.ts";

/** How many of the ranked undeclared entrances scaffold entrances proposes bullets for, unless --all or --first says otherwise. */
export const FIRST_RANKED = 15;

/** One undeclared entrance with what ranks it. */
export interface RankedEntrance {
  candidate: EntranceCandidate;
  /** Its rule is one a request from off the machine reaches. */
  outside: boolean;
  /** Its handler writes, as the detected shape names it. */
  writes: boolean;
  /** The invariants (component and name) whose chokepoint protects a thing its handler's file reaches by import. */
  protects: { component: string; name: string }[];
  /** The components its handler's file reaches by import, its own first. */
  components: string[];
  /** The grouped entrance whose family it sits in and whose handler it does not go through, when there is one. */
  skips?: SkippedGroup;
}

/** A grouped entrance a detected entrance skips: its name, its component, the handler its family goes through, and how many go through it. */
export interface SkippedGroup {
  component: string;
  name: string;
  handler: string;
  members: number;
  /** The deepest folder holding every member. */
  folder: string;
}

/** The deepest folder holding every one of the files, "." when they share none. */
function commonFolder(files: readonly string[]): string {
  const parts = files.map((f) => f.split("/").slice(0, -1));
  const first = parts[0] ?? [];
  let depth = 0;
  while (depth < first.length && parts.every((p) => p[depth] === first[depth])) depth += 1;
  return depth === 0 ? "." : first.slice(0, depth).join("/");
}

/**
 * The families declared with one bullet: each declared entrance whose handler
 * is a symbol no entrance is detected as but more than one detected entrance
 * goes through (its `through`), with the rules and folder its members share.
 */
export function familiesOf(model: Pick<SpecModel, "components">, detected: readonly EntranceCandidate[]): (SkippedGroup & { rules: Set<string> })[] {
  const symbols = new Set(detected.map((c) => c.symbol).filter((x) => x !== ""));
  const out: (SkippedGroup & { rules: Set<string> })[] = [];
  for (const component of model.components) {
    for (const e of component.entrances) {
      const handler = /^([A-Za-z_$][\w$]*)(?:\s+in\s+\S+)?$/.exec(e.handler?.trim() ?? "")?.[1];
      if (handler === undefined || symbols.has(handler)) continue;
      const members = detected.filter((c) => c.through?.includes(handler) === true);
      if (members.length < 2) continue;
      out.push({ component: component.folder, name: e.name, handler, members: members.length, folder: commonFolder(members.map((m) => m.file)), rules: new Set(members.map((m) => m.rule)) });
    }
  }
  return out.sort((a, b) => b.members - a.members || a.name.localeCompare(b.name));
}

/** The family a detected entrance sits in and skips: detected by a rule its members share, under their folder, and not going through its handler. The largest such family. */
export function skippedBy(c: EntranceCandidate, families: readonly (SkippedGroup & { rules: Set<string> })[]): SkippedGroup | undefined {
  const family = families.find((f) => f.rules.has(c.rule) && (f.folder === "." || c.file.startsWith(`${f.folder}/`)) && c.through?.includes(f.handler) !== true);
  if (family === undefined) return undefined;
  const { rules: _rules, ...group } = family;
  return group;
}

/** The methods and builders that write, as a symbol names them. */
const WRITING_SYMBOLS = new Set(["POST", "PUT", "PATCH", "DELETE", "action"]);
/** A writing method as a rule's why writes it: `@app.post(`, `#[delete(`, `.put(`, `post(handler)`, or `POST /path`. */
const WRITING_CALL = /(?:^|[^A-Za-z0-9_])(?:post|put|patch|delete)\s*\(/i;
const WRITING_PATTERN = /(?:^|[\s"'`])(?:POST|PUT|PATCH|DELETE)\s+\//;
/** A Convex builder that writes: its why names the builder it was created by. */
const WRITING_BUILDER = /\b(?:internalMutation|mutation|internalAction|action)\b/;

/** Whether a detected entrance's handler writes, as its detected shape names it. */
export function writesOf(c: Pick<EntranceCandidate, "symbol" | "rule" | "why">): boolean {
  if (WRITING_SYMBOLS.has(c.symbol)) return true;
  if (c.rule === "server action") return true;
  if (c.rule === "Convex function") return WRITING_BUILDER.test(c.why);
  return WRITING_CALL.test(c.why) || WRITING_PATTERN.test(c.why);
}

/** The order: one that skips its family's handler first, then outside, then writing, then the most protected things reached, then the most components reached; ties keep the order given. */
export function rankOrder(a: RankedEntrance, b: RankedEntrance): number {
  return Number(b.skips !== undefined) - Number(a.skips !== undefined) || Number(b.outside) - Number(a.outside) || Number(b.writes) - Number(a.writes) || b.protects.length - a.protects.length || b.components.length - a.components.length;
}

/** The files a file reaches by its static imports, itself included, each file's imports read once per ranking. */
function reachOf(root: string, start: string, languages: readonly Language[], imports: Map<string, string[]>): Set<string> {
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const file = queue.shift()!;
    let next = imports.get(file);
    if (next === undefined) {
      next = [];
      const language = languageOfFile(file, languages);
      if (language !== undefined) {
        try {
          next = [...new Set(importsOf(root, file, readFileSync(join(root, file), "utf8"), language).map((i) => i.module))];
        } catch {
          next = [];
        }
      }
      imports.set(file, next);
    }
    for (const module of next) {
      if (seen.has(module)) continue;
      seen.add(module);
      queue.push(module);
    }
  }
  return seen;
}

/** Whether a file the imports reach is the thing a chokepoint protects: its named file, or a file of its component declaring its named symbol. */
function holdsProtected(root: string, file: string, protects: { symbol?: string; file?: string }, folder: string, languages: readonly Language[], declared: Map<string, Set<string>>): boolean {
  if (protects.file !== undefined) return file === protects.file || file === `${folder}/${protects.file}` || file.endsWith(`/${protects.file}`);
  if (protects.symbol === undefined || !(folder === "." || file.startsWith(`${folder}/`))) return false;
  let names = declared.get(file);
  if (names === undefined) {
    const language = languageOfFile(file, languages);
    try {
      names = new Set(language === undefined ? [] : declarationsOf(readFileSync(join(root, file), "utf8"), language).map((d) => d.name));
    } catch {
      names = new Set();
    }
    declared.set(file, names);
  }
  return names.has(protects.symbol);
}

/**
 * Rank detected entrances against a spec model: each with its signals,
 * highest first. `languages` are the project's languages, as its config
 * reads them; a file in none of them reaches nothing by import. `detected`
 * is every detected entrance, declared or not, which the families declared
 * with one bullet are read from; the candidates alone when not given.
 */
export function rankEntrances(root: string, model: Pick<SpecModel, "components">, candidates: readonly EntranceCandidate[], languages: readonly Language[], detected: readonly EntranceCandidate[] = candidates): RankedEntrance[] {
  const targets = chokepointTargets(model);
  const families = familiesOf(model, detected);
  const imports = new Map<string, string[]>();
  const declared = new Map<string, Set<string>>();
  const reached = new Map<string, Set<string>>();
  const ranked = candidates.map((candidate): RankedEntrance => {
    let files = reached.get(candidate.file);
    if (files === undefined) {
      files = reachOf(root, candidate.file, languages, imports);
      reached.set(candidate.file, files);
    }
    const own = componentHolding(model.components, candidate.file)?.folder;
    const components = [...new Set([...(own === undefined ? [] : [own]), ...[...files].flatMap((f) => componentHolding(model.components, f)?.folder ?? [])])];
    const protects = targets.filter((t) => [...files].some((f) => holdsProtected(root, f, t.protects, t.component, languages, declared))).map((t) => ({ component: t.component, name: t.name }));
    const skips = skippedBy(candidate, families);
    return { candidate, outside: ruleIsRemote(candidate.rule), writes: writesOf(candidate), protects, components, ...(skips === undefined ? {} : { skips }) };
  });
  return ranked.map((r, i) => ({ r, i })).sort((a, b) => rankOrder(a.r, b.r) || a.i - b.i).map(({ r }) => r);
}

/** What ranks one entrance, in words: "from off the machine, writes, reaches what 1 chokepoint protects, imports reach 4 components", led by the handler it skips when it skips one. */
export function rankWords(r: RankedEntrance): string {
  const parts = r.skips === undefined ? [] : [`skips ${r.skips.handler}, which ${r.skips.members} others under ${r.skips.folder} go through (the grouped entrance "${r.skips.name}")`];
  parts.push(r.outside ? "from off the machine" : "run on the machine");
  if (r.writes) parts.push("writes");
  if (r.protects.length > 0) parts.push(`reaches what ${r.protects.length === 1 ? "1 chokepoint protects" : `${r.protects.length} chokepoints protect`}`);
  parts.push(`imports reach ${r.components.length === 1 ? "1 component" : `${r.components.length} components`}`);
  return parts.join(", ");
}
