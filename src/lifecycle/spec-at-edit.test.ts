import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { runHook } from "./hook.ts";
import { specAlarm } from "./spec-at-edit.ts";

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const ENTRY = (levels: string): string => `# Shop\n\nA shop with one door in.\n\n## trust levels\n${levels}\n\n## invariants\n`;
const VALID = "- visitor (outside): what anyone on the network sends (a browser, a cron)\n- storage: the rows beneath everything";

/** An adopter of the umami shape: an entry spec, a component with its practice file, and a folder the config bounds away. */
function project(): string {
  const root = mkdtempSync(join(tmpdir(), "coherence-spec-at-edit-"));
  made.push(root);
  const files: Record<string, string> = {
    "coherence.config.json": JSON.stringify({ name: "shop", ignore: ["vendor"] }),
    "Shop.spec.md": ENTRY(VALID),
    "src/cart/Cart.spec.md": "# Cart\n\nThe cart.\n\n## invariants\n",
    "src/cart/Cart.practice.md": "- add an item: An item joins the cart only through addItem.\n  step: call addItem\n",
    "src/cart/cart.ts": "export const cart = 1;\n",
    "vendor/Lib.spec.md": "# Lib\n\nA vendored library.\n\n## trust levels\n- visitor: (outside) anyone\n",
  };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(root, file, ".."), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
}

async function edit(root: string, file: string, text: string, session = "s-spec-edit"): Promise<{ context: string; exit: number }> {
  writeFileSync(join(root, file), text);
  const result = await runHook("PostToolUse", { cwd: root, session_id: session, tool_name: "Edit", tool_input: { file_path: join(root, file) } }, root);
  const context = result.stdout.trim() === "" ? "" : ((JSON.parse(result.stdout) as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput?.additionalContext ?? "");
  result.commit?.();
  return { context, exit: result.exit };
}

test("an edit that writes a spec problem names it by file and line in the same turn, and again only when the file's problems change", async () => {
  const root = project();
  // The umami adoption's first entry spec: the marker in the meaning, where it marks nothing.
  const broke = await edit(root, "Shop.spec.md", ENTRY("- visitor: (outside) what anyone on the network sends\n- storage: the rows beneath everything"));
  assert.equal(broke.exit, 0, "advice in the turn, never a block");
  assert.match(broke.context, /✕ Shop\.spec\.md:6 trust level visitor carries \(outside\) where it marks nothing, so it reads as inside; the marker follows the name: - visitor \(outside\)/);
  // The same problems, lines moved by an unrelated change: said once.
  const again = await edit(root, "Shop.spec.md", `# Shop\n\nA shop with one door in.\n\n\n## trust levels\n- visitor: (outside) what anyone on the network sends\n- storage: the rows beneath everything\n\n## invariants\n`);
  assert.equal(again.context, "", "a file whose problems did not change is not named again");
  // A second problem in the same file: the file is named again, with both.
  const more = await edit(root, "Shop.spec.md", ENTRY("- visitor: (outside) what anyone on the network sends\n- (outside) caller: an API caller"));
  assert.match(more.context, /Shop\.spec\.md:6 trust level visitor carries \(outside\)/);
  assert.match(more.context, /Shop\.spec\.md:7 trust level caller carries \(outside\)/);
  // Fixed: silent, and forgotten, so the same problem returning is said again.
  assert.equal((await edit(root, "Shop.spec.md", ENTRY(VALID))).context, "");
  assert.match((await edit(root, "Shop.spec.md", ENTRY("- visitor: (outside) what anyone on the network sends"))).context, /Shop\.spec\.md:6 trust level visitor/);
  // Another session has heard nothing yet.
  assert.match((await edit(root, "Shop.spec.md", ENTRY("- visitor: (outside) what anyone on the network sends"), "s-other")).context, /Shop\.spec\.md:6/);
});

test("an edit that writes a practice file names its problems by file and line", async () => {
  const root = project();
  const broke = await edit(root, "src/cart/Cart.practice.md", "- add an item: An item joins the cart only through addItem.\n  step: call addItem\n  stride: twice\n");
  assert.match(broke.context, /✕ src\/cart\/Cart\.practice\.md:3 unknown key stride: on practice add an item/);
});

test("an edit says no spec problem where spec --check finds none: a valid spec, a code file, a spec the config bounds away, a deleted spec", async () => {
  const root = project();
  // Valid inputs the umami fix must not flag: the marker after the name, the word outside and other parentheses in a meaning.
  assert.equal((await edit(root, "Shop.spec.md", ENTRY(VALID))).context, "");
  assert.equal((await edit(root, "src/cart/Cart.spec.md", "# Cart\n\nThe cart.\n\n## entrances\n- page (outside)/cart: the cart page in a route group\n  handler: cart in src/cart/cart.ts\n  trust: visitor\n\n## invariants\n")).context, "");
  assert.equal((await edit(root, "src/cart/cart.ts", "export const cart = 2;\n")).context, "");
  assert.equal((await edit(root, "vendor/Lib.spec.md", "# Lib\n\nA vendored library.\n\n## trust levels\n- visitor: (outside) anyone else\n")).context, "", "the model never reads a spec the ignore list bounds away");
  rmSync(join(root, "src/cart/Cart.spec.md"));
  assert.equal(specAlarm(root, ["src/cart/Cart.spec.md"], "s-gone", "coherence").text, "");
});

test("the spec alarm parses only the files the edit wrote, inside the tool hooks' budget", () => {
  const root = project();
  writeFileSync(join(root, "Shop.spec.md"), ENTRY("- visitor: (outside) what anyone on the network sends"));
  const at = performance.now();
  const alarm = specAlarm(root, ["Shop.spec.md", "src/cart/cart.ts"], "s-cost", "coherence");
  const spent = performance.now() - at;
  assert.match(alarm.text, /Shop\.spec\.md:6/);
  assert.ok(spent < 100, `one spec parsed in ${spent.toFixed(1)} ms`);
  const none = performance.now();
  assert.equal(specAlarm(root, ["src/cart/cart.ts"], "s-cost", "coherence").text, "");
  assert.ok(performance.now() - none < 5, "an edit that wrote no spec or practice file reads nothing");
});
