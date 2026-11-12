import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";
import { TypeScriptAdapter } from "../../plugins/typescript/typescript.ts";
import { readEnforcementConfig } from "../../src/enforcement/config.ts";

const USAGE = `tsgo against tsserver: the TypeScript adapter's answers through each engine on real projects, and each engine's cost.
For each project: a spread of source files' top-level symbols, then for a spread of the symbols tsserver reports, the
resolved definition, its reference sites and its refutation verdict, once through tsgo and once with COHERENCE_TSGO=0.
Every answer that differs is printed; a SymbolKind that differs (tsgo calls a const a Variable, tsserver a Constant) is counted
apart, since no verdict reads it. Cost: the language server process tree's peak RSS (VmHWM, summed) and wall time.

usage: node bench/tsgo-parity/run.ts <project> [<project> ...] [--files 40] [--symbols 15] [--json <file>]`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    files: { type: "string", default: "40" },
    symbols: { type: "string", default: "15" },
    json: { type: "string" },
  },
});
if (positionals.length === 0) {
  process.stderr.write(`${USAGE}\n`);
  process.exit(64);
}
const fileCount = Number(values.files);
const symbolCount = Number(values.symbols);

type Engine = "tsgo" | "tsserver";

interface Answers {
  engine: string | undefined;
  symbols: Record<string, string[]>;
  kinds: Record<string, string[]>;
  resolved: Record<string, string>;
  references: Record<string, string[]>;
  refutations: Record<string, string>;
  peakRssMB: number;
  seconds: number;
}

interface ProjectReport {
  project: string;
  typescript: string;
  files: number;
  probed: number;
  answers: Record<Engine, Answers>;
  differences: string[];
  kindDifferences: string[];
}

function evenlySpread<T>(items: readonly T[], count: number): T[] {
  if (items.length <= count) return [...items];
  const step = items.length / count;
  return Array.from({ length: count }, (_, i) => items[Math.floor(i * step)]!);
}

