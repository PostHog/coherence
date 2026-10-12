/**
 * Spike: per-file traces at first touch, replayed against this repository's
 * own history. Not a feature; nothing here is imported by src/.
 *
 *   node bench/traces/traces.ts [root] [--labels bench/traces/labels.json] [--out results.json]
 *     [--policy on|off] [--theta 0.3] [--about loose|strict] [--tight 8]
 *     [--sample out.txt] [--sample-ex out.txt]   draw unlabeled items for hand labels
 *     [--show "<session> <file>"]                what that first touch would have delivered
 *     [--pairs a:b,c:d]                          text similarity of record pairs
 *
 * --policy on (the default) drops lexicon apply and classify decisions, work
 * orders reached other than through what they cite, and defects a later
 * decision says it fixed (by id); off measures the raw sources.
 *
 * 1. Index: file -> record ids, from four sources kept apart so each can be
 *    measured alone: co-change (cc), explicit files and cites (ex), paths
 *    named in the text (tx), the owning component (cp). Plus an optional
 *    simulated write-time source (wt: the files a session changed between
 *    its records), for the --files on decide question.
 * 2. Liveness at a time T: retracted decisions, resolved or dismissed
 *    defects and conjectures, closed experiments, acknowledged escalations,
 *    terminal work orders drop; decisions a later decision cites with
 *    superseding words are marked.
 * 3. Replay: for each session S and each file F it changed (its commits are
 *    the commits that add its journal lines), T = the start of the window in
 *    which S first changed F (the session's previous journal commit, or its
 *    first record or run). The index is built from records with at < T and
 *    from links available before T (a co-change link only once its commit
 *    exists), and S's own records are excluded: they are its own memory.
 *    Relevance is read from what S wrote at or after T.
 * 4. Cost: full index build, cached-index lookup and render, tokens.
 *
 * Writes bench/traces/results.json and prints the tables.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { tmpdir } from "node:os";

const HERE = resolve(fileURLToPath(import.meta.url), "..");
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const ROOT = resolve(args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1]!.startsWith("--"))) ?? ".");
const CAP = 4; // item lines under one header line: five lines in all
const SIM_THRESHOLD = Number(flag("--theta") ?? "0.3");
/** loose: any record the session wrote after T counts for overlap; strict: only one linked to F or its component. */
const ABOUT = flag("--about") ?? "loose";
/** Policy: decisions that are vocabulary applications or defect classifications are not traces about a file. */
const BOOKKEEPING = /^[a-z]+ apply [lg]p-|^classify /; // a vocabulary application (under either of its names) or a classification
const POLICY = flag("--policy") ?? "on";

type Src = "cc" | "ct" | "ex" | "tx" | "cp" | "wt";
const WEIGHT: Record<Src, number> = { ex: 4, wt: 3, cc: 3, ct: 3, tx: 3, cp: 1 };
/** cc-tight: a co-change link only from a commit changing at most this many files, whose records are one session's. */
const TIGHT_FILES = Number(flag("--tight") ?? "8");

// ---------------------------------------------------------------- loading

type Rec = Record<string, any> & { id: string; kind: string; at: string; session: string; t: number };

function git(argv: string[]): string {
  return execFileSync("git", ["-C", ROOT, ...argv], { encoding: "utf8", maxBuffer: 1 << 30 });
}

function readStore(dir: string): Rec[] {
  const out: Rec[] = [];
  const seen = new Set<string>();
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".jsonl")).sort()) {
    for (const line of readFileSync(join(dir, name), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        if (typeof r.id !== "string" || seen.has(r.id)) continue;
        seen.add(r.id);
        r.t = Date.parse(r.at);
        out.push(r);
      } catch {
        /* a damaged line is not a trace */
      }
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

interface Commit {
  sha: string;
  t: number; // committer time, ms
  files: string[]; // outside .coherence
  ids: string[]; // record ids whose line this commit adds first
  sessions: Set<string>;
}

const ID_RE = /\b(?:d|rt|c|rs|dm|df|x|xc|u|e|ak|en|w|wm|wo|wc)-[0-9a-f]{8}\b/g;
const CLOSERS = new Set(["retraction", "resolution", "dismissal", "close", "acknowledgement"]);
const STOP = new Set(
  "the and for that this with from are was were not but its it's has have had into than then when what which who whose would could should their there they them one two all any each every only also more most some such own same other new old now just over under onto upon been being does did done can may must will shall our out off per via a an of to in on at by or is be as so no if do it we".split(
    " ",
  ),
);

function textOf(r: Rec): string {
  const parts: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string") parts.push(v);
    else if (Array.isArray(v)) v.forEach((x) => push(typeof x === "object" && x ? x.text ?? "" : x));
  };
  for (const k of ["chose", "over", "because", "observation", "couldBe", "discriminatedBy", "what", "evidence", "expectation", "context", "actions", "criteria", "human", "objective", "success", "boundary"]) push(r[k]);
  return parts.join(" \n ");
}

function subject(r: Rec): string {
  return (r.chose ?? r.observation ?? r.what ?? r.expectation ?? r.objective ?? "") as string;
}

// ---------------------------------------------------------------- similarity

function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? []).filter((w) => !STOP.has(w)).map((w) => w.replace(/(?:ies|es|s)$/, ""));
}

