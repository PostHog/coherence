/**
 * The journal verbs: each one turns a command line into one appended record.
 *
 * A verb that points at an earlier record (retract, resolved, dismiss,
 * experiment close, acknowledge) reads the journal first and refuses an id it
 * cannot find or a target of the wrong kind; it never edits the target. A verb
 * that writes a new subject (decide, conjecture, defect, experiment create,
 * unable, escalate) needs nothing but its own fields and the attribution every
 * write requires.
 */

import { JournalError, onePositional, parseFlags, required, type FlagShape, type Parsed } from "./args.ts";
import {
  INSTRUMENT_IS_WRONG,
  deriveOutcome,
  pointsAt,
  recordId,
  type Acknowledgement,
  type Attribution,
  type Close,
  type Conjecture,
  type Decision,
  type Defect,
  type Escalation,
  type Experiment,
  type JournalRecord,
  type Kind,
  type Resolution,
  type Retraction,
  type Stamp,
  type Step,
  type StepResult,
  type Unable,
  type Dismissal,
  type WorkKind,
} from "./record.ts";
import { JOURNAL_DIR, appendRecord, gitState, loadJournal, type Loaded } from "./store.ts";
import { describeBinding } from "./work.ts";

export interface Context {
  cwd: string;
  now: () => Date;
}

export interface Written {
  record: JournalRecord;
  /** What the verb prints on success; the first line starts with the new id. */
  lines: string[];
}

/** Every verb takes attribution; --work names the work order when the inferred binding is not wanted. */
const COMMON: Record<string, FlagShape> = { session: "one", agent: "one", work: "one" };

export function withCommon(spec: Record<string, FlagShape>): Record<string, FlagShape> {
  return { ...COMMON, ...spec };
}

export function attribution(parsed: Parsed): Attribution {
  const session = required(parsed, "session", "every record binds through its session");
  const agent = required(parsed, "agent", "every record names the agent that wrote it");
  const work = parsed.one.get("work");
  return work === undefined ? { session, agent } : { session, agent, work };
}

/**
 * The head every record shares, in the journal and in the work store. The id
 * hashes session, time, and the record's text; this is the one site that
 * mints one.
 */
export function head<K extends Kind | WorkKind>(kind: K, who: Attribution, ctx: Context, text: string): Stamp<K> & { work?: string } {
  const at = ctx.now().toISOString();
  const { commit, dirty } = gitState(ctx.cwd);
  return { id: recordId(kind, who.session, at, text), kind, at, ...who, commit, dirty };
}

function write(ctx: Context, record: JournalRecord, extra: string[] = []): Written {
  const written = appendRecord(ctx.cwd, record);
  return {
    record: written,
    lines: [
      `${written.id}  ${written.kind} recorded in ${JOURNAL_DIR}/${written.session}.jsonl`,
      `  ${describeBinding({ binding: written.binding ?? "none: unsettled", ...(written.work === undefined ? {} : { work: written.work }) })}`,
      ...extra,
    ],
  };
}

/** The record an id names, refused when absent or of another kind. */
function target<K extends Kind>(loaded: Loaded, id: string, kind: K | null, verb: string): JournalRecord & { kind: K } {
  const found = loaded.records.find((record) => record.id === id);
  if (found === undefined) throw new JournalError(`${verb}: no record with id ${id}`);
  if (kind !== null && found.kind !== kind) {
    throw new JournalError(`${verb}: ${id} is a ${found.kind}, not a ${kind}`);
  }
  return found as JournalRecord & { kind: K };
}

/** Records that already point at an id, so a second resolution or close is refused. */
function pointers(loaded: Loaded, id: string): JournalRecord[] {
  return loaded.records.filter((record) => pointsAt(record) === id);
}

function refuseIfAnswered(loaded: Loaded, id: string, verb: string, kinds: readonly Kind[]): void {
  const prior = pointers(loaded, id).find((record) => kinds.includes(record.kind));
  if (prior !== undefined) {
    throw new JournalError(`${verb}: ${id} was already answered by ${prior.id} (${prior.kind})`);
  }
}

export function decide(argv: string[], ctx: Context): Written {
  const parsed = parseFlags(argv, withCommon({ over: "many", because: "one" }));
  const who = attribution(parsed);
  const chose = onePositional(parsed, "what was chosen");
  const because = required(parsed, "because", "a decision records why");
  const given = parsed.many.get("over") ?? [];
  let over: string[] | "none";
  if (given.length === 0) {
    over = [];
  } else if (given.some((value) => value.trim().toLowerCase() === "none")) {
    if (given.length > 1) throw new JournalError("--over none cannot be combined with a rejected alternative");
    over = "none";
  } else {
    over = given;
  }
  const record: Decision = { ...head("decision", who, ctx, chose), chose, over, because };
  return write(ctx, record);
}

