/**
 * The work verbs: one command, five subcommands, each an appended record or a read.
 *
 *   work create "<objective>" --success "<criterion>" --boundary "<files>" [--owner-session <id>]
 *   work move <id> <open|active|waiting|cancelled> --because "<why>"
 *   work close <id> --because "<what was done>"
 *   work owner <id> --owner-session <id> --because "<why>"
 *   work inspect [<id>]
 *
 * Every write takes --session and --agent. An order grants nothing
 * and refuses nothing: anyone may move it or change its owner, and the record
 * says who did. Content is what a reader wants: the objective, the
 * observable success criterion, the boundary, and everything the owner
 * session wrote while it held the order.
 */

import { loadRuns, type RunRecord } from "../enforcement/record.ts";
import { JournalError, onePositional, parseFlags, required } from "./args.ts";
import { GLYPH, isWorkState, subjectOf, type JournalRecord, type WorkCompletion, type WorkOrderRecord, type WorkOwner, type WorkMove } from "./record.ts";
import { loadJournal } from "./store.ts";
import { attribution, head, withCommon, type Context, type Written } from "./verbs.ts";
import { WORK_DIR, appendWork, isTerminal, loadOrders, type WorkOrder } from "./work.ts";

/** What a work verb prints on success; the first line starts with the record id. */
export interface WorkWritten {
  lines: string[];
}

function orderOrRefuse(cwd: string, id: string, verb: string): WorkOrder {
  const found = loadOrders(cwd).find((order) => order.id === id);
  if (found === undefined) throw new JournalError(`work ${verb}: no work order with id ${id}`);
  return found;
}

function refuseTerminal(order: WorkOrder, verb: string): void {
  if (isTerminal(order.state)) throw new JournalError(`work ${verb}: ${order.id} is ${order.state}; a closed or cancelled order does not move`);
}

function create(argv: string[], ctx: Context): WorkWritten {
  const parsed = parseFlags(argv, withCommon({ success: "one", boundary: "one", "owner-session": "one" }));
  const who = attribution(parsed);
  if (who.work !== undefined) throw new JournalError("work create: --work names a journal record's order, not a new order's");
  const objective = onePositional(parsed, "objective");
  const success = required(parsed, "success", "an order names the observable criterion that completes it");
  const boundary = required(parsed, "boundary", "an order names the folders or files its owner may write");
  const owner = parsed.one.get("owner-session") ?? who.session;
  const record: WorkOrderRecord = { ...head("order", who, ctx, objective), objective, success, boundary, owner };
  appendWork(ctx.cwd, record);
  return {
    lines: [
      `${record.id}  work order recorded in ${WORK_DIR}/${record.session}.jsonl; owner ${owner}; state open`,
      `  nothing binds to it until its owner activates it: work move ${record.id} active --because "<taking it up>" --session ${owner} --agent <name>`,
    ],
  };
}

function move(argv: string[], ctx: Context): WorkWritten {
  const parsed = parseFlags(argv, withCommon({ because: "one" }));
  const who = attribution(parsed);
  const [id, state, ...rest] = parsed.positionals;
  if (id === undefined || state === undefined) throw new JournalError("work move takes <id> <state>");
  if (rest.length > 0) throw new JournalError(`work move: unexpected argument "${rest[0]}"`);
  if (!isWorkState(state)) throw new JournalError(`work move: "${state}" is not open, active, waiting, or cancelled`);
  if (state === "completed") throw new JournalError(`work move: completed is what close records; run: work close ${id} --because "<what was done>"`);
  const because = required(parsed, "because", "a move records why the order moved");
  const order = orderOrRefuse(ctx.cwd, id, "move");
  refuseTerminal(order, "move");
  if (order.state === state) throw new JournalError(`work move: ${id} is already ${state}`);
  const record: WorkMove = { ...head("move", who, ctx, `${id}\n${state}\n${because}`), of: id, state, because };
  appendWork(ctx.cwd, record);
  return { lines: [`${record.id}  ${id} ${order.state} -> ${state} recorded in ${WORK_DIR}/${record.session}.jsonl`] };
}

function close(argv: string[], ctx: Context): WorkWritten {
  const parsed = parseFlags(argv, withCommon({ because: "one" }));
  const who = attribution(parsed);
  const id = onePositional(parsed, "work order id");
  const because = required(parsed, "because", "a close records what was done against the success criterion");
  const order = orderOrRefuse(ctx.cwd, id, "close");
  refuseTerminal(order, "close");
  const record: WorkCompletion = { ...head("completion", who, ctx, `${id}\n${because}`), of: id, state: "completed", because };
  appendWork(ctx.cwd, record);
  return { lines: [`${record.id}  ${id} ${order.state} -> completed recorded in ${WORK_DIR}/${record.session}.jsonl`] };
}

