/**
 * The two files Coherence keeps for git inside its own folder, so a project
 * commits its records and nothing else of Coherence's, and merges them
 * without a conflict. Both sit in .coherence, so writing them never edits a
 * file the adopter wrote, and their patterns are relative to that folder.
 *
 * `.coherence/.gitignore` keeps out the state Coherence regenerates. Install
 * writes it once; a file holding exactly what an earlier release wrote is
 * Coherence's and is brought up to this one's text; any other text is the
 * adopter's and is left alone. This release writes one of two texts, as the
 * config's commitReplay asks: the replay record (every tool call each session
 * made) kept on the machine, the default, or committed with the records.
 * Both are Coherence's, so install and every session start switch one to the
 * other when the config changes; where the file is the adopter's and git's
 * verdict on the replay record differs from the config, that is said, never
 * written.
 *
 * `.coherence/.gitattributes` makes each record store's session files merge
 * with the union of both sides' lines (merge=union): two branches that
 * appended to one session's file, as every stacked branch does, merge and
 * rebase cleanly, and every record of both survives. The stores' readers
 * order records by their content, never by line, so the order the union
 * leaves is no one's concern. It also marks the stores generated, so GitHub
 * folds them in a pull request's diff. Install and every session start
 * write it, so a project that adopted an earlier release has it from its
 * first session after the upgrade; a file already there keeps every line
 * the adopter wrote, and only an attribute it does not set for that pattern
 * is added.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "./work-meter.ts";
import { COMMIT_REPLAY_KEY, commitsReplay, CONFIG_FILE, DURABLE_FOLDERS, RECORD_STORES, REPLAY_FOLDER } from "./project.ts";

/** Coherence's own folder in a project. */
export const STATE_DIR = ".coherence";

/** The ignore file inside Coherence's own folder. */
export const IGNORE_FILE = join(STATE_DIR, ".gitignore");

/** The attributes file inside Coherence's own folder. */
export const ATTRIBUTES_FILE = join(STATE_DIR, ".gitattributes");

const IGNORE_HEAD = [
  "# Written by coherence hooks install; hooks uninstall removes it.",
  "# Commit this file, .gitattributes and the folders it keeps: the journal,",
  "# runs and work orders are durable records, and hooks holds the project's",
  "# own hook voice. Everything else here is regenerated (feed cursors, read",
  "# traces, practice firings, the warm server, structure and lexicon",
  "# readings), so git ignores it.",
];

const IGNORE_KEPT = ["/*", "!/.gitignore", "!/.gitattributes", ...DURABLE_FOLDERS.map((folder) => `!/${folder}/`)];

/** The exact text install writes, the replay record kept on the machine; only a file holding exactly this, REPLAY_IGNORE_TEXT, or an earlier release's text, is Coherence's. */
export const IGNORE_TEXT = [...IGNORE_HEAD, ...IGNORE_KEPT].join("\n") + "\n";

/** The text written instead when the config's commitReplay is true: the same, with the replay record kept for git too. */
export const REPLAY_IGNORE_TEXT = [
  ...IGNORE_HEAD,
  `# The config's ${COMMIT_REPLAY_KEY} is true, so the replay record (every tool`,
  "# call each session made) is committed too.",
  ...IGNORE_KEPT,
  `!/${REPLAY_FOLDER}/`,
].join("\n") + "\n";

/** The ignore text the config asks for. */
export function ignoreTextFor(commitReplay: boolean): string {
  return commitReplay ? REPLAY_IGNORE_TEXT : IGNORE_TEXT;
}

/** What releases through 1.6.0 wrote, which ignored the attributes file; a file holding exactly one of these is brought up to IGNORE_TEXT. */
export const EARLIER_IGNORE_TEXTS: readonly string[] = [
  [
    "# Written by coherence hooks install; hooks uninstall removes it.",
    "# Commit this file and the folders it keeps: the journal, runs and work",
    "# orders are durable records, and hooks holds the project's own hook voice.",
    "# Everything else here is regenerated (feed cursors, read traces, practice",
    "# firings, the warm server, structure and lexicon readings), so git ignores it.",
    "/*",
    "!/.gitignore",
    "!/journal/",
    "!/runs/",
    "!/work/",
    "!/hooks/",
  ].join("\n") + "\n",
];

