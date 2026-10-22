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
import { createServer } from "node:net";
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
  const deadline = Date.now() + verifierBudget(request.timeoutMs);
  const scratch = mkdtempSync(join(tmpdir(), "coherence-quint-"));
  try {
    let last: QuintResult | undefined;
    const step = async (name: string, argv: string[]): Promise<VerifyResult | undefined> => {
      const left = deadline - Date.now();
      const result: QuintResult = left <= 0 ? { outcome: "timeout", command: `quint ${argv[0]}`, stdout: "", stderr: "", reason: "no time was left for it" } : await runQuint(argv, scratch, left);
      last = result;
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
    // What the simulation reached, read from quint's own statistics: a run that never left its initial state, or never had one, proved nothing of later steps.
    const lengths = traceLengths(last!.stdout);
    if (lengths === undefined) return { verdict: "not run", reason: `quint run reported no trace length statistics for ${model}, so how deep it looked cannot be said` };
    if (lengths.max === 0) return { verdict: "not run", reason: `no initial state: quint run found no state satisfying ${model}'s init, so ${property} was checked of nothing` };
    const depth = lengths.max - 1;
    const short = depth < config.maxSteps ? `, short of the ${config.maxSteps} steps asked: no trace went further, so nothing past step ${depth} was seen` : "";
    const sampled = `no violation of ${property} in ${config.maxSamples} sampled traces of ${model} (max depth ${depth}${short}; ${config.backend} backend)`;
    if (request.form === "quint run") return { verdict: "pass", reason: sampled };
    const checked = await step("verify", ["verify", file, "--invariant", property, "--max-steps", String(config.verifySteps), "--server-endpoint", `localhost:${await freePort()}`]);
    if (checked !== undefined) return checked;
    return { verdict: "pass", reason: `${sampled}; and none in Apalache's bounded model check within ${config.verifySteps} steps, a bound, not every reachable state` };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Quint's trace length statistics (states per trace, the initial one included), or undefined when it printed none. */
export function traceLengths(stdout: string): { max: number; min: number } | undefined {
  const match = /Trace length statistics: max=(\d+), min=(\d+)/.exec(stdout);
  return match === null ? undefined : { max: Number(match[1]), min: Number(match[2]) };
}

/**
 * How much of the core's timeout the plugin spends, so its own deadline
 * always falls inside the core's and a step out of time reads not run here:
 * two seconds short, or a quarter short when the timeout is under eight.
 */
export function verifierBudget(timeoutMs: number): number {
  return timeoutMs - Math.max(1, Math.min(2000, Math.floor(timeoutMs / 4)));
}

/** A port nothing listens on now, for an Apalache server of this proof's own: quint verify would otherwise reuse any server on the default port. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => resolve(port));
    });
  });
}

/** The states quint printed for a violation, short enough for a reason. */
function counterexample(result: QuintResult): string {
  const text = result.stdout.split("\n").filter((l) => l.trim() !== "" && !/^Use --/.test(l)).join(" ");
  return text.length > 600 ? `${text.slice(0, 600)}…` : text;
}

const quint: PluginModule = { verify };

export default quint;
