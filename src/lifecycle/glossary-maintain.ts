/** Preview first, apply atomically, then record the actual effect. An interrupted journal write is recoverable. */
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { decide } from "../journal/verbs.ts";
import { loadJournal, sessionFile } from "../journal/store.ts";
import { workBinding } from "../journal/work.ts";
import { digest, glossaryCoverage } from "./glossary-coverage.ts";
import { parseGlossary, rejectedNames } from "./glossary.ts";
import { isCoherenceItself, projectGlossaryPath } from "./project.ts";

export interface Who {
  session: string;
  agent: string;
  work?: string;
}
export interface Change {
  action: "declare" | "define" | "alias" | "reject" | "rename" | "retire";
  name: string;
  value?: string;
  definition?: string;
  entry?: Record<string, unknown>;
  because: string;
}
export interface Proposal {
  id: string;
  target: string;
  before: string;
  after: string;
  change: Change;
  humanRequired: boolean;
}
interface Transaction {
  proposal: Proposal;
  who: Who;
  because: string;
  over: string[];
  human?: string;
}
const STATE = ".coherence/glossary";

/** Confine even through existing symlinked parents; a configured glossary cannot write outside its project. */
export function confined(root: string, name: string): string {
  const path = resolve(root, name);
  const rel = relative(resolve(root), path);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith("../"))
    throw new Error("glossary path is outside the project root");
  let existing = path;
  while (!existsSync(existing)) existing = dirname(existing);
  const actual = relative(realpathSync(root), realpathSync(existing));
  if (isAbsolute(actual) || actual === ".." || actual.startsWith("../"))
    throw new Error("glossary path follows a link outside the project root");
  return path;
}
function atomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = path + "." + randomUUID() + ".tmp";
  try {
    writeFileSync(temp, text, { flag: "wx", mode: 0o600 });
    renameSync(temp, path);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}
