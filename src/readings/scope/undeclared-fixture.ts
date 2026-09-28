/**
 * The undeclared-entrance fixture the Lifecycle and Scaffold checks share: a
 * TypeScript project in a git repository whose entry spec declares one of
 * its server functions, with more server functions, a server route and a
 * package script the rules detect and no spec declares. Not a test file, so
 * importing it registers no test.
 *
 * src/server/fns.ts holds `functions` server functions (readThing declared,
 * the rest not); src/routes/api/users.$id.ts a server route; scripts/seed.ts
 * the file package.json's seed script runs. With `serverSpec`, src/server has
 * a spec of its own, so its entrances belong there.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface UndeclaredProject {
  root: string;
  remove: () => void;
}

export const SERVER_FUNCTION_NAMES = ["readThing", "writeThing", "deleteThing", "listThings", "shareThing"];

export function undeclaredProject(options: { functions?: number; serverSpec?: boolean; trust?: string } = {}): UndeclaredProject {
  const count = options.functions ?? SERVER_FUNCTION_NAMES.length;
  const root = mkdtempSync(join(tmpdir(), "coherence-undeclared-"));
  writeFileSync(join(root, "coherence.config.json"), JSON.stringify({ name: "Shelf", language: "typescript" }));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "shelf", private: true, scripts: { seed: "tsx scripts/seed.ts" } }));
  mkdirSync(join(root, "src", "server"), { recursive: true });
  mkdirSync(join(root, "src", "routes", "api"), { recursive: true });
  mkdirSync(join(root, "scripts"));
  const names = Array.from({ length: count }, (_, i) => SERVER_FUNCTION_NAMES[i] ?? `extraThing${i}`);
  writeFileSync(
    join(root, "src", "server", "fns.ts"),
    ["import { createServerFn } from '@tanstack/react-start'", "", ...names.flatMap((n) => [`export const ${n} = createServerFn({ method: 'POST' })`, "  .handler(async () => null)", ""])].join("\n"),
  );
  writeFileSync(
    join(root, "src", "routes", "api", "users.$id.ts"),
    ["import { createFileRoute } from '@tanstack/react-router'", "", "export const Route = createFileRoute('/api/users/$id')({", "  server: { handlers: { GET: async () => new Response('ok') } },", "})", ""].join("\n"),
  );
  writeFileSync(join(root, "scripts", "seed.ts"), "console.log('seeded')\n");
  writeFileSync(
    join(root, "Shelf.spec.md"),
    [
      "# Shelf", "", "Keeps things.", "",
      "## trust levels",
      "- visitor (outside): anyone on the network",
      "- operator: the people who run the service", "",
      "## entrances",
      "- read thing: a visitor reads a thing", "  handler: readThing in src/server/fns.ts", `  trust: ${options.trust ?? "visitor"}`, "",
      "## invariants", "",
    ].join("\n"),
  );
  if (options.serverSpec === true) writeFileSync(join(root, "src", "server", "Server.spec.md"), "# Server\n\nAnswers the browser.\n\n## invariants\n");
  const git = (...args: string[]): void => void execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git("init", "-q");
  git("add", ".");
  git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "seed");
  return { root, remove: () => rmSync(root, { recursive: true, force: true }) };
}
