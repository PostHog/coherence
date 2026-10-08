/**
 * `adopt <path>`: opt one folder of a repository into Coherence by listing
 * it in the registry, the `projects` of the coherence.config.json at the
 * repository top, creating that file when there is none. The file keeps its
 * indentation, its key order and its final newline; nothing else is written,
 * since a listed folder needs no file of its own to be a project.
 *
 * Refused: a path outside the repository or the top itself, a path that is
 * no folder, a path already listed, a path inside a listed folder or holding
 * one, and a top whose config is already a whole-repository project (it
 * lists no projects): adding the key would turn that project into a
 * registry, which is the owner's decision to make by hand.
 */

import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { CONFIG_FILE, readConfigFile, repositoryTop, under } from "../adapters/project-config.ts";
import { readTach } from "../scaffold/boundaries.ts";
import { projectPractices } from "../spec/model.ts";
import { deadTriggers, deadTriggerText } from "../spec/practices.ts";

export class AdoptError extends Error {}

export interface Adopted {
  /** The registry file written. */
  path: string;
  /** The folder listed, repository-relative. */
  folder: string;
  /** Whether the registry was created by this call. */
  created: boolean;
  /** The tach module whose path is this folder, when tach.toml at the top declares one. */
  tachModule: string | undefined;
  /** The folder's own practice triggers that match no file in it, as spec --check will name them: a whole-repository adoption's paths, still relative to the repository top. */
  deadTriggers: string[];
}

function realOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** The indentation of the first indented key, or two spaces for a file that has none. */
function indentationOf(text: string): string | number {
  return text.match(/^([\t ]+)"/m)?.[1] ?? 2;
}

/** List `given` (relative to `cwd`, or absolute) in the registry of the repository holding it. */
export function adopt(cwd: string, given: string): Adopted {
  const target = realOr(resolve(cwd, given));
  const found = repositoryTop(target);
  if (found === undefined) throw new AdoptError(`adopt: ${given} is in no git repository; a registry lives at a repository's top`);
  const top = realOr(found);
  if (!under(top, target) || target === top) throw new AdoptError(`adopt: ${given} is not a folder below the repository top ${top}`);
  if (!existsSync(target) || !statSync(target).isDirectory()) throw new AdoptError(`adopt: ${given} is not a folder`);
  const folder = relative(top, target).split(sep).join("/");
  const path = join(top, CONFIG_FILE);
  const text = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  const record = readConfigFile(path) ?? {};
  if (text !== undefined && !("projects" in record)) {
    throw new AdoptError(`adopt: ${path} is a whole-repository project (it lists no projects); listing ${folder} there would make it a registry, whose top is no project. Add "projects" to it by hand if that is what you want`);
  }
  const projects = record["projects"] ?? [];
  if (!Array.isArray(projects) || !projects.every((p): p is string => typeof p === "string")) throw new AdoptError(`adopt: ${path}: projects is a list of folders relative to the repository top`);
  const listed = projects.map((p) => ({ name: p, absolute: resolve(top, p) }));
  if (listed.some((p) => p.absolute === target)) throw new AdoptError(`adopt: ${folder} is already listed in ${path}`);
  const outer = listed.find((p) => under(p.absolute, target));
  if (outer !== undefined) throw new AdoptError(`adopt: ${folder} lies inside ${outer.name}, which is already a project; a project is never nested in another`);
  const inner = listed.find((p) => under(target, p.absolute));
  if (inner !== undefined) throw new AdoptError(`adopt: ${folder} holds ${inner.name}, which is already a project; a project is never nested in another`);
  const next = { ...record, projects: [...projects, folder] };
  const indent = text === undefined ? 2 : indentationOf(text);
  const newline = text === undefined || text === "" || text.endsWith("\n");
  writeFileSync(path, JSON.stringify(next, null, indent) + (newline ? "\n" : ""));
  return { path, folder, created: text === undefined, tachModule: tachModuleFor(top, folder), deadTriggers: deadTriggersIn(target) };
}

/** The dead triggers of the folder's own practices, or none when its practices cannot be read (spec --check says why). */
function deadTriggersIn(folder: string): string[] {
  try {
    return deadTriggers(folder, projectPractices(folder)).map(deadTriggerText);
  } catch {
    return [];
  }
}

/** The tach module whose folder is `folder`, read from tach.toml at the top; undefined when there is none or it will not read. */
function tachModuleFor(top: string, folder: string): string | undefined {
  const file = join(top, "tach.toml");
  if (!existsSync(file)) return undefined;
  try {
    return readTach(top, file).find((m) => m.folder === folder)?.id;
  } catch {
    return undefined;
  }
}

/** What adopt prints: what it wrote, and the next steps. */
export function adoptText(adopted: Adopted, cli: string): string {
  const lines = [
    `${adopted.created ? "created" : "updated"} ${adopted.path}: projects now lists ${adopted.folder}`,
    `${adopted.folder} is a project: its records live in ${adopted.folder}/.coherence, and it inherits the registry's keys unless a ${CONFIG_FILE} of its own there overrides them.`,
    `Next: work through the adoption practice from inside ${adopted.folder}: ${cli} query practice "adopt Coherence"`,
  ];
  if (adopted.deadTriggers.length > 0) lines.push(`${adopted.deadTriggers.length} practice trigger${adopted.deadTriggers.length === 1 ? "" : "s"} in ${adopted.folder} name no file of the project it now is (a when: line's paths are relative to the project's folder):`, ...adopted.deadTriggers.map((t) => `  ${t}`));
  if (adopted.tachModule !== undefined) lines.push(`tach.toml declares ${adopted.folder} as the module ${adopted.tachModule}; draft its spec with: ${cli} scaffold import tach ${adopted.tachModule}`);
  lines.push(`Install the hooks once, at the repository top, if they are not yet: ${cli} hooks install --host claude (or --local for yourself alone).`);
  return lines.join("\n") + "\n";
}