class Tfidf {
  df = new Map<string, number>();
  n = 0;
  vecs = new Map<string, Map<string, number>>();
  add(id: string, text: string) {
    const tf = new Map<string, number>();
    for (const w of tokens(text)) tf.set(w, (tf.get(w) ?? 0) + 1);
    for (const w of tf.keys()) this.df.set(w, (this.df.get(w) ?? 0) + 1);
    this.n++;
    this.vecs.set(id, tf);
  }
  finish() {
    for (const [id, tf] of this.vecs) {
      const v = new Map<string, number>();
      let norm = 0;
      for (const [w, c] of tf) {
        const x = (1 + Math.log(c)) * Math.log((1 + this.n) / (1 + this.df.get(w)!));
        v.set(w, x);
        norm += x * x;
      }
      norm = Math.sqrt(norm) || 1;
      for (const [w, x] of v) v.set(w, x / norm);
      this.vecs.set(id, v);
    }
  }
  sim(a: string, b: string): number {
    const va = this.vecs.get(a), vb = this.vecs.get(b);
    if (!va || !vb) return 0;
    let s = 0;
    const [small, big] = va.size < vb.size ? [va, vb] : [vb, va];
    for (const [w, x] of small) s += x * (big.get(w) ?? 0);
    return s;
  }
}

// ---------------------------------------------------------------- the world

export function loadWorld(root: string) {
  const journal = readStore(join(root, ".coherence/journal"));
  const work = readStore(join(root, ".coherence/work"));
  const all = [...journal, ...work].sort((a, b) => a.t - b.t);
  const byId = new Map(all.map((r) => [r.id, r]));

  // every non-merge commit and the files it changes
  const commits = new Map<string, Commit>();
  let cur: Commit | null = null;
  for (const line of git(["log", "--no-merges", "--format=C\t%H\t%ct", "--name-only"]).split("\n")) {
    if (line.startsWith("C\t")) {
      const [, sha, ct] = line.split("\t");
      cur = { sha: sha!, t: Number(ct) * 1000, files: [], ids: [], sessions: new Set() };
      commits.set(sha!, cur);
    } else if (line && cur && !line.startsWith(".coherence/")) cur.files.push(line);
  }
  // which commit first adds each record's line
  const commitOf = new Map<string, Commit>();
  let c: Commit | undefined;
  for (const line of git(["log", "--no-merges", "--format=C\t%H", "-p", "--unified=0", "--", ".coherence/journal", ".coherence/work"]).split("\n")) {
    if (line.startsWith("C\t")) c = commits.get(line.slice(2));
    else if (c && line.startsWith("+{")) {
      const m = /"id":"([^"]+)"/.exec(line);
      if (!m) continue;
      const prev = commitOf.get(m[1]!);
      if (!prev || c.t < prev.t) commitOf.set(m[1]!, c);
    }
  }
  for (const [id, cm] of commitOf) {
    cm.ids.push(id);
    const r = byId.get(id);
    if (r) cm.sessions.add(r.session);
  }

  // every path that ever existed, for matching paths named in prose
  const paths = new Set<string>();
  for (const cm of commits.values()) cm.files.forEach((f) => paths.add(f));
  const byBase = new Map<string, string[]>();
  for (const p of paths) {
    const b = basename(p);
    byBase.set(b, [...(byBase.get(b) ?? []), p]);
  }

  // components and bullet names, from the spec model as it stands
  const model = JSON.parse(execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", join(root, "src/cli.ts"), "spec", "--json", root], { encoding: "utf8", maxBuffer: 1 << 28 }));
  const components: { folder: string; bullets: string[]; requirements: string[] }[] = model.components.map((k: any) => ({
    folder: k.folder,
    bullets: (k.invariants ?? []).map((b: any) => String(b.name).toLowerCase()).filter((n: string) => n.split(" ").length >= 3),
    requirements: (k.invariants ?? []).filter((b: any) => b.state && b.state !== "invariant").map((b: any) => b.name),
  }));
  const folders = components.map((k) => k.folder).sort((a, b) => b.length - a.length);
  const componentOf = (f: string) => folders.find((d) => d !== "." && (f === d || f.startsWith(`${d}/`))) ?? ".";

  // session start: first record or first run
  const runStart = new Map<string, number>();
  const runDir = join(root, ".coherence/runs");
  if (existsSync(runDir))
    for (const name of readdirSync(runDir)) {
      const first = readFileSync(join(runDir, name), "utf8").split("\n", 1)[0];
      try {
        const r = JSON.parse(first!);
        runStart.set(r.session, Math.min(runStart.get(r.session) ?? Infinity, Date.parse(r.at)));
      } catch {}
    }

  return { journal, work, all, byId, commits, commitOf, paths, byBase, components, componentOf, runStart };
}
type World = ReturnType<typeof loadWorld>;

// ---------------------------------------------------------------- links

interface Link {
  src: Src;
  key: string; // a file path, or "@<component folder>" for cp
  t: number; // when the link exists
}

const PATH_RE = /(?:[\w.-]+\/)*[\w.-]+\.(?:ts|tsx|js|mjs|cjs|json|md|py|sh|toml|yml|yaml|html|css)\b|(?:src|bench|docs|mods|promo)\/[\w./-]+/g;

