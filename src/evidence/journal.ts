// journal.ts — the journal STREAM: the merged decision timeline as a live feed, and a
// surfable history — in aggregate, or one session's stream at a time.
//
// WHY A SECOND READ SURFACE WHEN `decisions` EXISTS. `decisions` is the SETTLED render:
// it resolves retractions against what they withdraw, files answered questions under
// their answers, and leads with what is still open. That is the right artifact for a
// reader arriving AFTER the work — and useless for one watching DURING it, because it
// re-derives the whole resolution every time and orders by standing, not by arrival.
// This is the other read: strictly chronological, scoped by STREAM (a session is a
// subagent's stream — the split-file layout already made that identity structural), and
// LIVE, because the motivating scene is an orchestrator with five subagents running and
// no way to see what any of them is deciding until it finishes.
//
// THE TAIL IS CONTENT-ADDRESSED, NOT POSITION-ADDRESSED, and that is the one design
// decision everything else here leans on. A byte-offset tailer is correct only while
// files strictly grow — and this journal's files do not: `decisions --compact` folds
// committed session files into one per (branch, month), which unlinks sources and
// writes their lines into a target the tailer may already hold an offset into. A
// position-addressed reader replays everything after the fold; a reader keyed on the
// record's own (session, id, at) — the same triple `readJournal`'s total sort orders
// by — recognizes a moved line as one it has already streamed. Offsets survive as an
// OPTIMIZATION (skip re-parsing what was already consumed on the append path); identity
// never comes from them.
//
// IT RENDERS; IT NEVER RESOLVES A VERDICT. Like every read in decisions.ts, a malformed
// line is counted and skipped, never thrown on — a live monitor that dies because one
// agent wrote garbage has failed at the one moment it was being watched.
import { existsSync, readFileSync, readdirSync, watch, type FSWatcher } from "node:fs";
import { createHash } from "node:crypto";
import * as readline from "node:readline";
import { join } from "node:path";
import type { Config } from "../types.ts";
import {
  decisionsDir, deriveSessions, inScope, timelineOrder, resolve as resolveJournal,
  type DecisionKind, type DecisionRecord, type JournalScope, type Session,
} from "./decisions.ts";
import { sty, clip, padE, wrapText, humanAge, type Sty } from "../readings/panel.ts";

// ── the tail: incremental, fold-proof reads over the session files ─────────────────

export interface TailState {
  /** filename → bytes consumed, up to and including the last COMPLETE line, plus a
   *  digest of exactly those bytes. A writer caught mid-append leaves a partial tail
   *  line; it is left unconsumed and picked up whole on the next pull, so a record is
   *  never parsed from half its bytes.
   *
   *  THE DIGEST IS WHAT MAKES THE OFFSET SAFE TO KEEP. A fold can rewrite a file the
   *  tailer holds an offset into — compaction's target may be one of its own sources,
   *  and the rewrite interleaves OTHER files' lines before the held offset. A
   *  size-only check misses that (the file GREW), and reading on from the stale
   *  offset both splits a line mid-byte and never visits the lines that landed before
   *  it — a silently dropped record, the worst thing this stream can do. So the
   *  offset is only trusted while the bytes under it are the bytes that were
   *  consumed; any rewrite fails the compare and the file re-reads from zero, with
   *  `seen` absorbing the replay. */
  offsets: Map<string, { off: number; digest: string }>;
  /** (session, id, at) triples already streamed. `id` alone is not enough: it hashes
   *  content, and two sessions can legitimately reach the same decision — the dedupe
   *  that collapses them is `resolve`'s job at render time, not the stream's. The
   *  triple is exactly what `timelineOrder` sorts by, so "already streamed" and
   *  "same position in the merged timeline" are one judgment, not two. */
  seen: Set<string>;
}

export const newTailState = (): TailState => ({ offsets: new Map(), seen: new Set() });

const seenKey = (r: DecisionRecord): string => `${r.session}\0${r.id}\0${r.at}`;

const prefixDigest = (buf: Buffer, off: number): string =>
  createHash("sha256").update(buf.subarray(0, off)).digest("hex");

/** One pull over the journal directory: every record not yet streamed, in timeline
 *  order, plus the count of lines nothing could parse. Call it again forever — appends
 *  arrive once, a compaction fold (bytes moved between files, sources unlinked, target
 *  rewritten) arrives zero times, because a moved line is recognized by content.
 *
 *  A file whose consumed prefix is no longer the bytes that were consumed — shorter
 *  than the offset, or same-or-longer with a different digest, which is what a fold
 *  into an EXISTING target produces — was rewritten; it re-reads from zero and `seen`
 *  absorbs the replay. A file that vanished needs nothing at all — its lines either
 *  were streamed already or now live in the fold target, where the next scan finds
 *  them. */