/**
 * Each attribute Coherence sets, one per line, relative to .coherence: every
 * record store's session files merge by union and read as generated, and so
 * do the replay record's, whether or not the config commits them, so a branch
 * that turns commitReplay on merges with one that turned it on earlier.
 */
export const ATTRIBUTE_LINES: readonly string[] = [...RECORD_STORES, REPLAY_FOLDER].flatMap((store) => [`${store}/*.jsonl merge=union`, `${store}/** linguist-generated=true`]);

const ATTRIBUTES_HEAD = [
  "# Written by Coherence; hooks uninstall removes it while it holds only this.",
  "# Each record store is one append-only JSONL file per session, and its",
  "# readers order records by content: two branches that appended to one",
  "# session's file merge with both sides' lines (merge=union), never a",
  "# conflict. GitHub folds the records in a pull request's diff.",
];

/** The exact text written where no attributes file was; only a file holding exactly this, or an earlier release's text, is Coherence's. */
export const ATTRIBUTES_TEXT = [...ATTRIBUTES_HEAD, ...ATTRIBUTE_LINES].join("\n") + "\n";

/** What releases through 1.11.0 wrote, before the replay record; a file holding exactly this is brought up to ATTRIBUTES_TEXT. */
export const EARLIER_ATTRIBUTES_TEXTS: readonly string[] = [
  [...ATTRIBUTES_HEAD, ...RECORD_STORES.flatMap((store) => [`${store}/*.jsonl merge=union`, `${store}/** linguist-generated=true`])].join("\n") + "\n",
];

/** The line above what Coherence adds to an attributes file the adopter already had. */
const ADDED_HEAD = "# Added by Coherence: its record stores merge with both sides' lines.";

/** What was done with .coherence/.gitignore: written, already the text the config asks for, Coherence's other text or an earlier release's brought to it, the adopter's kept, or absent and left so. */
export type IgnoreAction = "wrote" | "unchanged" | "upgraded" | "kept" | "absent";

/** What was done with .coherence/.gitattributes: written, already exactly Coherence's, the adopter's (or an earlier release's) with Coherence's missing lines added, or the adopter's already setting them all. */
export type AttributesAction = "wrote" | "unchanged" | "added" | "kept";

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** Whether an ignore file's text is one Coherence wrote: either text this release writes, or an earlier release's. */
export function coherenceIgnore(text: string | undefined): boolean {
  return text !== undefined && (text === IGNORE_TEXT || text === REPLAY_IGNORE_TEXT || EARLIER_IGNORE_TEXTS.includes(text));
}

/**
 * Bring .coherence/.gitignore to the text the config asks for when it is
 * Coherence's, so turning commitReplay on or off switches it at the next
 * install or session start; write it when absent only with `create`
 * (install does, a session start does not).
 */
export function keepIgnore(root: string, create: boolean, commitReplay: boolean = commitsReplay(root)): IgnoreAction {
  const path = resolve(root, IGNORE_FILE);
  const found = readText(path);
  const wanted = ignoreTextFor(commitReplay);
  if (found === wanted) return "unchanged";
  if (coherenceIgnore(found)) {
    write(path, wanted);
    return "upgraded";
  }
  if (found !== undefined) return "kept";
  if (!create) return "absent";
  write(path, wanted);
  return "wrote";
}

/** A file inside the replay folder, as git is asked about it from the project root: git ignores files, not empty folders. */
const REPLAY_PROBE = `${STATE_DIR}/${REPLAY_FOLDER}/session.jsonl`;

/** A file of the read trace (economy/trace.ts TRACES_DIR), asked beside it: state the ignore files are meant to keep out whatever the config says. */
const TRACE_PROBE = `${STATE_DIR}/traces/session.jsonl`;

/**
 * Where the config and git disagree on the replay record, said as one line
 * with what to change; undefined where they agree, outside git, or where the
 * ignore file is Coherence's own, which install and the session start bring
 * to the config's text. Coherence never edits an ignore file of the
 * adopter's, so it names the rule that decides and leaves the change to them.
 */
