// Compares what the patched TypeScript parsers read against what the stock ones read, over a fixed corpus, node by
// node: every node's type, whether it is named, its span, its field and whether it is an error or a missing node.
// Each difference is one region, the smallest run of sibling nodes outside which the two trees agree, and every
// region must be one the patch intends, as intended-differences.json names it by its construct, never by its place:
// what kind of difference it is (an improvement, where the stock parser errs and the patched one does not; a
// regression, the other way about; both erring, differently; or a reshape, neither erring), in which dialects, and a
// tree-sitter query whose capture the region overlaps. Every token the patched parsers read is also held to the stock
// parsers' own reading of its spelling: a keyword or a mark read as a type the stock parsers never read it as (a token
// renamed or aliased) fails wherever it stands, an improvement's region among it: no intended difference renames one.
// Each intended difference names the corpus cases it must show in, and one that shows nowhere fails, so the list
// holds no more than the patch does.
//
// node compare.mjs --runtime <web-tree-sitter folder> --stock <folder> --patched <folder> --intended <json>
//   --cases <test/corpus folder>... --files <folder>...
// Each parser folder holds tree-sitter-typescript.wasm and tree-sitter-tsx.wasm. --cases reads every *.txt in the
// folder as tree-sitter's corpus format, each case an input; --files reads every .ts, .tsx, .mts and .cts below the
// folder, node_modules left out. Every input is read by both dialects. Exits 1 on any difference no entry allows.

import { readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const DIALECTS = ["typescript", "tsx"];

const { values: options } = parseArgs({
  options: {
    runtime: { type: "string" },
    stock: { type: "string" },
    patched: { type: "string" },
    intended: { type: "string" },
    cases: { type: "string", multiple: true, default: [] },
    files: { type: "string", multiple: true, default: [] },
  },
});
for (const required of ["runtime", "stock", "patched", "intended"]) {
  if (options[required] === undefined) fail(`--${required} is required`);
}

function fail(message) {
  console.error(`compare.mjs: ${message}`);
  process.exit(1);
}

// --- Inputs ------------------------------------------------------------------------------------------------------

/** The cases of one file in tree-sitter's corpus format: a name between two rows of =, the input, a row of -, its tree. */
function casesOf(text) {
  const lines = text.split("\n");
  const header = /^(={3,})(\S*?)\s*$/;
  const cases = [];
  let i = 0;
  while (i < lines.length) {
    const open = header.exec(lines[i]);
    if (open === null) { i++; continue; }
    const suffix = open[2];
    let j = i + 1;
    const names = [];
    while (j < lines.length && header.exec(lines[j])?.[2] !== suffix) names.push(lines[j++]);
    const divider = new RegExp(`^-{3,}${suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`);
    let k = j + 1;
    const body = [];
    while (k < lines.length && !divider.test(lines[k])) body.push(lines[k++]);
    let next = k + 1;
    while (next < lines.length && !header.test(lines[next])) next++;
    const name = names.filter((line) => !line.startsWith(":")).join(" ").trim();
    cases.push({ name, text: body.join("\n").replace(/^\n+/, "").replace(/\n+$/, "\n") });
    i = next;
  }
  return cases;
}

function inputs() {
  const all = [];
  let before = 0;
  const from = (folder) => {
    if (all.length === before) fail(`${folder} holds no input`);
    before = all.length;
  };
  for (const folder of options.cases) {
    for (const file of readdirSync(folder).filter((f) => f.endsWith(".txt")).sort()) {
      const seen = new Map();
      for (const c of casesOf(readFileSync(join(folder, file), "utf8"))) {
        const label = `${basename(file, ".txt")}: ${c.name}`;
        const n = (seen.get(label) ?? 0) + 1;
        seen.set(label, n);
        all.push({ key: n === 1 ? label : `${label} (${n})`, text: c.text });
      }
    }
    from(folder);
  }
  for (const folder of options.files) {
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== "node_modules") walk(path); }
        else if (/\.[mc]?tsx?$/.test(entry.name)) all.push({ key: `${basename(folder)}/${relative(folder, path)}`, text: readFileSync(path, "utf8") });
      }
    };
    walk(folder);
    from(folder);
  }
  return all;
}

