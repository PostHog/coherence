import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { formatReport, hasFindings, identifierWords, normalizeTerm, runCheck, type CheckReport } from "./check.ts";
import { loadGlossary, parseGlossary, rejectedNames, type Glossary } from "./glossary.ts";
import { COHERENCE_GLOSSARY } from "./project.ts";

let root: string;
let coherence: Glossary;
let project: Glossary;
let report: CheckReport;
/** A single-word name Coherence rejects for "invariant", read from the glossary so this file never spells it. */
let REJ: string;
let Rej: string;
/** Another single-word name Coherence rejects, used here as a project concept name the project's sense wins for. */
let ALT: string;

function projectGlossaryWith(rej: string, alt: string): unknown {
  return {
    ...projectGlossary,
    concepts: [
      ...projectGlossary.concepts.map((c) => (c.name === "widget" ? { ...c, not_to_be_confused_with: [`sprocket ${rej}: a toothed wheel`] } : c)),
      { name: alt, definition: "The widget catalogue.", aliases: [] },
    ],
  };
}

const projectGlossary = {
  project: "widgetry",
  version: 0,
  concepts: [
    {
      name: "widget",
      definition: "A thing with a knob.",
      aliases: ["gadget (code term)"],
    },
  ],
  rejected: [
    { concept: "doohickey", because: "retired surface" },
    { concept: "convention / add_convention (change type)", because: "vestigial" },
  ],
};

async function write(rel: string, text: string): Promise<void> {
  await mkdir(join(root, rel, ".."), { recursive: true });
  await writeFile(join(root, rel), text);
}

