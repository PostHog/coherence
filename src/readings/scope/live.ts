/**
 * The live Scope reading, as the warm server answers it over HTTP.
 *
 * The server's guard (admitHttp in the warm server) has already checked the
 * Host, the method, the origin and the token before a request reaches here;
 * this file answers only GET and HEAD, and only these paths:
 *
 *   /                the fixed shell: its bytes depend on no project content
 *   /api/state       the first load: the windowed state, its version, and where history starts
 *   /api/events      the event stream: catch-up from the page's cursors, then every update
 *   /api/journal     older journal records by cursor (before=<at>~<id>), or matching a search (q=)
 *   /api/runs        older run records by cursor (before=<at>~<session>)
 *   /api/record      one journal record by id, for a citation the page has not loaded
 *   /api/sites       every reference site of one chokepoint entry (run=<at>~<session>, component, name), where the first load counted some
 *   /api/relief/files    the files of components and districts the relief read (folder=, repeated), which the first load counts and does not list
 *   /api/relief/commits  the commits the Structure view's diff can name: the branch's own, then the trunk's recent line
 *   /api/relief/diff     the paths that changed between two commits, or a commit and the working tree (a=, b=), with lines added and deleted
 *
 * The state is loaded once through scopeState, whole, on a worker thread
 * (apart.ts), and kept current: the journal, runs and work folders are
 * watched, and an append is read back from its store and sent as the records
 * that are new (by id, or a run's time and session); a spec, a practice file,
 * a lexicon or the config changing (whatever the spec model reads by name)
 * reads the model again on a worker, apart from the update chain, one rebuild
 * at a time with at most one more queued behind it, while every route and
 * every store's push answers from the state held; each rebuild lands on the
 * chain as one quick step that keeps the records the chain read, and is sent
 * as a snapshot with a new version. The relief is read apart from that
 * chain, in a worker, when the state first loads, when the model changes and
 * when git moves HEAD or a ref (a commit, a checkout, a fetch); one reading
 * runs at a time, with at most one more queued behind it, and each that lands
 * is sent as a snapshot of its own with a new version, so no refresh or
 * history answer waits on it and a page that loaded before it lands is sent
 * it on the stream. The component interfaces are read on a worker too, which
 * asks its questions of the server's own instrument here (or, for a Python
 * adoption the config bounds, a bounded server the reading keeps for itself),
 * when the reading is first asked for and again when a run lands, never on
 * every file save, within the same budget as a snapshot's; each reading moves
 * the version, so a page that opens its stream after it landed is sent it.
 *
 * A page resumes from cursors derived from what it holds. The catch-up sends
 * every record at or after a little before each cursor, since a writer whose
 * clock read earlier can append after a later record; the page merges by
 * key, so the overlap is held once and nothing is lost.
 *
 * Node-only; the browser bundle never imports it.
 */

import { realpathSync, watch, type FSWatcher } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { TRACES_DIR, tracesDir } from "../../economy/trace.ts";
import type { HttpApp, HttpAppFactory, HttpContext } from "../../enforcement/server.ts";
import { loadRuns } from "../../enforcement/record.ts";
import { loadJournal } from "../../journal/store.ts";
import { REVISION, TraceTail, WORKTREE, folderName, gitRecords, movesRelief, readReliefApart, reliefCommits, reliefDiff, type GitRecords, type ReliefRead, type ReliefReading } from "../relief/relief.ts";
import { foldOrders, loadWork as loadWorkRecords } from "../../journal/work.ts";
import { STORE_NAMES, storeOfPath, type RecordStore } from "../../journal/stores.ts";
import { FROM_SOURCES, SOURCE_FOLDER, buildShell, forgetPageBundle, isPageSource, rootOptions, windowState, type BuildOptions, type Shell } from "./build.ts";
import { interfaceAdapter, interfaceBounds, readingAdapters } from "./component-interfaces.ts";
import { readInterfacesApart, scopeStateApart } from "./apart.ts";
import type { LanguageAdapter } from "../../adapters/adapter.ts";
import { isLanguage, type Language } from "../../adapters/index.ts";
import { readByModel } from "../../spec/model.ts";
import { DEFAULT_PROJECT_LEXICON, projectLexiconPath } from "../../lifecycle/project.ts";
import { JOURNAL_WINDOW, RUN_WINDOW } from "./derive.ts";
import type { InterfaceReading, JournalRecord, RunRecord, ShellState, WorkOrder } from "./model.ts";
import { runKeyOf } from "./updates.ts";

/** How far before a page's cursor the catch-up reaches, for a writer whose clock read earlier but appended later. */
export const CATCH_UP_SLACK_MS = 60_000;
/** How often an open stream carries a keepalive, which also keeps the warm server from idling out under a watched page. */
const KEEPALIVE_MS = 15_000;
/** The most records one history answer carries. */
const HISTORY_LIMIT = 500;