// --- Trees -------------------------------------------------------------------------------------------------------

const ERROR = "ERROR";

/** A tree flattened in preorder: each node's type, named-ness, missing-ness, span, field and depth, and its children. */
function flatten(tree, text) {
  const nodes = [];
  const leaves = [];
  const cursor = tree.walk();
  const stack = [];
  for (let more = true; more; ) {
    const index = nodes.length;
    const node = {
      type: cursor.nodeType,
      named: cursor.nodeIsNamed,
      missing: cursor.nodeIsMissing,
      start: cursor.startIndex,
      end: cursor.endIndex,
      field: cursor.currentFieldName ?? "",
      children: [],
      errs: false,
    };
    nodes.push(node);
    if (stack.length > 0) nodes[stack.at(-1)].children.push(index);
    if (cursor.gotoFirstChild()) { stack.push(index); continue; }
    if (node.end > node.start) leaves.push({ type: node.type, named: node.named, start: node.start, end: node.end, text: text.slice(node.start, node.end) });
    while (!cursor.gotoNextSibling()) {
      if (!cursor.gotoParent()) { more = false; break; }
      stack.pop();
    }
  }
  cursor.delete();
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    node.errs = node.type === ERROR || node.missing || node.children.some((c) => nodes[c].errs);
  }
  return { nodes, leaves };
}

const keyOf = (n) => `${n.type}\u0000${n.named}\u0000${n.missing}\u0000${n.start}\u0000${n.end}\u0000${n.field}`;

function sameSubtree(s, si, p, pi) {
  const a = s.nodes[si];
  const b = p.nodes[pi];
  if (keyOf(a) !== keyOf(b) || a.children.length !== b.children.length) return false;
  return a.children.every((c, k) => sameSubtree(s, c, p, b.children[k]));
}

/** The regions where two trees of one text differ: runs of siblings under a pair of nodes that agree. */
function regionsOf(s, p) {
  const regions = [];
  const run = (sRun, pRun, parent) => {
    const spans = [...sRun.map((i) => s.nodes[i]), ...pRun.map((i) => p.nodes[i])];
    regions.push({
      start: Math.min(...spans.map((n) => n.start)),
      end: Math.max(...spans.map((n) => n.end)),
      parent,
      stockErrs: sRun.some((i) => s.nodes[i].errs),
      patchedErrs: pRun.some((i) => p.nodes[i].errs),
      stockTypes: sRun.map((i) => s.nodes[i].type),
      patchedTypes: pRun.map((i) => p.nodes[i].type),
    });
  };
  const visit = (si, pi) => {
    const sc = s.nodes[si].children;
    const pc = p.nodes[pi].children;
    let i = 0;
    let j = 0;
    while (i < sc.length || j < pc.length) {
      if (i < sc.length && j < pc.length && keyOf(s.nodes[sc[i]]) === keyOf(p.nodes[pc[j]])) {
        if (!sameSubtree(s, sc[i], p, pc[j])) visit(sc[i], pc[j]);
        i++;
        j++;
        continue;
      }
      // A run: take the next node of each side, then every node of either side that starts before the run ends.
      const i0 = i;
      const j0 = j;
      let end = -1;
      if (i < sc.length) end = Math.max(end, s.nodes[sc[i++]].end);
      if (j < pc.length) end = Math.max(end, p.nodes[pc[j++]].end);
      for (let grew = true; grew; ) {
        grew = false;
        while (i < sc.length && (s.nodes[sc[i]].start < end || j >= pc.length)) { end = Math.max(end, s.nodes[sc[i++]].end); grew = true; }
        while (j < pc.length && (p.nodes[pc[j]].start < end || i >= sc.length)) { end = Math.max(end, p.nodes[pc[j++]].end); grew = true; }
      }
      run(sc.slice(i0, i), pc.slice(j0, j), s.nodes[si].type);
    }
  };
  if (keyOf(s.nodes[0]) !== keyOf(p.nodes[0])) run([0], [0], "");
  else visit(0, 0);
  return regions;
}

const kindOf = (r) => (r.stockErrs ? (r.patchedErrs ? "both err" : "improvement") : r.patchedErrs ? "regression" : "reshape");

