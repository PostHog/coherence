/**
 * The gap fixture the Scope, Lifecycle and Scaffold checks share: a project
 * whose entry spec declares three entrances carrying outside trust in, one of
 * them with control: none, in a git repository, and the reading that
 * resolved each. Not a test file, so importing it registers no test.
 *
 * With `door`, the project also has a chokepoint invariant (one door: door
 * protects inner, in src/door.ts), look's handler calls door, and peek's
 * reach enters src/store; with `waived: false`, ping declares no control.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InterfaceReading, ReachReference } from "./model.ts";

export interface GapProject {
  root: string;
  reading: InterfaceReading;
  remove: () => void;
}

/** A project with three entrances carrying outside trust in, one declaring control: none, and a reading that resolved each. */
export function gapProject(options: { door?: boolean; waived?: boolean } = {}): GapProject {
  const door = options.door === true;
  const waived = options.waived !== false;
  const root = mkdtempSync(join(tmpdir(), "coherence-gaps-"));
  writeFileSync(join(root, "coherence.config.json"), JSON.stringify({ name: "Gappy", language: "typescript" }));
  mkdirSync(join(root, "src"));
  writeFileSync(
    join(root, "src", "look.ts"),
    door
      ? 'import { door } from "./door.ts";\nexport const look = door(() => "looked");\nexport function peek(): void {}\nexport function ping(): void {}\n'
      : "export function look(): void {}\nexport function peek(): void {}\nexport function ping(): void {}\n",
  );
  if (door) {
    writeFileSync(join(root, "src", "door.ts"), "export function inner(): void {}\nexport function door<T>(work: () => T): T {\n  inner();\n  return work();\n}\n");
    mkdirSync(join(root, "src", "store"));
    writeFileSync(join(root, "src", "store", "Store.spec.md"), "# Store\n\nKeeps rows.\n\n## invariants\n");
    writeFileSync(join(root, "src", "store", "rows.ts"), "export function row(): number {\n  return 1;\n}\n");
  }
  writeFileSync(
    join(root, "Gappy.spec.md"),
    [
      "# Gappy", "", "Serves looks.", "",
      "## trust levels",
      "- public (outside): anyone on the network",
      "- inside: the service's own code", "",
      "## entrances",
      "- look: a caller looks", "  handler: look in src/look.ts", "  trust: public",
      "- peek: a caller peeks", "  handler: peek in src/look.ts", "  trust: public",
      "- ping: a health check", "  handler: ping in src/look.ts", "  trust: public", ...(waived ? ["  control: none — the same empty answer for every caller"] : []), "",
      "## invariants",
      ...(door
        ? [
            "- one door: Every look passes the door before its work runs.",
            "  protects: inner",
            "  chokepoint: door",
            "  because: the door is where a look is checked",
            "  crossing: public -> inside",
            "  kinds: none",
          ]
        : []),
      "",
    ].join("\n"),
  );
  const reach = (name: string): ReachReference[] =>
    door && name === "peek" ? [{ from: ".", to: "src/store", symbol: "row", file: "src/store/rows.ts", sites: 1 }] : [];
  const reading: InterfaceReading = {
    kind: "read",
    language: "typescript",
    declarations: 3,
    symbols: door ? [{ from: ".", to: "src/store", symbol: "row", file: "src/store/rows.ts", sites: 1 }] : [],
    entrances: ["look", "peek", "ping"].map((name) => ({ component: ".", name, file: "src/look.ts", reach: reach(name), guards: [] })),
    unowned: { files: 0, lines: 0 },
  };
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "add", "."], { cwd: root });
  execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "seed"], { cwd: root });
  return { root, reading, remove: () => rmSync(root, { recursive: true, force: true }) };
}