export interface LiveOptions {
  /** Read the component interfaces through the instrument (default true); a test turns it off. */
  interfaces?: boolean;
  /** How long a burst of changes to one store settles before it is read (default 100 ms). */
  debounceMs?: number;
  /** Build options beyond the root's defaults (Coherence's lexicon, the project's name). */
  build?: Partial<BuildOptions>;
  /** How the component interfaces are read (default on a worker thread that asks the instrument here, when `interfaces` is not false); a test gives its own reading. */
  interfaceReading?: (root: string) => Promise<InterfaceReading>;
  /** How the whole state is read (default scopeState on a worker thread, scopeStateApart); a test holds a rebuild to see the live routes answer meanwhile. */
  load?: (options: BuildOptions) => Promise<ShellState>;
}

/** A record store, or the model: the specs, the config and the lexicons. */
type Store = RecordStore | "model";

interface Cursor {
  at: string;
  key: string;
}

function parseCursor(text: string | null): Cursor | undefined {
  if (text === null) return undefined;
  if (text === "") return { at: "", key: "" };
  const tilde = text.indexOf("~");
  return tilde === -1 ? { at: text, key: "" } : { at: text.slice(0, tilde), key: text.slice(tilde + 1) };
}

/** The cursor moved back by the slack, so the catch-up also carries what a slower writer appended late. */
function withSlack(cursor: Cursor): string {
  if (cursor.at === "") return "";
  const time = Date.parse(cursor.at);
  return Number.isNaN(time) ? "" : new Date(time - CATCH_UP_SLACK_MS).toISOString();
}

function before(at: string, key: string, cursor: Cursor): boolean {
  return at < cursor.at || (at === cursor.at && key < cursor.key);
}

function json(response: ServerResponse, request: IncomingMessage, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  response.end(request.method === "HEAD" ? undefined : body);
}

/** Which store a changed path belongs to, or undefined when it is nothing the reading shows. */
export function storeOf(path: string, lexicons: readonly string[]): Store | undefined {
  const name = path.split(sep).join("/");
  const store = storeOfPath(name);
  if (store !== undefined) return store;
  if (name.startsWith(".git/") || name.startsWith(".coherence/") || name.startsWith("node_modules/") || name.includes("/node_modules/")) return undefined;
  // The spec model's own test of what it reads, so a kind of file it begins to read refreshes the reading with it.
  if (readByModel(name) || lexicons.includes(name)) return "model";
  return undefined;
}

/**
 * The lexicons a reading of `root` loads, as paths inside it: Coherence's own
 * when it lies there, the domain lexicon given or located as the state's load
 * locates it (the config's lexicon key, else the default name), and the
 * default name, so one written later is noticed. A config that will not parse
 * locates nothing here; the config itself is watched, and its reload says why.
 */
export async function watchedLexicons(root: string, build: Pick<BuildOptions, "lexiconPath" | "domainPath">): Promise<string[]> {
  let located: string | undefined;
  try {
    located = build.domainPath ?? (await projectLexiconPath(root));
  } catch {
    located = undefined;
  }
  const inside = [build.lexiconPath, located, DEFAULT_PROJECT_LEXICON].filter((p): p is string => p !== undefined).map((p) => relative(root, resolve(root, p)).split(sep).join("/"));
  return [...new Set(inside.filter((p) => !p.startsWith("..")))];
}

/**
 * The page the server serves, kept through a broken edit: a rebuild after a
 * page source changes replaces it only when it succeeds, so a save that does
 * not build (a syntax error mid-edit) leaves open pages on the last good page
 * instead of reloading them into an error. A build that fails is never kept,
 * so the next request or change tries again. Builds run one at a time, since
 * the bundler is one process each build stops.
 */
export class PageShell {
  private good: Shell | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private failed: string | undefined;
  private readonly make: () => Promise<Shell>;
  private readonly forget: () => void;
  private readonly log: (line: string) => void;

  constructor(make: () => Promise<Shell>, forget: () => void, log: (line: string) => void) {
    this.make = make;
    this.forget = forget;
    this.log = log;
  }

  private queued<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** The last good page, or a first build of it; a first build that fails is answered as an error and tried again next time. */
  current(): Promise<Shell> {
    if (this.good !== undefined) return Promise.resolve(this.good);
    return this.queued(async () => (this.good ??= await this.make()));
  }

  /** Build the page again from its sources; true when the new page replaced the old, which is when open pages should reload. */
  rebuild(): Promise<boolean> {
    const generation = ++this.generation;
    return this.queued(async () => {
      // A later change is queued behind this one and will build the newer sources.
      if (generation !== this.generation) return false;
      this.forget();
      try {
        this.good = await this.make();
        this.failed = undefined;
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Said once per failure, not once per save of the same broken file.
        if (message !== this.failed) this.log(`scope: the page did not build, so open pages keep the last one: ${message}`);
        this.failed = message;
        return false;
      }
    });
  }
}

/** How often agent activity is sent at most, while an agent keeps reading and writing. */
const TOUCH_MS = 120;

