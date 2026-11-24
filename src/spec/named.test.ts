import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { NAMED_SYMBOL } from "./named.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A regular expression spelling a symbol optionally `in <path>`: an identifier, then an optional group that opens on \s+in\s+. */
const SPELLED = /\[A-Za-z_\$\]\[(?:\\w\$|A-Za-z0-9_\$)\]\*\)\((?:\?:)?\\s\+in\\s\+/;

test("how a spec value names a symbol, optionally in a path, is written once: the spec model, the readings, the closure, the run and the scaffold import it", () => {
  assert.deepEqual([..."handle in src/a.ts".match(NAMED_SYMBOL)!].slice(1), ["handle", "src/a.ts"]);
  assert.deepEqual([..."$handle".match(NAMED_SYMBOL)!].slice(1), ["$handle", undefined]);
  for (const value of ["src/a.ts", "the sign-in route", "a in", "9a"]) assert.equal(NAMED_SYMBOL.exec(value), null, value);
  const spelled = ["src", "plugins"].flatMap((dir) =>
    readdirSync(join(REPO, dir), { recursive: true })
      .map(String)
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.includes("fixtures") && !file.includes("node_modules"))
      .map((file) => join(dir, file))
      .filter((file) => file !== join("src", "spec", "named.ts") && SPELLED.test(readFileSync(join(REPO, file), "utf8"))),
  );
  assert.deepEqual(spelled, [], "import NAMED_SYMBOL from src/spec/named.ts");
});
