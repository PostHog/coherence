/**
 * A practice trigger that names no file of its project never fires and would
 * never say so. The PostHog adoption moved from one whole-repository project
 * to registry leaves, and its practices kept triggers written relative to the
 * repository top: edit posthog/auth.py, inside the posthog leaf, names
 * posthog/posthog/auth.py; one ee/api trigger named a file in another leaf
 * (df-b277ba29). spec --check names each, with what to write instead, and
 * adopt says so the moment a folder becomes a project.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { adopt, adoptText } from "../lifecycle/adopt.ts";
import { closeWork, openWork } from "../lifecycle/work-meter.ts";
import { deadTriggers } from "./practices.ts";
import { loadSpecModel, projectPractices } from "./model.ts";

const madeFolders: string[] = [];
after(() => {
  for (const folder of madeFolders) rmSync(folder, { recursive: true, force: true });
});

function repository(files: Record<string, string>): string {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "coherence-dead-triggers-")));
  madeFolders.push(top);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(top, path)), { recursive: true });
    writeFileSync(join(top, path), text);
  }
  const git = (...args: string[]) => spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: top, encoding: "utf8" });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "seed");
  return top;
}

const practice = (name: string, when: string): string => `- ${name}: A method kept here.\n  when: ${when}\n  step: do the thing\n  because: a fixture\n`;
const spec = (name: string): string => `# ${name}\n\nA component.\n`;
const dead = (root: string): string[] =>
  loadSpecModel(root, { runs: false })
    .problems.filter((p) => /matches no file in this project/.test(p.message))
    .map((p) => p.message);

test("a practice's edit trigger that names no file of its project is a spec problem saying what to write instead", () => {
  const top = repository({
    "coherence.config.json": JSON.stringify({ projects: ["posthog", "ee/api"] }),
    "posthog/auth.py": "def authenticate():\n    pass\n",
    "posthog/api/authentication.py": "social_auth = 1\n",
    "posthog/Posthog.spec.md": spec("Posthog"),
    "posthog/Posthog.practice.md": practice("auth rule", "edit posthog/auth.py adding def authenticate | edit posthog/auth.py adding is_active | edit auth.py adding team_id"),
    "ee/api/authentication.py": "def get_user_id():\n    pass\n",
    "ee/api/EeApi.spec.md": spec("EeApi"),
    "ee/api/EeApi.practice.md": practice("link identities", "edit ee/api/authentication.py adding def get_user_id | edit posthog/api/authentication.py adding social_ | edit nowhere/at/all.py adding x"),
  });
  const posthog = dead(join(top, "posthog"));
  assert.equal(posthog.length, 1, `one dead glob, named once however many triggers use it: ${posthog.join("\n")}`);
  assert.match(posthog[0]!, /practice auth rule: its trigger edit posthog\/auth\.py matches no file in this project, so the practice never fires on it; paths in a when: line are relative to the project's folder: write edit auth\.py$/);
  const ee = dead(join(top, "ee/api"));
  assert.equal(ee.length, 3, ee.join("\n"));
  assert.ok(ee.some((m) => /edit ee\/api\/authentication\.py .*: write edit authentication\.py$/.test(m)), "a path written from the repository top gets the leaf's path for it");
  assert.ok(ee.some((m) => /edit posthog\/api\/authentication\.py .*it names posthog\/api\/authentication\.py, outside this project/.test(m)), "a path in another leaf is named as outside");
  assert.ok(ee.some((m) => /edit nowhere\/at\/all\.py .*correct the path, or remove the trigger$/.test(m)), "a path that is nowhere is still a problem");
});

test("a trigger that matches a file of its project, a pattern, or a whole-repository project's path is no problem, and a mistyped one is", () => {
  const top = repository({
    "coherence.config.json": JSON.stringify({ name: "p" }),
    "src/widget/Widget.spec.md": spec("Widget"),
    "src/widget/knob.ts": "export const knob = 1;\n",
    "src/widget/Widget.practice.md": practice("oil the knob", "edit src/widget/**/*.ts adding knob | edit src/widget/knob.ts | command turn-knob"),
  });
  assert.deepEqual(dead(top), [], "every edit trigger names a file of the project");
  writeFileSync(join(top, "src/widget/Widget.practice.md"), practice("oil the knob", "edit src/widgets/knob.ts"));
  assert.match(dead(top)[0] ?? "", /edit src\/widgets\/knob\.ts matches no file in this project.*correct the path, or remove the trigger$/, "a mistyped path in a whole-repository project is a problem too");
});

test("adopt names the folder's practice triggers that name no file of the project it becomes", () => {
  const top = repository({
    "coherence.config.json": JSON.stringify({ projects: [] }),
    "posthog/auth.py": "def authenticate():\n    pass\n",
    "posthog/Posthog.spec.md": spec("Posthog"),
    "posthog/Posthog.practice.md": practice("auth rule", "edit posthog/auth.py adding def authenticate"),
    "ee/api/authentication.py": "x = 1\n",
    "ee/api/EeApi.spec.md": spec("EeApi"),
    "ee/api/EeApi.practice.md": practice("link identities", "edit authentication.py adding x"),
  });
  const adopted = adopt(top, "posthog");
  assert.equal(adopted.deadTriggers.length, 1);
  assert.match(adoptText(adopted, "coherence"), /1 practice trigger in posthog name no file of the project it now is[^\n]*\n  practice auth rule: its trigger edit posthog\/auth\.py .*: write edit auth\.py/);
  assert.deepEqual(adopt(top, "ee/api").deadTriggers, [], "a folder whose triggers already name its files hears nothing more");
});

test("the dead-trigger check lists only what its triggers name, so a project ten times larger costs it nothing more", () => {
  // The spec model loads several times in one hook, and each load runs the check: a listing of the whole project per load cost PostHog's first leaf entry half a second.
  const files = (others: number): Record<string, string> => ({
    "coherence.config.json": JSON.stringify({ name: "p" }),
    "src/widget/Widget.spec.md": spec("Widget"),
    "src/widget/knob.ts": "export const knob = 1;\n",
    "src/widget/Widget.practice.md": practice("oil the knob", "edit src/widget/knob.ts adding knob | edit src/widget/*.ts adding dial"),
    ...Object.fromEntries(Array.from({ length: others }, (_, k) => [`docs/notes/note-${k}.md`, `A note numbered ${k}.\n`])),
  });
  const output = (root: string): number => {
    const practices = projectPractices(root);
    const scope = openWork();
    try {
      assert.deepEqual(deadTriggers(root, practices), []);
    } finally {
      closeWork(scope);
    }
    return Object.values(scope.work.outputs).reduce((sum, bytes) => sum + bytes, 0);
  };
  const small = output(repository(files(20)));
  const large = output(repository(files(2000)));
  assert.ok(small > 0, "the check asks git");
  assert.equal(large, small, `the check's listings are the same size beside 20 and 2000 unrelated files: ${small} and ${large} bytes`);
});