/**
 * A call to `fire` made at most once per `ms`: the first call in a quiet spell
 * runs at once, and calls while one is due fold into it; a call after a run
 * is due `ms` after it, so a steady stream runs on that beat and the last
 * call is never dropped.
 */
export function throttle(fire: () => void, ms: number): { call(): void; cancel(): void } {
  let due: NodeJS.Timeout | undefined;
  let last = -Infinity;
  return {
    call() {
      if (due !== undefined) return;
      due = setTimeout(() => {
        due = undefined;
        last = Date.now();
        fire();
      }, Math.max(0, last + ms - Date.now()));
      due.unref();
    },
    cancel() {
      clearTimeout(due);
      due = undefined;
    },
  };
}

class LiveReading implements HttpApp {
  private readonly root: string;
  private readonly options: LiveOptions;
  private readonly context: HttpContext;
  private readonly build: BuildOptions;
  private readonly shell: PageShell;
  private loading: Promise<ShellState> | undefined;
  private base: ShellState | undefined;
  private version = 0;
  private readonly epoch = `${Date.now().toString(36)}-${process.pid}`;
  private journalIds = new Set<string>();
  private runKeys = new Set<string>();
  private workIds = new Set<string>();
  private interfaces: InterfaceReading;
  /** What Structure draws beyond the spec, read when the state loads and again when the model changes. */
  private relief: ReliefReading = { kind: "unread", because: "the warm server has not read it yet" };
  /** The relief's files by folder, as the files route sends them: read with the relief, never in the first load. */
  private reliefFiles: ReadonlyMap<string, string> = new Map();
  private reading: Promise<void> | undefined;
  private readAgain = false;
  /** The reading's own bounded server, when the shared instrument reads a whole workspace the reading never draws. */
  private readingServer: { adapter: LanguageAdapter; bounds: string } | undefined;
  private readonly clients = new Set<ServerResponse>();
  private readonly watchers: FSWatcher[] = [];
  /** The lexicons the state loaded, located again with every reload, so a config that names another is followed. */
  private lexicons: string[] = [];
  private readonly timers = new Map<Store, NodeJS.Timeout>();
  private chain: Promise<void> = Promise.resolve();
  private closed = false;
  /** Aborted by close: a relief reading under way stops, and its worker and git with it. */
  private readonly stopping = new AbortController();
  /** A relief reading under way, and whether a change since it began wants one more. */
  private reliefRunning: Promise<void> | undefined;
  private reliefAgain = false;
  /** A commit, checkout or fetch settling before the relief is read again: git rewrites several refs for one. */
  private reliefTimer: NodeJS.Timeout | undefined;
  /** Where git records what moves the relief, located when the watch starts; undefined outside a repository. */
  private git: GitRecords | undefined;
  /** A model rebuild under way, and whether a change since it began wants one more. */
  private rebuilding: Promise<void> | undefined;
  private rebuildAgain = false;

  constructor(context: HttpContext, options: LiveOptions) {
    this.context = context;
    this.root = context.root;
    this.options = options;
    this.build = { ...rootOptions(context.root), ...options.build, root: context.root };
    this.shell = new PageShell(buildShell, forgetPageBundle, (line) => context.log(line));
    this.interfaces =
      options.interfaces === false
        ? { kind: "unread", because: "this live reading was started without the instrument" }
        : { kind: "unread", because: "the warm server is reading the component interfaces; the map redraws when it is done" };
    this.traces = new TraceTail(tracesDir(context.root));
  }

  private get versionId(): string {
    return `${this.epoch}.${this.version}`;
  }

  /** The state, loaded once and kept current by the watchers from then on. */
  private ensure(): Promise<ShellState> {
    this.loading ??= (async () => {
      const state = await this.stateWithRelief();
      this.base = state;
      this.remember(state);
      this.lexicons = await watchedLexicons(this.root, this.build);
      // Closed during the first read: nothing is watched and nothing more is read.
      if (this.closed) return state;
      this.git = await gitRecords(this.root);
      if (this.closed) return state;
      this.watch();
      // What the stores gained while the state loaded, before anything watched them, is read once now: a refresh that finds nothing new sends nothing.
      for (const store of STORE_NAMES) this.changed(store);
      this.readInterfaces();
      return state;
    })();
    return this.loading;
  }

  /** The whole state, unwindowed, with the interfaces held now: read on a worker thread, which a close ends. */
  private load(): Promise<ShellState> {
    const options: BuildOptions = { ...this.build, window: false, componentInterfaces: this.interfaces };
    return this.options.load === undefined ? scopeStateApart(options, this.stopping.signal) : this.options.load(options);
  }

  /** The whole state with the relief read beside it, for the first load: the relief and the state each read in a worker of their own. */
  private async stateWithRelief(): Promise<ShellState> {
    const relief = readReliefApart(this.root, this.stopping.signal);
    const state = await this.load();
    const read = await relief;
    this.relief = read.reading;
    this.reliefFiles = read.files;
    state.relief = read.reading;
    return state;
  }

