/**
 * Entrance detection (entrance-candidates.ts): every rule the language lists
 * detects its shape, with the rule and why; what the rules leave alone (a
 * page route, a path inside a string, include(), an imported helper script,
 * a test file) stays undetected; and a detected entrance records the
 * declared wrappers its own statement calls, bound in its file.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { CANDIDATE_RULES } from "../readings/scope/entrance-coverage.ts";
import { detectEntranceCandidates, type EntranceCandidate } from "./entrance-candidates.ts";

function project(files: Record<string, string>): { root: string; files: string[]; remove: () => void } {
  const root = mkdtempSync(join(tmpdir(), "coherence-detect-"));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return { root, files: Object.keys(files).sort(), remove: () => rmSync(root, { recursive: true, force: true }) };
}

const TYPESCRIPT: Record<string, string> = {
  "package.json": JSON.stringify({ bin: { tool: "src/cli.ts" }, scripts: { backup: "tsx scripts/backup.ts --help", build: "vite build && esbuild scripts/bundled.ts --bundle", test: "node --test src/fns.test.ts" } }),
  "src/cli.ts": "import { run } from './run'\nrun(process.argv)\n",
  "src/run.ts": "export function run(argv: string[]): void {}\n",
  "src/rpc.ts": "export const { rpc, mutationRpc } = make()\nfunction make() { return { rpc: (f: () => unknown) => f(), mutationRpc: (f: () => unknown) => f() } }\n",
  "src/fns.ts": [
    "import { createServerFn } from '@tanstack/react-start'",
    "import { rpc, mutationRpc } from './rpc'",
    "",
    "export const readThing = createServerFn({ method: 'GET' })",
    "  .handler(async () =>",
    "    rpc(async () => 1),",
    "  )",
    "",
    "export const writeThing = createServerFn({ method: 'POST' })",
    "  .handler(async () =>",
    "    mutationRpc(async () => 2),",
    "  )",
    "",
    "export const wrapped = mutationRpc(async () => 3)",
    "",
    "export const helper = (n: number) => n + 1",
    "",
  ].join("\n"),
  "src/fns.test.ts": "import { createServerFn } from '@tanstack/react-start'\nexport const notOne = createServerFn({ method: 'GET' })\n",
  "src/routes/api/health.ts": [
    "import { createFileRoute } from '@tanstack/react-router'",
    "import { mutationRpc } from '../../rpc'",
    "",
    "const handle = () => mutationRpc(async () => new Response('ok'))",
    "",
    "export const Route = createFileRoute('/api/health')({",
    "  server: {",
    "    handlers: { GET: handle },",
    "  },",
    "})",
    "",
  ].join("\n"),
  "src/routes/index.tsx": "import { createFileRoute } from '@tanstack/react-router'\nexport const Route = createFileRoute('/')({ component: Home })\nfunction Home() { return null }\n",
  "app/api/items/route.ts": "export async function GET() { return new Response('[]') }\nexport async function POST() { return new Response('') }\nexport function helper() {}\n",
  "app/actions.ts": "// actions\n/* the forms */\n'use server'\nexport async function save(form: FormData) {}\n",
  "src/index.ts": [
    "import { authorize, cached, serveOutput } from './routes'",
    "const routes = [",
    "  { method: 'GET', pattern: '/authorize', handler: authorize },",
    "  { method: 'GET', pattern: '/o/:path', handler: cached(serveOutput) },",
    "]",
    "app.get('/items', listItems)",
    "const doc = \"a call like app.get('/path', handler)\"",
    "",
  ].join("\n"),
  "scripts/backup.ts": "console.log('backup')\n",
  "scripts/bundled.ts": "import { share } from './shared'\nshare()\n",
  "scripts/shared.ts": "export function share(): void {}\n",
  "scripts/nested/deep.ts": "console.log('deep')\n",
};

function by(found: EntranceCandidate[], file: string, symbol = ""): EntranceCandidate | undefined {
  return found.find((c) => c.file === file && c.symbol === symbol);
}