export function tailJournal(cfg: Config, state: TailState): { fresh: DecisionRecord[]; unreadable: number } {
  const fresh: DecisionRecord[] = [];
  let unreadable = 0;
  const dir = decisionsDir(cfg);
  if (!existsSync(dir)) return { fresh, unreadable };
  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
  const live = new Set(files);
  for (const f of [...state.offsets.keys()]) if (!live.has(f)) state.offsets.delete(f);
  for (const f of files) {
    let buf: Buffer;
    try { buf = readFileSync(join(dir, f)); } catch { continue; } // unlinked between readdir and read — the fold target has its lines
    const held = state.offsets.get(f);
    let off = held?.off ?? 0;
    if (held && (buf.length < off || prefixDigest(buf, off) !== held.digest)) off = 0;
    const end = buf.lastIndexOf(0x0a) + 1; // consume complete lines only
    if (end > off) {
      for (const line of buf.subarray(off, end).toString("utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const o = JSON.parse(line) as DecisionRecord;
          if (typeof o.id === "string" && typeof o.chose === "string" && typeof o.at === "string") {
            if (!state.seen.has(seenKey(o))) { state.seen.add(seenKey(o)); fresh.push(o); }
          } else unreadable++;
        } catch { unreadable++; }
      }
    }
    const at = Math.max(off, end);
    state.offsets.set(f, { off: at, digest: prefixDigest(buf, at) });
  }
  fresh.sort(timelineOrder);
  return { fresh, unreadable };
}

// ── one line per record — the stream's whole vocabulary ────────────────────────────

/** One glyph per kind, so a scrolling feed is scannable by shape before it is read.
 *  `Record<DecisionKind, …>` on purpose: a new kind in decisions.ts refuses to compile
 *  until it says what it looks like here. */
export const KIND_GLYPH: Record<DecisionKind, string> = {
  session: "▷", decision: "●", blocked: "✗", conjecture: "?",
  resolution: "✓", dismissal: "∅", retraction: "↩",
};

/** The whole record on ONE line: when, what kind, who, what — and the full `because`,
 *  uncapped, because this is a pipe-facing render and the evidence lives at the end of
 *  a rationale (the LABEL_SOFT_MAX argument, applied to a different surface). Pointer
 *  kinds carry their target inline; a resolution that does not say WHAT it resolves is
 *  unactionable in a feed where the conjecture scrolled past an hour ago. */
export function formatEntryLine(r: DecisionRecord): string {
  const lp = localParts(r.at);
  const t = lp ? `${lp.y}-${lp.md} ${lp.hms}` : r.at;
  const g = KIND_GLYPH[r.kind] ?? "•";
  const who = `${r.agent} · ${r.session}`;
  const arrow = r.supersedes ? ` ⇒ ${r.supersedes}` : "";
  const why = r.because && r.kind !== "session" ? ` — ${r.because}` : "";
  return `${t}  ${g} ${r.kind.padEnd(10)} [${who}]${arrow}  ${r.chose}${why}`;
}

/** When a human is looking straight at ONE entry, "how long ago" is the question the
 *  timestamp answers — up to a day, after which distance stops being felt in hours and
 *  the calendar takes over. Relative up close, absolute far away; `now` is a parameter
 *  so the judgment is testable, and an unparseable `at` passes through untouched
 *  rather than pretending to a recency it cannot compute. Local time on the absolute
 *  form: this render exists only under a human's eyes. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const p2 = (n: number) => String(n).padStart(2, "0");

/** Stored timestamps are UTC ISO — right for the record, wrong for the eye. Every
 *  render below converts to the machine's wall clock; an unparseable stamp returns
 *  null and the caller falls back to showing the raw string, because a wrong-looking
 *  stamp a reader can question beats a silently invented one. */
export function localParts(at: string): { y: string; md: string; hm: string; hms: string } | null {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return {
    y: String(d.getFullYear()),
    md: `${p2(d.getMonth() + 1)}-${p2(d.getDate())}`,
    hm: `${p2(d.getHours())}:${p2(d.getMinutes())}`,
    hms: `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`,
  };
}
export function formatWhen(at: string, now: number = Date.now()): string {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return at;
  const s = Math.floor((now - t) / 1000);
  const ago = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  if (s >= 0 && s < 60) return ago(s, "second");
  if (s >= 0 && s < 3600) return ago(Math.floor(s / 60), "minute");
  if (s >= 0 && s < 86400) return ago(Math.floor(s / 3600), "hour");
  const d = new Date(t);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} · ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** The drill-in: every field the record carries, wrapped to width. The stream's rows
 *  clip; this is where nothing does.
 *
 *  Fields are COLLECTED before anything is formatted, because the layout is a single
 *  judgment over all of them: the widest label present in THIS record sets one colon
 *  column, labels right-align against it so every colon lands at the same x, and
 *  wrapped continuations indent to the value column — so the eye reads one flush
 *  column of colons and one flush column of content, instead of re-finding the start
 *  of the text on every line. The
 *  metadata that used to ride one `·`-joined line is the same shape (label → value),
 *  so it stacks under the same column: schema names from decisions.ts, absent fields
 *  omitted rather than printed as empty labels. */
