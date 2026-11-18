/**
 * The sources a project names for what its words mean: `lexiconSources` in
 * coherence.config.json. `paths` are folders or files inside the project
 * (a knowledge base, a docs folder, a terms document) that lexicon review searches
 * for a term, read even when the config's ignore list keeps them out of the
 * checks: ignore says what is not the project's code or prose, and a source
 * says where its meaning is written down. `elsewhere` names sources outside
 * the repository (a Slack channel, a saved query), which Coherence never
 * reads: review prints them, and the agent settling the term may read them
 * read-only and cites what it used. Nothing outside the list is a source, so
 * an agent never goes looking through a team's conversations or production
 * data on its own (PostHog/billing#2703: the corrections came from a
 * reviewer and production data, which the adopter's agent had no business
 * querying unattended).
 */

import { existsSync, readdirSync, readFileSync, statSync, type Dirent, type Stats } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { configRecord } from "./project-config.ts";

export interface LexiconSources {
  /** Project-relative folders and files, forward slashes, each one that exists inside the root. */
  paths: string[];
  /** Sources outside the repository, as the config describes them. */
  elsewhere: string[];
  /** What the config's lexiconSources says that cannot be read: a malformed value, or a path outside the project or not there. */
  problems: string[];
}

export interface SourceUse {
  file: string;
  line: number;
  text: string;
}

const KEY = "lexiconSources";
/** A file larger than this is no terms document: skipped, never read whole. */
const MAX_BYTES = 1024 * 1024;
const SKIPPED_FOLDERS = new Set([".git", "node_modules", ".venv", "__pycache__"]);

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** The config's lexiconSources, with every path checked: inside the project and present. */
export function readLexiconSources(root: string): LexiconSources {
  const out: LexiconSources = { paths: [], elsewhere: [], problems: [] };
  let raw: unknown;
  try {
    raw = configRecord(root)[KEY];
  } catch {
    return out;
  }
  if (raw === undefined) return out;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    out.problems.push(`${KEY} is an object: { "paths": [folders or files in the project], "elsewhere": [sources outside the repository, described] }`);
    return out;
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) if (key !== "paths" && key !== "elsewhere") out.problems.push(`${KEY} has no key ${key}; it takes paths and elsewhere`);
  if (record["paths"] !== undefined && !strings(record["paths"])) out.problems.push(`${KEY}.paths is a list of folders or files in the project`);
  if (record["elsewhere"] !== undefined && !strings(record["elsewhere"])) out.problems.push(`${KEY}.elsewhere is a list of sources outside the repository, each described in words`);
  const base = resolve(root);
  for (const entry of strings(record["paths"]) ? record["paths"] : []) {
    const full = resolve(base, entry);
    const rel = relative(base, full);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      out.problems.push(`${KEY}.paths entry "${entry}" is outside the project; a source in another repository goes under elsewhere`);
      continue;
    }
    if (!existsSync(full)) {
      out.problems.push(`${KEY}.paths entry "${entry}" names no file or folder in the project: a typo, or a path that moved?`);
      continue;
    }
    out.paths.push(rel === "" ? "." : rel.split(sep).join("/"));
  }
  if (strings(record["elsewhere"])) out.elsewhere = record["elsewhere"].map((s) => s.trim()).filter((s) => s !== "");
  return out;
}

function filesUnder(root: string, rel: string): string[] {
  const full = join(root, rel);
  let stat: Stats;
  try {
    stat = statSync(full);
  } catch {
    return [];
  }
  if (stat.isFile()) return [rel];
  if (!stat.isDirectory()) return [];
  const out: string[] = [];
  // A walk with its own stack: a deep folder never costs a recursion.
  const stack = [rel];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = readdirSync(join(root, dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const child = dir === "." ? entry.name : `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIPPED_FOLDERS.has(entry.name)) stack.push(child);
      } else if (entry.isFile()) out.push(child);
    }
  }
  return out.sort();
}

function normalized(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/** The lines in the named paths that use the term as whole words, in path order; a binary or oversized file is skipped. */
export function sourceUses(root: string, sources: LexiconSources, term: string, limit = 40): { uses: SourceUse[]; total: number } {
  const wanted = normalized(term);
  if (wanted.trim() === "") return { uses: [], total: 0 };
  const uses: SourceUse[] = [];
  const seen = new Set<string>();
  for (const path of sources.paths) {
    for (const file of filesUnder(root, path)) {
      if (seen.has(file)) continue;
      seen.add(file);
      // An environment file is never a source, even under a path the config names: its values are secrets.
      if (/(^|\/)\.env(?:$|\.)/.test(file)) continue;
      let text: string;
      try {
        if (statSync(join(root, file)).size > MAX_BYTES) continue;
        const bytes = readFileSync(join(root, file));
        if (bytes.includes(0)) continue;
        text = bytes.toString("utf8");
      } catch {
        continue;
      }
      text.split(/\r?\n/).forEach((line, i) => {
        if (normalized(line).includes(wanted)) uses.push({ file, line: i + 1, text: line.trim().slice(0, 360) });
      });
    }
  }
  return { uses: uses.slice(0, limit), total: uses.length };
}

/** The review's section on the named sources: the uses found, and the sources outside the repository to read, read-only, and cite; empty when the config names none. */
export function sourcesText(sources: LexiconSources, found: { uses: SourceUse[]; total: number }): string {
  if (sources.paths.length === 0 && sources.elsewhere.length === 0) return "";
  const lines = ["", "Sources the config names for what the project's words mean (lexiconSources):"];
  if (sources.paths.length > 0) {
    lines.push(`  in the project (${sources.paths.join(", ")}): ${found.total === 0 ? "no use of the term" : `${found.total} use${found.total === 1 ? "" : "s"}${found.total > found.uses.length ? `, the first ${found.uses.length}` : ""}`}`);
    for (const use of found.uses) lines.push(`    ${use.file}:${use.line}  ${use.text}`);
  }
  if (sources.elsewhere.length > 0) {
    lines.push("  outside the repository, read-only; cite what you use in the decision, and read nothing the list does not name:");
    for (const source of sources.elsewhere) lines.push(`    ${source}`);
  }
  return lines.join("\n") + "\n";
}
