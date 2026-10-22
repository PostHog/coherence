/**
 * The Quint plugin: opt-in, bundled, a verifier. A bullet proves a property
 * of a Quint model through it:
 *
 *   via: [quint run] terminalNeverMoves in Journal.qnt   typecheck, then simulate
 *   via: [quint] terminalNeverMoves in Journal.qnt       typecheck, simulate, then a bounded model check
 *
 * The model file is named from the bullet's spec folder; with no file named,
 * the folder's one .qnt model. Every step must answer: a refusal or a state
 * that breaks the property fails the bullet, and a step that could not run
 * (no quint, no Java for Apalache, out of time) leaves it not run with why,
 * never passing. Quint runs from a scratch folder, so Apalache's working
 * files never land in the project.
 *
 * The project's config may tune it under "quint": backend ("typescript", the
 * default, needs nothing fetched; "rust"), maxSamples, maxSteps, seed and
 * verifySteps.
 */

import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { configRecord, type PluginModule, type VerifyRequest, type VerifyResult } from "../../src/plugins/api.ts";
import { runQuint, type QuintResult } from "./quint.ts";

export interface QuintConfig {
  backend: "typescript" | "rust";
  maxSamples: number;
  maxSteps: number;
  seed: string | undefined;
  verifySteps: number;
}

export const DEFAULT_QUINT: QuintConfig = { backend: "typescript", maxSamples: 1000, maxSteps: 20, seed: undefined, verifySteps: 10 };

/** The project's quint settings over the defaults; a value of the wrong shape is ignored for the default. */
export function quintConfig(root: string): QuintConfig {
  let raw: unknown;
  try {
    raw = configRecord(root)["quint"];
  } catch {
    raw = undefined;
  }
  const given = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const count = (key: keyof QuintConfig, fallback: number): number => (typeof given[key] === "number" && Number.isInteger(given[key]) && (given[key] as number) > 0 ? (given[key] as number) : fallback);
  return {
    backend: given["backend"] === "rust" ? "rust" : "typescript",
    maxSamples: count("maxSamples", DEFAULT_QUINT.maxSamples),
    maxSteps: count("maxSteps", DEFAULT_QUINT.maxSteps),
    seed: typeof given["seed"] === "string" ? given["seed"] : undefined,
    verifySteps: count("verifySteps", DEFAULT_QUINT.verifySteps),
  };
}

const QUINT_NAME = /^([A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*)(?:\s+in\s+(\S+\.qnt))?$/;

/** The property and the model file (project-relative) a via names, or why it names none. */
export function resolveTarget(root: string, component: string, name: string): { property: string; model: string } | { reason: string } {
  const parsed = QUINT_NAME.exec(name.trim());
  if (parsed === null) return { reason: `"${name}" is not a Quint property, optionally in a model: write <property> or <property> in <file>.qnt` };
  const [, property, file] = parsed as unknown as [string, string, string | undefined];
  const folder = component === "." ? "" : `${component}/`;
  if (file !== undefined) {
    const model = posix.normalize(`${folder}${file}`);
    if (model.startsWith("..")) return { reason: `${file} leaves the project` };
    return existsSync(join(root, model)) ? { property, model } : { reason: `no model ${model}: ${file} is named from the bullet's folder (${component})` };
  }
  let models: string[];
  try {
    models = readdirSync(join(root, component)).filter((f) => f.endsWith(".qnt")).sort();
  } catch {
    models = [];
  }
  if (models.length === 1) return { property, model: `${folder}${models[0]}` };
  return { reason: models.length === 0 ? `no .qnt model in ${component}, the bullet's folder; name one: ${property} in <file>.qnt` : `${component} holds ${models.length} models (${models.join(", ")}); name one: ${property} in <file>.qnt` };
}

/** Prove one via: typecheck, simulate, and for [quint] the bounded model check, each step within what is left of the deadline. */
export async function verify(request: VerifyRequest): Promise<VerifyResult> {
  const target = resolveTarget(request.root, request.component, request.name);
  if ("reason" in target) return { verdict: "not run", reason: target.reason };
  const { property, model } = target;
  const config = quintConfig(request.root);
  const file = join(request.root, model);
  // Two seconds short of the core's own deadline, so a step that runs out of time reads not run here rather than a killed verifier there.
  const deadline = Date.now() + Math.max(1000, request.timeoutMs - 2000);
  const scratch = mkdtempSync(join(tmpdir(), "coherence-quint-"));
  try {
    const step = async (name: string, argv: string[]): Promise<VerifyResult | undefined> => {
      const left = deadline - Date.now();
      const result: QuintResult = left <= 0 ? { outcome: "timeout", command: `quint ${argv[0]}`, stdout: "", stderr: "", reason: "no time was left for it" } : await runQuint(argv, scratch, left);
      if (result.outcome === "ok") return undefined;
      if (result.outcome === "unavailable") return { verdict: "not run", reason: `quint ${name} could not run: ${result.reason}` };
      if (result.outcome === "timeout") return { verdict: "not run", reason: `quint ${name} ${result.reason}; nothing it said counts` };
      if (result.outcome === "violation") return { verdict: "fail", reason: `quint ${name} found a state of ${model} that breaks ${property}: ${counterexample(result)}` };
      return { verdict: "fail", reason: `quint ${name} refused ${model}: ${result.reason}` };
    };
    const typed = await step("typecheck", ["typecheck", file]);
    if (typed !== undefined) return typed;
    const run = ["run", file, "--invariant", property, "--max-samples", String(config.maxSamples), "--max-steps", String(config.maxSteps), "--backend", config.backend, ...(config.seed === undefined ? [] : ["--seed", config.seed])];
    const simulated = await step("run", run);
    if (simulated !== undefined) return simulated;
    const sampled = `typechecked and simulated (${config.maxSamples} samples of ${config.maxSteps} steps, ${config.backend} backend)`;
    if (request.form === "quint run") return { verdict: "pass", reason: `${property} holds in ${model}: ${sampled}` };
    const checked = await step("verify", ["verify", file, "--invariant", property, "--max-steps", String(config.verifySteps)]);
    if (checked !== undefined) return checked;
    return { verdict: "pass", reason: `${property} holds in ${model}: ${sampled}, and model-checked by Apalache within ${config.verifySteps} steps, a bound, not every reachable state` };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The states quint printed for a violation, short enough for a reason. */
function counterexample(result: QuintResult): string {
  const text = result.stdout.split("\n").filter((l) => l.trim() !== "" && !/^Use --/.test(l)).join(" ");
  return text.length > 600 ? `${text.slice(0, 600)}…` : text;
}

const quint: PluginModule = { verify };

export default quint;