export function retract(argv: string[], ctx: Context): Written {
  const parsed = parseFlags(argv, withCommon({ because: "one" }));
  const who = attribution(parsed);
  const of = onePositional(parsed, "the id to retract");
  const because = required(parsed, "because", "a retraction records what refuted the record");
  const loaded = loadJournal(ctx.cwd);
  const found = target(loaded, of, null, "retract");
  if (found.kind === "retraction") throw new JournalError(`retract: ${of} is itself a retraction`);
  refuseIfAnswered(loaded, of, "retract", ["retraction"]);
  const record: Retraction = { ...head("retraction", who, ctx, `${of}\n${because}`), of, because };
  return write(ctx, record);
}

export function conjecture(argv: string[], ctx: Context): Written {
  const parsed = parseFlags(argv, withCommon({ "could-be": "many", "discriminated-by": "one" }));
  const who = attribution(parsed);
  const observation = onePositional(parsed, "the observation");
  const discriminatedBy = required(parsed, "discriminated-by", "a conjecture names the test that separates its candidates");
  const named = parsed.many.get("could-be") ?? [];
  const hasInstrument = named.some((value) => value.trim().toLowerCase() === INSTRUMENT_IS_WRONG);
  const couldBe = hasInstrument ? named : [INSTRUMENT_IS_WRONG, ...named];
  const record: Conjecture = {
    ...head("conjecture", who, ctx, observation),
    observation,
    couldBe,
    discriminatedBy,
  };
  return write(ctx, record);
}

export function resolved(argv: string[], ctx: Context): Written {
  const parsed = parseFlags(argv, withCommon({ because: "one", as: "one" }));
  const who = attribution(parsed);
  const of = onePositional(parsed, "the conjecture id");
  const because = required(parsed, "because", "a resolution records what the test showed");
  const loaded = loadJournal(ctx.cwd);
  target(loaded, of, "conjecture", "resolved");
  refuseIfAnswered(loaded, of, "resolved", ["resolution", "dismissal"]);
  const as = parsed.one.get("as");
  const record: Resolution = {
    ...head("resolution", who, ctx, `${of}\n${because}`),
    of,
    because,
    ...(as === undefined ? {} : { as }),
  };
  return write(ctx, record);
}

export function dismiss(argv: string[], ctx: Context): Written {
  const parsed = parseFlags(argv, withCommon({ because: "one" }));
  const who = attribution(parsed);
  const of = onePositional(parsed, "the conjecture id");
  const because = required(parsed, "because", "a dismissal records why nobody will chase the conjecture");
  const loaded = loadJournal(ctx.cwd);
  target(loaded, of, "conjecture", "dismiss");
  refuseIfAnswered(loaded, of, "dismiss", ["resolution", "dismissal"]);
  const record: Dismissal = { ...head("dismissal", who, ctx, `${of}\n${because}`), of, because };
  return write(ctx, record);
}

export function defect(argv: string[], ctx: Context): Written {
  const parsed = parseFlags(argv, withCommon({ evidence: "one", file: "many" }));
  const who = attribution(parsed);
  const what = onePositional(parsed, "what failed");
  const evidence = required(parsed, "evidence", "a defect carries the reproducer or report that made it one");
  const files = parsed.many.get("file") ?? [];
  const record: Defect = { ...head("defect", who, ctx, what), what, evidence, files };
  return write(ctx, record);
}

export function experiment(argv: string[], ctx: Context): Written {
  const [sub, ...rest] = argv;
  if (sub === "create") return experimentCreate(rest, ctx);
  if (sub === "close") return experimentClose(rest, ctx);
  throw new JournalError('experiment takes "create" or "close"');
}