// The totality oracle the spec names: every test below runs under this one title.
describe("entrance detection", () => {
  test("the TypeScript rules detect server functions, wrapped exports, server routes, route handlers, server actions, route tables, route methods, package bins and scripts, and top-level scripts, each with its rule and why", () => {
    const { root, files, remove } = project(TYPESCRIPT);
    try {
      const found = detectEntranceCandidates(root, { language: "typescript", files, wrappers: ["mutationRpc", "rpc", "cached"], testFolders: [] });
      const rules = new Set(CANDIDATE_RULES["typescript"]!.map((r) => r.rule));
      for (const c of found) {
        assert.ok(rules.has(c.rule), `${c.rule} is a listed rule`);
        assert.ok(c.why.length > 0, "every detected entrance says why");
      }
      assert.equal(by(found, "src/fns.ts", "readThing")?.rule, "server function");
      assert.deepEqual(by(found, "src/fns.ts", "readThing")?.through, ["rpc"], "a read registered through rpc, not mutationRpc");
      assert.deepEqual(by(found, "src/fns.ts", "writeThing")?.through, ["mutationRpc"]);
      assert.equal(by(found, "src/fns.ts", "wrapped")?.rule, "wrapped export");
      assert.equal(by(found, "src/fns.ts", "helper"), undefined, "a plain exported function is no entrance");
      assert.equal(by(found, "src/routes/api/health.ts", "Route")?.rule, "server route");
      assert.deepEqual(by(found, "src/routes/api/health.ts", "Route")?.through, ["mutationRpc"], "one level into the file's own helper");
      assert.equal(by(found, "src/routes/index.tsx", "Route"), undefined, "a page route without server handlers is not detected");
      assert.deepEqual(found.filter((c) => c.file === "app/api/items/route.ts").map((c) => c.symbol), ["GET", "POST"], "each HTTP method a Next.js route file exports, never its helper");
      assert.equal(by(found, "app/actions.ts", "save")?.rule, "server action", "'use server' found past leading comments");
      assert.equal(by(found, "src/index.ts", "authorize")?.registered, true, "a route table entry is registered here, declared elsewhere");
      assert.deepEqual(by(found, "src/index.ts", "serveOutput")?.through, ["cached"]);
      assert.equal(by(found, "src/index.ts", "listItems")?.rule, "route method");
      assert.equal(found.filter((c) => c.rule === "route method").length, 1, "a path inside a string is never a route");
      assert.match(by(found, "src/cli.ts")?.why ?? "", /bin "tool"/);
      assert.equal(by(found, "scripts/backup.ts")?.rule, "package script");
      assert.match(by(found, "scripts/backup.ts")?.why ?? "", /backup.*; a script directly under scripts\//, "one file-grain entrance, its reasons joined");
      assert.equal(by(found, "scripts/bundled.ts")?.rule, "script", "esbuild bundles, it does not run: only the scripts/ rule sees it");
      assert.equal(by(found, "scripts/shared.ts"), undefined, "a script another file imports is a helper");
      assert.equal(by(found, "scripts/nested/deep.ts"), undefined, "only files directly under scripts/");
      assert.equal(found.some((c) => c.file === "src/fns.test.ts"), false, "a test file is never an entrance, even run by a package script");
    } finally {
      remove();
    }
  });

  test("a wrapper a file does not import or declare is a namesake, never a registration", () => {
    const { root, files, remove } = project({
      "src/fns.ts": "import { createServerFn } from '@tanstack/react-start'\nexport const x = createServerFn().handler(() => rpc(() => 1))\nfunction other() { const rpc = 1 }\n",
      "src/more.ts": "import { createServerFn } from '@tanstack/react-start'\nexport const y = createServerFn().handler(() => rpc(() => 1))\n",
    });
    try {
      const found = detectEntranceCandidates(root, { language: "typescript", files, wrappers: ["rpc"], testFolders: [] });
      assert.deepEqual(found.find((c) => c.symbol === "x")?.through, ["rpc"], "declared in the file: bound");
      assert.equal(found.find((c) => c.symbol === "y")?.through, undefined, "neither imported nor declared: a namesake");
    } finally {
      remove();
    }
  });

  test("the Python rules detect URL patterns, viewsets, route decorators, management commands, tasks, console scripts and scripts, and leave include() alone", () => {
    const { root, files, remove } = project({
      "pyproject.toml": '[project]\nname = "app"\n\n[project.scripts]\napp-sync = "app.sync:main"\n',
      "app/__init__.py": "",
      "app/sync.py": "def main():\n    pass\n",
      "app/urls.py": "from django.urls import include, path\nfrom . import views\nurlpatterns = [\n    path('items/', views.items),\n    path('item/<int:pk>/', views.ItemView.as_view()),\n    path('api/', include('app.api')),\n]\nrouter.register(r'things', ThingViewSet)\n",
      "app/api.py": "from fastapi import APIRouter\nfrom app.guard import checked\nrouter = APIRouter()\n\n@router.get('/health')\n@checked\ndef health():\n    return {}\n\n@router.get('health')\ndef not_a_path():\n    return {}\n",
      "app/guard.py": "def checked(f):\n    return f\n",
      "app/tasks.py": "from celery import shared_task\n\n@shared_task\ndef reindex():\n    pass\n\n@activity.defn\nasync def fetch():\n    pass\n",
      "app/management/commands/rebuild.py": "from django.core.management.base import BaseCommand\n\nclass Command(BaseCommand):\n    def handle(self, *args, **options):\n        pass\n",
      "app/management/commands/__init__.py": "",
      "scripts/seed.py": "def run():\n    pass\n\nif __name__ == '__main__':\n    run()\n",
      "scripts/helpers.py": "def util():\n    pass\n",
    });
    try {
      const found = detectEntranceCandidates(root, { language: "python", files, wrappers: ["checked"], testFolders: [] });
      const rules = new Set(CANDIDATE_RULES["python"]!.map((r) => r.rule));
      for (const c of found) assert.ok(rules.has(c.rule), `${c.rule} is a listed rule`);
      const names = (rule: string): string[] => found.filter((c) => c.rule === rule).map((c) => c.symbol || c.file);
      assert.deepEqual(names("url pattern"), ["items", "ItemView"], "include() is delegation, not an entrance");
      assert.deepEqual(names("viewset"), ["ThingViewSet"]);
      assert.deepEqual(names("route decorator"), ["health"], "a route path must start with /");
      assert.deepEqual(found.find((c) => c.symbol === "health")?.through, ["checked"], "a decorator a declared entrance names is its registration");
      assert.deepEqual(names("task"), ["reindex", "fetch"]);
      assert.deepEqual(names("management command"), ["Command"]);
      assert.deepEqual(names("console script"), ["main"]);
      assert.deepEqual(names("script"), ["scripts/seed.py"], "a script without a main block is a helper");
    } finally {
      remove();
    }
  });
});