export function entryDetail(r: DecisionRecord, width: number): string[] {
  const w = Math.max(24, width - 4);
  const meta: [string, string][] = [["agent", r.agent], ["session", r.session], ["job", r.job]];
  if (r.branch) meta.push(["branch", r.branch]);
  if (r.commit) meta.push(["commit", `${r.commit}${r.dirty ? " (dirty)" : ""}`]);
  const body: [string, string][] = [["chose", r.chose]];
  if (r.kind === "conjecture") {
    for (const c of r.couldBe ?? []) body.push(["could be", c]);
    body.push(["discriminated by", r.discriminatedBy ?? ""]);
    if (r.because) body.push(["because", r.because]);
  } else if (r.kind !== "session") {
    // Same rule as the settled render: `over` prints even when empty, and says so —
    // forced and unexamined are different claims, and the reader should see which.
    body.push(["over", r.over.length ? r.over.join(" · ") : "(nothing — forced, or no alternative considered)"]);
    body.push(["because", r.because]);
  }
  if (r.supersedes) body.push(["supersedes", r.supersedes]);
  if (r.files?.length) body.push(["files", r.files.join(", ")]);
  if (r.metric) body.push(["metric", `${r.metric} = ${r.value}${r.unit ? ` ${r.unit}` : ""} (baseline ${r.baseline}, threshold ${r.threshold})`]);

  // The widest label sets the colon column: labels are right-aligned against it, so
  // every colon lands at the SAME x, and every value starts one space after it.
  const labelW = Math.max(...[...meta, ...body].map(([l]) => l.length));
  const col = labelW + 2;
  const field = ([label, text]: [string, string]): string[] =>
    wrapText(text, Math.max(10, w - col)).map((l, i) => (i === 0 ? `${label.padStart(labelW)}: ${l}` : `${" ".repeat(col)}${l}`));

  const L: string[] = [];
  L.push(`${KIND_GLYPH[r.kind] ?? "•"} ${r.kind}  ${r.id}  ${formatWhen(r.at)}`);
  L.push(""); // identity above, metadata below — a breath between the two
  for (const f of meta) L.push(...field(f));
  L.push("");
  for (const f of body) {
    const lines = field(f); // empty text wraps to nothing — the field vanishes whole, label and all
    if (!lines.length) continue;
    L.push(...lines, ""); // a blank between fields: each claim reads as its own block
  }
  while (L[L.length - 1] === "") L.pop();
  return L;
}

// ── the frame: pure render (model + ui + size → lines), panel.ts discipline ────────

export interface StreamModel { records: DecisionRecord[]; unreadable: number }

export interface StreamUI {
  view: "timeline" | "streams" | "entry" | "conjectures";
  stream: string | null;     // a session id, or null — the merged timeline
  cursor: number;            // timeline: selected entry, in DISPLAY order — 0 is always the newest
  scroll: number;            // timeline: first visible entry (display order); slides only when the selection hits an edge
  sCursor: number;           // streams view: 0 = ALL, then sessions newest-activity-first
  sScroll: number;           // streams view: first visible row, same edge-only sliding
  cCursor: number;           // conjectures view: selected open conjecture (display order, newest first)
  cScroll: number;           // conjectures view: first visible cell, same edge-only sliding
  entryScroll: number;
  back: "timeline" | "conjectures"; // where the entry drill-in returns on esc — set by the ⏎ that opened it
  /** Reference-following inside the drill-in: each ⏎ on an entry that carries a
   *  `supersedes` pointer pushes the TARGET id here, esc pops back one hop. Ids, not
   *  cursor positions, because the referenced entry lives in the whole model — it may
   *  be outside the list (a resolved conjecture, a scoped-out stream) that opened the
   *  drill-in. Empty means the drill-in shows the list's own selection. */
  refTrail: string[];
  follow: boolean;           // pinned to the newest entry (row 0); any surf into history pauses it
}

export const initialStreamUI = (): StreamUI =>
  ({ view: "timeline", stream: null, cursor: 0, scroll: 0, sCursor: 0, sScroll: 0,
     cCursor: 0, cScroll: 0, entryScroll: 0, back: "timeline", refTrail: [], follow: true });

/** The record the drill-in is showing: the tip of the reference trail when one is being
 *  followed, otherwise the selection of the list that opened it. Null when a followed id
 *  resolves to nothing — the caller renders that as a dangling pointer, not a crash. */
export const shownEntry = (m: StreamModel, ui: StreamUI): DecisionRecord | null => {
  const refId = ui.refTrail[ui.refTrail.length - 1];
  if (refId !== undefined) return m.records.find((r) => r.id === refId) ?? null;
  return (ui.back === "conjectures" ? openConjectures(m)[ui.cCursor] : displayRecords(m, ui)[ui.cursor]) ?? null;
};

export const visibleRecords = (m: StreamModel, ui: StreamUI): DecisionRecord[] =>
  ui.stream === null ? m.records : m.records.filter((r) => r.session === ui.stream);

