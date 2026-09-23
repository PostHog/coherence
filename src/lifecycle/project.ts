/**
 * Where a project keeps its glossary, where Coherence keeps its own, and
 * where each host keeps the settings file that carries the hook.
 *
 * `coherence.config.json` at the project root may name the project glossary
 * under `glossary`; otherwise `glossary.json` at the root is used when it
 * exists. Coherence's own glossary travels with this package.
 */

import { existsSync, realpathSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGlossary, type Glossary } from "./glossary.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** Coherence's own glossary, relative to this source tree. */
export const COHERENCE_GLOSSARY = resolve(here, "..", "..", "docs", "glossary.json");

export const CONFIG_FILE = "coherence.config.json";
export const DEFAULT_PROJECT_GLOSSARY = "glossary.json";

export const HOSTS = ["claude", "codex"] as const;
export type Host = (typeof HOSTS)[number];

export function isHost(name: string): name is Host {
  return (HOSTS as readonly string[]).includes(name);
}

/** The settings file each host reads, relative to the project root. */
export const SETTINGS_FILE: Record<Host, string> = {
  claude: ".claude/settings.json",
  codex: ".codex/hooks.json",
};

/** The harness's own name for the project directory, honored when it agrees with where the process runs. */
export const PROJECT_DIR_VAR = "CLAUDE_PROJECT_DIR";

/** A path with its symbolic links followed where they can be, so two spellings of one directory compare equal. */
function real(path: string): string {
  let existing=resolve(path); const suffix:string[]=[];
  while(!existsSync(existing) && dirname(existing)!==existing) { suffix.unshift(basename(existing)); existing=dirname(existing); }
  try { return resolve(realpathSync(existing),...suffix); }
  catch { return resolve(path); }
}

/** Whether `path` is `root` itself or lies under it, comparing the directories rather than their spellings. */
export function within(root: string, path: string): boolean {
  const rel = relative(real(root), real(path));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * The project root the hook was installed for, or nothing when no
 * installation can be pointed at: the harness's own name for the project when
 * that name contains the directory the process was started in, else the
 * nearest directory at or above that one holding a host settings file. This
 * is the tree the hook may read and write, whatever cwd arrives on stdin.
 *
 * The environment variable is checked for agreement because a process started
 * elsewhere has inherited a name that is not about the tree it is running in.
 * Nothing is returned rather than a guess: a hook the host ran from outside
 * any installation has no tree to defend, and refusing every event on a guess
 * would be worse than answering the cwd it was handed.
 */
export function installedRoot(fallback: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const start = real(fallback);
  const named = env[PROJECT_DIR_VAR];
  if (typeof named === "string" && named !== "" && existsSync(named) && within(named, start)) return real(named);
  let dir = start;
  for (;;) {
    if (Object.values(SETTINGS_FILE).some((file) => existsSync(join(dir, file)))) return dir;
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

export interface ProjectGlossaries {
  root: string;
  coherence: Glossary;
  /** Absent when the project declares none; identical to `coherence` is folded away. */
  project: Glossary | undefined;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** The project glossary path the config names, or the default when present, or undefined. */
export async function projectGlossaryPath(root: string): Promise<string | undefined> {
  const configPath = resolve(root, CONFIG_FILE);
  if (await exists(configPath)) {
    let config: unknown;
    try {
      config = JSON.parse(await readFile(configPath, "utf8"));
    } catch (error) {
      throw new Error(`${configPath}: not valid JSON (${(error as Error).message})`);
    }
    if (typeof config === "object" && config !== null && !Array.isArray(config)) {
      const named = (config as Record<string, unknown>)["glossary"];
      if (typeof named === "string") return resolve(root, named);
    }
  }
  const fallback = resolve(root, DEFAULT_PROJECT_GLOSSARY);
  return (await exists(fallback)) ? fallback : undefined;
}

/**
 * The project facts vocabulary coverage reads from the config: the project's
 * own name (`name`) and the names it vouches for as well known (`wellKnown`),
 * which no tool could derive. A missing or partial config is no facts.
 */
export interface VocabularyFacts {
  name: string | undefined;
  wellKnown: string[];
}

export async function vocabularyFacts(root: string): Promise<VocabularyFacts> {
  const facts: VocabularyFacts = { name: undefined, wellKnown: [] };
  const configPath = resolve(root, CONFIG_FILE);
  if (!(await exists(configPath))) return facts;
  let config: unknown;
  try {
    config = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    throw new Error(`${configPath}: not valid JSON (${(error as Error).message})`);
  }
  if (typeof config !== "object" || config === null || Array.isArray(config)) return facts;
  const record = config as Record<string, unknown>;
  if (typeof record["name"] === "string" && record["name"].trim() !== "") facts.name = record["name"].trim();
  const named = record["wellKnown"];
  if (Array.isArray(named)) facts.wellKnown = named.filter((n): n is string => typeof n === "string" && n.trim() !== "").map((n) => n.trim());
  return facts;
}

/** Whether the project at `root` is Coherence itself, whose CLI is its own source tree rather than an installed bin. */
export async function isCoherenceItself(root: string): Promise<boolean> {
  try {
    const pkg: unknown = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
    return typeof pkg === "object" && pkg !== null && (pkg as Record<string, unknown>)["name"] === "coherence";
  } catch {
    return false;
  }
}

/** Both layers for a project root. */
export async function loadProjectGlossaries(root: string): Promise<ProjectGlossaries> {
  const coherence = await loadGlossary(COHERENCE_GLOSSARY);
  coherence.project ??= "coherence";
  const path = await projectGlossaryPath(root);
  const project = path === undefined || path === COHERENCE_GLOSSARY ? undefined : await loadGlossary(path);
  return { root, coherence, project };
}