// --- The comparison ----------------------------------------------------------------------------------------------

const { Parser, Language, Query } = await import(pathToFileURL(join(options.runtime, "web-tree-sitter.js")).href);
await Parser.init();
const load = async (folder, dialect) => Language.load(readFileSync(join(folder, `tree-sitter-${dialect}.wasm`)));
const parsers = {};
for (const dialect of DIALECTS) {
  parsers[dialect] = {};
  for (const side of ["stock", "patched"]) {
    const language = await load(options[side], dialect);
    const parser = new Parser();
    parser.setLanguage(language);
    parsers[dialect][side] = { language, parser };
  }
}

const intended = JSON.parse(readFileSync(options.intended, "utf8"));
const KINDS = ["improvement", "regression", "both err", "reshape"];
const ids = new Set();
const entries = intended.differences.map((entry) => {
  if (ids.has(entry.id)) fail(`intended difference ${entry.id} is listed twice`);
  ids.add(entry.id);
  if (!KINDS.includes(entry.kind)) fail(`intended difference ${entry.id}: its kind is one of ${KINDS.join(", ")}, not ${entry.kind}`);
  if (entry.side !== "stock" && entry.side !== "patched") fail(`intended difference ${entry.id}: its side is stock or patched, not ${entry.side}`);
  if (!Array.isArray(entry.dialects) || entry.dialects.length === 0 || entry.dialects.some((d) => !DIALECTS.includes(d))) fail(`intended difference ${entry.id}: its dialects are among ${DIALECTS.join(", ")}`);
  if (!Array.isArray(entry.cases) || entry.cases.length === 0) fail(`intended difference ${entry.id}: it names the corpus cases it shows in`);
  const queries = {};
  for (const dialect of entry.dialects) {
    try {
      queries[dialect] = new Query(parsers[dialect][entry.side].language, entry.query);
    } catch (error) {
      fail(`intended difference ${entry.id}: its query does not compile against the ${entry.side} ${dialect} parser (${error.message})`);
    }
  }
  const tokens = new Set((entry.tokens ?? []).map((t) => `${t.text}\u0000${t.type}\u0000${t.named}`));
  return { ...entry, queries, tokens, seen: new Set(), tokensSeen: new Set() };
});

const failures = [];
const renames = [];
// A token is known by its spelling: a leaf the stock parsers read as an anonymous token, a keyword or a mark, read by the
// patched parsers as another type is a rename. The symbol's own name cannot say so, since a token used only under an
// alias takes the alias's name in its parser's table. So a patched leaf's spelling and type must be a pair the stock
// parsers show somewhere in the corpus, when the leaf is anonymous and not its own spelling, or named and spelled as
// one of the stock grammar's tokens (keyof as an identifier, & as a string fragment). An intended difference may list
// such a reading in its tokens (a member named instanceof is a property_identifier spelled as a keyword), and it is
// allowed only inside a region that difference allows.
const stockKinds = new Set();
const patchedKinds = new Map(); // spelling and type -> the first leaf showing it, and where
const tokenSpelled = (language, text) => {
  const id = language.idForNodeType(text, false);
  return id !== null && id !== 0 && language.nodeTypeIsVisible(id);
};
const heldToStock = (leaf, dialect) => (leaf.named ? tokenSpelled(parsers[dialect].stock.language, leaf.text) : leaf.type !== leaf.text);
const tally = { inputs: 0, identical: 0, regions: 0 };
const kindKey = (leaf) => `${leaf.text}\u0000${leaf.type}\u0000${leaf.named}`;
const excerpt = (text, start, end) => JSON.stringify(text.slice(start, Math.min(end, start + 80)) + (end - start > 80 ? "…" : ""));