/** THE LIST ORDER — newest first. `visibleRecords` stays chronological (that is the
 *  order `timelineOrder` defines, and what the pipe modes print); the interactive list
 *  reverses it, because the reader this surface exists for is watching a live feed and
 *  the newest entry belongs where the eye rests — the top. `ui.cursor` indexes THIS
 *  order, so 0 is always the tip and "follow" is simply "cursor pinned at 0".
 *  Copied before reversing: `visibleRecords` hands back the model's own array when the
 *  scope is ALL, and reversing that in place would corrupt the timeline itself. */
export const displayRecords = (m: StreamModel, ui: StreamUI): DecisionRecord[] =>
  [...visibleRecords(m, ui)].reverse();

/** THE OPEN LIST — the records behind the masthead's "N OPEN conjecture(s)", newest
 *  first. Deliberately UNSCOPED (the whole model, never the surfed stream): the count
 *  in the header is unscoped, and a drill-in that shows fewer entries than the number
 *  that invited the reader in would read as a bug. `resolve` already owns the
 *  open/answered/dismissed judgment — reused here, never re-decided. Copied before
 *  reversing for the same reason `displayRecords` copies. */
export const openConjectures = (m: StreamModel): DecisionRecord[] =>
  [...resolveJournal(m.records).open].reverse();

/** The PICKER's order: streams by most recent activity, newest first — the stream the
 *  operator is reaching for is almost always the one that just spoke. `deriveSessions`
 *  keeps its started-order (the settled render leans on it); the recency sort lives
 *  here, beside the one surface that wants it. */
export function sessionsByRecency(records: DecisionRecord[]): Session[] {
  const lastAt = new Map<string, string>();
  for (const r of records) { const p = lastAt.get(r.session); if (!p || r.at > p) lastAt.set(r.session, r.at); }
  return deriveSessions(records)
    .sort((a, b) => (lastAt.get(b.id) ?? b.started).localeCompare(lastAt.get(a.id) ?? a.started));
}

function glyph(kind: DecisionKind, S: Sty): string {
  const g = KIND_GLYPH[kind] ?? "•";
  switch (kind) {
    case "decision": return S.cyn(g);
    case "blocked": return S.red(g);
    case "conjecture": return S.mag(g);
    case "resolution": return S.grn(g);
    case "retraction": return S.yel(g);
    default: return S.dim(g);
  }
}

/** One timeline entry as a stacked CELL, not a table row: a metadata line — glyph,
 *  MM-DD HH:MM, agent — over up to two wrapped lines of the entry text, ellipsized past
 *  that. The old columnar row spent the whole width on ONE clipped line, which crammed
 *  when, who and what into a race for the same characters; stacking gives the metadata
 *  a line of its own and the sentence room to be read. Two text lines is the trade the
 *  drill-in makes cheap: enough to recognize the entry, ⏎ for the rest. Selection
 *  inverts the whole cell — the highlight-bar answer to "what will Enter open".
 *  An optional HINT rides as one clipped line under the text — the conjectures view
 *  uses it for the discriminator/candidates; the timeline passes none. */
function timelineCell(r: DecisionRecord, S: Sty, cols: number, selected: boolean, hint?: string): string[] {
  const lp = localParts(r.at);
  const t = lp ? `${lp.md} ${lp.hm}` : r.at; // MM-DD HH:MM — the year belongs to the detail view
  const what = `${r.chose}${r.because && r.kind !== "session" ? ` — ${r.because}` : ""}`;
  const w = Math.max(20, cols - 5);
  const wrapped = wrapText(what, w);
  const text = wrapped.slice(0, 2);
  // A third wrapped line exists: give line two its next words and let `clip` spend the
  // final character on the ellipsis that says "there is more".
  if (wrapped.length > 2) text[1] = clip(`${text[1]} ${wrapped[2]}`, w);
  if (selected) {
    return [
      S.inv(padE(` ${KIND_GLYPH[r.kind] ?? "•"} ${t}  ${r.agent}`, cols)),
      ...text.map((l) => S.inv(padE(`   ${l}`, cols))),
      ...(hint ? [S.inv(padE(`   ${clip(hint, w)}`, cols))] : []),
    ];
  }
  return [
    ` ${glyph(r.kind, S)} ${S.dim(t)}  ${r.agent}`,
    ...text.map((l) => `   ${l}`),
    ...(hint ? [`   ${S.dim(clip(hint, w))}`] : []),
  ];
}

/** Window a run of variable-height CELLS: never slice a cell through its middle, slide
 *  the anchor only when the selection would leave the window, and reserve the last line
 *  for the "older" indicator whenever entries exist below the cursor — otherwise it
 *  lands ON the selected cell's final line exactly at the bottom edge, eating the
 *  highlight it points past. Shared by every cell list (timeline, open conjectures);
 *  the caller writes the reconciled scroll back into the field it owns. */
