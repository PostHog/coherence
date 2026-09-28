/**
 * What enforcement reads from `coherence.config.json`:
 *
 *   language   typescript (default), python, or dbt; or a list of them,
 *              one instrument each (["dbt", "python"]). The plain scans
 *              (economy, mass, observation) read the first language in the
 *              list that has source files of its own; a dbt-only project
 *              scans Python, the language its tooling is written in
 *   test       the test command: an argv array the filter is appended to,
 *              or a string template with {filter}; absent means not configured
 *   testMatch  a regular expression the test output must match to pass
 *              (a runner that exits 0 when no test matched the filter
 *              needs it); absent means the exit code decides
 *   testJson   one invocation for every test the bullets name at once: an argv array or
 *              string template with {filter} (a combined name pattern) and
 *              {out} (where the runner writes a jest-shaped JSON report:
 *              testResults[].assertionResults[] with ancestorTitles, title,
 *              status). Results map back to invariants by test name; when
 *              absent the pass runs one test per invocation through `test`
 *   testFilterForm  how a name filter is written for the runner: "regex"
 *              (default: a title is escaped and several are joined with |,
 *              as jest, vitest, and node:test read --test-name-pattern) or
 *              "pytest" (a `-k` expression: names as written, joined with
 *              or). The report {out} names may be jest-shaped JSON, pytest's
 *              JUnit XML (--junitxml), or pytest-json-report's JSON; the
 *              pass tells them apart by their content
 *   testDir    a folder name (or testDirs, a list) whose files are tests,
 *              beside the built-in __tests__, test, tests
 *   testTimeoutMs  how long the one test invocation may run before its
 *              process tree is killed (default ten minutes)
 *   dbt        the dbt instrument and its own test runner: manifest (default
 *              target/manifest.json) or snapshot (the reference's committed
 *              normalized manifest, read instead and labelled as such), parse
 *              (the command that writes the manifest), and test, testJson,
 *              testMatch, testTimeoutMs as above, with the filter written as
 *              dbt test names and {outdir} a folder the runner may write its
 *              target into. A via the manifest names as a test runs there;
 *              every other via runs through the project-wide runner
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dbtSettingsFrom, type DbtSettings } from "../adapters/dbt.ts";
import { isInstrument, isLanguage, type Instrument, type Language } from "../adapters/index.ts";

export const CONFIG_FILE = "coherence.config.json";
export const DEFAULT_TEST_FOLDERS: readonly string[] = ["__tests__", "test", "tests"];

export interface EnforcementConfig {
  /** The language the plain scans read. */
  language: Language;
  /** The instruments a check asks, in the config's order: one adapter each, a composite when there are several. */
  instruments: Instrument[];
  /** Undefined when no test command is configured. */
  test: string[] | string | undefined;
  testMatch: RegExp | undefined;
  /** One invocation reporting every test the bullets name, or undefined to run them one at a time. */
  testJson: string[] | string | undefined;
  /** How a name filter is written for the runner: an escaped regex (jest, vitest, node:test), a pytest -k expression, or dbt test names. */
  testFilterForm: "regex" | "pytest" | "dbt";
  testFolders: string[];
  /** How long the one test invocation may run; undefined keeps the default. */
  testTimeoutMs: number | undefined;
  /** The dbt instrument and its runner, when the config names one. */
  dbt: DbtSettings | undefined;
}

function commandValue(value: unknown): string[] | string | undefined {
  if (Array.isArray(value) && value.every((v): v is string => typeof v === "string") && value.length > 0) return value;
  if (typeof value === "string" && value.trim() !== "") return value;
  return undefined;
}

export function readEnforcementConfig(root: string): EnforcementConfig {
  const config: EnforcementConfig = { language: "typescript", instruments: ["typescript"], test: undefined, testMatch: undefined, testJson: undefined, testFilterForm: "regex", testFolders: [...DEFAULT_TEST_FOLDERS], testTimeoutMs: undefined, dbt: undefined };
  const path = resolve(root, CONFIG_FILE);
  if (!existsSync(path)) return config;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path}: not valid JSON (${(error as Error).message})`);
  }
  if (typeof parsed !== "object" || parsed === null) return config;
  const record = parsed as Record<string, unknown>;
  const language = record["language"];
  const named = (Array.isArray(language) ? language : [language]).filter((v): v is Instrument => typeof v === "string" && isInstrument(v));
  if (named.length > 0) {
    config.instruments = [...new Set(named)];
    config.language = named.find(isLanguage) ?? "python";
  }
  const timeout = record["testTimeoutMs"];
  if (typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0) config.testTimeoutMs = timeout;
  config.dbt = dbtSettingsFrom(record["dbt"], path);
  config.test = commandValue(record["test"]);
  config.testJson = commandValue(record["testJson"]);
  if (record["testFilterForm"] === "pytest") config.testFilterForm = "pytest";
  const testMatch = record["testMatch"];
  if (typeof testMatch === "string" && testMatch !== "") {
    try {
      config.testMatch = new RegExp(testMatch);
    } catch (error) {
      throw new Error(`${path}: testMatch is not a regular expression (${(error as Error).message})`);
    }
  }
  const folders = new Set(config.testFolders);
  if (typeof record["testDir"] === "string") folders.add(record["testDir"]);
  if (Array.isArray(record["testDirs"])) for (const dir of record["testDirs"]) if (typeof dir === "string") folders.add(dir);
  config.testFolders = [...folders];
  return config;
}
