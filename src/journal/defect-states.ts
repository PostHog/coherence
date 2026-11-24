/**
 * Each defect as the journal now has it, folded from the records that name
 * it. Kept apart from defects.ts, which reads lexicons and the repository, so
 * Scope's browser bundle folds the records a page holds the way the CLI does.
 */

import type { Caught, Decision, Defect, DefectOrigin, JournalRecord, Resolution } from "./record.ts";

/** A defect class's name, as the defect verb takes one and the lexicon declares one: lowercase words joined by hyphens (path-identity, silent-skip). */
export const CLASS_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * A defect's origin fields (DefectOrigin) in the order every reader gives
 * them: the verbs' flags, the classification's words, the journal's reading
 * and this fold. Kept here, with no runtime import, so Scope's bundle folds by
 * them too; the record's word roles (ORIGIN_ROLES) are typed against
 * DefectOrigin, as this list is.
 */
export const ORIGIN_FIELDS = ["class", "introduced", "caught"] as const satisfies readonly (keyof DefectOrigin)[];

export type OriginField = (typeof ORIGIN_FIELDS)[number];

// Every field of DefectOrigin is listed.
export const ORIGIN_COMPLETE: [Exclude<keyof DefectOrigin, OriginField>] extends [never] ? true : never = true;

/** The origin fields as a caller gives them, each a raw value or absent. */
export type OriginGiven = { [K in OriginField]?: string | undefined };

/** A defect's class, origin and catch as given on one record, "class <name>, introduced <commit>, caught <how>", or "" when it gives none. */
export function originText(origin: DefectOrigin): string {
  return ORIGIN_FIELDS.flatMap((field) => (origin[field] === undefined ? [] : [`${field} ${origin[field]}`])).join(", ");
}

/** One defect as the journal now has it: its fields folded from every later record, and the resolution that closed it. */
export interface DefectState {
  id: string;
  at: string;
  what: string;
  class?: string;
  introduced?: string;
  caught?: Caught;
  /** The files the defect names, as it was recorded; empty when it named none. */
  files?: string[];
  /** The component the defect record names, when it was written with one; a record older than the field names none. */
  component?: string;
  /** The short commit HEAD named when the defect was written, null where no git answered. */
  commit?: string | null;
  /** The resolution that closed it, unretracted; absent while it is open. */
  resolution?: Resolution;
}

/** Records some retraction points at. */
function retracted(records: readonly JournalRecord[]): Set<string> {
  return new Set(records.flatMap((r) => (r.kind === "retraction" ? [r.of] : [])));
}

function fold(into: DefectOrigin, from: DefectOrigin): void {
  for (const field of ORIGIN_FIELDS) if (from[field] !== undefined) (into as Record<OriginField, string>)[field] = from[field];
}

/**
 * Every defect in the journal, oldest first, with its class, origin and catch
 * folded and its close, if any. A retracted defect is none: a withdrawn
 * report is no fault, so no floor, convergence count or dead end reads it.
 */
export function defectStates(records: readonly JournalRecord[]): DefectState[] {
  const gone = retracted(records);
  const ordered = [...records].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const states = new Map<string, DefectState>();
  for (const record of ordered) {
    if (record.kind === "defect" && !gone.has(record.id)) {
      const d = record as Defect;
      const state: DefectState = { id: d.id, at: d.at, what: d.what, files: Array.isArray(d.files) ? d.files : [], commit: d.commit ?? null };
      if (typeof d.component === "string") state.component = d.component;
      fold(state, d);
      states.set(d.id, state);
    } else if (gone.has(record.id)) {
      continue;
    } else if (record.kind === "decision") {
      const c = (record as Decision).classifies;
      const state = c === undefined ? undefined : states.get(c.of);
      if (state !== undefined) fold(state, c!);
    } else if (record.kind === "resolution") {
      const state = states.get(record.of);
      if (state === undefined) continue;
      fold(state, record);
      state.resolution = record;
    }
  }
  return [...states.values()];
}