function windowCells(cells: string[][], cursor: number, scroll: number, bodyH: number, S: Sty,
): { lines: string[]; scroll: number; more: string } {
  scroll = Math.max(0, Math.min(scroll, cursor));
  const span = (from: number, to: number) => { // lines from cell `from` through cell `to`, rules included, minus the trailing one
    let n = 0; for (let i = from; i <= to; i++) n += cells[i].length + 1; return n - 1;
  };
  const reserve = cursor < cells.length - 1 ? 1 : 0;
  while (scroll < cursor && span(scroll, cursor) > bodyH - reserve) scroll++;
  const lines: string[] = [];
  let shown = 0; // cells FULLY visible — what the "older" count is honest about
  for (let i = scroll; i < cells.length && lines.length < bodyH; i++) {
    if (lines.length + cells[i].length <= bodyH) shown++;
    lines.push(...cells[i], ""); // the blank rule that makes entries read as cards
  }
  const below = cells.length - scroll - shown;
  return { lines: lines.slice(0, bodyH), scroll, more: below > 0 ? S.dim(` ↓ ${below} older`) : "" };
}

/** The picker's rows. `sessions` arrives already in display order (newest activity
 *  first, from `sessionsByRecency`) — this function only draws; ALL stays pinned as
 *  row 0 because "everything, interleaved" is the view the picker exists to return to. */
function streamsBody(m: StreamModel, sessions: Session[], ui: StreamUI, S: Sty, cols: number): string[] {
  const idW = Math.min(36, Math.max(12, ...sessions.map((s) => s.id.length)));
  const rows = [
    ` ▤ ${padE("ALL", idW)} the merged timeline — every stream interleaved (${m.records.length} entr${m.records.length === 1 ? "y" : "ies"})`,
    ...sessions.map((s) => {
      const lp = localParts(s.started);
      const started = lp ? `${lp.y}-${lp.md} ${lp.hm}` : s.started;
      return ` ▷ ${padE(s.id, idW)} ${padE(s.agent, 12)} job ${padE(s.job, 14)} ${padE(s.branch ?? "-", 12)} ${started}  ${s.count} entr${s.count === 1 ? "y" : "ies"}`;
    }),
  ];
  return rows.map((row, i) => (i === ui.sCursor ? S.inv(padE(row, cols)) : (i === 0 ? row : ` ${S.dim("▷")}${row.slice(2)}`)));
}

/** Assemble one full frame. Pure over its inputs — no IO, no clock of its own —
 *  EXCEPT that it reconciles `ui.scroll`/`ui.sScroll` in place: cells have variable
 *  height and height exists only at layout time (it depends on the wrap width), so the
 *  render is the one place "slide the window only when the selection hits an edge" can
 *  be decided. Same (model, ui, size) still produces the same frame and the same
 *  anchors — replayable, just not stateless about where the window sits. */
