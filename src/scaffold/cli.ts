/**
 * The scaffold commands:
 *
 *   node src/cli.ts scaffold component <folder> "<intent>"
 *   node src/cli.ts scaffold invariant <componentFolder> "<sentence>" [--name "<name>"] --kinds a,b [--chokepoint|--totality-oracle] [--crossing "a -> b"] [--preview] [--write]
 *   node src/cli.ts scaffold control "<entrance>" | --all [--as guard|invariant|none] [--guard <symbol>] [--reason "<why>"] [--write]
 *   node src/cli.ts scaffold control --baseline --session <id> --agent <name>
 *
 * The control verb proposes the closure for an entrance with no traced
 * control (control.ts) from the recorded Structure reading when it still
 * describes the tree, else from a reading taken now and recorded.
 *
 * The invariant bullet prints on stdout with every absent slot as a
 * placeholder; the applicable checklist shapes print on stderr as guidance.
 * --preview writes an ephemeral Scope page in the system temporary directory;
 * --write independently appends the bullet to the component's spec.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { JournalError, parseFlags } from "../journal/args.ts";
import type { Io } from "../journal/cli.ts";
import { writeStructurePreview } from "../readings/scope/build.ts";
import type { StructurePreview } from "../readings/scope/derive.ts";
import { loadSeed } from "../spec/seed.ts";
import { readEnforcementConfig } from "../enforcement/config.ts";
import { cliName } from "../lifecycle/hook.ts";
import { BUDGET_FLAGS, budgetFlags, readComponentInterfaces } from "../readings/scope/component-interfaces.ts";
import { freshReading, gapsOf, readAndRecord, recordGapBaseline, structureState } from "../readings/scope/gaps.ts";
import { flowOf, flowPartialText } from "../readings/scope/structure-flow.ts";
import { proposeClosures, renderAll, renderProposal, writeClosure, type Closure, type Proposal } from "./control.ts";
import { appendInvariant, componentDir, parseCrossing, renderGuidance, renderInvariant, scaffoldComponent, ScaffoldError, specsIn, type Form } from "./scaffold.ts";

export const SCAFFOLD_USAGE = [
  '  scaffold component <folder> "<intent>"',
  '  scaffold invariant <componentFolder> "<sentence>" [--name "<name>"] --kinds <a,b|none> [--chokepoint|--totality-oracle] [--crossing "<level> -> <level>"] [--preview] [--write]',
  `  scaffold control "<entrance>" | --all [--component <folder>] [--as guard|invariant|none] [--guard <symbol>] [--reason "<why>"] [--write] ${BUDGET_FLAGS}   the closure for an entrance with no traced control: a guard: line, an invariant, or control: none`,
  "  scaffold control --baseline --session <id> --agent <name>   record the entrances with no traced control at adoption, so orient names only new ones",
].join("\n");

function usage(message: string): never {
  throw new ScaffoldError(`${message}\n${SCAFFOLD_USAGE}`);
}

function componentVerb(argv: string[], io: Io): void {
  const parsed = parseFlags(argv, {});
  const [folder, intent, ...rest] = parsed.positionals;
  if (folder === undefined || intent === undefined) usage("scaffold component takes a folder and an intent");
  if (rest.length > 0) usage(`unexpected argument "${rest[0]}"; quote the intent`);
  const result = scaffoldComponent(io.cwd, folder, intent);
  io.out(`wrote ${result.path}`);
  if (resolve(io.cwd, folder) === resolve(io.cwd)) {
    io.err("this is the entry spec: add ## trust levels (one bullet per level, name: meaning) before the invariants so crossings can name them");
  }
}

function previewPath(): string {
  return join(mkdtempSync(join(tmpdir(), "coherence-scaffold-preview-")), "scope.html");
}

function invariantVerb(argv: string[], io: Io): void | Promise<void> {
  const parsed = parseFlags(argv, {
    name: "one",
    kinds: "one",
    crossing: "one",
    chokepoint: "switch",
    "totality-oracle": "switch",
    preview: "switch",
    write: "switch",
  });
  const [folder, sentence, ...rest] = parsed.positionals;
  if (folder === undefined || sentence === undefined) usage("scaffold invariant takes a component folder and a sentence");
  if (rest.length > 0) usage(`unexpected argument "${rest[0]}"; quote the sentence`);
  if (parsed.switches.has("chokepoint") && parsed.switches.has("totality-oracle")) usage("--chokepoint or --totality-oracle, not both");
  const form: Form = parsed.switches.has("totality-oracle") ? "totality oracle" : "chokepoint";
  const dir = componentDir(io.cwd, folder);
  const component = relative(resolve(io.cwd), dir).split(sep).join("/") || ".";
  const specs = specsIn(dir);
  if (specs.length === 0) throw new ScaffoldError(`${folder} holds no spec; scaffold component ${folder} "<intent>" first`);
  const crossingText = parsed.one.get("crossing");
  if (parsed.switches.has("preview") && crossingText === undefined) usage('--preview requires --crossing "<trust level> -> <trust level>"');
  const crossing = crossingText === undefined ? undefined : parseCrossing(crossingText);
  const kindsText = parsed.one.get("kinds");
  const kinds =
    kindsText === undefined
      ? undefined
      : kindsText.trim() === "none"
        ? "none"
        : kindsText.split(",").map((kind) => kind.trim()).filter((kind) => kind !== "");
  const seed = loadSeed();
  const name = parsed.one.get("name") ?? "<name>";
  const { bullet, shapes } = renderInvariant(seed, { sentence, name: parsed.one.get("name"), kinds, form, crossing });

  const finish = (outPath?: string): void => {
    if (parsed.switches.has("write")) {
      const specPath = join(dir, specs[0]!);
      appendInvariant(specPath, bullet);
      io.out(bullet.trimEnd());
      io.out(`appended to ${specPath}`);
    } else {
      io.out(bullet.trimEnd());
    }
    if (outPath !== undefined) io.out(`preview wrote ${outPath}`);
    if (kinds === undefined) io.err(`no --kinds given: name the kinds of thing protected (${Object.keys(seed.kinds).join(", ")}) or none, and the checklist follows`);
    const guidance = renderGuidance(shapes);
    if (guidance !== "") io.err(guidance.trimEnd());
  };

  if (!parsed.switches.has("preview")) {
    finish();
    return;
  }

  // Preview validation and rendering happen before the optional spec write, so
  // an invalid component or trust-level endpoint cannot leave a partial edit.
  const proposal: StructurePreview = { component, name, crossing: crossing! };
  const outPath = previewPath();
  return writeStructurePreview(io.cwd, proposal, outPath).then(
    () => finish(outPath),
    (error: unknown) => {
      throw new ScaffoldError(error instanceof Error ? error.message : String(error));
    },
  );
}

/** The Structure model the control verb proposes from: the recorded reading while it describes the tree, else one read now (and recorded). */
async function controlModel(root: string, io: Io, values: ReadonlyMap<string, string>) {
  const fresh = freshReading(root);
  let reading = fresh?.reading;
  if (reading === undefined) {
    const budget = budgetFlags(values);
    if (typeof budget === "string") usage(budget);
    io.err("reading the component interfaces through the language adapter (no recorded reading describes this tree); this can take minutes");
    reading = await readAndRecord(root, () => readComponentInterfaces(root, undefined, { budget }));
  }
  if (reading.kind !== "read") throw new ScaffoldError(`the component interfaces could not be read (${reading.because}), so no route's controls are known`);
  const state = structureState(root, reading);
  const model = flowOf(state);
  const partial = flowPartialText(model);
  if (partial !== undefined) io.err(`${partial}; a gap below may only be a route the reading did not finish`);
  return { state, model };
}

