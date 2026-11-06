/**
 * How Coherence works, read from docs/how-coherence-works.md in the installed
 * package: the one text an adopter's agent reads at adoption (the adopt
 * practice sends it there) and Scope's Home shows, so the words are written
 * once, in one file anyone can edit. Its opening is read: the title, the
 * paragraph under it, then each `###` moment before the first `##`, with its
 * hook names (a line of backticked names), its plain line, and its bullets.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { HowItWorks } from "./model.ts";

export const HOW_IT_WORKS = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "how-coherence-works.md");

/** Paragraphs and list items of a block of lines: a blank line ends a paragraph, "- " starts an item, other lines continue the one before. */
function blocks(lines: readonly string[]): { kind: "p" | "li"; text: string }[] {
  const out: { kind: "p" | "li"; text: string }[] = [];
  let open = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") { open = false; continue; }
    if (line.startsWith("- ")) { out.push({ kind: "li", text: line.slice(2).trim() }); open = true; continue; }
    if (open && out.length > 0) out[out.length - 1]!.text += ` ${line}`;
    else { out.push({ kind: "p", text: line }); open = true; }
  }
  return out;
}

/** The section's text parsed, or why it could not be: a moment with no plain line or no hook names is said, never guessed. */
export function parseHowItWorks(text: string): HowItWorks {
  const lines = text.split(/\r?\n/);
  const title = lines.find((l) => l.startsWith("# "))?.slice(2).trim() ?? "How Coherence works";
  const start = lines.findIndex((l) => l.startsWith("# "));
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  const section = lines.slice(start + 1, end < 0 ? undefined : end);
  const heads = section.flatMap((l, i) => (l.startsWith("### ") ? [i] : []));
  // The opening keeps its paragraphs, each its own on Home.
  const lead = blocks(section.slice(0, heads[0] ?? section.length)).filter((b) => b.kind === "p").map((b) => b.text).join("\n\n");
  const moments: Extract<HowItWorks, { kind: "read" }>["moments"] = [];
  for (const [n, at] of heads.entries()) {
    const tab = section[at]!.slice(4).trim();
    const body = blocks(section.slice(at + 1, heads[n + 1] ?? section.length));
    const events = body.find((b) => b.kind === "p" && /^(`[^`]+`\s*(·|,)?\s*)+$/.test(b.text));
    const plain = body.find((b) => b.kind === "p" && b !== events);
    if (events === undefined) return { kind: "unread", because: `the moment “${tab}” names no hook (a line of backticked names, such as \`Stop\`)` };
    if (plain === undefined) return { kind: "unread", because: `the moment “${tab}” has no plain line` };
    moments.push({ tab, events: [...events.text.matchAll(/`([^`]+)`/g)].map((m) => m[1]!), plain: plain.text, details: body.filter((b) => b.kind === "li").map((b) => b.text) });
  }
  if (moments.length === 0) return { kind: "unread", because: "it has no “###” moment before its first “##” section" };
  return { kind: "read", title, lead, moments };
}

/** The installed package's text, parsed; a file missing or unreadable is said. */
export function readHowItWorks(path: string = HOW_IT_WORKS): HowItWorks {
  try {
    return parseHowItWorks(readFileSync(path, "utf8"));
  } catch (error) {
    return { kind: "unread", because: `docs/how-coherence-works.md could not be read: ${error instanceof Error ? error.message : String(error)}` };
  }
}
