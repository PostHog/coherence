/**
 * The decomposition checklist seed: the known invariant shapes, each tagged
 * with the kinds of thing it applies to.
 *
 * A requirement names its kinds; the shapes whose kinds intersect are the
 * ones it must declare as an invariant or dismiss with a reason. The seed is
 * prose plus tags: no ids, no links, no assessments.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** The seed that travels with this package. */
export const CHECKLIST_SEED = resolve(here, "..", "..", "docs", "checklist-seed.json");

export interface Shape {
  shape: string;
  kinds: string[];
  sentence: string;
  appliesWhen: string;
  excludes: string;
}

export interface Seed {
  /** Every kind tag a requirement may name, with its one-line meaning. */
  kinds: Record<string, string>;
  shapes: Shape[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, where: string): string {
  if (typeof value !== "string") throw new Error(`${where}: expected text`);
  return value;
}

export function parseSeed(input: unknown, path: string): Seed {
  if (!isRecord(input)) throw new Error(`${path}: the seed must be an object`);
  const kinds: Record<string, string> = {};
  if (!isRecord(input["kinds"])) throw new Error(`${path}: the seed names its kinds`);
  for (const [tag, meaning] of Object.entries(input["kinds"])) kinds[tag] = text(meaning, `${path} kinds.${tag}`);
  if (!Array.isArray(input["shapes"])) throw new Error(`${path}: shapes must be a list`);
  const shapes: Shape[] = input["shapes"].map((raw: unknown, index: number) => {
    const where = `${path} shapes[${index}]`;
    if (!isRecord(raw)) throw new Error(`${where}: a shape must be an object`);
    const shape = text(raw["shape"], `${where}.shape`);
    const tags = raw["kinds"];
    if (!Array.isArray(tags) || tags.length === 0) throw new Error(`${where} (${shape}): a shape carries at least one kind`);
    for (const tag of tags) {
      if (typeof tag !== "string" || !Object.hasOwn(kinds, tag)) throw new Error(`${where} (${shape}): unknown kind ${String(tag)}`);
    }
    return {
      shape,
      kinds: tags as string[],
      sentence: text(raw["sentence"], `${where}.sentence`),
      appliesWhen: text(raw["applies_when"], `${where}.applies_when`),
      excludes: text(raw["excludes"], `${where}.excludes`),
    };
  });
  const names = new Set<string>();
  for (const shape of shapes) {
    if (names.has(shape.shape)) throw new Error(`${path}: shape ${shape.shape} appears twice`);
    names.add(shape.shape);
  }
  return { kinds, shapes };
}

export function loadSeed(path: string = CHECKLIST_SEED): Seed {
  return parseSeed(JSON.parse(readFileSync(path, "utf8")), path);
}

/** The shapes a requirement of these kinds must declare or dismiss, in seed order. */
export function applicableShapes(seed: Seed, kinds: readonly string[]): Shape[] {
  return seed.shapes.filter((shape) => shape.kinds.some((tag) => kinds.includes(tag)));
}

export function shapeNamed(seed: Seed, name: string): Shape | undefined {
  return seed.shapes.find((shape) => shape.shape === name);
}
