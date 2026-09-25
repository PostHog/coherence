/**
 * The spec grammar: one file, parsed into an intent, trust levels, and
 * invariant bullets.
 *
 *   # Name
 *
 *   One-line intent.
 *
 *   ## trust levels            (entry spec only)
 *   - owner-trusted: full kernel access
 *   - public (outside): what anyone on the network sends   outside the system's control
 *
 *   ## entrances               (any spec)
 *   - <name>: <one-line meaning: what work enters here from outside>
 *     handler: <symbol, symbol in file, or a module file>   a module file: its top-level script is the handler
 *     trust: <the trust level it carries in>              optional; else derived from crossings
 *     guard: <a chokepoint's symbol>                     optional; the chokepoint its handler is registered through
 *
 *   ## invariants
 *   - <name>: <sentence>
 *     protects: <symbol or module>            chokepoint form, with
 *     chokepoint: <symbol>
 *     over: <the set the detector is total over>   totality oracle form, with
 *     via: <the test>
 *     because: <why it exists, what it protects against>
 *     crossing: <trust level> -> <trust level>
 *     refuted: <what was broken> -> <what was seen> (YYYY-MM-DD)   the human account of a refutation record
 *     kinds: <a, b> | none
 *     checklist: <shape> declared as <invariant> | <shape> dismissed: <reason>
 *
 * Every bullet is an invariant; there is no other kind of claim. A value
 * still written as <a placeholder> parses but counts as absent, so a
 * scaffolded bullet can be written first and filled second. The sections the
 * reference used are refused by name with their replacement; any other
 * section is refused as unknown. The parser reports problems and never
 * throws on content; cross-spec facts (trust levels, declared-as names,
 * duplicate names, an entrance's trust against the crossings on its
 * handler) are checked by the model.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Seed } from "./seed.ts";

const here = dirname(fileURLToPath(import.meta.url));

interface RetiredSection {
  section: string;
  replacement: string;
}

/** The sections the reference used, each with what replaced it. Data, so the names appear nowhere in code. */
export const RETIRED_SECTIONS: readonly RetiredSection[] = (
  JSON.parse(readFileSync(resolve(here, "retired-sections.json"), "utf8")) as { sections: RetiredSection[] }
).sections;

export const TRUST_LEVELS_SECTION = "trust levels";
export const ENTRANCES_SECTION = "entrances";
export const INVARIANTS_SECTION = "invariants";

/** What a spec may hold, for the problems that name it. */
const SECTIONS_SENTENCE = "a spec holds ## trust levels (entry spec only), ## entrances and ## invariants";

/** The keys an invariant bullet may carry, in the order the scaffold prints them. */
export const KEYS = ["protects", "chokepoint", "over", "via", "because", "crossing", "refuted", "kinds", "checklist"] as const;
export type Key = (typeof KEYS)[number];
const MANY: ReadonlySet<Key> = new Set<Key>(["refuted", "checklist"]);

export interface Problem {
  file: string;
  line: number;
  message: string;
}

export interface TrustLevel {
  name: string;
  meaning: string;
  /** Whether it comes from outside the system's control: the level is written `- <name> (outside): <meaning>`. */
  outside: boolean;
  line: number;
}

/** The marker a trust level wears when it comes from outside the system's control. */
export const OUTSIDE_MARKER = "(outside)";

/**
 * Where work enters the system from outside: a command, a host event, a
 * route, a tool. The handler is the code that receives it, named as a symbol,
 * a symbol in a file, or a module file whose top-level script receives it;
 * the model checks that it resolves. A guard names the chokepoint the handler
 * is registered through, where the reading cannot see the registration.
 */
export interface Entrance {
  name: string;
  meaning: string;
  /** Undefined when the bullet names no handler, which is a problem. */
  handler: string | undefined;
  line: number;
  /** The handler line, or the bullet's own line when there is none. */
  handlerLine: number;
  /** The trust level it declares it carries in; undefined when it declares none, and its trust is derived. */
  trust: string | undefined;
  /** The trust line, when there is one. */
  trustLine: number | undefined;
  /** The chokepoint it declares its handler is registered through (a guard: line); undefined when it declares none. */
  guard?: string | undefined;
  /** The guard line, when there is one. */
  guardLine?: number | undefined;
}

/** A handler named as a module file (a path with an extension): the module's top-level script receives the work. */
export function isModuleHandler(handler: string): boolean {
  return /^[A-Za-z0-9_./@-]+\.[A-Za-z]+$/.test(handler.trim()) && !/\s/.test(handler.trim());
}

