/**
 * The Convex adapter: the TypeScript adapter it extends, with the sites that
 * reach a Convex function through the generated API added to its references,
 * and a reference through that API staged in its refutation. Everything else
 * is the TypeScript adapter's answer.
 */

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import {
  horizonFolders,
  languageOfFile,
  outsideOfFolder,
  parseName,
  walkBounds,
  walkedProjectFiles,
  type Definition,
  type LanguageAdapter,
  type ReferenceSite,
  type Refutation,
  type ResolveHint,
} from "../../src/plugins/api.ts";
import { convexBuilder, convexModule, exportedNames, generatedObjectFor, moduleExports } from "./convex-api.ts";
import { ApiReader } from "./convex-reach.ts";

export class ConvexAdapter implements LanguageAdapter {
  readonly language: string;
  readonly ladder: LanguageAdapter["ladder"];
  /** The project's TypeScript sources and its horizon's, project-relative, taken once per forget. */
  private sources: string[] | undefined;
  /** The generated-API reader over the sources, its parses and relays kept until forget. */
  private reader: ApiReader | undefined;
  /** Unsaved documents a refutation stages, by project-relative path: read as sources while they are open. */
  private readonly probes = new Map<string, string>();

  private readonly root: string;
  private readonly base: LanguageAdapter;

  constructor(root: string, base: LanguageAdapter) {
    this.root = root;
    this.base = base;
    this.language = base.language;
    this.ladder = base.ladder;
  }

  ready(): ReturnType<LanguageAdapter["ready"]> {
    return this.base.ready();
  }

  resolve(name: string, hint: ResolveHint): ReturnType<LanguageAdapter["resolve"]> {
    return this.base.resolve(name, hint);
  }

  visibility(definition: Definition, chokepoint?: Definition): ReturnType<LanguageAdapter["visibility"]> {
    return this.base.visibility(definition, chokepoint);
  }

  testFilter(via: string): string {
    return this.base.testFilter(via);
  }

  async forget(files?: readonly string[]): Promise<void> {
    this.sources = undefined;
    this.reader = undefined;
    await this.base.forget(files);
  }

  // The core closes the adapter it handed over; this one started nothing of its own.
  async close(): Promise<void> {}

  serverPid(): number | undefined {
    return this.base.serverPid?.();
  }

