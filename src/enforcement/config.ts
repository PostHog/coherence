/**
 * What enforcement reads from `coherence.config.json`:
 *
 *   language   typescript (default) or python
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
 *   testDir    a folder name (or testDirs, a list) whose files are tests,
 *              beside the built-in __tests__, test, tests
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isLanguage, type Language } from "../adapters/index.ts";

export const CONFIG_FILE = "coherence.config.json";
export const DEFAULT_TEST_FOLDERS: readonly string[] = ["__tests__", "test", "tests"];

export interface EnforcementConfig {
  language: Language;
  /** Undefined when no test command is configured. */
  test: string[] | string | undefined;
  testMatch: RegExp | undefined;
  /** One invocation reporting every test the bullets name, or undefined to run them one at a time. */
  testJson: string[] | string | undefined;
  testFolders: string[];
}

function commandValue(value: unknown): string[] | string | undefined {
  if (Array.isArray(value) && value.every((v): v is string => typeof v === "string") && value.length > 0) return value;
  if (typeof value === "string" && value.trim() !== "") return value;
  return undefined;
}

export function readEnforcementConfig(root: string): EnforcementConfig {
  const config: EnforcementConfig = { language: "typescript", test: undefined, testMatch: undefined, testJson: undefined, testFolders: [...DEFAULT_TEST_FOLDERS] };
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
  if (typeof language === "string" && isLanguage(language)) config.language = language;
  config.test = commandValue(record["test"]);
  config.testJson = commandValue(record["testJson"]);
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