export type Enforcement =
  | { form: "chokepoint"; protects: string; chokepoint: string; line: number }
  | { form: "totality oracle"; over: string; via: string; line: number };

export interface Refutation {
  broke: string;
  saw: string;
  date: string;
  line: number;
}

export interface Crossing {
  from: string;
  to: string;
  line: number;
}

export type ChecklistLine =
  | { shape: string; outcome: "declared"; as: string; line: number }
  | { shape: string; outcome: "dismissed"; reason: string; line: number };

export interface Invariant {
  name: string;
  sentence: string;
  line: number;
  enforcements: Enforcement[];
  because: string | undefined;
  crossing: Crossing | undefined;
  refutations: Refutation[];
  /** Undefined when no kinds line was written; "none" when the line says no shape applies. */
  kinds: string[] | "none" | undefined;
  checklist: ChecklistLine[];
  /** Keys whose value is still a placeholder, as written (a checklist entry names its shape). */
  unfilled: string[];
}

export interface ParsedSpec {
  file: string;
  title: string | undefined;
  intent: string | undefined;
  /** Undefined when the spec has no trust levels section. */
  trustLevels: TrustLevel[] | undefined;
  trustLevelsLine: number | undefined;
  /** Empty when the spec has no entrances section. */
  entrances: Entrance[];
  invariants: Invariant[];
  problems: Problem[];
}

/** A scaffold placeholder: angle brackets around a lowercase lead, as `<the test>`. */
const PLACEHOLDER = /(?:^|\s)<[a-z][^<>]*>(?:$|[\s)|])/;

export function isPlaceholder(value: string): boolean {
  return PLACEHOLDER.test(value);
}

const ARROW = /\s*(?:->|→)\s*/;
/** The first arrow in a value, found by position: a lazy group on either side of it backtracks quadratically. */
const ARROW_AT = /->|→/;
/** The date a refuted line ends with, anchored: no group before it, so the scan is linear in the value's length. */
const REFUTED_DATE = /\((\d{4})-(\d{2})-(\d{2})\)\s*$/;