export function renderStreamFrame(
  m: StreamModel, ui: StreamUI, size: { cols: number; rows: number }, colors: boolean, now: Date = new Date(),
): string[] {
  const S = sty(colors);
  const cols = Math.max(60, size.cols);
  const rows = Math.max(12, size.rows);
  const sessions = deriveSessions(m.records);
  const disp = displayRecords(m, ui);
  const open = resolveJournal(m.records).open.length;

  const follow = ui.follow ? S.grn("following ▶") : S.yel("paused ⏸ (G resumes)");
  const l1 = ` ${S.bold("journal — the live stream")}  ${m.records.length} entr${m.records.length === 1 ? "y" : "ies"}`
    + ` · ${sessions.length} stream(s)`
    + (open ? ` · ${S.mag(`${open} OPEN conjecture(s)`)}` : "")
    + (m.unreadable ? ` · ${S.red(`${m.unreadable} unreadable line(s)`)}` : "")
    + `  ${S.dim("|")}  ${follow}`;
  const active = ui.stream === null ? null : sessions.find((s) => s.id === ui.stream);
  // The conjectures list is unscoped (see `openConjectures`), so its second line says
  // what the list IS rather than repeating a stream scope it deliberately ignores.
  const l2 = ui.view === "conjectures"
    ? ` ${S.dim("open conjectures — raised, not yet resolved or dismissed · every stream · newest first")}`
    : ui.stream === null
      ? ` ${S.dim("stream: ALL — every session interleaved, newest first")}`
      : ` stream: ${S.bold(ui.stream)}  ${active ? `${active.agent} · job ${active.job} · ${active.branch ?? "-"} · started ${humanAge(active.started, now)} ago` : S.dim("(no entries yet)")}`;
  const sep = S.dim("─".repeat(cols));

  const bodyH = Math.max(1, rows - 2 /*header*/ - 2 /*seps*/ - 1 /*keybar*/);
  let windowed: string[];
  let more = "";
  if (ui.view === "streams") {
    const body = sessions.length || m.records.length
      ? streamsBody(m, sessionsByRecency(m.records), ui, S, cols)
      : [S.dim(" (nothing logged yet)")];
    // One-line rows: keep the selection inside the window, sliding only at the edges.
    ui.sScroll = Math.max(0, Math.min(ui.sScroll, ui.sCursor));
    if (ui.sCursor >= ui.sScroll + bodyH) ui.sScroll = ui.sCursor - bodyH + 1;
    windowed = body.slice(ui.sScroll, ui.sScroll + bodyH);
    if (body.length > ui.sScroll + bodyH) more = S.dim(` ↓ ${body.length - ui.sScroll - bodyH} more`);
  } else if (ui.view === "entry") {
    // The drill-in resolves its record against the list that OPENED it — cursor indexes
    // are meaningless across lists, and `back` already remembers which one ⏎ came from —
    // unless a reference is being followed, in which case the trail's tip id wins.
    const r = shownEntry(m, ui);
    const dangling = ui.refTrail.length && !r ? ui.refTrail[ui.refTrail.length - 1] : null;
    const body = r ? entryDetail(r, cols).map((l) => ` ${l}`)
      : [S.dim(dangling ? ` (no entry ${dangling} in this journal — the pointer is dangling)` : " (no entry selected)")];
    const from = Math.min(ui.entryScroll, Math.max(0, body.length - 1));
    windowed = body.slice(from, from + bodyH);
    if (body.length > from + bodyH) more = S.dim(` ↓ ${body.length - from - bodyH} more`);
  } else if (ui.view === "conjectures") {
    const opens = openConjectures(m);
    if (!opens.length) {
      // The zero state is a STATEMENT, not an empty screen — reaching this view past a
      // masthead that stopped announcing a count deserves the answer in words.
      windowed = [S.dim(" (no open conjectures — every question raised has been resolved or dismissed)")];
      ui.cCursor = 0; ui.cScroll = 0;
    } else {
      ui.cCursor = Math.min(ui.cCursor, opens.length - 1); // a resolution can shrink the list under the cursor
      // Same cells as the timeline, plus the hint line that makes this view worth
      // having: the discriminator FIRST (the actionable field — the one thing `clip`
      // must not eat), then the candidates it would separate.
      const cells = opens.map((r, i) => timelineCell(r, S, cols, i === ui.cCursor,
        [r.discriminatedBy ? `discriminated by: ${r.discriminatedBy}` : null,
         r.couldBe?.length ? `could be: ${r.couldBe.join(" · ")}` : null,
        ].filter(Boolean).join("   ") || undefined));
      const win = windowCells(cells, ui.cCursor, ui.cScroll, bodyH, S);
      ui.cScroll = win.scroll; windowed = win.lines; more = win.more;
    }
  } else if (!disp.length) {
    windowed = [S.dim(" (nothing logged yet — entries appear here the moment an agent writes one)")];
    ui.scroll = 0;
  } else {
    // The timeline windows by whole CELLS, not lines: a card sliced through its middle
    // reads as damage. The scroll anchor moves only when the selected cell would leave
    // the window — up past the top pulls it back, growth past the bottom pushes it down
    // one cell at a time — so arrowing inside the window never shifts the page.
    const cells = disp.map((r, i) => timelineCell(r, S, cols, i === ui.cursor));
    const win = windowCells(cells, ui.cursor, ui.scroll, bodyH, S);
    ui.scroll = win.scroll; windowed = win.lines; more = win.more;
  }
  while (windowed.length < bodyH) windowed.push("");
  if (more) windowed[windowed.length - 1] = more;

  // The follow hint appears only when ⏎ would actually go somewhere: the shown entry
  // carries a pointer AND the target resolves. A dangling pointer earns no invitation.
  const followTarget = ui.view === "entry" ? shownEntry(m, ui)?.supersedes : undefined;
  const followable = followTarget && m.records.some((r) => r.id === followTarget) ? followTarget : null;
  const keys = ui.view === "timeline"
    ? `[↑↓] surf [⏎] entry [s]treams [c]onjectures [f] follow [G] latest ${ui.stream === null ? "" : "[esc] all "}[q]uit`
    : ui.view === "streams"
      ? `[↑↓] move [⏎] open stream [esc] back [q]uit`
      : ui.view === "conjectures"
        ? `[↑↓] move [⏎] entry [esc] back [q]uit`
        : `[↑↓] scroll ${followable ? `[⏎] open ${followable} ` : ""}[esc] back [q]uit`;
  return [l1, l2, sep, ...windowed, sep, S.dim(` ${keys}`)];
}

// ── the loop: snapshot, line-mode follow, or the interactive surf ──────────────────

export interface JournalOpts {
  follow?: boolean; once?: boolean;
  job?: string | null; agent?: string | null; session?: string | null; branch?: string | null;
}

