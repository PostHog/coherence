/**
 * The dbt adapter: dbt's parsed manifest is the instrument. dbt already
 * knows every dependency in the project exactly (a model's `ref` and
 * `source` calls, a test's attachment to the model it tests), so the adapter
 * never parses SQL for structure; it reads the manifest, and reads the text
 * only to say where each dependency is written.
 *
 *   resolve      a model by name (`orders`), by name in its file
 *                (`orders in models/sales/orders.sql`), a model file as a
 *                module (`models/sales/orders.sql`), or a folder of models
 *                as a module (`models/sales/lines/`), whose members are
 *                every model file under it
 *   references   one site per `depends_on` edge into the definition, at the
 *                `ref(...)` or `source(...)` call that writes it, or at the
 *                `name:` line of a YAML test; line 1 when no literal call is
 *                found. The manifest decides what depends on what, so no edge
 *                is ever dropped. A site whose referencing resource is a dbt
 *                test carries `testResource`, wherever its file lies
 *   visibility   reference-choked: any model may `ref` a model whose access
 *                is protected or public
 *   refute       stage, in memory, one model beside the chokepoint that reads
 *                the chokepoint and the protected thing directly, and report
 *                the site the same edge reading gives it; nothing touches disk
 *
 * A manifest older than any dbt file in the project is an answer the
 * instrument cannot confirm. When a parse command is configured the adapter
 * runs it and reads the result; otherwise, or when the parse fails, every
 * question it is asked throws, and the run records not run, never pass.
 *
 * The manifest is dbt's own `target/manifest.json`. A project that committed
 * the normalized snapshot the reference implementation's dbt extension wrote
 * (`.coherence/dbt-manifest.json`, version 1 or 2) may name it instead with
 * `dbt.snapshot`; every reason and evidence line then says the answer came
 * from the snapshot.
 */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { parseName, type Definition, type Ladder, type LanguageAdapter, type ReferenceSite, type Refutation, type Resolved, type ResolveHint, type Visibility } from "./adapter.ts";
import { projectFiles } from "./project-files.ts";

const COHERENCE_ENFORCER = "Coherence's check at the edit and in CI";

export const DBT_LADDER: Ladder = {
  top: "reference-choked",
  because: "dbt refuses a ref only to a model whose access is private, from outside its group; a model whose access is protected or public may be read by any model in the project, so Coherence's check is the enforcer",
  rungs: [{ grade: "reference-choked", enforcer: COHERENCE_ENFORCER, fact: "no bypass among the manifest's dependency edges; the top rung while the protected models' access lets any model ref them" }],
};

/** What the project's config says about dbt, from the `dbt` key of coherence.config.json. */
export interface DbtSettings {
  /** The manifest the adapter reads, project-relative. */
  manifest: string;
  /** Whether that file is the reference implementation's normalized snapshot rather than dbt's own manifest. */
  snapshot: boolean;
  /** The command that writes the manifest (`dbt parse`); absent, a stale manifest is only reported. */
  parse: string[] | string | undefined;
  /** How long one parse may take. */
  parseTimeoutMs: number;
  /** The dbt test runner: the same keys the project-wide runner takes, with the filter written as dbt test names. */
  test: string[] | string | undefined;
  testJson: string[] | string | undefined;
  testMatch: RegExp | undefined;
  testTimeoutMs: number | undefined;
}

export const DEFAULT_MANIFEST = "target/manifest.json";
export const PARSE_TIMEOUT_MS = 5 * 60 * 1000;

function commandValue(value: unknown): string[] | string | undefined {
  if (Array.isArray(value) && value.length > 0 && value.every((v): v is string => typeof v === "string")) return value;
  if (typeof value === "string" && value.trim() !== "") return value;
  return undefined;
}

