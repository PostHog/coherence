/**
 * Build the Scope reading: one self-contained HTML file.
 *
 * The builder loads the glossary file (and an optional project domain glossary
 * of the same shape) into the model once, embeds that state in the page as
 * JSON, and inlines the styles and the browser script. It renders nothing
 * itself: the browser turns the crank on the embedded state. The same glossary
 * in produces a byte-identical page out.
 *
 *   npm run scope -- [--glossary docs/glossary.json] [--domain path.json]
 *                    [--domain-title "Domain glossary"] [--out public/_scope.html]
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { escapeHtml } from "./html.ts";
import { parseGlossary, type Glossary, type Layer, type ShellState } from "./model.ts";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The browser bundle, in dependency order. Each file may import the ones
 * before it; the relative imports are removed when the files are joined into
 * one inline module, and types are stripped by Node's own stripper.
 */
const BROWSER_SOURCES = ["html.ts", "model.ts", "glossary-view.ts", "shell.ts", "page.ts"];

export interface BuildOptions {
  /** Path to Coherence's own glossary. */
  glossaryPath: string;
  /** Path to a project domain glossary of the same shape, if one exists. */
  domainPath?: string;
  /** Heading for the domain layer. Derived from the file's project name when not given. */
  domainTitle?: string;
  /** Project name shown in the masthead. */
  project: string;
}

export const DEFAULTS = {
  glossaryPath: "docs/glossary.json",
  outPath: "public/_scope.html",
  domainTitle: "Domain glossary",
  project: "Coherence",
} as const;

async function readGlossary(path: string): Promise<Glossary> {
  const text = await readFile(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${path}: not valid JSON (${(error as Error).message})`);
  }
  return parseGlossary(parsed, path);
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

/** The domain layer's heading: as given, else from the file's project name, else the default. */
function domainTitle(options: BuildOptions, glossary: Glossary | undefined): string {
  if (options.domainTitle !== undefined) return options.domainTitle;
  if (glossary?.project !== undefined) return `${capitalize(glossary.project)} glossary`;
  return DEFAULTS.domainTitle;
}

/** Load both layers into the shell's state. Absence of the domain layer is a rendered fact. */
export async function loadState(options: BuildOptions): Promise<ShellState> {
  const coherence: Layer = {
    kind: "present",
    id: "coherence",
    title: `${options.project} glossary`,
    glossary: await readGlossary(options.glossaryPath),
  };
  const domainGlossary = options.domainPath === undefined ? undefined : await readGlossary(options.domainPath);
  const domain: Layer =
    domainGlossary === undefined
      ? {
          kind: "absent",
          id: "domain",
          title: domainTitle(options, undefined),
          because:
            "No domain glossary is present. Supply a second glossary file of the same shape to read the project's own vocabulary beneath Coherence's.",
        }
      : {
          kind: "present",
          id: "domain",
          title: domainTitle(options, domainGlossary),
          glossary: domainGlossary,
        };
  return {
    project: options.project,
    views: [{ id: "glossary", label: "Glossary" }],
    activeView: "glossary",
    glossary: { layers: [coherence, domain], query: "" },
  };
}

/** Strip one source file to JavaScript and drop its relative imports. */
function toBrowserModule(source: string, name: string): string {
  const stripped = stripTypeScriptTypes(source, { mode: "strip" });
  return stripped
    .split("\n")
    .filter((line) => !/^import\s[^;]*from\s+["']\.\//.test(line))
    .join("\n")
    .concat(`\n// end of ${name}\n`);
}

async function browserScript(): Promise<string> {
  const parts: string[] = [];
  for (const name of BROWSER_SOURCES) {
    const source = await readFile(resolve(here, name), "utf8");
    parts.push(toBrowserModule(source, name));
  }
  return parts.join("\n");
}

/** JSON that is safe inside a script element: no `<` can close it. */
function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** Render the page document around the state. Deterministic for the same inputs. */
export async function buildScopePage(options: BuildOptions): Promise<{ html: string; state: ShellState }> {
  const state = await loadState(options);
  const css = await readFile(resolve(here, "styles.css"), "utf8");
  const script = await browserScript();
  const title = `${options.project} Scope`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)}</title>
<style>
${css}
</style>
</head>
<body>
<noscript><p style="padding:1.25rem;font-family:system-ui,sans-serif">This reading renders from the glossary state embedded in this file and needs scripts enabled to show it.</p></noscript>
<div id="scope-root"></div>
<script type="application/json" id="scope-state">${embedJson(state)}</script>
<script type="module">
${script}
</script>
</body>
</html>
`;
  return { html, state };
}

export async function writeScopePage(options: BuildOptions, outPath: string): Promise<{ bytes: number; state: ShellState }> {
  const { html, state } = await buildScopePage(options);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, html, "utf8");
  return { bytes: Buffer.byteLength(html, "utf8"), state };
}

async function main(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      glossary: { type: "string", default: DEFAULTS.glossaryPath },
      domain: { type: "string" },
      "domain-title": { type: "string" },
      project: { type: "string", default: DEFAULTS.project },
      out: { type: "string", default: DEFAULTS.outPath },
    },
  });
  const options: BuildOptions = {
    glossaryPath: values.glossary,
    project: values.project,
  };
  if (values.domain !== undefined) options.domainPath = values.domain;
  if (values["domain-title"] !== undefined) options.domainTitle = values["domain-title"];
  const { bytes, state } = await writeScopePage(options, values.out);
  const first = state.glossary.layers[0];
  const count = first?.kind === "present" ? first.glossary.concepts.length : 0;
  const domain = state.glossary.layers[1]?.kind === "present" ? "with a domain glossary" : "no domain glossary";
  console.log(`Scope: wrote ${values.out} (${bytes} bytes, ${count} concepts, ${domain}).`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