  /**
   * Read the relief again, in a worker thread and git's child processes, so the
   * server keeps answering hooks and pages meanwhile; it never runs on the
   * update chain. One reading at a time: a change while one runs, which it may
   * have begun before, asks for one more after it, and any number of changes
   * meanwhile ask for that same one.
   */
  private rereadRelief(): void {
    if (this.closed) return;
    if (this.reliefRunning !== undefined) {
      this.reliefAgain = true;
      return;
    }
    this.reliefRunning = (async () => {
      do {
        this.reliefAgain = false;
        const read = await readReliefApart(this.root, this.stopping.signal);
        if (this.closed) return;
        // Landed on the chain, so it never interleaves with a refresh replacing the state it lands in; landing is quick.
        this.chain = this.chain.then(() => this.landRelief(read)).catch((error: unknown) => this.context.log(`scope: the relief did not land: ${error instanceof Error ? error.message : String(error)}`));
      } while (this.reliefAgain && !this.closed);
    })().finally(() => {
      this.reliefRunning = undefined;
    });
  }

  /**
   * A relief reading that landed: held for the state and the files route, and
   * sent as a snapshot with a new version when it differs from the one held.
   * A page that loaded the state before it landed holds the older version, so
   * its stream opens with this snapshot; one already streaming is sent it now.
   */
  private landRelief(read: ReliefRead): void {
    if (this.closed || this.base === undefined) return;
    const held = this.relief;
    this.relief = read.reading;
    this.reliefFiles = read.files;
    this.base.relief = read.reading;
    const same = held.kind === "read" && read.reading.kind === "read" ? held.stamp === read.reading.stamp : JSON.stringify(held) === JSON.stringify(read.reading);
    if (same) return;
    this.version += 1;
    this.send("snapshot", { state: windowState(this.base), version: this.versionId });
  }

  /** Git moved HEAD or a ref: the landings and heights are read again once the commit, checkout or fetch settles. */
  private gitMoved(): void {
    if (this.closed) return;
    clearTimeout(this.reliefTimer);
    this.reliefTimer = setTimeout(() => {
      this.reliefTimer = undefined;
      this.rereadRelief();
    }, Math.max(300, this.options.debounceMs ?? 100));
  }

  private remember(state: ShellState): void {
    this.journalIds = new Set(state.journal.records.map((record) => record.id));
    this.runKeys = new Set(state.runs.records.map(runKeyOf));
    this.workIds = new Set(state.journal.work.kind === "present" ? state.journal.work.orders.flatMap((order) => [order.id, ...order.history.map((h) => h.id)]) : []);
  }

  /** How far each read trace has been sent: a trace line is a touch once, and the traces before the server started are history, not activity. */
  private readonly traces: TraceTail;
  /** A look at the traces, throttled rather than settled: a busy agent appends without pause, and its touches must light as they happen. */
  private readonly traced = throttle(() => this.lookAtTraces(), TOUCH_MS);

  /**
   * Agent activity, live: the lines appended to the traces the watcher named
   * since the last look, each file a session read or wrote, sent as one touch
   * event for the Structure view to light. Nothing is stored, and with no page
   * connected nothing is read: a page that connects later sees only what
   * happens from then on.
   */
  private lookAtTraces(): void {
    if (this.clients.size === 0) return;
    const touches = this.traces.look();
    if (touches.length > 0) this.send("touch", { touches });
  }

  /** A trace changed, by its path below the traces folder, or some trace when the watcher named none: looked at on the beat while a page is connected. */
  private traceChanged(name: string | undefined): void {
    this.traces.note(name);
    if (this.clients.size > 0) this.traced.call();
  }

