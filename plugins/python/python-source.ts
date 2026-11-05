/**
 * Where a Python import leads: what no parse can say, since a module's place
 * is Python's rule, not its syntax. What a file declares and imports is read
 * through Python's parser and python.scm (the manifest's treeSitter), so this
 * module reads no text.
 */

import { existsSync } from "node:fs";
import { posix, resolve } from "node:path";
import type { ModuleResolution } from "../../src/plugins/api.ts";
import { resolveDotted } from "./python.ts";

/** A module is a .py file or a package's __init__.py; a leading dot resolves against the importing file's package, each further dot one package up. */
export const PYTHON_RESOLVE: ModuleResolution = {
  resolveModule(root, from, specifier, vanished) {
    const dots = /^(\.*)(.*)$/.exec(specifier)!;
    const up = dots[1]!.length;
    const parts = dots[2] === "" ? [] : dots[2]!.split(".");
    let base = posix.dirname(from);
    for (let i = 1; i < up; i++) base = posix.dirname(base);
    const candidates = up === 0 ? [posix.join(...parts) + ".py", posix.join(...parts, "__init__.py")] : [posix.join(base, ...parts) + ".py", posix.join(base, ...parts, "__init__.py")];
    return candidates.find((c) => vanished.has(c) || existsSync(resolve(root, c)));
  },
  // A star import keys the word index by the module as a .py file and as a package's __init__.py, whichever it is.
  modulePaths(from, specifier) {
    const [, dots, dotted] = /^(\.*)(.*)$/.exec(specifier)!;
    const target = resolveDotted(from, dots!, dotted!);
    return target === undefined ? [] : [`${target}.py`, `${target}/__init__.py`];
  },
};