const CLOSURE_KINDS = ["guard", "invariant", "none"] as const;

/** The closure --as names, or the proposed one; a guard with rivals needs --guard to choose. */
function chosen(p: Proposal, as: string | undefined, guard: string | undefined): Closure {
  const kind = as ?? p.closures[0]!.kind;
  if (!(CLOSURE_KINDS as readonly string[]).includes(kind)) usage(`--as takes ${CLOSURE_KINDS.join(", ")}`);
  const candidates = p.closures.filter((c) => c.kind === kind);
  if (kind === "guard") {
    if (candidates.length === 0) throw new ScaffoldError(`no verified chokepoint is traced on ${p.entrance.name}'s handler or called by it, so there is no guard: line to write; close it with --as invariant or --as none`);
    const pick = guard === undefined ? candidates[0]! : candidates.find((c) => c.kind === "guard" && c.symbol === guard);
    if (pick === undefined) throw new ScaffoldError(`${p.entrance.name}'s handler does not call ${guard}; it calls ${candidates.map((c) => (c.kind === "guard" ? c.symbol : "")).join(", ")}`);
    if (pick.kind === "guard" && pick.rivals.length > 0 && guard === undefined) throw new ScaffoldError(`${pick.invariant}'s module has several symbols the route's handlers call (${pick.rivals.join(", ")}); choose the one that applies its check with --guard <symbol>`);
    return pick;
  }
  return candidates[0]!;
}