function pathsIn(w: World, text: string): Set<string> {
  const found = new Set<string>();
  for (const raw of text.match(PATH_RE) ?? []) {
    const tok = raw.replace(/^\.\//, "").replace(/[.:,;)]+$/, "");
    if (tok.includes("/")) {
      if (w.paths.has(tok)) found.add(tok);
      else for (const p of w.paths) if (p.endsWith(`/${tok}`)) found.add(p);
    } else {
      const hits = w.byBase.get(tok);
      if (hits && hits.length === 1) found.add(hits[0]!);
    }
  }
  return found;
}

export function buildLinks(w: World, opts: { wt?: "lower" | "upper" | "none" } = {}) {
  const links = new Map<string, Link[]>();
  const add = (id: string, l: Link) => {
    const list = links.get(id) ?? [];
    list.push(l);
    links.set(id, list);
  };
  const explicitFiles = (r: Rec): string[] => [...(Array.isArray(r.files) ? r.files : []), ...(Array.isArray(r.context) ? r.context : [])].filter((f) => typeof f === "string" && !f.startsWith(".coherence/"));
  const text = new Map<string, string>();
  for (const r of w.all) text.set(r.id, textOf(r));

  for (const r of w.all) {
    // (a) co-change: the files of the commit that first adds the record's line
    const cm = w.commitOf.get(r.id);
    if (cm) for (const f of cm.files) add(r.id, { src: "cc", key: f, t: Math.max(cm.t, r.t) });
    if (cm && cm.files.length <= TIGHT_FILES && cm.sessions.size === 1) for (const f of cm.files) add(r.id, { src: "ct", key: f, t: Math.max(cm.t, r.t) });
    // (b) explicit: its own files and context; the files of records it cites; records citing it with files
    for (const f of explicitFiles(r)) add(r.id, { src: "ex", key: f, t: r.t });
    for (const q of r.cites ?? []) {
      const qr = w.byId.get(q);
      if (!qr) continue;
      for (const f of explicitFiles(qr)) {
        add(r.id, { src: "ex", key: f, t: r.t });
        add(q, { src: "ex", key: f, t: r.t }); // already explicit for q
      }
      for (const f of explicitFiles(r)) add(q, { src: "ex", key: f, t: r.t });
    }
    // (c) paths named in the prose
    for (const f of pathsIn(w, text.get(r.id)!)) add(r.id, { src: "tx", key: f, t: r.t });
    // (d) the owning component: a bullet of it named, its folder or spec named, or a guard in it
    const lower = text.get(r.id)!.toLowerCase();
    for (const k of w.components) {
      const named = k.bullets.some((b) => lower.includes(b)) || (k.folder !== "." && lower.includes(`${k.folder}/`)) || (typeof r.guard === "string" && r.guard.startsWith(`${k.folder}/`));
      if (named) add(r.id, { src: "cp", key: `@${k.folder}`, t: r.t });
    }
  }

  // (wt) simulated write-time --files: the files the session changed between its previous record and this one
  if (opts.wt && opts.wt !== "none") {
    const bySession = new Map<string, Rec[]>();
    for (const r of w.journal) bySession.set(r.session, [...(bySession.get(r.session) ?? []), r]);
    const windowCache = new Map<string, string[]>();
    for (const recs of bySession.values()) {
      let prevCommit: Commit | undefined;
      let seenInCommit = new Set<string>();
      for (const r of recs) {
        const cm = w.commitOf.get(r.id);
        if (!cm) continue;
        if (cm !== prevCommit && prevCommit && cm.t < prevCommit.t) continue; // out-of-order; skip
        const first = !seenInCommit.has(cm.sha);
        if (cm !== prevCommit) seenInCommit = new Set([cm.sha]);
        if (r.kind !== "decision") {
          prevCommit = cm;
          continue;
        }
        if (first || opts.wt === "upper") {
          const key = `${cm.sha}^${prevCommit?.sha ?? ""}`;
          let files = windowCache.get(key);
          if (!files) {
            const shas = prevCommit && prevCommit !== cm ? git(["rev-list", "--no-merges", "--max-count=30", cm.sha, `^${prevCommit.sha}`]).split("\n").filter(Boolean) : [cm.sha];
            files = [...new Set(shas.flatMap((s) => w.commits.get(s)?.files ?? []))];
            windowCache.set(key, files);
          }
          for (const f of files) add(r.id, { src: "wt", key: f, t: r.t });
        }
        prevCommit = cm;
      }
    }
  }
  // dedupe: keep the earliest link per (src,key)
  for (const [id, list] of links) {
    const best = new Map<string, Link>();
    for (const l of list) {
      const k = `${l.src}\0${l.key}`;
      const b = best.get(k);
      if (!b || l.t < b.t) best.set(k, l);
    }
    links.set(id, [...best.values()]);
  }
  return links;
}

// work orders: link through bound records, cited records, and the order's own text
function orderLinks(w: World, links: Map<string, Link[]>) {
  const out = new Map<string, Link[]>();
  for (const o of w.work.filter((r) => r.kind === "order")) {
    const list: Link[] = [];
    for (const f of pathsIn(w, textOf(o))) list.push({ src: "tx", key: f, t: o.t });
    for (const q of o.cites ?? []) for (const l of links.get(q) ?? []) if (l.src === "ex" || l.src === "tx") list.push({ ...l, src: "ex", t: Math.max(l.t, o.t) });
    for (const r of w.journal) if (r.work === o.id) for (const l of links.get(r.id) ?? []) list.push({ ...l, t: Math.max(l.t, r.t) });
    out.set(o.id, list);
  }
  return out;
}

// ---------------------------------------------------------------- liveness

const SUPERSEDE = /supersed|replac|instead of|no longer|reverses|overturn|amends|in place of/i;

function closersIndex(w: World) {
  const closedAt = new Map<string, number>();
  const supersededAt = new Map<string, number>();
  const fixedByDecision = new Set<string>();
  for (const r of w.journal) {
    if (CLOSERS.has(r.kind) && typeof r.of === "string") closedAt.set(r.of, Math.min(closedAt.get(r.of) ?? Infinity, r.t));
    // a defect a later decision says it fixed, by id, is closed in fact though never resolved
    if (POLICY === "on" && r.kind === "decision" && /\bfix(?:ed|es)?\b/i.test(r.chose ?? ""))
      for (const q of new Set([...(r.cites ?? []), ...(textOf(r).match(ID_RE) ?? [])])) if (w.byId.get(q)?.kind === "defect" && w.byId.get(q)!.t < r.t) {
        closedAt.set(q, Math.min(closedAt.get(q) ?? Infinity, r.t));
        fixedByDecision.add(q);
      }
    if (r.kind === "decision" && SUPERSEDE.test(textOf(r)))
      for (const q of r.cites ?? []) if (w.byId.get(q)?.kind === "decision") supersededAt.set(q, Math.min(supersededAt.get(q) ?? Infinity, r.t));
  }
  // work order state at T
  const orderEvents = new Map<string, { t: number; state: string; owner?: string }[]>();
  for (const r of w.work) {
    const of = r.kind === "order" ? r.id : r.of;
    const ev = orderEvents.get(of) ?? [];
    if (r.kind === "order") ev.push({ t: r.t, state: "open", owner: r.owner });
    else if (r.kind === "owner") ev.push({ t: r.t, state: "", owner: r.owner });
    else ev.push({ t: r.t, state: r.state });
    orderEvents.set(of, ev);
  }
  const orderAt = (id: string, T: number) => {
    let state = "", owner = "";
    for (const e of orderEvents.get(id) ?? []) {
      if (e.t >= T) break;
      if (e.state) state = e.state;
      if (e.owner) owner = e.owner;
    }
    return { state, owner };
  };
  return { closedAt, supersededAt, orderAt, fixedByDecision };
}
type Closers = ReturnType<typeof closersIndex>;

const DELIVERABLE = new Set(["decision", "defect", "conjecture", "unable", "experiment", "escalation", "order"]);
const OPEN_KINDS = new Set(["defect", "conjecture", "unable", "experiment", "escalation", "order"]);

export interface Item {
  id: string;
  kind: string;
  srcs: Src[];
  score: number;
  open: boolean;
  superseded: boolean;
  t: number;
}

/** What first touch of `file` at `T` by `session` would deliver, from the given sources, ranked, uncapped. */
export function lookup(
  w: World,
  links: Map<string, Link[]>,
  olinks: Map<string, Link[]>,
  cl: Closers,
  file: string,
  T: number,
  session: string | null,
  sources: Set<Src>,
): Item[] {
  const comp = `@${w.componentOf(file)}`;
  const items: Item[] = [];
  const consider = (r: Rec, list: Link[]) => {
    if (!DELIVERABLE.has(r.kind) || r.t >= T || r.session === session) return;
    if (POLICY === "on" && r.kind === "decision" && BOOKKEEPING.test(r.chose ?? "")) return;
    const srcs = new Set<Src>();
    for (const l of list) if (sources.has(l.src) && l.t < T && (l.key === file || (l.src === "cp" && l.key === comp))) srcs.add(l.src);
    if (!srcs.size) return;
    if (r.kind === "order") {
      const { state, owner } = cl.orderAt(r.id, T);
      if (!["open", "active", "waiting"].includes(state) || owner === session) return;
      if (POLICY === "on" && !srcs.has("ex")) return; // an order only through what it cites
    } else if ((cl.closedAt.get(r.id) ?? Infinity) < T) return;
    const s = [...srcs];
    items.push({ id: r.id, kind: r.kind, srcs: s, score: s.reduce((a, x) => a + WEIGHT[x], 0), open: OPEN_KINDS.has(r.kind), superseded: (cl.supersededAt.get(r.id) ?? Infinity) < T, t: r.t });
  };
  for (const r of w.journal) consider(r, links.get(r.id) ?? []);
  for (const o of w.work) if (o.kind === "order") consider(o, olinks.get(o.id) ?? []);
  items.sort((a, b) => Number(b.open) - Number(a.open) || Number(a.superseded) - Number(b.superseded) || b.score - a.score || b.t - a.t);
  return items;
}

const GLYPH: Record<string, string> = { decision: "◆", defect: "!", conjecture: "?", unable: "⊘", experiment: "▷", escalation: "▲", order: "▣" };
const LABEL: Record<string, string> = { decision: "decided", defect: "open defect", conjecture: "open conjecture", unable: "unable", experiment: "open experiment", escalation: "open escalation", order: "work order" };

export function render(byId: Map<string, Rec>, file: string, items: Item[], cap = CAP): string {
  if (!items.length) return "";
  const open = items.filter((i) => i.open).length;
  const lines = [`traces for ${file}: ${open} open, ${items.length - open} decided${items.length > cap ? `; ${items.length - cap} more: coherence query traces ${file}` : ""}`];
  for (const i of items.slice(0, cap)) {
    const s = subject(byId.get(i.id)!).replace(/\s+/g, " ");
    lines.push(`  ${GLYPH[i.kind]} ${i.id} ${LABEL[i.kind]}${i.superseded ? " (superseded?)" : ""}: ${s.length > 110 ? `${s.slice(0, 107)}...` : s}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- replay

interface Touch {
  session: string;
  file: string;
  T: number;
  commit: string;
}

function touches(w: World): Touch[] {
  const out: Touch[] = [];
  const bySession = new Map<string, Commit[]>();
  for (const [id, cm] of w.commitOf) {
    const r = w.byId.get(id);
    if (!r || !w.journal.includes(r)) continue;
    const list = bySession.get(r.session) ?? [];
    if (!list.includes(cm)) list.push(cm);
    bySession.set(r.session, list);
  }
  for (const [session, cms] of bySession) {
    cms.sort((a, b) => a.t - b.t);
    const first = Math.min(...w.journal.filter((r) => r.session === session).map((r) => r.t), w.runStart.get(session) ?? Infinity);
    const seen = new Set<string>();
    cms.forEach((cm, i) => {
      // the window opens at the session's previous journal commit, or at its start
      const T = i === 0 ? first : Math.max(first, cms[i - 1]!.t);
      for (const f of cm.files) {
        if (seen.has(f) || f.startsWith(".coherence/")) continue;
        seen.add(f);
        out.push({ session, file: f, T, commit: cm.sha });
      }
    });
  }
  return out;
}

/** What a session wrote at or after T that bears on a delivered item. */
const namedIds = new Map<string, string[]>();
function idsIn(s: Rec): string[] {
  let v = namedIds.get(s.id);
  if (!v) namedIds.set(s.id, (v = textOf(s).match(ID_RE) ?? []));
  return v;
}

function relevance(w: World, tf: Tfidf, links: Map<string, Link[]>, item: Item, touch: Touch, later: Rec[], theta: number) {
  let cited = false, acted = false, overlap: { id: string; sim: number; kind: string } | null = null;
  const comp = w.componentOf(touch.file);
  for (const s of later) {
    const names = s.id !== item.id && ((s.cites ?? []).includes(item.id) || s.of === item.id || s.work === item.id || s.decision === item.id || s.classifies?.of === item.id || idsIn(s).includes(item.id));
    if (names) {
      cited = true;
      if (s.of === item.id && CLOSERS.has(s.kind)) acted = true;
    }
  }
  for (const s of later) {
    if (!["decision", "defect", "conjecture", "unable"].includes(s.kind)) continue;
    const about = ABOUT === "loose" || (links.get(s.id) ?? []).some((l) => l.key === touch.file || l.key === `@${comp}` || (l.src !== "cp" && w.componentOf(l.key) === comp && comp !== "."));
    if (!about) continue;
    const sim = tf.sim(s.id, item.id);
    if (sim >= theta && (!overlap || sim > overlap.sim)) overlap = { id: s.id, sim, kind: s.kind };
  }
  const citesItem = overlap ? ((w.byId.get(overlap.id)!.cites ?? []) as string[]).includes(item.id) : false;
  return { cited, acted, overlap, relevant: cited || !!overlap, preempt: !!overlap && !citesItem && !cited };
}

function pct(n: number, d: number) {
  return d ? Math.round((1000 * n) / d) / 10 : 0;
}

// ---------------------------------------------------------------- main

function main() {
  const t0 = performance.now();
  const w = loadWorld(ROOT);
  const tLoad = performance.now() - t0;
  const t1 = performance.now();
  const links = buildLinks(w);
  const olinks = orderLinks(w, links);
  const cl = closersIndex(w);
  const tLinks = performance.now() - t1;

  const tf = new Tfidf();
  for (const r of w.all) tf.add(r.id, textOf(r));
  tf.finish();

  const pairs = flag("--pairs");
  if (pairs) {
    for (const pr of pairs.split(",")) {
      const [a, b] = pr.split(":");
      const lb = (links.get(b!) ?? []).map((l) => `${l.src}:${l.key}`).slice(0, 12);
      console.log(a, b, tf.sim(a!, b!).toFixed(3), w.byId.get(a!)?.session === w.byId.get(b!)?.session ? "same session" : "", lb.join(" "));
    }
    return;
  }
  const allTouches = touches(w);
  const show = flag("--show"); // "<session> <file>": what first touch would have delivered, per source set
  if (show) {
    const [session, file] = show.split(" ");
    const touch = allTouches.find((x) => x.session === session && x.file === file);
    if (!touch) return console.log("no such first touch");
    for (const set of [["ex", "tx"], ["ex", "tx", "cc"]] as Src[][])
      console.log(`--- ${set.join("+")} at ${new Date(touch.T).toISOString()}\n${render(w.byId, file!, lookup(w, links, olinks, cl, file!, touch.T, session!, new Set(set)))}`);
    return;
  }
  const sessionsTouched = new Set(allTouches.map((x) => x.session));
  const laterOf = (touch: Touch) => [...w.journal, ...w.work].filter((r) => r.session === touch.session && r.t >= touch.T);
  const laterCache = new Map<string, Rec[]>();
  const later = (touch: Touch) => {
    const k = `${touch.session}@${touch.T}`;
    let v = laterCache.get(k);
    if (!v) laterCache.set(k, (v = laterOf(touch)));
    return v;
  };

  const SETS: Record<string, Src[]> = {
    cc: ["cc"],
    ex: ["ex"],
    tx: ["tx"],
    cp: ["cp"],
    "ex+tx": ["ex", "tx"],
    "ex+tx+cc": ["ex", "tx", "cc"],
    "cc-tight": ["ct"],
    "ex+tx+cc-tight": ["ex", "tx", "ct"],
    "all four": ["ex", "tx", "cc", "cp"],
  };

  // recall target: records from other sessions a session went on to name (cite, act on, bind to)
  // that existed before the session's first touch and before the naming record
  const namedBy = (session: string) => {
    const out = new Map<string, number>(); // id -> earliest naming time
    for (const s of [...w.journal, ...w.work].filter((r) => r.session === session)) {
      const ids = new Set<string>([...(s.cites ?? []), ...(typeof s.of === "string" ? [s.of] : []), ...(typeof s.work === "string" && s.binding === "flag" ? [s.work] : []), ...(textOf(s).match(ID_RE) ?? [])]);
      for (const id of ids) {
        const q = w.byId.get(id);
        if (!q || q.session === session || !DELIVERABLE.has(q.kind) || q.t >= s.t) continue;
        out.set(id, Math.min(out.get(id) ?? Infinity, s.t));
      }
    }
    return out;
  };

  const perSet: Record<string, any> = {};
  const deliveriesBySet = new Map<string, any[]>();
  const evalSet = (name: string, srcs: Src[], lnk = links, record = true) => {
    const sources = new Set(srcs);
    deliveriesBySet.set(name, []);
    const byKind: Record<string, [number, number]> = {};
    const pairs = new Set<string>();
    let deliveries = 0, nonEmpty = 0, items1 = 0, rel1 = 0, itemsK = 0, relK = 0, itemsAll = 0, relAll = 0, preK = 0, preDeliveries = 0, tokens = 0;
    const sessionTokens = new Map<string, number>();
    const deliveredBy = new Map<string, Map<string, number>>(); // session -> id -> earliest T delivered in top K
    const deliveredAllBy = new Map<string, Map<string, number>>();
    const preemptedRecords = new Map<string, Set<string>>(); // session -> later records a trace would have pre-empted
    for (const touch of allTouches) {
      deliveries++;
      const items = lookup(w, lnk, olinks, cl, touch.file, touch.T, touch.session, sources);
      if (!items.length) continue;
      nonEmpty++;
      const text = render(w.byId, touch.file, items);
      tokens += Math.ceil(text.length / 4);
      sessionTokens.set(touch.session, (sessionTokens.get(touch.session) ?? 0) + Math.ceil(text.length / 4));
      const L = later(touch);
      let anyPre = false;
      items.forEach((it, rank) => {
        const v = relevance(w, tf, lnk, it, touch, L, SIM_THRESHOLD);
        itemsAll++;
        if (v.relevant) relAll++;
        if (rank === 0) {
          items1++;
          if (v.relevant) rel1++;
        }
        const dAll = deliveredAllBy.get(touch.session) ?? new Map();
        dAll.set(it.id, Math.min(dAll.get(it.id) ?? Infinity, touch.T));
        deliveredAllBy.set(touch.session, dAll);
        if (rank < CAP) {
          itemsK++;
          if (v.relevant) relK++;
          const kk = it.open ? "open" : it.superseded ? "superseded" : "decision";
          byKind[kk] ??= [0, 0];
          byKind[kk]![0]++;
          if (v.relevant) byKind[kk]![1]++;
          if (v.preempt) {
            preK++;
            anyPre = true;
            const set = preemptedRecords.get(touch.session) ?? new Set();
            set.add(v.overlap!.id);
            pairs.add(`${it.id} -> ${v.overlap!.id} (${v.overlap!.sim.toFixed(2)})`);
            preemptedRecords.set(touch.session, set);
          }
          const d = deliveredBy.get(touch.session) ?? new Map();
          d.set(it.id, Math.min(d.get(it.id) ?? Infinity, touch.T));
          deliveredBy.set(touch.session, d);
          if (record) deliveriesBySet.get(name)!.push({ session: touch.session, file: touch.file, T: new Date(touch.T).toISOString(), rank, item: it, proxy: v });
        }
      });
      if (anyPre) preDeliveries++;
    }
    // recall over sessions
    let target = 0, foundK = 0, foundAll = 0;
    const targetKinds: Record<string, [number, number]> = {};
    for (const session of sessionsTouched) {
      for (const [id, when] of namedBy(session)) {
        target++;
        const dk = deliveredBy.get(session)?.get(id);
        const kd = w.byId.get(id)!.kind;
        targetKinds[kd] = targetKinds[kd] ?? [0, 0];
        targetKinds[kd]![0]++;
        if (dk !== undefined && dk <= when) {
          foundK++;
          targetKinds[kd]![1]++;
        }
        const da = deliveredAllBy.get(session)?.get(id);
        if (da !== undefined && da <= when) foundAll++;
      }
    }
    // the payoff denominator: decisions and defects the sessions wrote about the files they touched
    let written = 0;
    for (const session of sessionsTouched) written += w.journal.filter((r) => r.session === session && (r.kind === "decision" || r.kind === "defect")).length;
    const pre = [...preemptedRecords.values()].reduce((a, s) => a + s.size, 0);
    const st = [...sessionTokens.values()].sort((a, b) => a - b);
    perSet[name] = {
      sources: srcs,
      firstTouches: deliveries,
      coverage: pct(nonEmpty, deliveries),
      meanItems: Math.round((itemsAll / Math.max(nonEmpty, 1)) * 10) / 10,
      precisionAt1: pct(rel1, items1),
      precisionAtCap: pct(relK, itemsK),
      precisionUncapped: pct(relAll, itemsAll),
      recallAtCap: pct(foundK, target),
      recallUncapped: pct(foundAll, target),
      recallTarget: target,
      recallAtCapByKind: Object.fromEntries(Object.entries(targetKinds).map(([k, [n, f]]) => [k, `${f} of ${n}`])),
      preemptItemsAtCap: preK,
      preemptPairs: [...pairs],
      deliveriesWithPreempt: pct(preDeliveries, nonEmpty),
      laterRecordsPreempted: pre,
      laterRecordsPreemptedPct: pct(pre, written),
      tokensPerDelivery: Math.round(tokens / Math.max(nonEmpty, 1)),
      tokensPerSessionMedian: st[Math.floor(st.length / 2)] ?? 0,
      tokensPerSessionP90: st[Math.floor(st.length * 0.9)] ?? 0,
      precisionAtCapByKind: Object.fromEntries(Object.entries(byKind).map(([k, [n, r]]) => [k, `${pct(r, n)}% of ${n}`])),
    };
  };

  for (const [name, srcs] of Object.entries(SETS)) evalSet(name, srcs, links);
  const deliveriesForSample = deliveriesBySet.get("ex+tx+cc")!;

  // write-time traces: the files a session changed since its previous record, given with decide
  const wtResults: Record<string, any> = {};
  for (const bound of ["lower", "upper"] as const) {
    const lw = buildLinks(w, { wt: bound });
    const before = { ...perSet };
    evalSet(`wt(${bound})`, ["wt"], lw, false);
    evalSet(`ex+tx+wt(${bound})`, ["ex", "tx", "wt"], lw, false);
    evalSet(`ex+tx+cc+wt(${bound})`, ["ex", "tx", "cc", "wt"], lw, false);
    wtResults[bound] = Object.keys(perSet).filter((k) => !(k in before));
  }

  // threshold sensitivity for the overlap proxy, on the recommended set
  const sens: Record<string, number> = {};
  {
    const sample = deliveriesForSample;
    for (const th of [0.2, 0.25, 0.3, 0.35, 0.4, 0.5]) {
      let rel = 0;
      for (const d of sample) {
        const touch = allTouches.find((x) => x.session === d.session && x.file === d.file)!;
        const v = relevance(w, tf, links, d.item, touch, later(touch), th);
        if (v.relevant) rel++;
      }
      sens[String(th)] = pct(rel, sample.length);
    }
  }

  // ---------------------------------------------------------------- cost
  // background build of the live index (everything, as of now) and its cache
  const b0 = performance.now();
  const w2 = loadWorld(ROOT);
  const l2 = buildLinks(w2);
  const o2 = orderLinks(w2, l2);
  const c2 = closersIndex(w2);
  const now = Date.now() + 1;
  const files = new Set<string>();
  for (const list of [...l2.values(), ...o2.values()]) for (const l of list) if (l.src !== "cp") files.add(l.key);
  const cache: Record<string, string[]> = {};
  const lines: Record<string, string> = {};
  for (const f of files) {
    const items = lookup(w2, l2, o2, c2, f, now, null, new Set(["ex", "tx", "cc"]));
    if (!items.length) continue;
    cache[f] = items.slice(0, 50).map((i) => `${i.open ? 1 : 0}${i.superseded ? "s" : "-"}${i.id}`);
    for (const i of items.slice(0, CAP)) lines[i.id] = `${GLYPH[i.kind]} ${i.id} ${LABEL[i.kind]}${i.superseded ? " (superseded?)" : ""}: ${subject(w2.byId.get(i.id)!).replace(/\s+/g, " ").slice(0, 110)}`;
  }
  const buildMs = performance.now() - b0;
  const scratch = mkdtempSync(join(tmpdir(), "traces-"));
  const cachePath = join(scratch, "index.json");
  const cacheText = JSON.stringify({ at: new Date().toISOString(), files: cache, lines });
  writeFileSync(cachePath, cacheText);
  // hook-time: read the cache, look up one file, render five lines
  const fileList = Object.keys(cache);
  const timings: number[] = [];
  const ROUNDS = 1000;
  for (let round = 0; round < ROUNDS; round++) {
    const f = fileList[round % fileList.length]!;
    const s = performance.now();
    const idx = JSON.parse(readFileSync(cachePath, "utf8"));
    const ids: string[] = idx.files[f] ?? [];
    const out = [`traces for ${f}`, ...ids.slice(0, CAP).map((x) => `  ${idx.lines[x.slice(2)] ?? x.slice(2)}`)].join("\n");
    void out;
    timings.push(performance.now() - s);
  }
  timings.sort((a, b) => a - b);
  const at = (q: number) => Math.round(timings[Math.min(ROUNDS - 1, Math.floor(ROUNDS * q))]! * 100) / 100;
  // the same lookup as the first thing a fresh process does (as a per-event hook would), timed inside it
  const cold: number[] = [];
  const probe = `const s=performance.now();const fs=require("node:fs");const i=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const ids=i.files[process.argv[2]]??[];const o=ids.slice(0,${CAP}).map(x=>i.lines[x.slice(2)]).join("\\n");process.stdout.write(String(performance.now()-s))`;
  for (let k = 0; k < 15; k++) cold.push(Number(execFileSync(process.execPath, ["-e", probe, cachePath, fileList[k % fileList.length]!], { encoding: "utf8" })));
  cold.sort((a, b) => a - b);
  const cost = {
    replayLoadMs: Math.round(tLoad),
    replayLinksMs: Math.round(tLinks),
    liveIndexBuildMs: Math.round(buildMs),
    cacheBytes: cacheText.length,
    filesIndexed: fileList.length,
    lookupRenderMedianMs: at(0.5),
    lookupRenderP95Ms: at(0.95),
    lookupRenderP99Ms: at(0.99),
    lookupRenderMaxMs: at(1),
    coldProcessLookupMedianMs: Math.round(cold[7]! * 100) / 100,
    coldProcessLookupMaxMs: Math.round(cold[14]! * 100) / 100,
  };

  // the sample for hand labels: fixed seed, ranked items from ex+tx+cc
  const seeded = (() => {
    let x = 0x9e3779b9;
    return () => ((x = (x * 1103515245 + 12345) >>> 0) / 2 ** 32);
  })();
  const draw = (from: any[], n: number, skip: Set<string>) => {
    const pool = from.filter((d) => !skip.has(`${d.session} ${d.file} ${d.item.id}`));
    const out: any[] = [];
    while (out.length < n && pool.length) out.push(pool.splice(Math.floor(seeded() * pool.length), 1)[0]);
    return out;
  };

  const labelsPath = flag("--labels") ?? join(HERE, "labels.json");
  const labels: any[] = existsSync(labelsPath) ? JSON.parse(readFileSync(labelsPath, "utf8")) : [];
  const labeled = new Set(labels.map((l) => `${l.session} ${l.file} ${l.id}`));
  let calibration: any = null;
  if (labels.length) {
    // the proxy's verdict on each labeled item, recomputed under the current proxy settings
    const tally: Record<string, Record<string, number>> = {};
    const bySource: Record<string, Record<string, number>> = {};
    const byKind: Record<string, Record<string, number>> = {};
    for (const l of labels) {
      // a label names its file, or (where the path holds a rejected name) only the session and the record
      const touch = allTouches.find((x) => x.session === l.session && (l.file ? x.file === l.file : lookup(w, links, olinks, cl, x.file, x.T, x.session, new Set<Src>(["ex", "tx"])).some((i) => i.id === l.id)));
      const item = touch && lookup(w, links, olinks, cl, touch.file, touch.T, touch.session, new Set<Src>(["ex", "tx", "cc", "cp"])).find((i) => i.id === l.id);
      const v = item && relevance(w, tf, links, item, touch!, later(touch!), SIM_THRESHOLD);
      const proxy = v ? (v.relevant ? "proxy relevant" : "proxy not") : "not delivered";
      tally[proxy] ??= {};
      tally[proxy]![l.label] = (tally[proxy]![l.label] ?? 0) + 1;
      const srcs = String(l.srcs).split(",");
      const group = srcs.includes("ex") ? "has ex" : srcs.includes("tx") ? "tx, no ex" : "cc only";
      bySource[group] ??= {};
      bySource[group]![l.label] = (bySource[group]![l.label] ?? 0) + 1;
      const kind = w.byId.get(l.id)?.kind === "decision" ? "decision" : "open item";
      byKind[kind] ??= {};
      byKind[kind]![l.label] = (byKind[kind]![l.label] ?? 0) + 1;
    }
    const count = (lab: string) => labels.filter((l) => l.label === lab).length;
    calibration = { n: labels.length, relevant: count("relevant"), marginal: count("marginal"), noise: count("noise"), proxyVsHand: tally, handBySource: bySource, handByKind: byKind };
  }

  const describe = (d: any, i: number) => {
    const r = w.byId.get(d.item.id)!;
    const L = later(allTouches.find((x) => x.session === d.session && x.file === d.file)!)
      .filter((s) => ["decision", "defect", "conjecture", "unable", "resolution", "retraction"].includes(s.kind) && !BOOKKEEPING.test(s.chose ?? ""))
      .slice(0, 6)
      .map((s) => `      later ${s.id} ${s.kind}: ${(subject(s) || s.because || "").slice(0, 160)}`);
    return [
      `#${i + 1} ${d.session} ${d.file} T=${d.T} rank=${d.rank} srcs=${d.item.srcs} proxy=${d.proxy.relevant ? "REL" : "no"}${d.proxy.cited ? " cited" : ""}${d.proxy.overlap ? ` overlap ${d.proxy.overlap.id} ${d.proxy.overlap.sim.toFixed(2)}` : ""}`,
      `   delivered ${r.id} ${r.kind}: ${textOf(r).slice(0, 400)}`,
      ...L,
    ].join("\n");
  };
  const samplePath = flag("--sample");
  if (samplePath) writeFileSync(samplePath, draw(deliveriesForSample, 30, labeled).map(describe).join("\n\n"));
  // a second, stratified draw: items the explicit and text sources deliver, for their own precision
  const sample2Path = flag("--sample-ex");
  if (sample2Path) writeFileSync(sample2Path, draw(deliveriesBySet.get("ex+tx")!, 15, labeled).map(describe).join("\n\n"));

  // worked examples: the best and worst of the sample by proxy
  const results = {
    root: ROOT,
    generatedAt: new Date().toISOString(),
    cap: CAP,
    overlapThreshold: SIM_THRESHOLD,
    counts: { records: w.journal.length, workRecords: w.work.length, commits: w.commits.size, recordsWithCommit: w.commitOf.size, sessionsWithTouches: sessionsTouched.size, firstTouches: allTouches.length, defectsClosedByAFixDecision: cl.fixedByDecision.size, decisionsMarkedSuperseded: cl.supersededAt.size },
    sets: perSet,
    writeTime: wtResults,
    thresholdSensitivity: sens,
    cost,
    calibration,
  };
  writeFileSync(flag("--out") ?? join(HERE, "results.json"), `${JSON.stringify(results, null, 2)}\n`);

  // tables
  console.log(`records ${w.journal.length}, sessions with touches ${sessionsTouched.size}, first touches ${allTouches.length}, cap ${CAP}, overlap theta ${SIM_THRESHOLD}`);
  console.log("set | coverage | items | p@1 | p@cap | p@all | recall@cap | recall all | deliveries w/ pre-empt | later records pre-empted | tok/delivery | tok/session med (p90)");
  for (const [k, v] of Object.entries(perSet))
    console.log(`${k} | ${v.coverage}% | ${v.meanItems} | ${v.precisionAt1}% | ${v.precisionAtCap}% | ${v.precisionUncapped}% | ${v.recallAtCap}% | ${v.recallUncapped}% (of ${v.recallTarget}) | ${v.deliveriesWithPreempt}% | ${v.laterRecordsPreempted} (${v.laterRecordsPreemptedPct}%) | ${v.tokensPerDelivery} | ${v.tokensPerSessionMedian} (${v.tokensPerSessionP90})`);
  for (const [k, v] of Object.entries(perSet)) console.log(`  ${k} p@cap by kind: ${JSON.stringify(v.precisionAtCapByKind)}`);
  console.log("threshold sensitivity (p@cap of ex+tx+cc):", sens);
  console.log("cost:", cost);
  if (calibration) console.log("calibration:", JSON.stringify(calibration));
}

main();