/** Summary + every scoped line, chronological — what a pipe or a `--once` gets. */
function snapshotLines(m: StreamModel, scope: JournalScope): string[] {
  const sessions = deriveSessions(m.records);
  const filters = [scope.job && `job ${scope.job}`, scope.agent && `agent ${scope.agent}`,
    scope.session && `session ${scope.session}`, scope.branch && `branch ${scope.branch}`].filter(Boolean).join(" · ");
  const L = [`journal — ${m.records.length} entr${m.records.length === 1 ? "y" : "ies"} across ${sessions.length} stream(s)`
    + (filters ? ` (${filters})` : "")
    + (m.unreadable ? `  WARNING: ${m.unreadable} unreadable line(s) — skipped, not repaired` : ""), ""];
  L.push(...m.records.map(formatEntryLine));
  if (!m.records.length) L.push("(nothing logged)");
  return L;
}

/**
 * `coherence journal` — three modes, chosen by where stdout points:
 *   · a TTY: the interactive surf (live timeline · streams picker · open-conjectures
 *     list · entry drill-in).
 *   · a pipe, or `--once`: a chronological snapshot, then exit — which is also what
 *     keeps this command safe to run bare in any harness that executes every verb.
 *   · `--follow`: line-mode tail for a pipe or a dumb terminal — print the scoped
 *     history, then each new record as it lands, until SIGINT.
 */
