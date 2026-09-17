/**
 * Where a project keeps its glossary, and where Coherence keeps its own.
 *
 * `coherence.config.json` at the project root may name the project glossary
 * under `glossary`; otherwise `glossary.json` at the root is used when it
 * exists. Coherence's own glossary travels with this package.
 */

import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGlossary, type Glossary } from "./glossary.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** Coherence's own glossary, relative to this source tree. */
export const COHERENCE_GLOSSARY = resolve(here, "..", "..", "docs", "glossary.json");

export const CONFIG_FILE = "coherence.config.json";
export const DEFAULT_PROJECT_GLOSSARY = "glossary.json";

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

/** Both layers for a project root. */
export async function loadProjectGlossaries(root: string): Promise<ProjectGlossaries> {
  const coherence = await loadGlossary(COHERENCE_GLOSSARY);
  coherence.project ??= "coherence";
  const path = await projectGlossaryPath(root);
  const project = path === undefined || path === COHERENCE_GLOSSARY ? undefined : await loadGlossary(path);
  return { root, coherence, project };
}