function positive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** The `dbt` key of the config, or undefined when the config has none. */
export function dbtSettingsFrom(value: unknown, where: string): DbtSettings | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${where}: dbt must be an object`);
  const record = value as Record<string, unknown>;
  const snapshot = record["snapshot"];
  if (snapshot !== undefined && (typeof snapshot !== "string" || snapshot === "")) throw new Error(`${where}: dbt.snapshot must name a file`);
  const manifest = record["manifest"];
  if (manifest !== undefined && (typeof manifest !== "string" || manifest === "")) throw new Error(`${where}: dbt.manifest must name a file`);
  let testMatch: RegExp | undefined;
  if (typeof record["testMatch"] === "string" && record["testMatch"] !== "") {
    try {
      testMatch = new RegExp(record["testMatch"]);
    } catch (error) {
      throw new Error(`${where}: dbt.testMatch is not a regular expression (${(error as Error).message})`);
    }
  }
  return {
    manifest: typeof snapshot === "string" ? snapshot : typeof manifest === "string" ? manifest : DEFAULT_MANIFEST,
    snapshot: typeof snapshot === "string",
    parse: commandValue(record["parse"]),
    parseTimeoutMs: positive(record["parseTimeoutMs"]) ?? PARSE_TIMEOUT_MS,
    test: commandValue(record["test"]),
    testJson: commandValue(record["testJson"]),
    testMatch,
    testTimeoutMs: positive(record["testTimeoutMs"]),
  };
}

/** The `dbt` key of the project's coherence.config.json, read on its own. */
export function readDbtSettings(root: string): DbtSettings | undefined {
  const path = join(root, "coherence.config.json");
  if (!existsSync(path)) return undefined;
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null) return undefined;
  return dbtSettingsFrom((parsed as Record<string, unknown>)["dbt"], path);
}

/* ------------------------------------------------------------ the manifest */

/** One resource of the project as the adapter reasons over it. */
export interface DbtResource {
  id: string;
  /** model, test, seed, snapshot, source, analysis. */
  type: string;
  name: string;
  /** Project-relative; for a test declared in YAML, the YAML file. */
  file: string | undefined;
  dependsOn: string[];
  access?: string | undefined;
  group?: string | undefined;
  /** The text dbt read, where the manifest carries it. */
  code?: string | undefined;
}

export interface DbtManifest {
  project: string;
  /** Where it was read from, for every reason the adapter gives. */
  source: string;
  resources: DbtResource[];
}

const RESOURCE_TYPES = new Set(["model", "test", "seed", "snapshot", "source", "analysis", "unit_test"]);

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** dbt's own manifest or the reference's normalized snapshot, as resources. */
export function readManifestText(raw: string, source: string): DbtManifest {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) throw new Error(`${source} is not a dbt manifest`);
  const record = parsed as Record<string, unknown>;
  // The reference's snapshot: { version: 1 | 2, project, resources: [{ uniqueId, resourceType, name, originalFilePath, dependsOn }] }.
  if (Array.isArray(record["resources"])) {
    const resources = (record["resources"] as Record<string, unknown>[]).flatMap((r): DbtResource[] => {
      const id = text(r["uniqueId"]);
      const type = text(r["resourceType"]);
      const name = text(r["name"]);
      if (id === undefined || type === undefined || name === undefined) return [];
      return [{ id, type, name, file: text(r["originalFilePath"]), dependsOn: strings(r["dependsOn"]) }];
    });
    return { project: text(record["project"]) ?? "", source, resources };
  }
  const nodes = record["nodes"];
  if (typeof nodes !== "object" || nodes === null) throw new Error(`${source} carries neither nodes nor resources: not a dbt manifest`);
  const metadata = (record["metadata"] ?? {}) as Record<string, unknown>;
  const resources: DbtResource[] = [];
  const all = [
    ...Object.values(nodes as Record<string, unknown>),
    ...Object.values((record["sources"] ?? {}) as Record<string, unknown>),
    ...Object.values((record["unit_tests"] ?? {}) as Record<string, unknown>),
  ];
  for (const node of all) {
    if (typeof node !== "object" || node === null) continue;
    const n = node as Record<string, unknown>;
    const id = text(n["unique_id"]);
    const type = text(n["resource_type"]);
    const name = text(n["name"]);
    if (id === undefined || type === undefined || name === undefined || !RESOURCE_TYPES.has(type)) continue;
    const depends = (n["depends_on"] ?? {}) as Record<string, unknown>;
    resources.push({
      id,
      type,
      name,
      file: text(n["original_file_path"]),
      dependsOn: strings(depends["nodes"]),
      access: text(n["access"]),
      group: text(n["group"]) ?? undefined,
      code: text(n["raw_code"]),
    });
  }
  return { project: text(metadata["project_name"]) ?? "", source, resources };
}

/** The test names the manifest holds, with every unique id each resolves to; undefined when there is no manifest to read. */
export function dbtTestIds(root: string, settings: DbtSettings): Map<string, string[]> | undefined {
  const path = join(root, settings.manifest);
  if (!existsSync(path)) return undefined;
  const manifest = readManifestText(readFileSync(path, "utf8"), settings.manifest);
  const out = new Map<string, string[]>();
  for (const r of manifest.resources) if (r.type === "test") out.set(r.name, [...(out.get(r.name) ?? []), r.id]);
  return out;
}

/* ------------------------------------------------------------ dbt's files */

const DEFAULT_PATHS: Record<string, string[]> = {
  "model-paths": ["models"],
  "test-paths": ["tests"],
  "seed-paths": ["seeds"],
  "snapshot-paths": ["snapshots"],
  "macro-paths": ["macros"],
  "analysis-paths": ["analyses"],
};

/** The folders dbt reads, from dbt_project.yml's `*-paths` keys, as a flow list or a block list; each absent key keeps dbt's default. */
export function dbtPaths(projectYml: string): string[] {
  const out: string[] = [];
  for (const [key, fallback] of Object.entries(DEFAULT_PATHS)) {
    const flow = new RegExp(`^${key}:\\s*\\[([^\\]]*)\\]`, "m").exec(projectYml);
    const block = new RegExp(`^${key}:\\s*\\n((?:\\s+-\\s*.+\\n?)+)`, "m").exec(projectYml);
    const listed = flow !== null ? flow[1]!.split(",") : block !== null ? block[1]!.split("\n").map((l) => l.replace(/^\s*-\s*/, "")) : fallback;
    for (const entry of listed) {
      const path = entry.trim().replace(/^["']|["']$/g, "").replace(/\/+$/, "");
      if (path !== "") out.push(path);
    }
  }
  return [...new Set(out)];
}

const DBT_EXTENSIONS = /\.(sql|ya?ml|csv|py|md)$/;

/** Every project file dbt reads: under its paths with a dbt extension, and the project and package files at the root. */
export function dbtFiles(root: string): string[] {
  const projectYml = join(root, "dbt_project.yml");
  const paths = existsSync(projectYml) ? dbtPaths(readFileSync(projectYml, "utf8")) : Object.values(DEFAULT_PATHS).flat();
  return projectFiles(root).filter(
    (file) => file === "dbt_project.yml" || file === "packages.yml" || file === "dependencies.yml" || (DBT_EXTENSIONS.test(file) && paths.some((p) => file.startsWith(p + "/"))),
  );
}

/* ------------------------------------------------------------ the adapter */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Where a resource's text names the target: a ref or source call, or the YAML `name:` line a test hangs under. */
export function locate(text: string, target: DbtResource, yaml: boolean): { line: number; character: number } | undefined {
  const patterns: RegExp[] = [];
  if (target.type === "source") {
    // A source's unique id is source.<package>.<source>.<table>.
    const [, , source, table] = target.id.split(".");
    if (source !== undefined && table !== undefined) patterns.push(new RegExp(`\\bsource\\(\\s*["']${escapeRegExp(source)}["']\\s*,\\s*["']${escapeRegExp(table)}["']`));
  } else {
    patterns.push(new RegExp(`\\bref\\(\\s*(?:["'][\\w.-]+["']\\s*,\\s*)?["']${escapeRegExp(target.name)}["']`));
  }
  if (yaml) patterns.push(new RegExp(`^\\s*-?\\s*name:\\s*["']?${escapeRegExp(target.name)}["']?\\s*$`));
  const lines = text.split("\n");
  for (const pattern of patterns) {
    for (let i = 0; i < lines.length; i++) {
      const match = pattern.exec(lines[i]!);
      if (match !== null) return { line: i + 1, character: match.index + (match[0].length - match[0].trimStart().length) };
    }
  }
  return undefined;
}