function sourceFiles(root: string): string[] {
  const listed = execFileSync("git", ["ls-files", "--", "*.ts", "*.tsx"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return listed
    .split("\n")
    .filter((file) => file !== "" && !file.endsWith(".d.ts"))
    .sort();
}

function projectTypeScript(root: string): string {
  try {
    return (
      JSON.parse(
        readFileSync(
          resolve(root, "node_modules/typescript/package.json"),
          "utf8",
        ),
      ) as { version: string }
    ).version;
  } catch {
    return "none installed";
  }
}

function processTree(pid: number): number[] {
  const children = execFileSync("ps", ["-e", "-o", "pid=,ppid="], {
    encoding: "utf8",
  })
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter(([, parent]) => parent === pid)
    .map(([child]) => child!);
  return [pid, ...children.flatMap(processTree)];
}

function peakRssMB(pid: number | undefined): number {
  if (pid === undefined) return 0;
  const kilobytes = processTree(pid).map((member) => {
    try {
      return Number(
        /VmHWM:\s+(\d+) kB/.exec(
          readFileSync(`/proc/${member}/status`, "utf8"),
        )?.[1] ?? 0,
      );
    } catch {
      return 0;
    }
  });
  return Math.round(kilobytes.reduce((sum, value) => sum + value, 0) / 1024);
}

function useEngine(engine: Engine): void {
  if (engine === "tsserver") process.env["COHERENCE_TSGO"] = "0";
  if (engine === "tsgo") delete process.env["COHERENCE_TSGO"];
}

async function answer(
  root: string,
  engine: Engine,
  files: readonly string[],
  probes: readonly string[] | undefined,
): Promise<Answers> {
  useEngine(engine);
  const hint = {
    component: ".",
    testFolders: readEnforcementConfig(root).testFolders,
  };
  const started = performance.now();
  const adapter = new TypeScriptAdapter(root);
  const answers: Answers = {
    engine: undefined,
    symbols: {},
    kinds: {},
    resolved: {},
    references: {},
    refutations: {},
    peakRssMB: 0,
    seconds: 0,
  };
  try {
    const ready = await adapter.ready();
    if (!ready.ok)
      throw new Error(`${engine} did not start on ${root}: ${ready.reason}`);
    answers.engine = adapter.engine;
    for (const file of files) {
      const symbols = await adapter
        .topLevelSymbols(file)
        .catch((error: unknown) => [
          {
            name: `error: ${error instanceof Error ? error.message : String(error)}`,
            line: 0,
            kind: 0,
          },
        ]);
      answers.symbols[file] = symbols
        .map((symbol) => `${symbol.name}@${symbol.line}`)
        .sort();
      answers.kinds[file] = symbols
        .map((symbol) => `${symbol.name}@${symbol.line}:${symbol.kind}`)
        .sort();
    }
    const candidates = Object.entries(answers.symbols).flatMap(
      ([file, symbols]) =>
        symbols
          .filter((symbol) => !symbol.startsWith("error:"))
          .map((symbol) => `${symbol.split("@")[0]} in ${basename(file)}`),
    );
    for (const name of probes ?? evenlySpread(candidates, symbolCount)) {
      const resolved = await adapter.resolve(name, hint);
      if (!resolved.ok) {
        answers.resolved[name] = `unresolved: ${resolved.reason.slice(0, 120)}`;
        continue;
      }
      const definition = resolved.definition;
      answers.resolved[name] =
        `${definition.file}:${definition.range.start.line + 1}`;
      answers.references[name] = (await adapter.references(definition))
        .map((site) => `${site.file}:${site.line}`)
        .sort();
      const refutation = await adapter.refute(definition, undefined);
      answers.refutations[name] =
        refutation.refused === undefined
          ? `seen ${refutation.seen}`
          : "refused by the compiler";
    }
    answers.peakRssMB = peakRssMB(adapter.serverPid());
  } finally {
    await adapter.close();
    delete process.env["COHERENCE_TSGO"];
  }
  answers.seconds = Math.round((performance.now() - started) / 100) / 10;
  return answers;
}

function compare(
  found: string[],
  what: string,
  fromTsserver: Record<string, unknown>,
  fromTsgo: Record<string, unknown>,
): void {
  for (const key of new Set([
    ...Object.keys(fromTsserver),
    ...Object.keys(fromTsgo),
  ])) {
    const left = JSON.stringify(fromTsserver[key] ?? null);
    const right = JSON.stringify(fromTsgo[key] ?? null);
    if (left !== right)
      found.push(`${what} ${key}: tsserver ${left} | tsgo ${right}`);
  }
}

function differences(tsserver: Answers, tsgo: Answers): string[] {
  const found: string[] = [];
  compare(found, "symbols of", tsserver.symbols, tsgo.symbols);
  compare(found, "resolved", tsserver.resolved, tsgo.resolved);
  compare(found, "references of", tsserver.references, tsgo.references);
  compare(found, "refutation of", tsserver.refutations, tsgo.refutations);
  return found;
}

function kindDifferences(tsserver: Answers, tsgo: Answers): string[] {
  const found: string[] = [];
  compare(found, "symbol kinds of", tsserver.kinds, tsgo.kinds);
  return found;
}

const reports: ProjectReport[] = [];
for (const given of positionals) {
  const root = resolve(given);
  const files = evenlySpread(sourceFiles(root), fileCount);
  const tsserver = await answer(root, "tsserver", files, undefined);
  const probes = Object.keys(tsserver.resolved);
  const tsgo = await answer(root, "tsgo", files, probes);
  const report: ProjectReport = {
    project: basename(root),
    typescript: projectTypeScript(root),
    files: files.length,
    probed: probes.length,
    answers: { tsserver, tsgo },
    differences: differences(tsserver, tsgo),
    kindDifferences: kindDifferences(tsserver, tsgo),
  };
  reports.push(report);
  process.stdout.write(
    `${report.project}: tsserver as ${tsserver.engine}, tsgo as ${tsgo.engine}; ${report.differences.length} difference(s), ${report.kindDifferences.length} file(s) whose symbol kinds differ\n${report.differences.map((line) => `  ${line}\n`).join("")}`,
  );
}

const rows = reports.map((report) => {
  const { tsserver, tsgo } = report.answers;
  return `| ${report.project} | ${report.typescript} | ${report.files} | ${report.probed} | ${report.differences.length} | ${report.kindDifferences.length} | ${tsserver.peakRssMB} | ${tsgo.peakRssMB} | ${tsserver.seconds} | ${tsgo.seconds} |`;
});
process.stdout.write(
  [
    "",
    "| project | its TypeScript | files read | symbols probed | differences | files with other SymbolKinds | tsserver peak MB | tsgo peak MB | tsserver s | tsgo s |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...rows,
    "",
  ].join("\n"),
);
if (values.json !== undefined)
  writeFileSync(values.json, `${JSON.stringify(reports, null, 2)}\n`);
