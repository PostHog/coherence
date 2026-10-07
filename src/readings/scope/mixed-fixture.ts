/**
 * The two-language fixture the multi-language readings share: one product
 * component spanning a Python backend/ and a TypeScript frontend/, and a
 * shared/ component with a file in each language. Not a test file, so
 * importing it registers no test.
 *
 * Each language has an entrance carrying outside trust in, and a chokepoint
 * its handler calls: rows (a route decorator in backend/views.py) seals each
 * row through seal, which guards SECRET_COLUMNS; shown (a route method in
 * frontend/server.ts) redacts through redact, which guards RAW_TOKENS. Both
 * handlers call label in shared/, each in its own language, so the product
 * has an interface into shared/ in each language and none across them.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ShellState } from "./model.ts";

const SPEC = `# Mixed

A product with a Python backend and a TypeScript frontend, one component.

## trust levels
- public (outside): anyone on the network
- storage: the rows beneath everything

## entrances
- rows view: a caller reads the rows
  handler: rows in backend/views.py
  trust: public
- shown page: a caller reads the page
  handler: shown in frontend/server.ts
  trust: public

## invariants
- python egress: A secret column leaves the store only through seal.
  protects: SECRET_COLUMNS
  chokepoint: seal
  because: a leaked row must disclose no usable bearer
  kinds: none
- typescript egress: A raw token leaves the client only through redact.
  protects: RAW_TOKENS
  chokepoint: redact
  because: a rendered page must disclose no usable bearer
  kinds: none
`;

export const MIXED: Record<string, string> = {
  "coherence.config.json": JSON.stringify({ name: "mixed", language: ["python", "typescript"] }),
  "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", allowImportingTsExtensions: true, noEmit: true, strict: true }, include: ["frontend/**/*.ts", "shared/**/*.ts"] }),
  "Mixed.spec.md": SPEC,
  "shared/Shared.spec.md": "# Shared\n\nLabels text for both sides.\n\n## invariants\n",
  "shared/__init__.py": "",
  "shared/fmt.py": 'def label(text: str) -> str:\n    return "[" + text + "]"\n',
  "shared/fmt.ts": "export function label(text: string): string {\n  return `[${text}]`;\n}\n",
  "backend/__init__.py": "",
  "backend/store.py": 'SECRET_COLUMNS = {"tokens": ["token"]}\n\n\ndef seal(pattern: str, row: dict) -> dict:\n    out = dict(row)\n    for column in SECRET_COLUMNS.get(pattern, []):\n        out.pop(column, None)\n    return out\n',
  "backend/views.py": [
    "from backend.store import seal",
    "from shared.fmt import label",
    "",
    "",
    "class _App:",
    "    def get(self, path: str):",
    "        return lambda fn: fn",
    "",
    "",
    "app = _App()",
    "",
    "",
    '@app.get("/rows")',
    "def rows(row: dict) -> str:",
    '    return label(str(seal("tokens", row)))',
    "",
  ].join("\n"),
  "frontend/tokens.ts": 'export const RAW_TOKENS: string[] = ["a", "b"];\n\nexport function redact(text: string): string {\n  let out = text;\n  for (const token of RAW_TOKENS) out = out.split(token).join("*");\n  return out;\n}\n',
  "frontend/server.ts": [
    'import { redact } from "./tokens.ts";',
    'import { label } from "../shared/fmt.ts";',
    "",
    "const app = { get(path: string, handler: () => string): string { return path + handler(); } };",
    "",
    "export function shown(): string {",
    '  return label(redact("abc"));',
    "}",
    "",
    'app.get("/shown", shown);',
    "",
  ].join("\n"),
};

/** A fresh copy of the mixed fixture, with any file overridden (a config naming one language) or removed (undefined). */
export function mixedProject(overrides: Record<string, string | undefined> = {}): { root: string; remove: () => void } {
  const root = mkdtempSync(join(tmpdir(), "coherence-mixed-"));
  for (const [path, text] of Object.entries({ ...MIXED, ...overrides })) {
    if (text === undefined) continue;
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return { root, remove: () => rmSync(root, { recursive: true, force: true }) };
}

/** The state with both egress chokepoints verified, as a run that found them holding would leave it. */
export function bothVerified(state: ShellState): ShellState {
  for (const c of state.spec.components) for (const i of c.invariants) if (i.name === "python egress" || i.name === "typescript egress") i.state = "invariant";
  return state;
}
