/**
 * The verifier role: a bullet proved by a plugin rather than a test.
 *
 *   via: [<form>] <name>
 *
 * The bracketed form is one a loaded plugin declares in its manifest; the
 * rest is the name the plugin is asked to prove. A test title never starts
 * with a bracketed form, so the two never read as each other, and a bracketed
 * form no loaded plugin declares is a spec problem naming the forms that are
 * (src/spec/model.ts), never a test run under that title. The verdict is
 * graded as a test's is: pass, fail, or not run with why; the run entry
 * records the plugin and the evidence label its manifest gives the form.
 */

import { spawn } from "../lifecycle/work-meter.ts";
import type { TotalityResult } from "../enforcement/totality.ts";
import type { LoadedPlugin, PluginTag } from "./plugin.ts";
import { tagOf } from "./plugin.ts";
import { moduleOf, verifierForms, verifierOf } from "./registry.ts";

const VIA_FORM = /^\[([^\]]*)\]\s*(.*)$/;

/** A via that names a form: the form and the name, whether or not any plugin declares the form; undefined for a test title. */
export function viaForm(via: string): { form: string; name: string } | undefined {
  const match = VIA_FORM.exec(via.trim());
  return match === null ? undefined : { form: match[1]!.trim(), name: match[2]!.trim() };
}

/** Why a via form cannot be proved by the loaded plugins, or undefined when one declares it. */
export function viaFormProblem(via: string, plugins: readonly LoadedPlugin[]): string | undefined {
  const form = viaForm(via);
  if (form === undefined) return undefined;
  if (form.name === "") return `via [${form.form}] names nothing to prove; write via: [${form.form}] <name>`;
  if (verifierOf(plugins, form.form) !== undefined) return undefined;
  const loaded = verifierForms(plugins);
  return `via [${form.form}] is a form no loaded plugin proves; ${loaded.length === 0 ? (plugins.length === 0 ? "the config runs no plugins" : `the plugins loaded (${plugins.map((p) => p.name).join(", ")}) prove no via form`) : `the forms loaded: ${loaded.join(", ")}`}`;
}

/** A verifier's result as a totality oracle's, with who proved it and what kind of evidence a pass is. */
export interface VerifierOutcome extends TotalityResult {
  plugins: PluginTag[];
  evidence: string;
}

function tailOf(output: string, lines = 12): string {
  return output.split("\n").filter((l) => l.trim() !== "").slice(-lines).join("\n");
}

/** Run a manifest's command with the name in place of {name}, from the root: exit 0 is a pass, and with `match`, only when its output matches too. */
function runCommand(root: string, argv: readonly string[], name: string, timeoutMs: number, match: RegExp | undefined): Promise<TotalityResult> {
  const [command, ...args] = argv.map((a) => a.split("{name}").join(name));
  const shown = [command!, ...args].map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ");
  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    const finish = (result: TotalityResult): void => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    let child;
    try {
      child = spawn(command!, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      finish({ verdict: "not run", reason: `the verifier's command could not start: ${error instanceof Error ? error.message : String(error)}`, command: shown, tail: "" });
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ verdict: "fail", reason: `the verifier did not finish in ${Math.round(timeoutMs / 1000)} s and was killed`, command: shown, tail: tailOf(output), unfinished: true });
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({ verdict: "not run", reason: `the verifier's command could not start: ${error.message}`, command: shown, tail: "" });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) finish({ verdict: "fail", reason: `${shown} exited ${code}`, command: shown, tail: tailOf(output) });
      else if (match !== undefined && !match.test(output)) finish({ verdict: "fail", reason: `${shown} exited 0 but its output did not match ${match}; nothing was proved under that name`, command: shown, tail: tailOf(output) });
      else finish({ verdict: "pass", reason: `${shown} exited 0${match === undefined ? "" : ` and its output matched ${match}`}`, command: shown, tail: "" });
    });
  });
}

/** Prove a via that names a form through the plugin that declares it. */
export async function proveVia(root: string, plugins: readonly LoadedPlugin[], via: string, timeoutMs: number, component = "."): Promise<VerifierOutcome> {
  const form = viaForm(via)!;
  const found = verifierOf(plugins, form.form);
  if (found === undefined) return { verdict: "not run", reason: viaFormProblem(via, plugins)!, command: undefined, tail: "", plugins: [], evidence: "none" };
  const { plugin, verifier } = found;
  const who = { plugins: [tagOf(plugin)], evidence: verifier.evidence };
  const label = `plugin ${plugin.name} (${plugin.version}), ${verifier.evidence}`;
  if (verifier.command !== undefined) {
    const result = await runCommand(root, verifier.command, form.name, timeoutMs, verifier.match === undefined ? undefined : new RegExp(verifier.match));
    return { ...result, reason: `${label}: ${result.reason}`, ...who };
  }
  try {
    const module = await moduleOf(plugin);
    if (typeof module.verify !== "function") return { verdict: "not run", reason: `${label}: its module exports no verify for [${form.form}]`, command: undefined, tail: "", ...who };
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<{ verdict: "fail"; reason: string }>((resolve) => {
      timer = setTimeout(() => resolve({ verdict: "fail", reason: `did not answer in ${Math.round(timeoutMs / 1000)} s` }), timeoutMs);
    });
    const answer = await Promise.race([module.verify({ root, component, form: form.form, name: form.name, timeoutMs }), late]).finally(() => clearTimeout(timer));
    return { verdict: answer.verdict, reason: `${label}: ${answer.reason}`, command: undefined, tail: "", ...who };
  } catch (error) {
    return { verdict: "not run", reason: `${label}: ${error instanceof Error ? error.message : String(error)}`, command: undefined, tail: "", ...who };
  }
}
