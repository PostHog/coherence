/**
 * The Python adapter: not yet. It exists so the grade ladder is
 * adapter-defined from the first day. Python enforces no visibility: an
 * underscore prefix and a module's __all__ list are conventions any caller
 * may ignore, so the top rung a Python chokepoint can earn is
 * reference-choked, one step below TypeScript's. When Pyright is driven over
 * the same protocol this file becomes the second implementation of the seam.
 */

import type { Definition, Ladder, LanguageAdapter, Refutation, ReferenceSite, ResolveHint, Resolved, Visibility } from "./adapter.ts";

export const PYTHON_LADDER: Ladder = {
  top: "reference-choked",
  because: "Python enforces no visibility: an underscore prefix and a module's __all__ list are conventions a caller may ignore, so nothing outside the repository is refused",
};

const NOT_YET = "the Python adapter is not yet implemented; Pyright over the language server protocol is next";

export class PythonAdapter implements LanguageAdapter {
  readonly language = "python";
  readonly ladder = PYTHON_LADDER;
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  async ready(): Promise<{ ok: false; reason: string }> {
    return { ok: false, reason: NOT_YET };
  }

  async resolve(_name: string, _hint: ResolveHint): Promise<Resolved> {
    return { ok: false, reason: NOT_YET };
  }

  async references(_definition: Definition): Promise<ReferenceSite[]> {
    throw new Error(NOT_YET);
  }

  async visibility(_definition: Definition): Promise<Visibility> {
    return { enforced: false, visible: true, evidence: PYTHON_LADDER.because };
  }

  /** pytest selects by `-k <expression>`; a `via` value is used as that expression. */
  testFilter(via: string): string {
    return via;
  }

  async refute(_protectedThing: Definition, _outsideOf: Definition | undefined): Promise<Refutation> {
    return { seen: false, account: NOT_YET };
  }

  async close(): Promise<void> {}
}