for (const input of inputs()) {
  tally.inputs++;
  for (const dialect of DIALECTS) {
    const { stock, patched } = parsers[dialect];
    const sTree = stock.parser.parse(input.text);
    const pTree = patched.parser.parse(input.text);
    const s = flatten(sTree, input.text);
    const p = flatten(pTree, input.text);
    for (const leaf of s.leaves) if (heldToStock(leaf, dialect)) stockKinds.add(kindKey(leaf));
    const regions = s.nodes.length === p.nodes.length && s.nodes.every((n, k) => keyOf(n) === keyOf(p.nodes[k])) ? [] : regionsOf(s, p);
    if (regions.length === 0) tally.identical++;
    tally.regions += regions.length;
    const captures = new Map();
    const capturesOf = (entry) => {
      if (!captures.has(entry.id)) {
        const tree = entry.side === "stock" ? sTree : pTree;
        captures.set(entry.id, entry.queries[dialect].captures(tree.rootNode).filter((c) => c.name === "construct").map((c) => ({ start: c.node.startIndex, end: c.node.endIndex })));
      }
      return captures.get(entry.id);
    };
    const allowed = [];
    for (const region of regions) {
      const kind = kindOf(region);
      const allowing = entries.filter((e) => e.kind === kind && e.dialects.includes(dialect) && capturesOf(e).some((c) => c.start < region.end && region.start < c.end));
      for (const entry of allowing) {
        entry.seen.add(`${input.key}\u0000${dialect}`);
        allowed.push({ region, entry });
      }
      if (allowing.length === 0) failures.push(`${input.key} (${dialect}): an unlisted ${kind} at ${region.start}..${region.end} under ${region.parent || "the root"}, stock ${region.stockTypes.join(" ") || "nothing"}, patched ${region.patchedTypes.join(" ") || "nothing"}: ${excerpt(input.text, region.start, region.end)}`);
    }
    for (const leaf of p.leaves) {
      if (!heldToStock(leaf, dialect)) continue;
      const key = kindKey(leaf);
      const listing = allowed.find(({ region, entry }) => entry.tokens.has(key) && leaf.start >= region.start && leaf.end <= region.end);
      if (listing !== undefined) { listing.entry.tokensSeen.add(key); continue; }
      if (!patchedKinds.has(key)) patchedKinds.set(key, { leaf, where: `${input.key} (${dialect})`, text: input.text });
    }
    sTree.delete();
    pTree.delete();
  }
}

// Every token the patched parsers read is read as the stock parsers read its spelling somewhere in the corpus.
for (const [key, { leaf, where, text }] of patchedKinds) {
  if (stockKinds.has(key)) continue;
  renames.push(`${where}: the patched parser reads ${JSON.stringify(leaf.text)} as ${leaf.named ? "named " : ""}${leaf.type}, which the stock parsers never do (a token renamed or aliased), first at ${leaf.start}..${leaf.end}`);
}
// Every intended difference shows in each case it names, in each of its dialects, and somewhere, and each token
// reading it lists shows in its regions.
for (const entry of entries) {
  for (const key of entry.tokens) if (!entry.tokensSeen.has(key)) failures.push(`intended difference ${entry.id} lists the token ${key.split("\u0000").slice(0, 2).join(" read as ")}, which none of its regions shows`);
  if (entry.seen.size === 0) failures.push(`intended difference ${entry.id} (${entry.construct}) shows in no input`);
  for (const name of entry.cases) {
    for (const dialect of entry.dialects) {
      if (!entry.seen.has(`${name}\u0000${dialect}`)) failures.push(`intended difference ${entry.id} does not show in ${name} (${dialect}), a case it names`);
    }
  }
}

console.log(`compare.mjs: ${tally.inputs} inputs in ${DIALECTS.length} dialects, ${tally.identical} parses identical, ${tally.regions} regions of difference`);
for (const entry of entries) console.log(`  ${entry.id} (${entry.kind}): ${entry.seen.size} parses`);
if (renames.length + failures.length > 0) {
  for (const r of renames) console.error(`  ✕ ${r}`);
  for (const f of failures.slice(0, 100)) console.error(`  ✕ ${f}`);
  if (failures.length > 100) console.error(`  … and ${failures.length - 100} more`);
  fail(`${renames.length} token${renames.length === 1 ? "" : "s"} renamed and ${failures.length} other difference${failures.length === 1 ? "" : "s"} between the stock and patched parsers that intended-differences.json does not allow`);
}
console.log("compare.mjs: every difference between the stock and patched parsers is one intended-differences.json allows");