export function replayIgnoreDisagreement(root: string, commitReplay: boolean = commitsReplay(root)): string | undefined {
  if (coherenceIgnore(readText(resolve(root, IGNORE_FILE)))) return undefined;
  // --no-index asks the rules alone, so a record already committed is judged as a new one would be; the trace is asked beside it in the one call.
  const asked = spawnSync("git", ["check-ignore", "--no-index", "-v", "-n", REPLAY_PROBE, TRACE_PROBE], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (asked.status !== 0 && asked.status !== 1) return undefined;
  // Each path's line is source:line:pattern, a tab, the path; a path no rule matches has an empty source.
  const rules = new Map(String(asked.stdout ?? "").split("\n").filter((l) => l.includes("\t")).map((l) => [l.slice(l.indexOf("\t") + 1), l.slice(0, l.indexOf("\t"))] as const));
  const rule = (rules.get(REPLAY_PROBE) ?? "").replace(/^::$/, "");
  // A negated rule matches too (!pattern), and leaves the path kept.
  const ignored = rule !== "" && !/^[^:]*:\d+:!/.test(rule);
  if (ignored !== commitReplay) return undefined;
  const folder = `${STATE_DIR}/${REPLAY_FOLDER}/`;
  if (commitReplay) {
    return `Replay: ${CONFIG_FILE} sets ${COMMIT_REPLAY_KEY}, but git ignores ${folder} (${rule}), so the replay record stays on this machine. That ignore file is yours, so Coherence leaves it: add !${folder} after that rule to commit the record.`;
  }
  // A project whose ignore files keep none of Coherence's regenerated state out (the trace among it) has a larger gap than this one, and it is not the replay record's to name.
  const trace = (rules.get(TRACE_PROBE) ?? "").replace(/^::$/, "");
  if (trace === "" || /^[^:]*:\d+:!/.test(trace)) return undefined;
  return `Replay: ${CONFIG_FILE} does not set ${COMMIT_REPLAY_KEY}, so the replay record is meant to stay on this machine, but git does not ignore ${folder}. The ignore files are yours, so Coherence leaves them: ignore ${folder}, or set "${COMMIT_REPLAY_KEY}": true to commit it.`;
}

/** Whether an attributes file already sets the attribute of `line` (in any state: set, unset, or a value) for the same pattern. */
function sets(text: string, line: string): boolean {
  const [pattern, attribute] = line.split(" ") as [string, string];
  const name = attribute.split("=")[0];
  return text.split("\n").some((l) => {
    const [first, ...attributes] = l.trim().split(/\s+/);
    return first === pattern && attributes.some((a) => a.replace(/^[-!]/, "").split("=")[0] === name);
  });
}

/** Write .coherence/.gitattributes when absent, or over an earlier release's exact text; to one of the adopter's, add only the attributes it does not set, after every line it holds. */
export function keepAttributes(root: string): AttributesAction {
  const path = resolve(root, ATTRIBUTES_FILE);
  const found = readText(path);
  if (found === ATTRIBUTES_TEXT) return "unchanged";
  if (found === undefined) {
    write(path, ATTRIBUTES_TEXT);
    return "wrote";
  }
  if (EARLIER_ATTRIBUTES_TEXTS.includes(found)) {
    write(path, ATTRIBUTES_TEXT);
    return "added";
  }
  const missing = ATTRIBUTE_LINES.filter((line) => !sets(found, line));
  if (missing.length === 0) return "kept";
  write(path, `${found}${found === "" || found.endsWith("\n") ? "" : "\n"}${[ADDED_HEAD, ...missing].join("\n")}\n`);
  return "added";
}

/** What a session start does: the attributes file kept, and an ignore file of Coherence's brought to the text the config asks for; nothing created that install did not. Never throws. */
export function keepStateFiles(root: string): void {
  try {
    keepIgnore(root, false);
    keepAttributes(root);
  } catch {
    // An unwritable folder: the next session start tries again, and hooks install writes both.
  }
}

/** Remove each file that holds exactly what Coherence writes (in this or an earlier release's text); whether the ignore file went. */
export function removeStateFiles(root: string): boolean {
  const attributes = readText(resolve(root, ATTRIBUTES_FILE));
  if (attributes !== undefined && (attributes === ATTRIBUTES_TEXT || EARLIER_ATTRIBUTES_TEXTS.includes(attributes))) rmSync(resolve(root, ATTRIBUTES_FILE));
  if (!coherenceIgnore(readText(resolve(root, IGNORE_FILE)))) return false;
  rmSync(resolve(root, IGNORE_FILE));
  return true;
}