function owner(argv: string[], ctx: Context): WorkWritten {
  const parsed = parseFlags(argv, withCommon({ "owner-session": "one", because: "one" }));
  const who = attribution(parsed);
  const id = onePositional(parsed, "work order id");
  const next = required(parsed, "owner-session", "the session that owns the order from here");
  const because = required(parsed, "because", "an owner change records why");
  const order = orderOrRefuse(ctx.cwd, id, "owner");
  refuseTerminal(order, "owner");
  if (order.owner === next) throw new JournalError(`work owner: ${id} is already owned by ${next}`);
  const record: WorkOwner = { ...head("owner", who, ctx, `${id}\n${next}\n${because}`), of: id, owner: next, because };
  appendWork(ctx.cwd, record);
  return { lines: [`${record.id}  ${id} owner ${order.owner} -> ${next} recorded in ${WORK_DIR}/${record.session}.jsonl`] };
}

function stamp(at: string): string {
  return `${at.slice(0, 10)} ${at.slice(11, 16)}`;
}

/** One order with everything bound to it: its history, the journal records, the runs. */
export function renderOrder(order: WorkOrder, journal: readonly JournalRecord[], runs: readonly RunRecord[]): string[] {
  const lines = [
    `${order.id}  ${order.state}  owner ${order.owner}`,
    `  objective: ${order.objective}`,
    `  success:   ${order.success}`,
    `  boundary:  ${order.boundary}`,
    `  created ${stamp(order.at)} by ${order.agent} (${order.session})`,
  ];
  for (const event of order.history) {
    const what = event.kind === "owner" ? `owner -> ${event.owner}` : `-> ${event.state}`;
    lines.push(`  ${stamp(event.at)} ${event.id}  ${what}  ${event.agent}: ${event.because}`);
  }
  const bound = journal.filter((record) => record.work === order.id);
  lines.push(`  journal records bound: ${bound.length}`);
  for (const record of bound) lines.push(`    ${stamp(record.at)} ${GLYPH[record.kind]} ${record.id}  ${record.agent}  ${subjectOf(record)}`);
  const boundRuns = runs.filter((run) => (run as RunRecord & { work?: string }).work === order.id);
  lines.push(`  runs bound: ${boundRuns.length}`);
  for (const run of boundRuns) {
    const fails = run.invariants.filter((e) => e.verdict === "fail").length;
    lines.push(`    ${stamp(run.at)} run by ${run.agent}: ${run.invariants.length} enforcements, ${fails} fail, at ${run.commit ?? "no commit"}`);
  }
  return lines;
}

function inspect(argv: string[], ctx: Context): WorkWritten {
  const parsed = parseFlags(argv, {});
  const [id, ...rest] = parsed.positionals;
  if (rest.length > 0) throw new JournalError(`work inspect: unexpected argument "${rest[0]}"`);
  const orders = loadOrders(ctx.cwd);
  if (id === undefined) {
    if (orders.length === 0) return { lines: ["no work orders"] };
    return { lines: orders.map((order) => `${order.id}  ${order.state.padEnd(9)}  ${order.owner}  ${order.objective}`) };
  }
  const order = orders.find((o) => o.id === id);
  if (order === undefined) throw new JournalError(`work inspect: no work order with id ${id}`);
  return { lines: renderOrder(order, loadJournal(ctx.cwd).records, loadRuns(ctx.cwd).records) };
}

export function work(argv: string[], ctx: Context): Written | WorkWritten {
  const [sub, ...rest] = argv;
  switch (sub) {
    case "create":
      return create(rest, ctx);
    case "move":
      return move(rest, ctx);
    case "close":
      return close(rest, ctx);
    case "owner":
      return owner(rest, ctx);
    case "inspect":
      return inspect(rest, ctx);
    default:
      throw new JournalError('work takes "create", "move", "close", "owner", or "inspect"');
  }
}

export const WORK_USAGE = [
  "work orders (writes need --session <id> --agent <name>; binding to journal writes and runs is inferred from sole active ownership):",
  '  work create "<objective>" --success "<observable criterion>" --boundary "<folders or files the owner may write>" [--owner-session <id>]',
  '  work move <id> <open|active|waiting|cancelled> --because "<why>"',
  '  work close <id> --because "<what was done>"',
  '  work owner <id> --owner-session <id> --because "<why>"',
  "  work inspect [<id>]",
].join("\n");