export type Parser = (command: string[] | string, root: string, timeoutMs: number) => { ok: boolean; output: string };

function runParse(command: string[] | string, root: string, timeoutMs: number): { ok: boolean; output: string } {
  const run = Array.isArray(command)
    ? spawnSync(command[0]!, command.slice(1), { cwd: root, encoding: "utf8", timeout: timeoutMs })
    : spawnSync(command, { cwd: root, encoding: "utf8", timeout: timeoutMs, shell: true });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}${run.error === undefined ? "" : run.error.message}`;
  return { ok: run.status === 0, output };
}

export class DbtAdapter implements LanguageAdapter {
  readonly language = "dbt";
  readonly ladder = DBT_LADDER;
  readonly root: string;
  private readonly settings: DbtSettings;
  private readonly parser: Parser;
  private manifest: DbtManifest | undefined;
  private manifestTime = 0;
  /** Why the instrument cannot answer; every question throws it until a refresh clears it. */
  private stale: string | undefined;
  private refreshed = false;
  private readonly texts = new Map<string, string[] | undefined>();
  /** The last parse's latency, for the server's log and the measurement. */
  parseLatency: number | undefined;

  constructor(root: string, settings?: DbtSettings, parser: Parser = runParse) {
    this.root = root;
    this.settings = settings ?? readDbtSettings(root) ?? { manifest: DEFAULT_MANIFEST, snapshot: false, parse: undefined, parseTimeoutMs: PARSE_TIMEOUT_MS, test: undefined, testJson: undefined, testMatch: undefined, testTimeoutMs: undefined };
    this.parser = parser;
  }

  private label(): string {
    return this.settings.snapshot ? `the committed snapshot ${this.settings.manifest} (not dbt's own manifest)` : this.settings.manifest;
  }

  /** The newest dbt file and its time, when it is newer than the manifest. */
  private newerThanManifest(): { file: string; at: number } | undefined {
    const at = this.manifestMtime();
    if (at === undefined) return undefined;
    let newest: { file: string; at: number } | undefined;
    for (const file of dbtFiles(this.root)) {
      let time: number;
      try {
        time = statSync(join(this.root, file)).mtimeMs;
      } catch {
        continue;
      }
      if (time > at && (newest === undefined || time > newest.at)) newest = { file, at: time };
    }
    return newest;
  }

  private manifestMtime(): number | undefined {
    try {
      return statSync(join(this.root, this.settings.manifest)).mtimeMs;
    } catch {
      return undefined;
    }
  }

  /** Make the manifest current: parse when it is missing or older than a dbt file and a parse is configured, then read it. */
  private refresh(): void {
    this.refreshed = true;
    this.stale = undefined;
    const missing = this.manifestMtime() === undefined;
    const newer = missing ? undefined : this.newerThanManifest();
    if ((missing || newer !== undefined) && this.settings.parse !== undefined && !this.settings.snapshot) {
      const t0 = Date.now();
      const parsed = this.parser(this.settings.parse, this.root, this.settings.parseTimeoutMs);
      this.parseLatency = Date.now() - t0;
      if (!parsed.ok) {
        const tail = parsed.output.split("\n").filter((l) => l.trim() !== "").slice(-3).join(" | ");
        this.stale = `the dbt parse command failed, so ${this.label()} cannot be confirmed: ${tail}`;
        return;
      }
    }
    const at = this.manifestMtime();
    if (at === undefined) {
      this.stale = `no manifest at ${this.label()}; run dbt parse, or configure dbt.parse so the adapter runs it`;
      return;
    }
    const still = this.newerThanManifest();
    if (still !== undefined) {
      this.stale = `${this.label()} is older than ${still.file}, so it cannot say what the project's text depends on now${this.settings.parse === undefined || this.settings.snapshot ? "; run dbt parse (or configure dbt.parse)" : ""}`;
      return;
    }
    if (this.manifest === undefined || at !== this.manifestTime) {
      try {
        this.manifest = readManifestText(readFileSync(join(this.root, this.settings.manifest), "utf8"), this.label());
        this.manifestTime = at;
      } catch (error) {
        this.stale = `${this.label()} could not be read: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }

  /** The manifest, current, or a thrown reason: an answer the instrument cannot confirm is no answer. */
  private current(): DbtManifest {
    if (!this.refreshed) this.refresh();
    if (this.stale !== undefined || this.manifest === undefined) throw new Error(`dbt instrument: ${this.stale ?? "no manifest read"}`);
    return this.manifest;
  }

  async ready(): Promise<{ ok: true } | { ok: false; reason: string }> {
    this.refresh();
    return this.stale === undefined ? { ok: true } : { ok: false, reason: this.stale };
  }

  /** The models (and seeds and snapshots, which a ref may also name) a definition covers. */
  private targetsOf(definition: Definition, manifest: DbtManifest): DbtResource[] {
    const files = new Set(definition.members ?? [definition.file]);
    return manifest.resources.filter((r) => REFERABLE.has(r.type) && r.file !== undefined && files.has(r.file));
  }

  async resolve(name: string, hint: ResolveHint): Promise<Resolved> {
    const manifest = this.current();
    const form = parseName(name);
    const referable = manifest.resources.filter((r) => REFERABLE.has(r.type) && r.file !== undefined);
    if (form.form === "prose") return { ok: false, reason: `"${name}" is prose: not a model name, a model file, or a folder of models` };
    if (form.form === "symbol") {
      let found = referable.filter((r) => r.name === form.name);
      if (form.fileHint !== undefined) {
        const hinted = form.fileHint;
        found = found.filter((r) => r.file === hinted || r.file === posix.join(hint.component, hinted) || r.file!.endsWith("/" + hinted));
      }
      if (found.length > 1) {
        const preferred = found.filter((r) => hint.component === "." || r.file!.startsWith(hint.component + "/"));
        if (preferred.length === 1) found = preferred;
      }
      if (found.length === 0) return { ok: false, reason: `names no dbt model in ${manifest.source}` };
      if (found.length > 1) return { ok: false, reason: `names ${found.length} dbt models`, candidates: found.map((r) => `${r.name} in ${r.file}`) };
      return { ok: true, definition: this.definition(name, "symbol", found[0]!.file!, undefined) };
    }
    const path = form.path;
    const exact = referable.filter((r) => r.file === path);
    if (exact.length > 0) return { ok: true, definition: this.definition(name, "module", path, undefined) };
    const members = [...new Set(referable.filter((r) => r.file!.startsWith(path + "/")).map((r) => r.file!))].sort();
    if (members.length === 0) return { ok: false, reason: `${path} holds no dbt model in ${manifest.source}` };
    return { ok: true, definition: this.definition(name, "module", path + "/", members) };
  }

  private definition(name: string, kind: "symbol" | "module", file: string, members: string[] | undefined): Definition {
    // A model is its whole file: dbt has no smaller unit a ref can name.
    const lines = members === undefined ? (this.lines(file)?.length ?? 1) : 1;
    return { name, kind, file, range: { start: { line: 0, character: 0 }, end: { line: lines, character: 0 } }, selection: { line: 0, character: 0 }, ...(members === undefined ? {} : { members }) };
  }

  private lines(file: string): string[] | undefined {
    if (!this.texts.has(file)) {
      let lines: string[] | undefined;
      try {
        lines = readFileSync(join(this.root, file), "utf8").split("\n");
      } catch {
        lines = undefined;
      }
      this.texts.set(file, lines);
    }
    return this.texts.get(file);
  }

  /** One site per edge into the targets, from the given resources; the text of a resource not on disk comes from `inMemory`. */
  private sitesInto(targets: readonly DbtResource[], resources: readonly DbtResource[], inMemory?: ReadonlyMap<string, string>): ReferenceSite[] {
    const byId = new Map(targets.map((t) => [t.id, t]));
    const sites: ReferenceSite[] = [];
    for (const r of resources) {
      if (r.file === undefined) continue;
      for (const dependency of new Set(r.dependsOn)) {
        const target = byId.get(dependency);
        if (target === undefined) continue;
        const body = inMemory?.get(r.file) ?? this.lines(r.file)?.join("\n") ?? r.code ?? "";
        const at = locate(body, target, /\.ya?ml$/.test(r.file));
        sites.push({
          file: r.file,
          line: at?.line ?? 1,
          character: at?.character ?? 0,
          symbol: r.name,
          ...(r.type === "test" || r.type === "unit_test" ? { testResource: true as const } : {}),
        });
      }
    }
    return sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.character - b.character);
  }

  async references(definition: Definition): Promise<ReferenceSite[]> {
    const manifest = this.current();
    return this.sitesInto(this.targetsOf(definition, manifest), manifest.resources);
  }

  async visibility(definition: Definition): Promise<Visibility> {
    const manifest = this.current();
    const targets = this.targetsOf(definition, manifest);
    const access = [...new Set(targets.map((t) => t.access ?? (this.settings.snapshot ? "unknown (the snapshot carries no access)" : "protected")))].sort();
    return {
      enforced: false,
      visible: true,
      evidence: `${targets.length} model${targets.length === 1 ? "" : "s"} with access ${access.join(", ")}; any model in the project may ref ${targets.length === 1 ? "it" : "them"}`,
      rung: { grade: "reference-choked", enforcer: COHERENCE_ENFORCER, fact: `any model may ref ${definition.name}; every dependency edge into it in ${manifest.source} is inside the chokepoint` },
    };
  }

  testFilter(via: string): string {
    return via;
  }

  /**
   * Stage one model the manifest does not hold: beside the chokepoint (in the folder above a folder chokepoint),
   * reading the chokepoint and the protected thing directly, so it is downstream of the chokepoint and bypasses it.
   * Its site comes from the same edge reading every other site does. Nothing is written.
   */
  async refute(protectedThing: Definition, outsideOf: Definition | undefined): Promise<Refutation> {
    const manifest = this.current();
    const target = this.targetsOf(protectedThing, manifest).sort((a, b) => a.name.localeCompare(b.name))[0];
    if (target === undefined) return { seen: false, staged: [], account: `${protectedThing.name} covers no model, so no model can read it` };
    const door = outsideOf === undefined ? [] : this.targetsOf(outsideOf, manifest).sort((a, b) => a.name.localeCompare(b.name));
    const beside = outsideOf ?? protectedThing;
    const folder = beside.members !== undefined ? posix.dirname(beside.file.replace(/\/+$/, "")) : posix.dirname(beside.file);
    const name = `coherence_refutation_${randomBytes(4).toString("hex")}`;
    const file = folder === "." ? `${name}.sql` : `${folder}/${name}.sql`;
    // A chokepoint that is also the protected thing (a folder of diagnostics nothing may read) has no door to read first.
    const through = door[0] !== undefined && door[0].id !== target.id ? door[0] : undefined;
    const reads = through === undefined ? [target] : [through, target];
    const body = `-- staged by a Coherence refutation; never written to disk\n${reads.map((r, i) => `${i === 0 ? "select * from" : "union all select * from"} {{ ref('${r.name}') }}`).join("\n")}\n`;
    const synthetic: DbtResource = { id: `model.${manifest.project}.${name}`, type: "model", name, file, dependsOn: reads.map((r) => r.id), code: body };
    const site = this.sitesInto([target], [synthetic], new Map([[file, body]])).find((s) => s.file === file);
    const what = `a model at ${file}${through === undefined ? "" : ` downstream of ${through.name}`} that refs ${target.name} directly`;
    return {
      seen: site !== undefined,
      staged: [{ what, ...(site === undefined ? {} : { site }) }],
      account: site === undefined ? `staged ${what} in memory, and the edge reading reported no site for it` : `staged ${what} in memory; the edge reading reported it at ${file}:${site.line}`,
    };
  }

  /** Any edit may change the manifest: drop every text read, and parse again when a dbt file is newer than the manifest. */
  async forget(): Promise<void> {
    this.texts.clear();
    this.refresh();
  }

  async close(): Promise<void> {}
}

/** What a ref can name: a model, a seed, or a snapshot. Sources are named by the staging model that reads them. */
const REFERABLE = new Set(["model", "seed", "snapshot"]);
