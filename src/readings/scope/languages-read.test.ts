/**
 * No reading skips a language quietly. Two guards:
 *
 * The source guard: in the readings (src/readings, src/economy,
 * src/scaffold, src/observation) no file takes the config's primary
 * language (`config.language`, `config.languages[0]`) except through
 * primaryOnly, which hands back the statement of what was left unread with
 * it. A new reading that reads the primary language alone fails here until
 * it says so; the two files allowed are named with why, and each must still
 * need its place.
 *
 * The renderer guard: every reading's renderer, given a result whose
 * languages field names a language not read, prints that language and why;
 * and the Structure reading names a language whose instrument did not answer
 * rather than reading the others as the whole.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { computeMass, formatMass } from "../../economy/mass.ts";
import { formatObservationSummary } from "../../observation/observed.ts";
import { buildObservation } from "../../observation/observe.ts";
import { readEnforcementConfig } from "../../enforcement/config.ts";
import { answerStructure } from "../query/query.ts";
import { readComponentInterfaces } from "./component-interfaces.ts";
import { structureState } from "./gaps.ts";
import { mixedProject } from "./mixed-fixture.ts";
import { renderEntrances } from "../../scaffold/entrances.ts";
import { loadSpecModel } from "../../spec/model.ts";
import type { LanguageAdapter } from "../../adapters/adapter.ts";
import { adapterFor } from "../../adapters/index.ts";
import { languagesRead, languagesReadLine, primaryOnly, type LanguagesRead } from "./languages-read.ts";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The folders whose code reads the project's files for a reading. */
const READINGS = ["readings", "economy", "scaffold", "observation"];

/** Taking the config's primary language: `config.language`, `readEnforcementConfig(root).language`, `config.languages[0]`. */
const PRIMARY = /\b\w*[Cc]onfig\w*(?:\([^)]*\))?\.language\b(?!s)|\.languages\[0\]/;

/** The one file that takes it for every reading: primaryOnly, which hands the statement of what was left unread back with it. */
const PRIMARY_ONLY = "readings/scope/languages-read.ts";

/** The files allowed to take it, and why each reads no language's files the reading would leave out. */
const ALLOWED: Record<string, string> = {
  "economy/closure.ts": "the economy prediction's one-language path; with several languages it reads each given file through its own language's instrument",
  "readings/scope/build.ts": "ladderFor names the primary language's grade ladder on the page and reads no file",
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : [];
  });
}

test("no reading takes the primary language alone without naming the languages it left unread, and every renderer prints them", async () => {
  // The source guard.
  const taking = READINGS.flatMap((folder) => sources(join(SRC, folder)))
    .filter((path) => readFileSync(path, "utf8").split("\n").some((line) => !/^\s*(\*|\/\/)/.test(line) && PRIMARY.test(line)))
    .map((path) => relative(SRC, path).split("\\").join("/"))
    .filter((file) => file !== PRIMARY_ONLY)
    .sort();
  const refused = taking.filter((file) => ALLOWED[file] === undefined);
  assert.deepEqual(refused, [], `these readings take the primary language without saying which languages they left unread; read each language, or take it through primaryOnly and carry its languages: ${refused.join(", ")}`);
  assert.deepEqual(Object.keys(ALLOWED).filter((file) => !taking.includes(file)), [], "an allowed file that no longer takes the primary language leaves the list");

  // The renderer guard: a result that names a language not read prints it, with why, in every renderer.
  const unread: LanguagesRead = languagesRead(["python", "typescript"], new Map([["typescript", "the typescript instrument did not answer: no tsserver"]]));
  const said = /languages read: python; NOT READ: typescript \(the typescript instrument did not answer: no tsserver\)/;
  const { root, remove } = mixedProject();
  try {
    const config = readEnforcementConfig(root);
    const model = loadSpecModel(root, { runs: false });
    const rendered: Record<string, string> = {
      mass: formatMass({ ...computeMass(root), languages: unread }),
      "scaffold entrances": renderEntrances({ groups: [], detected: 0, declared: 0, target: undefined, levels: [], cli: "coherence", languages: unread }),
      observation: formatObservationSummary(
        buildObservation({ root, realRoot: root, capture: { runner: "pytest", attribution: "per test", note: "n", tests: [] }, map: { symbols: [], entrances: [] }, model, config, vias: [], at: "", session: "s", agent: "a", binding: {}, commit: null, dirty: false, latency: { pass: 0, map: 0 }, languages: unread }),
      ),
    };
    // The Structure reading, through a stub whose TypeScript instrument never answers: the Python half stands, the TypeScript half is named.
    const started: LanguageAdapter[] = [];
    const reading = await readComponentInterfaces(root, (language) => {
      if (language === "typescript") return { language: "typescript", ready: async () => ({ ok: false as const, reason: "no tsserver" }), close: async () => {} } as unknown as LanguageAdapter;
      const adapter = adapterFor(language, root);
      started.push(adapter);
      return adapter;
    });
    for (const adapter of started) await adapter.close();
    assert.equal(reading.kind, "read");
    assert.deepEqual(reading.kind === "read" ? reading.languages : undefined, unread, "the language whose instrument did not answer is named, with why");
    assert.match(reading.kind === "read" ? (reading.entrances.find((e) => e.name === "shown page")?.reason ?? "") : "", /^not read: /, "its entrance says it was not read");
    rendered["structure (query)"] = answerStructure(structureState(root, reading)).text;
    for (const [reader, text] of Object.entries(rendered)) assert.match(text, said, `${reader} names the language it did not read`);
    // One language read whole: no line, so a single-language reading prints what it always did.
    assert.equal(languagesReadLine(languagesRead(["python"])), undefined);
    assert.equal(primaryOnly({ language: "python", languages: ["python"] }, "why").languages.unread.length, 0);
  } finally {
    remove();
  }
});