  private watch(): void {
    // Every trace as it stands now is history: only what is appended from here on is sent as activity.
    this.traces.start();
    const traces = TRACES_DIR.split(sep).join("/") + "/";
    // Real paths, as git names its folders: a root reached through a link (a temporary folder on macOS) is matched by where it lies.
    let realRoot = this.root;
    try {
      realRoot = realpathSync(this.root);
    } catch {
      // the root's own spelling
    }
    const git = this.git;
    // A worktree's git folders, and a root inside a repository, lie outside the root: watched where they are.
    const outside = (folder: string): boolean => {
      const path = relative(realRoot, folder);
      return path.startsWith("..") || isAbsolute(path);
    };
    if (git !== undefined) {
      const folders: [folder: string, recursive: boolean][] = [
        [dirname(git.head), false],
        [dirname(git.packed), false],
        [git.refs, true],
      ];
      for (const [folder, recursive] of folders.filter(([folder], i, all) => outside(folder) && all.findIndex(([other]) => other === folder) === i)) {
        try {
          const watcher = watch(folder, { recursive }, (_event, name) => {
            if (name === null || movesRelief(git, join(folder, String(name)))) this.gitMoved();
          });
          watcher.on("error", () => {});
          this.watchers.push(watcher);
        } catch {
          // Unwatchable: the relief is read again when the model changes.
        }
      }
    }
    try {
      const watcher = watch(this.root, { recursive: true }, (_event, name) => {
        if (name === null) return this.traceChanged(undefined);
        const path = String(name).split(sep).join("/");
        if (path.startsWith(traces)) return this.traceChanged(path.slice(traces.length));
        if (git !== undefined && movesRelief(git, join(realRoot, String(name)))) return this.gitMoved();
        const store = storeOf(String(name), this.lexicons);
        if (store !== undefined) this.changed(store);
      });
      watcher.on("error", (error) => this.context.log(`scope: the watch on ${this.root} failed: ${error.message}`));
      this.watchers.push(watcher);
    } catch (error) {
      this.context.log(`scope: could not watch ${this.root}: ${error instanceof Error ? error.message : String(error)}`);
    }
    // In a checkout the page is bundled from sources that can change under this server: a change to one rebuilds the page and reloads it.
    if (FROM_SOURCES) {
      let pending: NodeJS.Timeout | undefined;
      try {
        const watcher = watch(SOURCE_FOLDER, { recursive: true }, (_event, name) => {
          // Only a file the page is built from rebuilds it: a server-side edit leaves open pages, and what they show, alone.
          if (name === null || !isPageSource(resolve(SOURCE_FOLDER, String(name)))) return;
          clearTimeout(pending);
          // Open pages reload only onto a page that built; a broken save leaves them where they are.
          pending = setTimeout(() => {
            void this.shell.rebuild().then((replaced) => {
              if (replaced && !this.closed) this.send("shell", {});
            });
          }, 300);
          pending.unref();
        });
        watcher.on("error", () => {});
        this.watchers.push(watcher);
      } catch {
        // Unwatchable: the page is rebuilt when the server restarts.
      }
    }
    // Coherence's own lexicon lives outside a root that is another project.
    const own = resolve(this.build.lexiconPath);
    if (relative(this.root, own).startsWith("..")) {
      try {
        const watcher = watch(dirname(own), (_event, name) => {
          if (name !== null && String(name) === basename(own)) this.changed("model");
        });
        watcher.on("error", () => {});
        this.watchers.push(watcher);
      } catch {
        // Unwatchable: the lexicon still loads with every model change in the root.
      }
    }
  }

  /** A burst of changes to one store settles, then the store is read once. */
  private changed(store: Store): void {
    if (this.closed) return;
    const pending = this.timers.get(store);
    if (pending !== undefined) clearTimeout(pending);
    this.timers.set(
      store,
      setTimeout(() => {
        this.timers.delete(store);
        if (store === "model") return this.rebuildModel();
        this.chain = this.chain.then(() => this.refresh(store)).catch((error: unknown) => this.context.log(`scope: ${store} refresh failed: ${error instanceof Error ? error.message : String(error)}`));
      }, store === "model" ? Math.max(300, this.options.debounceMs ?? 100) : (this.options.debounceMs ?? 100)),
    );
  }

