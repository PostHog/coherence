/**
 * What regulate has already said to a session, and what it carries to the
 * session's next prompt.
 *
 * A main-thread stop's message reaches the user, not the agent: the host
 * shows a stop hook's systemMessage and never puts it in the model's context.
 * So the stop says each line once (a line said at an earlier stop of this
 * session is not said again), blocks once when a line names what the session
 * owes, which puts the reason in front of the agent, and otherwise carries
 * what it said to the next UserPromptSubmit, which the agent does read.
 * Transient, like the feed cursors: .coherence/regulate/<session>.json.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const REGULATE_DIR = join(".coherence", "regulate");

interface Memory {
  /** Hashes of every line said at a stop of this session. */
  said: string[];
  /** What the last stop said, for the next prompt; absent once delivered. */
  carry?: string;
}

function file(root: string, session: string): string {
  return join(root, REGULATE_DIR, `${session.replace(/[^\w.-]/g, "_")}.json`);
}

function read(root: string, session: string): Memory {
  try {
    const parsed = JSON.parse(readFileSync(file(root, session), "utf8")) as Partial<Memory>;
    return { said: Array.isArray(parsed.said) ? parsed.said.filter((s): s is string => typeof s === "string") : [], ...(typeof parsed.carry === "string" ? { carry: parsed.carry } : {}) };
  } catch {
    return { said: [] };
  }
}

function write(root: string, session: string, memory: Memory): void {
  mkdirSync(join(root, REGULATE_DIR), { recursive: true });
  writeFileSync(file(root, session), JSON.stringify(memory));
}

const hash = (line: string): string => createHash("sha256").update(line).digest("hex").slice(0, 16);

/**
 * The parts with only the lines this session has not been told: a part's
 * heading (a first line ending in a colon) stays with any new line under it,
 * and a part with no new line is left out.
 */
export function unsaid(root: string, session: string, parts: readonly string[]): { parts: string[]; lines: string[] } {
  const said = new Set(read(root, session).said);
  const out: string[] = [];
  const lines: string[] = [];
  for (const part of parts) {
    const all = part.split("\n");
    const heading = all.length > 1 && all[0]!.endsWith(":") ? all[0]! : undefined;
    const body = heading === undefined ? all : all.slice(1);
    const fresh = body.filter((line) => line.trim() !== "" && !said.has(hash(line)));
    if (fresh.length === 0) continue;
    lines.push(...fresh);
    out.push([...(heading === undefined ? [] : [heading]), ...fresh].join("\n"));
  }
  return { parts: out, lines };
}

/** Remember the lines as said, and keep the text for the next prompt when it is to be carried. */
export function rememberSaid(root: string, session: string, lines: readonly string[], carry: string | undefined): void {
  const memory = read(root, session);
  const said = [...new Set([...memory.said, ...lines.map(hash)])];
  write(root, session, { said, ...(carry === undefined ? (memory.carry === undefined ? {} : { carry: memory.carry }) : { carry }) });
}

/** What the last stop carried to this prompt, or undefined. */
export function carried(root: string, session: string): string | undefined {
  return existsSync(file(root, session)) ? read(root, session).carry : undefined;
}

/** The carried text has reached the agent: drop it, keep what was said. */
export function dropCarry(root: string, session: string): void {
  const memory = read(root, session);
  if (memory.carry === undefined) return;
  write(root, session, { said: memory.said });
}
