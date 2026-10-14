/**
 * Blanking a source file's comments and strings (source-text.ts): what is
 * left is exactly the code a text scan may read, at the offsets it had, so a
 * regex literal that holds a quote or a comment marker, and a template
 * literal's substitutions, never hide or invent code.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { blankNonCode } from "./source-text.ts";

function kept(text: string): string {
  const code = blankNonCode(text, true);
  assert.equal(code.length, text.length, "every offset stands");
  assert.deepEqual(code.split("\n").length, text.split("\n").length, "every line stands");
  return code.replace(/\s+/g, " ").trim();
}

test("comments and string contents are blanked; the code around them and the offsets stand", () => {
  assert.equal(kept(`const a = "x/y"; // internal.t.send\n/* api.t.send */ const b = 'q';`), `const a = " "; const b = ' ';`);
});

test("a regex literal is not a string, a comment or a template: the code after it stands, and division is not a regex", () => {
  assert.equal(kept("const strip = /`/g; run(internal.t.send);"), "const strip = / /g; run(internal.t.send);");
  assert.equal(kept(`a.replace(/\\/*$/, ''); export const join = mutation({});`), `a.replace(/ /, ''); export const join = mutation({});`);
  assert.equal(kept(`url.replace(/^https?:\\/\\//, ''); run(internal.t.send);`), `url.replace(/ /, ''); run(internal.t.send);`);
  assert.equal(kept(`const q = /'/.test("hello"); run(internal.t.send);`), `const q = / /.test(" "); run(internal.t.send);`);
  assert.equal(kept(`const r = /[/"]/; run(internal.t.send);`), `const r = / /; run(internal.t.send);`);
  assert.equal(kept(`const half = total / 2 / count; const s = "a";`), `const half = total / 2 / count; const s = " ";`);
  assert.equal(kept(`return /x/.test(s) ? a : b;`), `return / /.test(s) ? a : b;`);
});

test("a slash divides after a postfix operator and a property named like a keyword, opens a regex after a control statement's condition, and closes a JSX tag", () => {
  const reads = (text: string, code: string): void => assert.ok(kept(text).includes(code), `${code} stays code in: ${kept(text)}`);
  reads("const half = counter++ / await run(internal.t.send) / 2;", "await run(internal.t.send) / 2");
  reads("const r = data.in / 2; const s = '/'; run(internal.t.send);", "run(internal.t.send);");
  reads("if (ready) /`/.test(label); run(internal.t.send);", "run(internal.t.send);");
  reads("while (x) /'/.test(y); run(internal.t.send);", "run(internal.t.send);");
  reads("if /* ready */ (ready) /`/.test(label); run(internal.t.send);", "run(internal.t.send);");
  reads("const f = (a) / 2; const s = '/'; run(internal.t.send);", "run(internal.t.send);");
  reads("return <p><b>Hi</b>{String(useQuery(api.t.send))}</p>;", "useQuery(api.t.send)");
  reads("return <Img src={a} />{run(internal.t.send)}<i>/</i>;", "run(internal.t.send)");
});

test("a template literal's text is blanked and its substitutions stay code, nested templates and braces included", () => {
  assert.equal(kept("const t = `send ${internal.t.send} now`;"), "const t = ` ${internal.t.send} `;");
  assert.equal(kept("const t = `${ { a: internal.t.send }.a } and ${`in ${api.t.get}`}`; run();"), "const t = `${ { a: internal.t.send }.a } ${` ${api.t.get}`}`; run();");
});

test("with strings kept, only comments are blanked", () => {
  assert.equal(blankNonCode(`import { api } from "./_generated/api"; // x`, false).trimEnd(), `import { api } from "./_generated/api";`);
});
