/**
 * A session id as it may name a file: every record store writes
 * <store>/<session>.<token>.jsonl, so an id that is a path (../x) or empty
 * would write outside its store. The one rule every store, trace and baseline
 * that names a file by session checks; a copy of its own could loosen alone.
 * Only node: imports, so the hook's hottest paths and the status line load
 * nothing else for it.
 */

import { createHash } from "node:crypto";

export const SESSION_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Why a session id was refused, in the words every store says it. */
export function sessionRefusal(session: string): string {
  return `session "${session}" cannot name a file; use letters, digits, dot, dash, or underscore`;
}

/**
 * The file name a host-supplied name (a session id, an event) takes where a
 * state file is kept for it rather than refused: its characters outside
 * letters, digits, dot, dash and underscore become _, as every state file has
 * named them; a name that would still not meet SESSION_TOKEN (., .., empty, or
 * too long) takes a stem hashed from it, so it never names a folder above.
 */
export function fileStemOf(name: string): string {
  const rewritten = name.replace(/[^\w.-]/g, "_");
  return SESSION_TOKEN.test(rewritten) ? rewritten : `h${createHash("sha256").update(name).digest("hex").slice(0, 32)}`;
}