function body(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}
function validate(value: Record<string, unknown>, path: string): void {
  const parsed = parseGlossary(value, path);
  const names = new Set<string>();
  for (const entry of value["concepts"] as Record<string, unknown>[]) {
    for (const key of [
      "aliases",
      "instances",
      "related",
      "not_to_be_confused_with",
    ])
      if (
        entry[key] !== undefined &&
        (!Array.isArray(entry[key]) ||
          (entry[key] as unknown[]).some((v) => typeof v !== "string"))
      )
        throw new Error(`${key} must be a list of strings`);
    if (
      entry["properties"] !== undefined &&
      (!entry["properties"] ||
        typeof entry["properties"] !== "object" ||
        Array.isArray(entry["properties"]))
    )
      throw new Error("properties must be an object");
  }
  for (const c of parsed.concepts) {
    if (!c.definition.trim())
      throw new Error(`a settled concept needs a definition: ${c.name}`);
    for (const n of [c.name, ...c.aliases, ...(c.instances ?? [])]) {
      const key = n.toLowerCase().trim();
      if (names.has(key))
        throw new Error(`ambiguous or duplicate glossary name: ${n}`);
      names.add(key);
    }
  }
  for (const rejected of rejectedNames(parsed))
    if (names.has(rejected.name.toLowerCase().trim()))
      throw new Error(
        `a name cannot be both accepted and rejected: ${rejected.name}`,
      );
}
export async function glossaryTarget(root: string): Promise<string> {
  return confined(
    root,
    (await projectGlossaryPath(root)) ??
      ((await isCoherenceItself(root))
        ? "docs/glossary.json"
        : "glossary.json"),
  );
}
export async function propose(root: string, change: Change): Promise<Proposal> {
  if (!change.name.trim() || !change.because.trim())
    throw new Error("a proposal needs a name and because");
  if (change.entry) {
    if (Array.isArray(change.entry) || typeof change.entry !== "object")
      throw new Error("entry must be an object");
    if (
      change.entry["name"] !== undefined &&
      change.entry["name"] !== change.name
    )
      throw new Error(
        "use an explicit rename proposal to change a concept's name",
      );
    if (
      [
        "uses",
        "contexts",
        "where",
        "file",
        "files",
        "code_addresses",
        "defined_in",
        "implementation_paths",
      ].some((k) => k in change.entry!)
    )
      throw new Error(
        "live usage/code addresses belong to the reading, not a glossary entry",
      );
  }
  const target = await glossaryTarget(root);
  const raw = body(target);
  const value = (
    raw
      ? JSON.parse(raw)
      : { version: 1, project: root.split("/").at(-1), concepts: [] }
  ) as Record<string, unknown>;
  if (!Array.isArray(value["concepts"]))
    throw new Error("glossary concepts must be a list");
  const concepts = value["concepts"] as Record<string, unknown>[];
  const existing = concepts.find(
    (c) => String(c["name"]).toLowerCase() === change.name.toLowerCase(),
  );
  if (change.action !== "declare" && !existing)
    throw new Error(`no concept named ${change.name}`);
  let acceptedRemoval = false;
  if (change.action === "declare") {
    if (existing) throw new Error(`concept already exists: ${change.name}`);
    concepts.push({
      ...change.entry,
      name: change.name,
      definition: change.definition ?? change.entry?.["definition"] ?? "",
    });
  } else if (change.action === "define") {
    const entry = change.entry ?? {};
    const merged = {
      ...existing,
      ...entry,
      name: change.name,
      definition:
        change.definition ?? entry["definition"] ?? existing!["definition"],
    };
    for (const key of ["detail", "provenance", "properties"])
      if (entry[key] !== undefined) {
        if (
          !entry[key] ||
          typeof entry[key] !== "object" ||
          Array.isArray(entry[key])
        )
          throw new Error(`${key} must be an object`);
        (merged as Record<string, unknown>)[key] = {
          ...((existing![key] as Record<string, unknown>) ?? {}),
          ...(entry[key] as Record<string, unknown>),
        };
      }
    for (const key of ["aliases", "instances", "rejected"])
      if (entry[key] !== undefined) {
        if (!Array.isArray(entry[key]))
          throw new Error(`${key} must be a list`);
        (merged as Record<string, unknown>)[key] = [
          ...new Map(
            [...((existing![key] as unknown[]) ?? []), ...entry[key]].map(
              (v) => [JSON.stringify(v), v],
            ),
          ).values(),
        ];
      }
    Object.assign(existing!, merged);
  } else if (change.action === "alias") {
    if (!change.value?.trim()) throw new Error("an alias needs a value");
    existing!["aliases"] = [
      ...((existing!["aliases"] as string[]) ?? []),
      change.value,
    ];
  } else if (change.action === "reject") {
    if (!change.value?.trim()) throw new Error("a rejected name needs a value");
    const owner = concepts.find((c) =>
      [
        c["name"],
        ...((c["aliases"] as string[]) ?? []),
        ...((c["instances"] as string[]) ?? []),
      ].some((n) => String(n).toLowerCase() === change.value!.toLowerCase()),
    );
    if (
      owner &&
      (owner !== existing ||
        String(owner["name"]).toLowerCase() === change.value.toLowerCase())
    )
      throw new Error(
        "use rename/retire for a concept, or reject the alias under its own concept",
      );
    if (owner) {
      acceptedRemoval = true;
      for (const key of ["aliases", "instances"])
        if (Array.isArray(existing![key]))
          existing![key] = existing![key].filter(
            (n) => String(n).toLowerCase() !== change.value!.toLowerCase(),
          );
    }
    existing!["rejected"] = [
      ...((existing!["rejected"] as unknown[]) ?? []),
      { alternative: change.value, because: change.because },
    ];
  } else if (change.action === "rename") {
    if (!change.value?.trim()) throw new Error("a rename needs a new name");
    existing!["name"] = change.value;
    existing!["rejected"] = [
      ...((existing!["rejected"] as unknown[]) ?? []),
      { alternative: change.name, because: change.because },
    ];
    for (const c of concepts)
      if (Array.isArray(c["related"]))
        c["related"] = c["related"].map((n) =>
          n === change.name ? change.value : n,
        );
  } else if (change.action === "retire") {
    concepts.splice(concepts.indexOf(existing!), 1);
    value["retired"] = [
      ...((value["retired"] as unknown[]) ?? []),
      { ...existing, because: change.because },
    ];
    value["rejected"] = [
      ...((value["rejected"] as unknown[]) ?? []),
      { alternative: change.name, because: change.because },
    ];
  }
  // Human-only actions are flagged at proposal time, not guessed from a success message after a write.
  const humanRequired =
    acceptedRemoval || ["rename", "retire"].includes(change.action);
  validate(value, target);
  const draft = {
    target: relative(root, target),
    before: digest(raw),
    after: JSON.stringify(value, null, 2) + "\n",
    change,
    humanRequired,
  };
  const proposal: Proposal = {
    id: "gp-" + digest(draft).slice(0, 24),
    ...draft,
  };
  const path = confined(root, `${STATE}/proposals/${proposal.id}.json`);
  atomic(path, JSON.stringify(proposal, null, 2) + "\n");
  return proposal;
}
function readProposal(root: string, id: string): Proposal {
  if (!/^gp-[a-f0-9]{24}$/.test(id))
    throw new Error("invalid glossary proposal id");
  const p = JSON.parse(
    readFileSync(confined(root, `${STATE}/proposals/${id}.json`), "utf8"),
  ) as Proposal;
  const { id: stored, ...draft } = p;
  if (stored !== id || "gp-" + digest(draft).slice(0, 24) !== id)
    throw new Error("proposal content was changed; prepare a new preview");
  return p;
}
function writingFlags(who: Who): string[] {
  if (!who.session || !who.agent)
    throw new Error("every glossary ruling needs --session and --agent");
  return [
    "--session",
    who.session,
    "--agent",
    who.agent,
    ...(who.work ? ["--work", who.work] : []),
  ];
}
function appliedDecision(root: string, id: string): string | undefined {
  return loadJournal(root).records.find(
    (r) => r.kind === "decision" && r.chose.startsWith(`glossary apply ${id} `),
  )?.id;
}
/** The same path finishes a fresh application and an interrupted one; it never overwrites concurrent edits. */
function finish(root: string, tx: Transaction): string {
  const target = confined(root, tx.proposal.target);
  const current = body(target);
  if (current !== tx.proposal.after) {
    if (digest(current) !== tx.proposal.before)
      throw new Error(
        "glossary changed since preview; pending application cannot overwrite it",
      );
    atomic(target, tx.proposal.after);
  }
  const existing = appliedDecision(root, tx.proposal.id);
  const id =
    existing ??
    decide(
      [
        `glossary apply ${tx.proposal.id} ${JSON.stringify({ change: tx.proposal.change, human: tx.human ?? null })}`,
        "--because",
        tx.because,
        ...tx.over.flatMap((s) => ["--over", s]),
        ...writingFlags(tx.who),
      ],
      { cwd: root, now: () => new Date() },
    ).record.id;
  unlinkSync(confined(root, `${STATE}/pending.json`));
  return id;
}
function locked<T>(root: string, run: () => T): T {
  const path = confined(root, `${STATE}/apply.lock`);
  mkdirSync(dirname(path), { recursive: true });
  let fd: number;
  try {
    fd = openSync(path, "wx");
  } catch {
    throw new Error(
      "another glossary apply/recover holds the lock; inspect it before removing a stale lock",
    );
  }
  try {
    return run();
  } finally {
    closeSync(fd);
    unlinkSync(path);
  }
}
export function applyProposal(
  root: string,
  id: string,
  who: Who,
  because: string,
  over: string[],
  human?: string,
): string {
  writingFlags(who);
  confined(root, sessionFile(root, who.session));
  workBinding(root, who.session, who.work);
  if (!because.trim() || !over.length || over.some((s) => !s.trim()))
    throw new Error(
      "a ruling needs --because and --over (use none when nothing was rejected)",
    );
  return locked(root, () => {
    const p = readProposal(root, id);
    if (p.humanRequired && !human?.trim())
      throw new Error(
        "rename/retire needs an explicit --human acknowledgement; no change applied",
      );
    if (existsSync(confined(root, `${STATE}/pending.json`)))
      throw new Error(
        "an application is pending: run glossary recover before another apply",
      );
    if (appliedDecision(root, id))
      throw new Error(
        "proposal already applied; prepare a new preview for further changes",
      );
    if (digest(body(confined(root, p.target))) !== p.before)
      throw new Error("glossary changed since preview; prepare a new proposal");
    const tx: Transaction = {
      proposal: p,
      who,
      because,
      over,
      ...(human ? { human } : {}),
    };
    atomic(confined(root, `${STATE}/pending.json`), JSON.stringify(tx));
    return finish(root, tx);
  });
}
export function recoverGlossary(root: string): string {
  return locked(root, () => {
    const path = confined(root, `${STATE}/pending.json`);
    if (!existsSync(path)) return "no pending glossary application";
    const tx = JSON.parse(readFileSync(path, "utf8")) as Transaction;
    const p = readProposal(root, tx.proposal.id);
    if (digest(p) !== digest(tx.proposal))
      throw new Error("pending proposal does not match its preview");
    writingFlags(tx.who);
    confined(root, sessionFile(root, tx.who.session));
    workBinding(root, tx.who.session, tx.who.work);
    return finish(root, tx);
  });
}
export async function reviewGlossary(
  root: string,
  term: string,
  component: string,
  evidence: string,
  disposition: string,
  who: Who,
  because: string,
  over: string[],
  human?: string,
): Promise<string> {
  writingFlags(who);
  confined(root, sessionFile(root, who.session));
  if (!["confirmed", "not-domain", "deferred", "defect"].includes(disposition))
    throw new Error(
      "disposition must be confirmed, not-domain, deferred, or defect",
    );
  if (["confirmed", "not-domain"].includes(disposition) && !human?.trim())
    throw new Error(
      "a settled sense review needs --human acknowledgement; use deferred or defect without a ruling",
    );
  const report = await glossaryCoverage(root);
  const found = report.terms.find(
    (t) => t.term.toLowerCase() === term.toLowerCase(),
  );
  if (
    disposition === "confirmed" &&
    (found?.state === "unresolved" || found?.state === "rejected")
  )
    throw new Error(
      "declare/map/fix this name before confirming its defined sense; a review is not a declaration",
    );
  const context = found?.contexts.find((c) => c.component === component);
  if (!context || context.fingerprint !== evidence)
    throw new Error(
      "stale or absent review evidence; read glossary review again",
    );
  if (!because.trim() || !over.length)
    throw new Error("a review needs --because and --over");
  return decide(
    [
      "glossary review " +
        JSON.stringify({
          term,
          component,
          evidence,
          disposition,
          human: human ?? null,
        }),
      "--because",
      because,
      ...over.flatMap((s) => ["--over", s]),
      ...writingFlags(who),
    ],
    { cwd: root, now: () => new Date() },
  ).record.id;
}