export async function runJournal(cfg: Config, opts: JournalOpts = {}): Promise<number> {
  const scope: JournalScope = { job: opts.job, agent: opts.agent, session: opts.session, branch: opts.branch };
  const state = newTailState();
  const model: StreamModel = { records: [], unreadable: 0 };
  const pull = (): DecisionRecord[] => {
    const { fresh, unreadable } = tailJournal(cfg, state);
    model.unreadable += unreadable;
    const scoped = fresh.filter((r) => inScope(r, scope));
    if (scoped.length) { model.records.push(...scoped); model.records.sort(timelineOrder); }
    return scoped;
  };
  pull();

  const tty = !!process.stdout.isTTY && !!process.stdin.isTTY;
  if (opts.once || (!opts.follow && !tty)) {
    for (const line of snapshotLines(model, scope)) console.log(line);
    return 0;
  }

  // The wake-up seam both live modes share. fs.watch on the journal directory is the
  // fast path; a 1s interval is the floor under it — it re-arms the watcher when the
  // directory appears (a fresh repo has no `.coherence/decisions/` until the first
  // write, and there is nothing to watch before then) and re-pulls on platforms where
  // directory events are unreliable. The interval does the same pull the watcher does,
  // so a missed event costs latency, never a record.
  let watcher: FSWatcher | null = null;
  let deb: ReturnType<typeof setTimeout> | null = null;
  const dir = decisionsDir(cfg);
  const arm = (onChange: () => void) => {
    if (watcher || !existsSync(dir)) return;
    try {
      watcher = watch(dir, () => {
        if (deb) clearTimeout(deb);
        deb = setTimeout(onChange, 50); // one pull per burst of events, not one per byte
      });
    } catch { /* the interval carries it */ }
  };
  const disarm = () => { watcher?.close(); watcher = null; if (deb) clearTimeout(deb); };

  if (opts.follow) {
    // Line mode: history first, then the live tail. stdout is the whole interface.
    for (const line of snapshotLines(model, scope)) console.log(line);
    return new Promise<number>((res) => {
      const emit = () => { for (const r of pull()) console.log(formatEntryLine(r)); };
      arm(emit);
      const tick = setInterval(() => { arm(emit); emit(); }, 1000);
      const quit = () => { clearInterval(tick); disarm(); res(0); };
      process.on("SIGINT", quit);
      process.on("SIGTERM", quit);
    });
  }

  // The interactive surf. Same terminal contract as the panel: alternate screen,
  // hidden cursor, raw keypresses, and a pure frame the loop only repaints.
  const ui = initialStreamUI();
  if (opts.session) ui.stream = opts.session; // an explicit --session opens ON that stream
  const size = () => ({ cols: process.stdout.columns ?? 100, rows: process.stdout.rows ?? 32 });
  const draw = () => {
    const lines = renderStreamFrame(model, ui, size(), true);
    process.stdout.write("\x1b[H" + lines.map((l) => l + "\x1b[K").join("\n") + "\x1b[J");
  };
  const last = () => Math.max(0, visibleRecords(model, ui).length - 1);
  const toTip = () => { ui.cursor = 0; ui.scroll = 0; ui.follow = true; }; // newest-first: the tip IS row 0
  const onChange = () => {
    // Arrivals PREPEND (newest-first), which shifts every display index — so the
    // selection is remembered as the RECORD it sits on, not the row number it held.
    // Following at the tip: the new entry lands under the cursor, which is the point.
    // Surfing history (or reading a drill-in): the cursor is re-found by identity, so
    // the view never yanks mid-read.
    const held = displayRecords(model, ui)[ui.cursor];
    const heldOpen = openConjectures(model)[ui.cCursor];
    const fresh = pull();
    if (!fresh.length) return;
    if (ui.follow && ui.view === "timeline") { ui.cursor = 0; ui.scroll = 0; }
    else if (held) {
      const i = displayRecords(model, ui).indexOf(held); // same object: pull() merges, never copies
      if (i >= 0) ui.cursor = i;
    }
    if (heldOpen) {
      // Same identity discipline for the open list: an arrival can prepend a fresh
      // conjecture OR resolve one out from above the cursor, and either shifts every
      // display index. `resolve` hands back the model's own records, so the selection
      // is re-found as the record it sat on; one that just got answered is simply gone,
      // and the render's clamp lands the cursor on a neighbor.
      const i = openConjectures(model).indexOf(heldOpen);
      if (i >= 0) ui.cCursor = i;
    }
    draw();
  };
  arm(onChange);
  const tick = setInterval(() => { arm(onChange); onChange(); }, 1000);

  process.stdout.write("\x1b[?1049h\x1b[?25l");
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise<number>((resolve) => {
    const quit = () => {
      clearInterval(tick); disarm();
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\x1b[?25h\x1b[?1049l");
      resolve(0);
    };
    process.on("SIGTERM", quit);
    process.stdout.on("resize", draw);
    process.stdin.on("keypress", (_ch: string, key: { name?: string; ctrl?: boolean; shift?: boolean } = {}) => {
      const k = key.name ?? "";
      if (k === "q" || (key.ctrl && k === "c")) return quit();
      if (ui.view === "timeline") {
        // Surfing IS pausing: the tip is row 0 now, so DOWN walks into history and
        // unpins, and walking back UP to row 0 re-pins on its own — the operator who
        // returns to the top is asking to follow again. `G`/end jumps straight there.
        if (k === "down" || k === "j") { ui.cursor = Math.min(last(), ui.cursor + 1); ui.follow = false; }
        else if (k === "up" || k === "k") { ui.cursor = Math.max(0, ui.cursor - 1); ui.follow = ui.cursor === 0; }
        else if ((k === "g" && key.shift) || k === "end" || k === "home") toTip();
        else if (k === "f") { ui.follow = !ui.follow; if (ui.follow) toTip(); }
        else if (k === "return" || k === "right") { if (visibleRecords(model, ui).length) { ui.view = "entry"; ui.back = "timeline"; ui.entryScroll = 0; ui.refTrail = []; } }
        else if (k === "s" || k === "tab") { ui.view = "streams"; ui.sCursor = 0; ui.sScroll = 0; }
        else if (k === "c" || k === "o") { ui.view = "conjectures"; ui.cCursor = 0; ui.cScroll = 0; }
        else if (k === "escape" && ui.stream !== null) { ui.stream = null; toTip(); }
      } else if (ui.view === "streams") {
        const maxS = deriveSessions(model.records).length; // rows: ALL + sessions
        if (k === "down" || k === "j") ui.sCursor = Math.min(maxS, ui.sCursor + 1);
        else if (k === "up" || k === "k") ui.sCursor = Math.max(0, ui.sCursor - 1);
        else if (k === "return" || k === "right") {
          // The same recency order the picker DREW — sCursor must mean the row it sat on.
          const sessions = sessionsByRecency(model.records);
          ui.stream = ui.sCursor === 0 ? null : sessions[ui.sCursor - 1]?.id ?? null;
          ui.view = "timeline"; toTip();
        } else if (k === "escape") ui.view = "timeline";
      } else if (ui.view === "conjectures") {
        const maxC = Math.max(0, openConjectures(model).length - 1);
        if (k === "down" || k === "j") ui.cCursor = Math.min(maxC, ui.cCursor + 1);
        else if (k === "up" || k === "k") ui.cCursor = Math.max(0, ui.cCursor - 1);
        else if (k === "return" || k === "right") { if (openConjectures(model).length) { ui.view = "entry"; ui.back = "conjectures"; ui.entryScroll = 0; ui.refTrail = []; } }
        else if (k === "escape") ui.view = "timeline";
      } else if (ui.view === "entry") {
        // ⏎ follows the shown entry's `supersedes` pointer when the target exists —
        // hops push onto refTrail so a chain of retractions reads like a paper trail.
        // Esc walks back the way ⏎ came in, one hop at a time: first back down the
        // trail, then to the list that opened the drill-in — the open list returns to
        // the open list, mid-scan position intact, not to the timeline.
        if (k === "return" || k === "right") {
          const target = shownEntry(model, ui)?.supersedes;
          if (target && model.records.some((r) => r.id === target)) { ui.refTrail.push(target); ui.entryScroll = 0; }
          else { ui.view = ui.back; ui.refTrail = []; }
        }
        else if (k === "escape" || k === "left" || k === "backspace") {
          if (ui.refTrail.length) { ui.refTrail.pop(); ui.entryScroll = 0; }
          else ui.view = ui.back;
        }
        else if (k === "down" || k === "j") ui.entryScroll++;
        else if (k === "up" || k === "k") ui.entryScroll = Math.max(0, ui.entryScroll - 1);
      }
      draw();
    });
    draw();
  });
}
