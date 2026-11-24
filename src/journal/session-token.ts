/**
 * A session id as it may name a file: every record store writes
 * <store>/<session>.<token>.jsonl, so an id that is a path (../x) or empty
 * would write outside its store. The one rule every store, trace and baseline
 * that names a file by session checks; a copy of its own could loosen alone.
 * No imports, so the hook's hottest paths load nothing else for it.
 */

export const SESSION_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Why a session id was refused, in the words every store says it. */
export function sessionRefusal(session: string): string {
  return `session "${session}" cannot name a file; use letters, digits, dot, dash, or underscore`;
}