function experimentCreate(argv: string[], ctx: Context): Written {
  const parsed = parseFlags(argv, withCommon({ context: "many", action: "many", success: "many" }));
  const who = attribution(parsed);
  const expectation = onePositional(parsed, "the expectation");
  const context = parsed.many.get("context") ?? [];
  const actionTexts = parsed.many.get("action") ?? [];
  const successTexts = parsed.many.get("success") ?? [];
  if (actionTexts.length === 0) throw new JournalError("--action is required: an experiment plans at least one action");
  if (successTexts.length === 0) {
    throw new JournalError("--success is required: an experiment names at least one observable criterion");
  }
  const base = head("experiment", who, ctx, expectation);
  const steps = (prefix: string, texts: string[]): Step[] =>
    texts.map((text, index) => ({ id: `${base.id}.${prefix}${index + 1}`, text }));
  const record: Experiment = {
    ...base,
    expectation,
    context,
    actions: steps("a", actionTexts),
    criteria: steps("c", successTexts),
  };
  const ids = [...record.actions, ...record.criteria];
  const template = [
    `experiment close ${record.id} --session ${who.session} --agent ${who.agent}`,
    ...ids.map((step) => `  --result ${step.id}=<pass|fail|unknown>`),
  ].join(" \\\n");
  return write(ctx, record, [
    ...record.actions.map((step) => `  action    ${step.id}  ${step.text}`),
    ...record.criteria.map((step) => `  criterion ${step.id}  ${step.text}`),
    "close with:",
    template,
  ]);
}

const STEP_RESULTS: readonly StepResult[] = ["pass", "fail", "unknown"];

function experimentClose(argv: string[], ctx: Context): Written {
  const parsed = parseFlags(argv, withCommon({ result: "many" }));
  const who = attribution(parsed);
  const of = onePositional(parsed, "the experiment id");
  const loaded = loadJournal(ctx.cwd);
  const open = target(loaded, of, "experiment", "experiment close");
  refuseIfAnswered(loaded, of, "experiment close", ["close"]);
  const results: Record<string, StepResult> = {};
  for (const pair of parsed.many.get("result") ?? []) {
    const equals = pair.indexOf("=");
    if (equals === -1) throw new JournalError(`--result "${pair}" must be <id>=<pass|fail|unknown>`);
    const id = pair.slice(0, equals);
    const value = pair.slice(equals + 1);
    if (!STEP_RESULTS.includes(value as StepResult)) {
      throw new JournalError(`--result ${id}: "${value}" is not pass, fail, or unknown`);
    }
    if (Object.hasOwn(results, id)) throw new JournalError(`--result ${id} given twice`);
    results[id] = value as StepResult;
  }
  const expected = [...open.actions, ...open.criteria].map((step) => step.id);
  const missing = expected.filter((id) => !Object.hasOwn(results, id));
  if (missing.length > 0) {
    throw new JournalError(`experiment close: every action and criterion needs a result; missing ${missing.join(", ")}`);
  }
  const unknown = Object.keys(results).filter((id) => !expected.includes(id));
  if (unknown.length > 0) throw new JournalError(`experiment close: ${of} has no step ${unknown.join(", ")}`);
  const outcome = deriveOutcome(expected.map((id) => results[id] as StepResult));
  const record: Close = { ...head("close", who, ctx, of), of, results, outcome };
  return write(ctx, record, [`  outcome ${outcome}`]);
}

export function unable(argv: string[], ctx: Context): Written {
  const parsed = parseFlags(argv, withCommon({ because: "one" }));
  const who = attribution(parsed);
  const what = onePositional(parsed, "what you could not do");
  const because = required(parsed, "because", "unable names the wall");
  const record: Unable = { ...head("unable", who, ctx, what), what, because };
  return write(ctx, record);
}

export function escalate(argv: string[], ctx: Context): Written {
  const parsed = parseFlags(argv, withCommon({ because: "one" }));
  const who = attribution(parsed);
  const what = onePositional(parsed, "what a human must see");
  const because = required(parsed, "because", "an escalation records why a human");
  const record: Escalation = { ...head("escalation", who, ctx, what), what, because };
  return write(ctx, record, ["  this escalation heads every read until a human acknowledges it"]);
}

export function acknowledge(argv: string[], ctx: Context): Written {
  const parsed = parseFlags(argv, withCommon({ because: "one" }));
  const who = attribution(parsed);
  const of = onePositional(parsed, "the escalation id");
  const because = required(parsed, "because", "an acknowledgement records what the human decided");
  const loaded = loadJournal(ctx.cwd);
  target(loaded, of, "escalation", "acknowledge");
  refuseIfAnswered(loaded, of, "acknowledge", ["acknowledgement"]);
  const record: Acknowledgement = { ...head("acknowledgement", who, ctx, `${of}\n${because}`), of, because };
  return write(ctx, record);
}
