/**
 * Spec problems at the edit: when a tool use writes a spec or a practice
 * file, that file is parsed again and its problems are said in the same
 * turn, by file and line, the way a chokepoint bypass is. Before this, an
 * edit that broke a spec heard nothing until spec --check or the stop, and
 * the stop's text reaches the user, not the agent (the umami adoption's
 * misplaced (outside) marker read every level as inside, unsaid).
 *
 * Only the written files are parsed, never the whole model: a parse of one
 * file is milliseconds, inside the tool hook's budget, where loading the
 * model is not. So what is said here is the file's own problems (its
 * grammar, its keys, its kinds against the seed); a problem only the whole
 * model sees (a crossing naming a level the entry spec lacks, a practice
 * file with no spec beside it) still comes from spec --check and the stop.
 *
 * What was said is kept per session and file as the problems' messages,
 * lines aside: a file is named again only when its problems change (one
 * fixed, one added), never on every edit that leaves them as they were, and
 * a file whose problems are gone is forgotten, so a problem that returns is
 * said again.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { exclusionOf, walkBounds } from "../adapters/project-files.ts";
import { parseSpec } from "../spec/grammar.ts";
import { modelFileKind } from "../spec/model.ts";
import { parsePractices } from "../spec/practice.ts";
import { loadSeed } from "../spec/seed.ts";
import { readProjectText } from "./work-meter.ts";

/** Where what an edit said of each written spec is kept, per session; transient state, ignored with the rest of .coherence. */
export const SPEC_SAID_DIR = join(".coherence", "spec-said");

/** One problem as the edit says it. */
export interface EditProblem {
  file: string;
  line: number;
  message: string;
}

function saidPath(root: string, session: string): string {
  return join(root, SPEC_SAID_DIR, `${session.replace(/[^\w.-]/g, "_")}.json`);
}

function readSaid(root: string, session: string | undefined): Record<string, string> {
  if (session === undefined) return {};
  try {
    return JSON.parse(readFileSync(saidPath(root, session), "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeSaid(root: string, session: string, said: Record<string, string>): void {
  const path = saidPath(root, session);
  try {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(said));
    renameSync(temporary, path);
  } catch {
    // State that cannot be kept only means the file is named again at its next edit: louder, never silent.
  }
}

/** The problems of one spec or practice file as the model's walk would parse it. */
export function fileProblems(root: string, rel: string): EditProblem[] {
  const kind = modelFileKind(rel);
  const text = readProjectText(resolve(root, rel), kind === "practice" ? "practice" : "spec");
  if (kind === "practice") return parsePractices(text, rel).problems;
  return parseSpec(text, rel, { seed: loadSeed() }).problems;
}

/**
 * What the edit says of the spec and practice files it wrote: each file
 * whose problems are new to this session, with every problem by file and
 * line; empty when none changed. `commit` keeps what was said, once the
 * text reached the host.
 */
export function specAlarm(root: string, written: readonly string[], session: string | undefined, cli: string): { text: string; commit: () => void } {
  const files = written.filter((file) => modelFileKind(file) !== undefined);
  if (files.length === 0) return { text: "", commit: () => {} };
  const said = readSaid(root, session);
  const next = { ...said };
  const fresh: EditProblem[] = [];
  const unread: string[] = [];
  // A spec the config's ignore list bounds away is no file the model reads, so it has no problem to say.
  let bounds: ReturnType<typeof walkBounds> | undefined;
  for (const file of files) {
    if (!existsSync(resolve(root, file))) {
      delete next[file];
      continue;
    }
    try {
      bounds ??= walkBounds(root);
      if (exclusionOf(file, bounds) !== undefined) continue;
      const problems = fileProblems(root, file);
      if (problems.length === 0) {
        delete next[file];
        continue;
      }
      const signature = problems.map((p) => p.message).sort().join("\n");
      if (said[file] !== signature) fresh.push(...problems);
      next[file] = signature;
    } catch (error) {
      unread.push(`${file} (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  const changed = JSON.stringify(next) !== JSON.stringify(said);
  const commit = (): void => {
    if (session !== undefined && changed) writeSaid(root, session, next);
  };
  const lines: string[] = [];
  if (fresh.length > 0) {
    lines.push(`Spec problem${fresh.length === 1 ? "" : "s"} in what this edit wrote; spec --check fails on each, and a subagent's stop is refused:`);
    for (const p of fresh) lines.push(`  ✕ ${p.file}:${p.line} ${p.message}`);
    lines.push(`Fix each where it stands; ${cli} spec --check reads the whole model, with the problems only it can see.`);
  }
  if (unread.length > 0) lines.push(`Spec: this edit's ${unread.length === 1 ? "file" : "files"} could not be parsed, so ${unread.length === 1 ? "it was" : "they were"} not checked: ${unread.join("; ")}.`);
  return { text: lines.length === 0 ? "" : `${lines.join("\n")}\n`, commit };
}