  async references(definition: Definition): Promise<ReferenceSite[]> {
    const sites = await this.base.references(definition);
    const seen = new Set(sites.map((s) => `${s.file}:${s.line}:${s.character}`));
    for (const site of this.generatedApiSites(definition)) {
      const key = `${site.file}:${site.line}:${site.character}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sites.push(site);
    }
    return sites;
  }

  async refute(protectedThing: Definition, outsideOf: Definition | undefined, exempt?: string): Promise<Refutation> {
    const refuted = await this.base.refute(protectedThing, outsideOf, exempt);
    const staged = this.stageGeneratedApiUse(protectedThing, exempt);
    if (staged === undefined) return refuted;
    try {
      const site = this.generatedApiSites(protectedThing).find((s) => s.file === staged.file);
      return {
        ...refuted,
        seen: refuted.seen && site !== undefined,
        staged: [...refuted.staged, { what: staged.what, ...(site === undefined ? {} : { site }) }],
        account: `${refuted.account}; ${staged.what} ${site === undefined ? "was not seen" : `was seen at ${site.file}:${site.line}`}`,
      };
    } finally {
      this.probes.delete(staged.file);
    }
  }

  private text(file: string): string | undefined {
    const probe = this.probes.get(file);
    if (probe !== undefined) return probe;
    try {
      return readFileSync(join(this.root, file), "utf8");
    } catch {
      return undefined;
    }
  }

  /** Every TypeScript or JavaScript source of the project and its reference horizon, project-relative, less what Convex generates. */
  private sourcesNow(): string[] {
    if (this.sources !== undefined) return this.sources;
    const own = walkedProjectFiles(walkBounds(this.root, [])).files;
    const horizon = horizonFolders(this.root).flatMap((folder) => walkedProjectFiles(walkBounds(folder, [])).files.map((rel) => relative(this.root, join(folder, rel)).split(sep).join("/")).filter((file) => file.startsWith("../")));
    this.sources = [...own, ...horizon].filter((rel) => languageOfFile(rel) === "typescript" && !/\.d\.[cm]?ts$/.test(rel) && !rel.split("/").includes("_generated"));
    return this.sources;
  }

  /** The names the generated API reaches the definition by: a module's every export, a symbol's exported names. */
  private namesOf(definition: Definition, text: string): string[] {
    if (definition.kind === "module") return moduleExports(definition.file, text);
    const parsed = parseName(definition.name);
    const local = parsed.form === "symbol" ? parsed.name : undefined;
    return local === undefined ? [] : exportedNames(definition.file, text, local);
  }

  /** The sites that reach the definition through its functions folder's generated API, in the sources and any staged document. */
  private generatedApiSites(definition: Definition): ReferenceSite[] {
    const module = convexModule(this.root, definition.file);
    if (module === undefined) return [];
    const text = this.text(definition.file);
    if (text === undefined) return [];
    const target = { ...module, names: this.namesOf(definition, text) };
    if (target.names.length === 0) return [];
    const files = [...new Set([...this.sourcesNow(), ...this.probes.keys()])];
    // A reader per question: a staged document joins the files it may read, and its parses are dropped with it.
    const reader = this.probes.size === 0 ? (this.reader ??= new ApiReader(files, (f) => this.text(f))) : new ApiReader(files, (f) => this.text(f));
    const sites: ReferenceSite[] = [];
    for (const file of files) {
      for (const at of reader.reach(file, target)) sites.push({ file, line: at.line + 1, character: at.character, symbol: at.symbol, ...(at.unread === undefined ? {} : { unread: at.unread }) });
    }
    return sites;
  }

  /**
   * For a registered Convex function, an unsaved document that reaches it
   * through the generated API the way Convex code does, outside any folder the
   * from: line exempts: the one path the language server cannot see, so the
   * refutation proves the check reads it.
   */
  private stageGeneratedApiUse(protectedThing: Definition, exempt: string | undefined): { file: string; what: string } | undefined {
    if (protectedThing.kind !== "symbol") return undefined;
    const module = convexModule(this.root, protectedThing.file);
    const text = this.text(protectedThing.file);
    const parsed = parseName(protectedThing.name);
    if (module === undefined || text === undefined || parsed.form !== "symbol") return undefined;
    const builder = convexBuilder(protectedThing.file, text, module.folder, parsed.name);
    const exported = exportedNames(protectedThing.file, text, parsed.name)[0];
    if (builder === undefined || exported === undefined) return undefined;
    const object = generatedObjectFor(builder);
    // Beside the exempted folder when there is one, else in the functions folder: either way outside the chokepoint's range.
    const beside = exempt === undefined ? (module.folder === "." ? "" : `${module.folder}/`) : outsideOfFolder(exempt);
    if (beside === undefined) return undefined;
    const file = `${beside}coherence-refutation-${randomBytes(4).toString("hex")}.ts`;
    const generated = module.folder === "." ? "_generated/api" : `${module.folder}/_generated/api`;
    const specifier = `./${posix.relative(posix.dirname(file), generated)}`.replace(/^\.\/\.\.\//, "../");
    const reference = `${object}.${[...module.path, exported].join(".")}`;
    this.probes.set(file, `import { ${object} as coherenceRefutationApi } from "${specifier}";\nexport const coherenceRefutationReference = coherenceRefutationApi.${[...module.path, exported].join(".")};\n`);
    return { file, what: `a reference to ${parsed.name} through the generated ${reference} from the unsaved document ${file}${exempt === undefined ? "" : `, outside ${exempt}`}` };
  }
}