/** Whether three digit groups name a day that exists: 2026-13-45 parses as digits and is no date. */
export function isCalendarDate(year: string, month: string, day: string): boolean {
  const text = `${year}-${month}-${day}`;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

interface Field {
  key: Key;
  value: string;
  line: number;
}

interface RawBullet {
  name: string;
  sentence: string;
  line: number;
  fields: Field[];
}

function normalizeSection(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function retiredSection(name: string): RetiredSection | undefined {
  const key = normalizeSection(name);
  return RETIRED_SECTIONS.find((entry) => entry.section === key);
}

export interface ParseOptions {
  /** The seed, when known kinds and shapes should be checked. */
  seed?: Seed | undefined;
}

export function parseSpec(text: string, file: string, options: ParseOptions = {}): ParsedSpec {
  const lines = text.split(/\r?\n/);
  const problems: Problem[] = [];
  const problem = (line: number, message: string): void => {
    problems.push({ file, line, message });
  };

  let title: string | undefined;
  let intent: string | undefined;
  let trustLevels: TrustLevel[] | undefined;
  let trustLevelsLine: number | undefined;
  let entrancesSeen = false;
  const entrances: Entrance[] = [];
  const bullets: RawBullet[] = [];

  type Section = "head" | "trust levels" | "entrances" | "invariants" | "skip";
  let section: Section = "head";
  let paragraph: string[] = [];
  let paragraphLine = 0;
  let prose = 0;
  let fenced = false;

  const closeParagraph = (): void => {
    if (paragraph.length === 0) return;
    const joined = paragraph.join(" ").replace(/\s+/g, " ").trim();
    prose += 1;
    if (prose === 1) intent = joined;
    else problem(paragraphLine, "prose after the intent: a spec holds one intent line; rationale belongs in because: lines on invariants");
    paragraph = [];
  };

  let current: RawBullet | undefined;
  const closeBullet = (): void => {
    if (current !== undefined) bullets.push(current);
    current = undefined;
  };

  lines.forEach((raw, index) => {
    const line = index + 1;
    if (/^\s*(```|~~~)/.test(raw)) {
      fenced = !fenced;
      problem(line, "a fenced block has no place in a spec");
      return;
    }
    if (fenced) return;

    const heading = /^(#+)\s*(.*?)\s*$/.exec(raw);
    if (heading !== null) {
      closeParagraph();
      closeBullet();
      const level = heading[1]!.length;
      const name = heading[2]!;
      if (level === 1) {
        if (title === undefined && section === "head") title = name;
        else problem(line, "one # title per spec, first");
        return;
      }
      if (level > 2) {
        problem(line, `no sub-headings: ${SECTIONS_SENTENCE}`);
        section = "skip";
        return;
      }
      const key = normalizeSection(name);
      if (key === TRUST_LEVELS_SECTION) {
        if (trustLevels !== undefined) problem(line, "## trust levels given twice");
        trustLevels ??= [];
        trustLevelsLine ??= line;
        section = "trust levels";
        return;
      }
      if (key === ENTRANCES_SECTION) {
        if (entrancesSeen) problem(line, "## entrances given twice");
        entrancesSeen = true;
        section = "entrances";
        return;
      }
      if (key === INVARIANTS_SECTION) {
        section = "invariants";
        return;
      }
      const retired = retiredSection(name);
      if (retired !== undefined) {
        problem(line, `## ${retired.section} is retired; its replacement is ${retired.replacement}`);
      } else {
        problem(line, `unknown section "${name}": ${SECTIONS_SENTENCE}`);
      }
      section = "skip";
      return;
    }

    switch (section) {
      case "skip":
        return;
      case "head": {
        if (raw.trim() === "") {
          closeParagraph();
          return;
        }
        if (paragraph.length === 0) paragraphLine = line;
        paragraph.push(raw.trim());
        return;
      }
      case "trust levels": {
        if (raw.trim() === "") return;
        const bullet = /^[-*]\s+(.*)$/.exec(raw);
        if (bullet === null) {
          problem(line, `a trust level is one bullet: - <name>: <one-line meaning>, or - <name> ${OUTSIDE_MARKER}: <one-line meaning>`);
          return;
        }
        const colon = bullet[1]!.indexOf(":");
        if (colon <= 0) {
          problem(line, `a trust level is one bullet: - <name>: <one-line meaning>, or - <name> ${OUTSIDE_MARKER}: <one-line meaning>`);
          return;
        }
        let name = bullet[1]!.slice(0, colon).trim();
        const meaning = bullet[1]!.slice(colon + 1).trim();
        // The one marker a level may wear: it comes from outside the system's control. Any other is refused, not ignored.
        const marked = /^(.*?)\s*(\([^()]*\))$/.exec(name);
        let outside = false;
        if (marked !== null) {
          if (marked[2] === OUTSIDE_MARKER) outside = true;
          else problem(line, `trust level ${marked[1]} is marked ${marked[2]}; the one marker is ${OUTSIDE_MARKER}, for a level from outside the system's control`);
          name = marked[1]!;
        }
        if (meaning === "") problem(line, `trust level ${name} needs a one-line meaning`);
        if (trustLevels!.some((level) => level.name === name)) problem(line, `trust level ${name} declared twice`);
        trustLevels!.push({ name, meaning, outside, line });
        return;
      }
      case "entrances": {
        if (raw.trim() === "") return;
        const bullet = /^[-*]\s+(.*)$/.exec(raw);
        if (bullet !== null) {
          const colon = bullet[1]!.indexOf(":");
          if (colon <= 0) {
            problem(line, "an entrance is one bullet: - <name>: <one-line meaning>, with an indented handler: <symbol> line and optional trust: <trust level> and guard: <chokepoint> lines");
            return;
          }
          const name = bullet[1]!.slice(0, colon).trim();
          const meaning = bullet[1]!.slice(colon + 1).trim();
          if (meaning === "") problem(line, `entrance ${name} needs a one-line meaning`);
          if (entrances.some((entrance) => entrance.name === name)) problem(line, `entrance ${name} declared twice`);
          entrances.push({ name, meaning, handler: undefined, line, handlerLine: line, trust: undefined, trustLine: undefined });
          return;
        }
        const current = entrances[entrances.length - 1];
        const field = /^\s+([a-z]+):\s*(.*)$/.exec(raw);
        if (current === undefined || field === null) {
          problem(line, "expected an entrance bullet (- <name>: <meaning>) or an indented handler:, trust: or guard: line under one");
          return;
        }
        if (field[1] === "trust") {
          if (current.trustLine !== undefined) problem(line, `entrance ${current.name} names its trust twice`);
          const value = field[2]!.trim();
          // A placeholder counts as absent, as on an invariant: the trust is then derived.
          if (value === "") problem(line, `trust: on entrance ${current.name} names no trust level`);
          else if (!isPlaceholder(value)) current.trust = value;
          current.trustLine = line;
          return;
        }
        if (field[1] === "guard") {
          if (current.guardLine !== undefined) problem(line, `entrance ${current.name} names its guard twice`);
          const value = field[2]!.trim();
          if (value === "") problem(line, `guard: on entrance ${current.name} names no chokepoint`);
          else if (!isPlaceholder(value)) current.guard = value;
          current.guardLine = line;
          return;
        }
        if (field[1] !== "handler") {
          problem(line, `unknown key "${field[1]}": an entrance carries handler, trust and guard`);
          return;
        }
        if (current.handler !== undefined) problem(line, `entrance ${current.name} names its handler twice`);
        current.handler = field[2]!.trim();
        current.handlerLine = line;
        return;
      }
      case "invariants": {
        if (raw.trim() === "") return;
        const bullet = /^[-*]\s+(.*)$/.exec(raw);
        if (bullet !== null) {
          closeBullet();
          const head = bullet[1]!;
          const colon = head.indexOf(":");
          if (colon <= 0) {
            problem(line, "an invariant bullet starts with <name>: <sentence>");
            current = { name: head.trim(), sentence: "", line, fields: [] };
            return;
          }
          const name = head.slice(0, colon).trim();
          const sentence = head.slice(colon + 1).trim();
          if (sentence === "") problem(line, `invariant ${name} needs its sentence: the abstract behavioral requirement`);
          current = { name, sentence, line, fields: [] };
          return;
        }
        if (current === undefined || !/^\s+\S/.test(raw)) {
          problem(line, "expected an invariant bullet (- <name>: <sentence>) or an indented key: value line under one");
          return;
        }
        const body = raw.trim();
        const field = /^([a-z]+):\s*(.*)$/.exec(body);
        if (field !== null) {
          const key = field[1]!;
          if (!(KEYS as readonly string[]).includes(key)) {
            problem(line, `unknown key "${key}": an invariant carries ${KEYS.join(", ")}`);
            return;
          }
          current.fields.push({ key: key as Key, value: field[2]!.trim(), line });
          return;
        }
        // A wrapped line continues the value above it, or the sentence.
        const last = current.fields[current.fields.length - 1];
        if (last === undefined) current.sentence = `${current.sentence} ${body}`.trim();
        else last.value = `${last.value} ${body}`.trim();
        return;
      }
    }
  });
  closeParagraph();
  closeBullet();

  if (title === undefined) problem(1, "a spec starts with # <Name>");
  if (intent === undefined) problem(1, "a spec needs its intent: one line after the title");
  if (fenced) problem(lines.length, "unclosed fenced block");

  for (const entrance of entrances) {
    if (entrance.handler === undefined || entrance.handler === "" || isPlaceholder(entrance.handler)) {
      problem(entrance.line, `entrance ${entrance.name} names no handler: add handler: <symbol, symbol in file, or module file>`);
    }
  }
  const invariants = bullets.map((bullet) => buildInvariant(bullet, problem, options.seed));
  return { file, title, intent, trustLevels, trustLevelsLine, entrances, invariants, problems };
}

function buildInvariant(bullet: RawBullet, problem: (line: number, message: string) => void, seed: Seed | undefined): Invariant {
  const single = new Map<Key, Field>();
  const many = new Map<Key, Field[]>();
  for (const field of bullet.fields) {
    if (MANY.has(field.key)) {
      const list = many.get(field.key) ?? [];
      list.push(field);
      many.set(field.key, list);
      continue;
    }
    if (single.has(field.key)) {
      problem(field.line, `${field.key}: given twice on ${bullet.name}`);
      continue;
    }
    single.set(field.key, field);
  }
  const unfilled: string[] = [];
  if (isPlaceholder(bullet.name)) unfilled.push("name");
  /** A filled value, or undefined when absent or still a placeholder (recorded as unfilled). */
  const filled = (key: Key): string | undefined => {
    const field = single.get(key);
    if (field === undefined) return undefined;
    if (field.value === "") {
      problem(field.line, `${key}: is empty on ${bullet.name}`);
      return undefined;
    }
    if (isPlaceholder(field.value)) {
      unfilled.push(key);
      return undefined;
    }
    return field.value;
  };

  const enforcements: Enforcement[] = [];
  const pair = (
    a: Key,
    b: Key,
    make: (x: string, y: string, line: number) => Enforcement,
    form: string,
  ): void => {
    const fa = single.get(a);
    const fb = single.get(b);
    if (fa === undefined && fb === undefined) return;
    if (fa === undefined || fb === undefined) {
      const present = fa ?? fb!;
      problem(present.line, `${form} on ${bullet.name} names both ${a}: and ${b}:; ${fa === undefined ? a : b}: is missing`);
      return;
    }
    const x = filled(a);
    const y = filled(b);
    if (x !== undefined && y !== undefined) enforcements.push(make(x, y, fa.line));
  };
  pair("protects", "chokepoint", (protects, chokepoint, line) => ({ form: "chokepoint", protects, chokepoint, line }), "the chokepoint form");
  pair("over", "via", (over, via, line) => ({ form: "totality oracle", over, via, line }), "the totality oracle form");

  const because = filled("because");

  let crossing: Crossing | undefined;
  const crossingText = filled("crossing");
  if (crossingText !== undefined) {
    const parts = crossingText.split(ARROW);
    const from = parts[0]?.trim() ?? "";
    const to = parts[1]?.trim() ?? "";
    const line = single.get("crossing")!.line;
    if (parts.length !== 2 || from === "" || to === "") problem(line, `crossing on ${bullet.name} reads <trust level> -> <trust level>`);
    else crossing = { from, to, line };
  }

  const refutations: Refutation[] = [];
  for (const field of many.get("refuted") ?? []) {
    if (isPlaceholder(field.value)) {
      unfilled.push("refuted");
      continue;
    }
    const dated = REFUTED_DATE.exec(field.value);
    if (dated !== null && !isCalendarDate(dated[1]!, dated[2]!, dated[3]!)) {
      problem(field.line, `refuted on ${bullet.name} ends with (${dated[1]}-${dated[2]}-${dated[3]}), which is not a day that exists`);
      continue;
    }
    const head = dated === null ? field.value : field.value.slice(0, dated.index);
    const arrow = ARROW_AT.exec(head);
    const broke = arrow === null ? "" : head.slice(0, arrow.index).trim();
    const saw = arrow === null ? "" : head.slice(arrow.index + arrow[0].length).trim();
    if (dated === null || arrow === null || broke === "" || saw === "") {
      problem(field.line, `refuted on ${bullet.name} reads <what was broken> -> <what was seen> (YYYY-MM-DD)`);
      continue;
    }
    refutations.push({ broke, saw, date: `${dated[1]}-${dated[2]}-${dated[3]}`, line: field.line });
  }

  let kinds: string[] | "none" | undefined;
  const kindsField = single.get("kinds");
  if (kindsField !== undefined) {
    const value = filled("kinds");
    if (value !== undefined) {
      const tags = value.split(",").map((tag) => tag.trim()).filter((tag) => tag !== "");
      if (tags.length === 1 && tags[0] === "none") {
        kinds = "none";
      } else if (tags.includes("none")) {
        problem(kindsField.line, `kinds on ${bullet.name}: none cannot be combined with a kind`);
      } else {
        const unknown = seed === undefined ? [] : tags.filter((tag) => !Object.hasOwn(seed.kinds, tag));
        if (unknown.length > 0) {
          problem(kindsField.line, `kinds on ${bullet.name}: unknown kind ${unknown.join(", ")}; the kinds are ${Object.keys(seed!.kinds).join(", ")}`);
        } else {
          kinds = tags;
        }
      }
    }
  }

  const checklist: ChecklistLine[] = [];
  for (const field of many.get("checklist") ?? []) {
    const declared = /^(\S+)\s+declared as\s+(.+)$/.exec(field.value);
    const dismissed = /^(\S+)\s+dismissed:\s*(.+)$/.exec(field.value);
    const shape = (declared ?? dismissed)?.[1] ?? /^(\S+)/.exec(field.value)?.[1] ?? "";
    if (seed !== undefined && shape !== "" && !isPlaceholder(shape) && seed.shapes.every((s) => s.shape !== shape)) {
      problem(field.line, `checklist on ${bullet.name}: no shape named ${shape}`);
      continue;
    }
    if (isPlaceholder(field.value)) {
      unfilled.push(`checklist ${shape}`);
      continue;
    }
    if (declared !== null) checklist.push({ shape, outcome: "declared", as: declared[2]!.trim(), line: field.line });
    else if (dismissed !== null) checklist.push({ shape, outcome: "dismissed", reason: dismissed[2]!.trim(), line: field.line });
    else problem(field.line, `checklist on ${bullet.name} reads <shape> declared as <invariant name> or <shape> dismissed: <reason>`);
  }

  return {
    name: bullet.name,
    sentence: bullet.sentence,
    line: bullet.line,
    enforcements,
    because,
    crossing,
    refutations,
    kinds,
    checklist,
    unfilled,
  };
}