before(async () => {
  coherence = await loadGlossary(COHERENCE_GLOSSARY);
  coherence.project = "coherence";
  REJ = rejectedNames(coherence).find((n) => n.concept === "invariant" && !n.name.includes(" "))!.name;
  Rej = REJ[0]!.toUpperCase() + REJ.slice(1);
  ALT = rejectedNames(coherence).find((n) => !n.name.includes(" ") && !n.identifierOnly && n.concept !== "invariant")!.name;
  root = await mkdtemp(join(tmpdir(), "coherence-check-"));
  await write("glossary.json", JSON.stringify(projectGlossaryWith(REJ, ALT)));
  await write("docs/retired.md", `The ${REJ} and the doohickey both retired here, and this file is never read.\n`);
  await write(
    "notes.md",
    [
      `# Notes on the ${Rej}`,
      `The doohickey turns the widget; the old ${REJ} is gone. A sprocket ${REJ} is fine.`,
      "Every Durable Object holds one widget. The Durable Object is the unit.",
      `The ${ALT} lists widgets; a convention is only English here but \`add_convention\` is a name.`,
      "Cloudflare hosts it, and Cloudflare bills for it.",
      "```",
      "Title Case In Fences Is Ignored",
      "```",
      "The Flux Capacitor appears once only.",
      "",
    ].join("\n"),
  );
  await write("flux/flux.spec.md", "The flux component. flux is named in prose here too, and the Durable Object once more.\n");
  await write(
    "src/a.ts",
    [
      'import { readFile } from "node:fs/promises";',
      "const doohickeyCount = 1; // a rejected project name inside an identifier",
      `const sprocket${Rej} = 2; // guarded by the project's not-to-be-confused-with lead`,
      `const ${REJ}Keeper = 3; // Coherence's name in an adopter's code: not a finding`,
      "const p: Promise<void> = Promise.resolve();",
      "const conventions = 4; // identifier-only project name",
    ].join("\n") + "\n",
  );
  project = await loadGlossary(join(root, "glossary.json"));
  report = await runCheck({ root, coherence, project });
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

test("the corpus excludes the glossary files and docs/retired.md", () => {
  assert.equal(report.files, 3);
  assert.ok(!report.rejected.some((f) => f.file.includes("retired")));
});

test("rejected names are found as whole words in prose, with concept and because", () => {
  const prose = report.rejected.filter((f) => f.file === "notes.md");
  assert.deepEqual(
    prose.map((f) => [f.line, f.text, f.concept]),
    [
      [1, Rej, "invariant"],
      [2, "doohickey", "widgetry"],
      [2, REJ, "invariant"],
      [4, "add_convention", "widgetry"],
    ],
  );
  assert.equal(prose[1]!.because, "retired surface");
  assert.match(prose[0]!.because, /former name/);
});

test("a project's own sense wins: an accepted project name silences a Coherence rejection, and an accepted phrase guards the words inside it", () => {
  assert.ok(!report.rejected.some((f) => f.name === ALT), `${ALT} is the project's own concept`);
  assert.equal(report.rejected.filter((f) => f.file === "notes.md" && f.line === 2 && f.text === REJ).length, 1, "the guarded phrase is not a second hit");
});

test("in code, both layers' rejected names match identifier tokens, Coherence's too in an adopter, unless the project declares the name as its own; language globals and module specifiers never match", () => {
  const code = report.rejected.filter((f) => f.file === "src/a.ts");
  assert.deepEqual(
    code.map((f) => [f.line, f.text, f.name]),
    [
      [2, "doohickey", "doohickey"],
      [4, REJ, REJ],
      [6, "conventions", "convention"],
    ],
  );
  assert.equal(code[1]!.concept, "invariant", "Coherence's name, in an adopter's identifier");
  assert.ok(!report.rejected.some((f) => f.file === "src/a.ts" && f.line === 3), `sprocket${Rej} is guarded by the project's own phrase`);
});

test("the corpus reads every text kind the project holds, the journal's records included, and leaves out lockfiles, binaries, runs, and the reviews", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coherence-corpus-"));
  const put = async (rel: string, text: string | Buffer): Promise<void> => {
    await mkdir(join(dir, rel, ".."), { recursive: true });
    await writeFile(join(dir, rel), text);
  };
  try {
    await put(".gitignore", `# keep the ${REJ}\n${REJ}/\n`);
    await put("config.yaml", `${REJ}: true\n`);
    await put("settings.toml", `[${REJ}]\nname = "x"\n`);
    await put("tool.py", `${REJ}_keeper = 1\n`);
    await put("web/app.tsx", `export const ${REJ}Box = 1;\n`);
    await put("scripts/run.mjs", `const ${REJ} = 1;\n`);
    await put("scripts/run.sh", `echo ${REJ}\n`);
    await put("data/rows.jsonl", JSON.stringify({ label: REJ }) + "\n");
    await put("data/shape.json", JSON.stringify({ [REJ]: 1 }) + "\n");
    await put(".coherence/journal/s1.jsonl", [
      JSON.stringify({ id: "d-1", kind: "decision", at: "2026-09-17T00:00:00.000Z", session: "s1", agent: "a", commit: null, dirty: false, chose: `the ${REJ}`, over: [`the ${ALT}`], because: "b" }),
      JSON.stringify({ id: "d-2", kind: "decision", at: "2026-09-17T00:00:01.000Z", session: "s1", agent: "a", commit: null, dirty: false, chose: "fine", over: [`a ${REJ} by another name`], because: "an alternative is what was refused, so its name is not drift" }),
    ].join("\n") + "\n");
    await put(".coherence/work/s1.jsonl", JSON.stringify({ id: "w-1", kind: "order", at: "2026-09-17T00:00:00.000Z", session: "s1", agent: "a", commit: null, dirty: false, objective: `ship the ${REJ}`, success: "s", boundary: "b", owner: "s1" }) + "\n");
    await put(".coherence/runs/s1.jsonl", JSON.stringify({ reason: `the ${REJ} passed` }) + "\n");
    await put("package-lock.json", JSON.stringify({ name: REJ }) + "\n");
    await put("bin.dat", Buffer.from([0x00, 0x01, 0x02, 0x67, 0x61, 0x74, 0x65]));
    await put("docs/reviews/2026-09-18-review.md", `The reviewer wrote ${REJ} on purpose.\n`);
    await put("docs/reference/old.md", `The ${REJ} was the old name.\n`);
    const out = await runCheck({ root: dir, coherence });
    const hits = out.rejected.map((f) => f.file).sort();
    assert.deepEqual(hits, [
      ".coherence/journal/s1.jsonl",
      ".coherence/work/s1.jsonl",
      ".gitignore",
      "config.yaml",
      "data/rows.jsonl",
      "data/shape.json",
      "scripts/run.mjs",
      "scripts/run.sh",
      "settings.toml",
      "tool.py",
      "web/app.tsx",
    ]);
    assert.deepEqual(out.rejected.filter((f) => f.file === ".coherence/journal/s1.jsonl").map((f) => f.line), [1], "a decision's chose is checked; what it rejected (over) is not drift");
    assert.equal(out.files, 11, "every readable text file of a kind the project holds, minus the lockfile, the binary, the run, the review, and the reference doc");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("collectFiles confines every given path to the project root", async () => {
  await assert.rejects(runCheck({ root, coherence, project, paths: [".."] }), /outside the project root/);
  await assert.rejects(runCheck({ root, coherence, project, paths: [join(root, "..", "elsewhere")] }), /outside the project root/);
  await assert.rejects(runCheck({ root, coherence, project, paths: ["/etc"] }), /outside the project root/);
  const inside = await runCheck({ root, coherence, project, paths: [join(root, "src")] });
  assert.equal(inside.files, 1, "an absolute path under the root is fine");
});

test("an unreadable folder is reported and skipped; the check never aborts on it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coherence-eacces-"));
  try {
    await writeFile(join(dir, "open.md"), `The ${REJ} is here.\n`);
    await mkdir(join(dir, "locked"));
    await writeFile(join(dir, "locked", "hidden.md"), `The ${REJ} is hidden.\n`);
    await chmod(join(dir, "locked"), 0o000);
    const out = await runCheck({ root: dir, coherence });
    assert.equal(out.rejected.length, 1, "the readable file is checked");
    if (process.getuid?.() === 0) return; // root reads everything; the skip cannot be witnessed
    assert.deepEqual(out.unreadable.map((u) => u.file), ["locked"]);
    assert.match(out.unreadable[0]!.reason, /EACCES|permission/i);
    assert.match(formatReport(out), /^UNREADABLE     locked  .*permission/m);
  } finally {
    await chmod(join(dir, "locked"), 0o755).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});

test("unknown nouns: Title Case away from a sentence start and component names, at least twice, with three closed options", () => {
  const terms = report.unknown.map((f) => f.term);
  assert.ok(terms.includes("durable object"), `expected durable object in ${terms.join(", ")}`);
  assert.ok(terms.includes("flux"));
  assert.ok(!terms.includes("flux capacitor"), "seen once");
  assert.ok(!terms.includes("title case in fences is ignored"));
  assert.ok(!terms.includes("cloudflare"), "a proper noun never seen as a common word would count, but it is capitalized at a sentence start once and mid-sentence once");
  const durable = report.unknown.find((f) => f.term === "durable object")!;
  assert.equal(durable.count, 3);
  assert.deepEqual(durable.locations, [
    { file: "flux/flux.spec.md", line: 1 },
    { file: "notes.md", line: 3 },
    { file: "notes.md", line: 3 },
  ]);
  assert.match(durable.options.declare, /as a concept/);
  assert.match(durable.options.map, /alias of an existing concept/);
  assert.match(durable.options.fix, /rejected name or a mistake/);
});

test("the report ends with counts, and hasFindings drives the exit code", () => {
  const text = formatReport(report);
  assert.match(text, new RegExp(`^REJECTED NAME  notes\\.md:1  "${Rej}"  rejected for invariant: `, "m"));
  assert.match(text, /^UNKNOWN NOUN   "durable object" \(3\)  flux\/flux\.spec\.md:1, notes\.md:3, notes\.md:3\n {15}declare: /m);
  assert.match(text, /\n\d+ rejected names, \d+ unknown nouns \(3 files\)\n$/);
  assert.equal(hasFindings(report), true);
  assert.equal(hasFindings({ files: 1, rejected: [], unknown: [], unreadable: [] }), false);
});

test("paths restrict the corpus", async () => {
  const only = await runCheck({ root, coherence, project, paths: ["src/a.ts"] });
  assert.equal(only.files, 1);
  assert.equal(only.rejected.length, 2);
  assert.equal(only.unknown.length, 0);
});

test("without a project glossary, nothing guards the project's phrases, so Coherence's names hit every identifier they are in", async () => {
  const alone = await runCheck({ root, coherence, paths: ["src/a.ts"] });
  assert.deepEqual(alone.rejected.map((f) => f.text.toLowerCase()), [REJ, REJ]);
  assert.deepEqual(alone.rejected.map((f) => f.line), [3, 4]);
});

test("identifier and term helpers", () => {
  assert.deepEqual(identifierWords("consentFlurbKeeper"), ["consent", "flurb", "keeper"]);
  assert.deepEqual(identifierWords("AUTH_CODE_ttl"), ["auth", "code", "ttl"]);
  assert.deepEqual(identifierWords("HTMLParser"), ["html", "parser"]);
  assert.equal(normalizeTerm("Auth-Code_form"), "auth code form");
});

test("parseGlossary refuses a shape it does not understand", () => {
  assert.throws(() => parseGlossary({ concepts: [{ definition: "no name" }] }, "x.json"), /needs a name/);
  assert.throws(() => parseGlossary([], "x.json"), /must be an object/);
});