  /**
   * Read the model again apart from the update chain, so every live route and
   * every store's push answers from the state held while it reads (on a large
   * project, a minute and more). One rebuild at a time: a change while one
   * runs asks for one more after it, and any number of changes meanwhile ask
   * for that same one. Each rebuild lands on the chain as one quick step.
   */
  private rebuildModel(): void {
    if (this.closed) return;
    // The relief reads apart and lands as its own snapshot, whichever finishes first.
    this.rereadRelief();
    if (this.rebuilding !== undefined) {
      this.rebuildAgain = true;
      return;
    }
    this.rebuilding = (async () => {
      do {
        this.rebuildAgain = false;
        try {
          const state = await this.load();
          const lexicons = await watchedLexicons(this.root, this.build);
          if (this.closed) return;
          this.chain = this.chain.then(() => this.landModel(state, lexicons)).catch((error: unknown) => this.context.log(`scope: the model did not land: ${error instanceof Error ? error.message : String(error)}`));
        } catch (error) {
          if (!this.closed) this.context.log(`scope: model refresh failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      } while (this.rebuildAgain && !this.closed);
    })().finally(() => {
      this.rebuilding = undefined;
    });
  }

  /**
   * A rebuilt model, landing: it replaces the model held and is sent as a
   * snapshot with a new version. The stores are the chain's alone: the journal,
   * runs and work kept are the ones the store refreshes read and sent, never
   * the rebuild's own read of them, so a record appended while it read reaches
   * a page once, as an append, and none the chain sent is dropped. The relief
   * and the interfaces are the ones held now, which may have landed after the
   * rebuild began.
   */
  private landModel(state: ShellState, lexicons: string[]): void {
    if (this.closed || this.base === undefined) return;
    state.journal = this.base.journal;
    state.runs = this.base.runs;
    state.relief = this.relief;
    state.componentInterfaces = this.interfaces;
    this.base = state;
    this.lexicons = lexicons;
    this.version += 1;
    this.send("snapshot", { state: windowState(state), version: this.versionId });
  }

  /** Read one record store again and send what is new. Serialized, so two refreshes never interleave. */
  private async refresh(store: RecordStore): Promise<void> {
    const base = this.base;
    if (base === undefined || this.closed) return;
    if (store === "journal") {
      const loaded = loadJournal(this.root);
      const fresh = loaded.records.filter((record) => !this.journalIds.has(record.id));
      for (const record of fresh) this.journalIds.add(record.id);
      const damagedChanged = JSON.stringify(loaded.damaged) !== JSON.stringify(base.journal.damaged);
      base.journal = { ...base.journal, records: loaded.records, damaged: loaded.damaged };
      if (fresh.length > 0 || damagedChanged) this.send("journal", { records: fresh, damaged: loaded.damaged });
    } else if (store === "runs") {
      const loaded = loadRuns(this.root);
      const fresh = loaded.records.filter((run) => !this.runKeys.has(runKeyOf(run)));
      for (const run of fresh) this.runKeys.add(runKeyOf(run));
      const damagedChanged = JSON.stringify(loaded.damaged) !== JSON.stringify(base.runs.damaged);
      base.runs = { ...base.runs, records: loaded.records, damaged: loaded.damaged };
      if (fresh.length > 0 || damagedChanged) this.send("runs", { records: fresh, damaged: loaded.damaged });
      // Structure refreshes when a run lands, not on every save.
      if (fresh.length > 0) this.readInterfaces();
    } else if (store === "work") {
      const loaded = loadWorkRecords(this.root);
      const fresh = new Set(loaded.records.filter((record) => !this.workIds.has(record.id)).map((record) => record.id));
      for (const id of fresh) this.workIds.add(id);
      const orders = foldOrders(loaded);
      base.journal = { ...base.journal, work: { kind: "present", orders, damaged: loaded.damaged } };
      const changed = orders.filter((order) => fresh.has(order.id) || order.history.some((h) => fresh.has(h.id)));
      if (changed.length > 0) this.send("work", { orders: changed, damaged: loaded.damaged });
    } else {
      // A store the table names and no branch above reads fails to compile here, never refreshes silently.
      const unread: never = store;
      throw new Error(`no refresh reads the ${String(unread)} store`);
    }
  }

  /** Read the component interfaces through the server's instrument; one reading at a time, once more if a run landed meanwhile. */
  private readInterfaces(): void {
    if (this.options.interfaces === false || this.closed) return;
    if (this.reading !== undefined) {
      this.readAgain = true;
      return;
    }
    this.reading = (async () => {
      do {
        this.readAgain = false;
        try {
          const reading = await (this.options.interfaceReading ?? ((root) => this.readApart(root)))(this.root);
          if (this.closed) return;
          this.interfaces = reading;
          if (this.base !== undefined) this.base.componentInterfaces = reading;
          // A new version: a page that loaded the state before the reading landed and opens its stream after is sent a snapshot holding it.
          this.version += 1;
          this.send("interfaces", { interfaces: reading, version: this.versionId });
        } catch (error) {
          if (!this.closed) this.context.log(`scope: reading the component interfaces failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      } while (this.readAgain && !this.closed);
    })().finally(() => {
      this.reading = undefined;
    });
  }

  /**
   * The component interfaces, read on a worker thread and kept for the hooks,
   * with every question for a language server asked here: the instrument's own
   * language of the server's instrument, or the reading's own bounded server;
   * any other language of a server of its own, started when the reading first
   * asks it and closed when the reading moves to the next, as the reading in
   * process starts and closes it.
   */
  private async readApart(root: string): Promise<InterfaceReading> {
    const shared = await this.interfaceServer();
    await shared.forget([]);
    let other: { language: Language; servers: ReturnType<typeof readingAdapters> } | undefined;
    const closing: Promise<void>[] = [];
    const adapterOf = (language: Language): LanguageAdapter => {
      // A question that arrives after the close starts no server the close would never end.
      if (this.closed) throw new Error("the live reading closed");
      if (language === shared.language) return shared;
      if (other?.language !== language) {
        if (other !== undefined) closing.push(other.servers.close());
        other = { language, servers: readingAdapters(root) };
      }
      return other.servers.of(language)!;
    };
    try {
      // The same reading, bounds and budget (the config's) as a snapshot's: the refresh on a run is never a second rule.
      return await readInterfacesApart(root, adapterOf, this.stopping.signal);
    } finally {
      if (other !== undefined) closing.push(other.servers.close());
      await Promise.allSettled(closing);
    }
  }

  /**
   * The server the interface reading asks: a bounded one of its own, kept warm
   * across refreshes and rebuilt when the config's bounds change, when the
   * shared instrument would read a whole workspace the reading never draws;
   * otherwise the shared instrument.
   */
  private async interfaceServer(): Promise<LanguageAdapter> {
    if (this.readingServer !== undefined && this.readingServer.bounds !== interfaceBounds(this.root)) {
      await this.readingServer.adapter.close();
      this.readingServer = undefined;
    }
    // Closed meanwhile: no server is started that the close would never end.
    if (this.closed) throw new Error("the live reading closed");
    const language = this.context.adapter.language;
    this.readingServer ??= isLanguage(language) ? interfaceAdapter(this.root, language) : undefined;
    return this.readingServer?.adapter ?? this.context.adapter;
  }

  private send(event: string, data: unknown): void {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) client.write(frame);
  }

  /** Where paging back starts: the oldest record of the latest window, when the first load leaves older records out. */
  private historyHint(state: ShellState): { journal?: string; runs?: string } {
    const journal = state.journal.records;
    const runs = state.runs.records;
    const hint: { journal?: string; runs?: string } = {};
    const j = journal[journal.length - JOURNAL_WINDOW];
    if (journal.length > JOURNAL_WINDOW && j !== undefined) hint.journal = `${j.at}~${j.id}`;
    const r = runs[runs.length - RUN_WINDOW];
    if (runs.length > RUN_WINDOW && r !== undefined) hint.runs = `${r.at}~${r.session}`;
    return hint;
  }

  async handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    switch (url.pathname) {
      case "/": {
        const shell = await this.shell.current();
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-length": Buffer.byteLength(shell.html),
          // The one inline script by its hash, styles inline, the font as data, and requests to this server alone.
          "content-security-policy": `default-src 'none'; script-src '${shell.scriptHash}'; style-src 'unsafe-inline'; font-src data:; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
        });
        response.end(request.method === "HEAD" ? undefined : shell.html);
        return;
      }
      case "/api/state": {
        const state = await this.ensure();
        await this.chain;
        json(response, request, 200, { state: windowState(this.base ?? state), version: this.versionId, history: this.historyHint(this.base ?? state) });
        return;
      }
      case "/api/events":
        return this.events(request, response, url);
      case "/api/journal": {
        await this.ensure();
        await this.chain;
        const cursor = parseCursor(url.searchParams.get("before"));
        const query = (url.searchParams.get("q") ?? "").trim().toLowerCase();
        const limit = Math.min(HISTORY_LIMIT, Math.max(1, Number(url.searchParams.get("limit") ?? 100) || 100));
        const matching = this.base!.journal.records.filter(
          (record) => (cursor === undefined || cursor.at === "" || before(record.at, record.id, cursor)) && (query === "" || JSON.stringify(record).toLowerCase().includes(query)),
        );
        const page = matching.slice(-limit);
        json(response, request, 200, { records: page, more: matching.length > page.length });
        return;
      }
      case "/api/runs": {
        await this.ensure();
        await this.chain;
        const cursor = parseCursor(url.searchParams.get("before"));
        const limit = Math.min(HISTORY_LIMIT, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
        const matching = this.base!.runs.records.filter((run) => cursor === undefined || cursor.at === "" || before(run.at, run.session, cursor));
        const page = matching.slice(-limit);
        json(response, request, 200, { records: page, more: matching.length > page.length });
        return;
      }
      case "/api/sites": {
        // Every reference site of one chokepoint entry, by its run (at~session) and enforcement: what the first load counted and did not list.
        await this.ensure();
        await this.chain;
        const run = url.searchParams.get("run") ?? "";
        const component = url.searchParams.get("component") ?? "";
        const name = url.searchParams.get("name") ?? "";
        const entry = this.base!.runs.records.find((r) => runKeyOf(r) === run)?.invariants.find((e) => e.component === component && e.name === name && e.form === "chokepoint");
        if (entry?.sites === undefined) json(response, request, 404, { reason: `no chokepoint entry ${component}/${name} with sites in the run ${run}` });
        else json(response, request, 200, { sites: entry.sites });
        return;
      }
      case "/api/record": {
        await this.ensure();
        await this.chain;
        const id = url.searchParams.get("id") ?? "";
        const record = this.base!.journal.records.find((r) => r.id === id);
        if (record === undefined) json(response, request, 404, { records: [], more: false, reason: `no journal record ${id}` });
        else json(response, request, 200, { records: [record], more: false });
        return;
      }
      case "/api/relief/commits": {
        // The commits the Structure view's diff can name, from git, read-only.
        try {
          json(response, request, 200, await reliefCommits(this.root));
        } catch (error) {
          json(response, request, 404, { reason: `no commits to diff: ${(error as Error).message.split("\n")[0]}` });
        }
        return;
      }
      case "/api/relief/diff": {
        // What changed between two commits, or a commit and the working tree; both names are checked before git sees them.
        const a = url.searchParams.get("a") ?? "", b = url.searchParams.get("b") ?? "";
        if (!REVISION.test(a) || !(REVISION.test(b) || b === WORKTREE)) {
          json(response, request, 400, { reason: "a and b must be commit ids (b may be WORKTREE)" });
          return;
        }
        try {
          json(response, request, 200, await reliefDiff(this.root, a, b));
        } catch (error) {
          json(response, request, 404, { reason: `no diff between ${a} and ${b}: ${(error as Error).message.split("\n")[0]}` });
        }
        return;
      }
      case "/api/relief/files": {
        // The files of the folders asked for, each one the relief read: a name of any other shape is refused before the state loads,
        // and one the reading does not hold is refused by lookup. The texts were made when the relief was read, so nothing here reads a file.
        const folders = [...new Set(url.searchParams.getAll("folder"))];
        const odd = folders.find((folder) => !folderName(folder));
        if (folders.length === 0 || odd !== undefined) {
          json(response, request, 400, { reason: odd === undefined ? "name one folder or more (folder=)" : `${JSON.stringify(odd)} is no folder name` });
          return;
        }
        await this.ensure();
        await this.chain;
        const relief = this.relief, files = this.reliefFiles;
        const unknown = folders.find((folder) => !files.has(folder));
        if (relief.kind !== "read" || unknown !== undefined) {
          json(response, request, 404, { reason: relief.kind !== "read" ? `the relief is not read: ${relief.because}` : `the relief holds no folder ${JSON.stringify(unknown)}` });
          return;
        }
        // Each folder's text goes out as it was made, never parsed again: on a large project they are megabytes.
        const body = `{"stamp":${JSON.stringify(relief.stamp)},"folders":{${folders.map((folder) => `${JSON.stringify(folder)}:${files.get(folder)!}`).join(",")}}}`;
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
        response.end(request.method === "HEAD" ? undefined : body);
        return;
      }
      default:
        json(response, request, 404, { reason: "no such path" });
    }
  }

  /**
   * The event stream: a snapshot first when the page's version is not the
   * current one, then every journal record, run and work record at or after
   * a little before each cursor the page sent, then `ready`, then every
   * update as it happens. Registered in the same turn as the catch-up is
   * read, so no update falls between them.
   */
  private async events(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    await this.ensure();
    await this.chain;
    const base = this.base!;
    response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", connection: "keep-alive" });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    const write = (event: string, data: unknown): void => {
      response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    if (url.searchParams.get("version") !== this.versionId) write("snapshot", { state: windowState(base), version: this.versionId });
    const journal = parseCursor(url.searchParams.get("journal"));
    if (journal !== undefined) {
      const from = withSlack(journal);
      const records: JournalRecord[] = base.journal.records.filter((record) => record.at >= from);
      if (records.length > 0) write("journal", { records, damaged: base.journal.damaged });
    }
    const runs = parseCursor(url.searchParams.get("runs"));
    if (runs !== undefined) {
      const from = withSlack(runs);
      const records: RunRecord[] = base.runs.records.filter((run) => run.at >= from);
      if (records.length > 0) write("runs", { records, damaged: base.runs.damaged });
    }
    const work = parseCursor(url.searchParams.get("work"));
    if (work !== undefined && base.journal.work.kind === "present") {
      const from = withSlack(work);
      const orders: WorkOrder[] = base.journal.work.orders.filter((order) => order.at >= from || order.history.some((h) => h.at >= from));
      if (orders.length > 0) write("work", { orders, damaged: base.journal.work.damaged });
    }
    write("ready", { version: this.versionId });
    // The first page since none was connected: what the traces gained meanwhile was never read, and is history to it.
    if (this.clients.size === 0) this.traces.skip();
    this.clients.add(response);
    this.context.keepAlive();
    const beat = setInterval(() => {
      response.write(": keepalive\n\n");
      this.context.keepAlive();
    }, KEEPALIVE_MS);
    const end = (): void => {
      clearInterval(beat);
      this.clients.delete(response);
    };
    request.on("close", end);
    response.on("close", end);
  }

  /**
   * Final: no watcher, timer, worker or git started before the close outlives
   * it. A first load under way finds the reading closed and watches nothing;
   * a relief reading is stopped, and the close returns once the first load,
   * a model rebuild, the update chain, the interface reading and the relief's
   * worker have all ended.
   */
  async close(): Promise<void> {
    this.closed = true;
    this.stopping.abort();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    clearTimeout(this.reliefTimer);
    for (const watcher of this.watchers) watcher.close();
    this.watchers.length = 0;
    this.traced.cancel();
    for (const client of this.clients) client.end();
    this.clients.clear();
    // The reading's own server ends first, so an interface reading under way stops asking and ends with it.
    const server = this.readingServer?.adapter.close();
    this.readingServer = undefined;
    await Promise.allSettled([server, this.loading, this.rebuilding, this.chain, this.reliefRunning, this.reading]);
  }
}

/** The live Scope reading as an app the warm server answers over HTTP. */
export function scopeApp(options: LiveOptions = {}): HttpAppFactory {
  return (context) => new LiveReading(context, options);
}