async function controlVerb(argv: string[], io: Io): Promise<void> {
  const parsed = parseFlags(argv, {
    all: "switch",
    write: "switch",
    baseline: "switch",
    as: "one",
    guard: "one",
    reason: "one",
    component: "one",
    session: "one",
    agent: "one",
    work: "one",
    because: "one",
    cite: "many",
    "interface-seconds": "one",
    "interface-memory": "one",
  });
  const root = io.cwd;
  const [name, ...rest] = parsed.positionals;
  if (rest.length > 0) usage(`unexpected argument "${rest[0]}"; quote the entrance's name`);
  const all = parsed.switches.has("all");
  const baseline = parsed.switches.has("baseline");
  if (baseline && (all || name !== undefined || parsed.switches.has("write"))) usage("--baseline takes no entrance, --all or --write");
  if (!baseline && (name === undefined) === !all) usage("scaffold control takes an entrance's name, or --all");
  const { state, model } = await controlModel(root, io, parsed.one);
  if (baseline) {
    const session = parsed.one.get("session");
    const agent = parsed.one.get("agent");
    if (session === undefined || agent === undefined) usage("--baseline records a journal decision: pass --session <id> --agent <name>");
    const work = parsed.one.get("work");
    const cite = parsed.many.get("cite");
    io.out(recordGapBaseline(root, gapsOf(state, model), { session, agent, ...(work === undefined ? {} : { work }), ...(cite === undefined ? {} : { cite }) }, parsed.one.get("because")));
    return;
  }
  const proposals = proposeClosures(root, state, model, readEnforcementConfig(root).language);
  const cli = await cliName(root);
  const as = parsed.one.get("as");
  const guard = parsed.one.get("guard");
  if (all) {
    io.out(renderAll(proposals, cli));
    if (!parsed.switches.has("write")) return;
    if (as !== undefined && as !== "guard") usage("--all --write writes only guard: lines; write an invariant or control: none one entrance at a time");
    // Bottom-up within each spec, so an inserted line never moves a bullet still to be written.
    const writable = proposals
      .filter((p) => p.closures[0]!.kind === "guard")
      .filter((p) => { const c = p.closures[0]!; return c.kind === "guard" && (guard === undefined ? c.rivals.length === 0 : c.symbol === guard); })
      .sort((a, b) => a.specPath.localeCompare(b.specPath) || b.declared.line - a.declared.line);
    for (const p of writable) io.out(`wrote ${writeClosure(root, p, p.closures[0]!)}`);
    if (writable.length === 0) io.err("no guard: line was written: none is proposed, or each is a choice between symbols (--guard <symbol> makes it)");
    return;
  }
  const component = parsed.one.get("component");
  const matches = proposals.filter((p) => p.entrance.name === name && (component === undefined || p.entrance.owners[0] === component));
  if (matches.length === 0) {
    const declared = model.entrances.filter((e) => e.name === name && (component === undefined || e.owners[0] === component));
    if (declared.length === 0) throw new ScaffoldError(`no entrance is named ${JSON.stringify(name)}; query structure lists them`);
    const e = declared[0]!;
    const route = model.routes.find((r) => r.entrances.includes(e.id));
    io.out(`${e.name} needs no closure: ${e.noControl !== undefined ? `it declares control: none — ${e.noControl}` : route === undefined ? `it has no route (${e.reason ?? "unresolved"})` : route.traced.length > 0 ? `its route is controlled (${route.traced.map((c) => c.name).join(", ")})` : "it carries trust inside the system's control in"}.`);
    return;
  }
  if (matches.length > 1) usage(`${matches.length} components declare an entrance named ${JSON.stringify(name)} (${matches.map((p) => p.entrance.owners[0]).join(", ")}); choose with --component <folder>`);
  const p = matches[0]!;
  if (as !== undefined && !(CLOSURE_KINDS as readonly string[]).includes(as)) usage(`--as takes ${CLOSURE_KINDS.join(", ")}`);
  // --as puts the chosen closure first, so what is printed is what --write would write.
  const shown: Proposal = as === undefined ? p : { ...p, closures: [...p.closures.filter((c) => c.kind === as), ...p.closures.filter((c) => c.kind !== as)] };
  io.out(renderProposal(shown, cli));
  if (!parsed.switches.has("write")) return;
  io.out(`wrote ${writeClosure(root, p, chosen(p, as, guard), parsed.one.get("reason"))}`);
}

function scaffoldFailure(error: unknown, io: Io): number {
  if (error instanceof ScaffoldError || error instanceof JournalError) {
    io.err(`scaffold: ${error.message}`);
    return 1;
  }
  throw error;
}

/** Synchronous shapes return a number; preview returns the rendering promise. */
export function scaffoldCommand(argv: string[], io: Io): number | Promise<number> {
  const [shape, ...rest] = argv;
  try {
    if (shape === "component") {
      componentVerb(rest, io);
      return 0;
    }
    if (shape === "invariant") {
      const result = invariantVerb(rest, io);
      return result === undefined ? 0 : result.then(() => 0, (error: unknown) => scaffoldFailure(error, io));
    }
    if (shape === "control") return controlVerb(rest, io).then(() => 0, (error: unknown) => scaffoldFailure(error, io));
    usage('scaffold takes "component", "invariant" or "control"');
  } catch (error) {
    return scaffoldFailure(error, io);
  }
}
