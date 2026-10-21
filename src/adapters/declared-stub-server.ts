/**
 * For tests: a language server for a toy language, speaking the protocol over
 * stdio, so a declared language's adapter (declared.ts) is proved against a
 * real process with no binary to install. A `.toy` file declares a top-level
 * symbol with a line `def NAME`, which runs until the next `def`; any other
 * whole-word occurrence of a declared name is a reference to it. Unsaved
 * documents (didOpen, didChange) stand in for the disk until they close.
 *
 * Run: node src/adapters/declared-stub-server.ts (the project root is the
 * initialize request's rootUri).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

interface Range {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

let root = process.cwd();
const overlays = new Map<string, string>();

function send(message: object): void {
  const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }), "utf8");
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (entry.endsWith(".toy")) out.push(path);
  }
  return out;
}

/** Every document the server knows: the files on disk, with an unsaved document's text in place of its file's. */
function documents(): Map<string, string> {
  const all = new Map<string, string>();
  for (const path of walk(root)) all.set(pathToFileURL(path).href, readFileSync(path, "utf8"));
  for (const [uri, text] of overlays) all.set(uri, text);
  return all;
}

function textOf(uri: string): string {
  return overlays.get(uri) ?? readFileSync(fileURLToPath(uri), "utf8");
}

function definitions(text: string): { name: string; range: Range; selectionRange: Range }[] {
  const lines = text.split("\n");
  const found: { name: string; line: number; character: number }[] = [];
  lines.forEach((line, i) => {
    const m = /^def ([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
    if (m !== null) found.push({ name: m[1]!, line: i, character: 4 });
  });
  return found.map((d, i) => {
    const endLine = i + 1 < found.length ? found[i + 1]!.line - 1 : lines.length - 1;
    return {
      name: d.name,
      range: { start: { line: d.line, character: 0 }, end: { line: endLine, character: (lines[endLine] ?? "").length } },
      selectionRange: { start: { line: d.line, character: d.character }, end: { line: d.line, character: d.character + d.name.length } },
    };
  });
}

function wordAt(text: string, line: number, character: number): string | undefined {
  const row = text.split("\n")[line] ?? "";
  const words = [...row.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)];
  return words.find((w) => w.index! <= character && character <= w.index! + w[0].length)?.[0];
}

function answer(method: string, params: Record<string, unknown>): unknown {
  switch (method) {
    case "initialize":
      if (typeof params["rootUri"] === "string") root = fileURLToPath(params["rootUri"]);
      return { capabilities: { documentSymbolProvider: true, workspaceSymbolProvider: true, referencesProvider: true, textDocumentSync: 1 } };
    case "textDocument/documentSymbol": {
      const uri = (params["textDocument"] as { uri: string }).uri;
      return definitions(textOf(uri)).map((d) => ({ name: d.name, kind: 12, range: d.range, selectionRange: d.selectionRange }));
    }
    case "workspace/symbol": {
      const query = String(params["query"] ?? "");
      const out: unknown[] = [];
      for (const [uri, text] of documents()) for (const d of definitions(text)) if (d.name.includes(query)) out.push({ name: d.name, kind: 12, location: { uri, range: d.selectionRange } });
      return out;
    }
    case "textDocument/references": {
      const uri = (params["textDocument"] as { uri: string }).uri;
      const position = params["position"] as { line: number; character: number };
      const name = wordAt(textOf(uri), position.line, position.character);
      if (name === undefined) return [];
      const out: unknown[] = [];
      for (const [doc, text] of documents()) {
        text.split("\n").forEach((row, line) => {
          if (new RegExp(`^def ${name}\\b`).test(row)) return;
          for (const m of row.matchAll(new RegExp(`\\b${name}\\b`, "g"))) out.push({ uri: doc, range: { start: { line, character: m.index! }, end: { line, character: m.index! + name.length } } });
        });
      }
      return out;
    }
    case "shutdown":
      return null;
    default:
      return null;
  }
}

function notified(method: string, params: Record<string, unknown>): void {
  const doc = params["textDocument"] as { uri: string; text?: string } | undefined;
  if (method === "textDocument/didOpen" && doc !== undefined) overlays.set(doc.uri, doc.text ?? "");
  if (method === "textDocument/didChange" && doc !== undefined) overlays.set(doc.uri, (params["contentChanges"] as { text: string }[]).at(-1)?.text ?? "");
  if (method === "textDocument/didClose" && doc !== undefined) overlays.delete(doc.uri);
  if (method === "exit") process.exit(0);
}

let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const end = buffer.indexOf("\r\n\r\n");
    if (end === -1) return;
    const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString("utf8"))?.[1]);
    if (buffer.length < end + 4 + length) return;
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString("utf8")) as { id?: number; method?: string; params?: Record<string, unknown> };
    buffer = buffer.subarray(end + 4 + length);
    if (message.method === undefined) continue;
    if (message.id === undefined) notified(message.method, message.params ?? {});
    else send({ id: message.id, result: answer(message.method, message.params ?? {}) });
  }
});

