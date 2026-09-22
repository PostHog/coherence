/** Fixed glossary workflows: observe, propose, record a ruling, and read the changed evidence back. */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative } from "node:path";
import { parseFlags, type Parsed } from "../journal/args.ts";
import type { Io } from "../journal/cli.ts";
import { loadProjectGlossaries } from "./project.ts";
import {
  coverageText,
  digest,
  glossaryCoverage,
  type Coverage,
} from "./glossary-coverage.ts";
import {
  applyProposal,
  confined,
  glossaryTarget,
  propose,
  recoverGlossary,
  reviewGlossary,
  type Change,
  type Who,
} from "./glossary-maintain.ts";

export const GLOSSARY_WORK_USAGE = `  glossary coverage [--json]              observed vocabulary, uses, exclusions and uncertainty
  glossary review <term> [--json]          definition, live contexts, evidence keys and prior rulings
  glossary review <term> --component <folder> --evidence <key> --disposition confirmed|not-domain|deferred|defect --because <reason> --over <alternative> --session <id> --agent <name> [--human <acknowledgement>]
  glossary propose declare|define|alias|reject|rename|retire <concept> [value] [--definition <text>] [--entry <file.json>] [--qualify] --because <reason>
                                          rename --qualify: the old name keeps its other senses and is not rejected
  glossary apply <proposal-id> --because <reason> --over <alternative> --session <id> --agent <name> [--human <acknowledgement>] [--work <id>]
  glossary recover                        finish an interrupted application without overwriting intervening edits
  glossary draft [--out <file>]            unsettled candidates, collisions and review questions; never overwrites
  glossary baseline --session <id>         remember observed uses for this session; no meaning is marked covered
  glossary changes [--session <id>] [--json] pending new/changed contexts relative to that session's baseline
  glossary ready --terms <a,b,...> [--json] explicit vocabulary prerequisites for a named slice; not host-delivery proof
  glossary similar <text> [--json]         optional offline suggestions; model absence leaves exact checks available
  glossary model --download                 explicitly download and verify the pinned 37 MB model
  glossary model --file <local.gguf> --sha256 <hash>  explicitly configure a local model`;
const WORKFLOWS = ["coverage", "review", "propose", "apply", "recover", "draft", "baseline", "changes", "ready", "similar", "model"] as const;

export function glossaryHelp(verb?: string): string {
  if (verb === undefined || verb === "help") return `usage:
${GLOSSARY_WORK_USAGE}`;
  const lines = GLOSSARY_WORK_USAGE.split("\n").filter((line) => line.trimStart().startsWith(`glossary ${verb}`));
  return lines.length > 0
    ? `usage:
${lines.join("\n")}

Run glossary help for every workflow.`
    : `unknown glossary workflow: ${verb}; run glossary help`;
}

const get = (p: Parsed, name: string): string | undefined => p.one.get(name);
function need(p: Parsed, name: string): string {
  const s = get(p, name);
  if (!s?.trim()) throw new Error(`missing --${name}`);
  return s;
}
function who(p: Parsed): Who {
  return {
    session: need(p, "session"),
    agent: need(p, "agent"),
    ...(get(p, "work") ? { work: get(p, "work")! } : {}),
  };
}
function cleanWrite(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = path + ".tmp";
  writeFileSync(temp, JSON.stringify(value, null, 2) + "\n");
  renameSync(temp, path);
}
export function baselinePath(root: string, session: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(session))
    throw new Error("invalid session token");
  return confined(root, `.coherence/glossary/sessions/${session}.json`);
}
export function coverageChanges(
  report: Coverage,
  prior: Record<string, string> = {},
): {
  term: string;
  component: string;
  evidence: string;
  state: string;
  reason: string;
}[] {
  return report.terms.flatMap((t) =>
    t.contexts
      .filter(
        (c) =>
          !["confirmed", "not-domain"].includes(c.disposition) &&
          prior[t.term + "\n" + c.component] !== c.fingerprint,
      )
      .map((c) => ({
        term: t.term,
        component: c.component,
        evidence: c.fingerprint,
        state: t.state,
        reason:
          c.disposition === "unreviewed"
            ? t.state === "unresolved"
              ? "undeclared use"
              : "new or changed context; is this the defined sense?"
            : c.disposition,
      })),
  );
}
export function saveBaseline(
  root: string,
  session: string,
  report: Coverage,
): void {
  cleanWrite(
    baselinePath(root, session),
    Object.fromEntries(
      report.terms.flatMap((t) =>
        t.contexts.map((c) => [t.term + "\n" + c.component, c.fingerprint]),
      ),
    ),
  );
}
export function priorBaseline(
  root: string,
  session: string,
): Record<string, string> {
  const path = baselinePath(root, session);
  if (!existsSync(path)) return {};
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.values(value).some((v) => typeof v !== "string")
  )
    throw new Error("glossary baseline is unreadable; recreate it explicitly");
  return value as Record<string, string>;
}
export async function glossaryWorkCommand(
  argv: string[],
  io: Io,
): Promise<number> {
  try {
    const [verb, ...rest] = argv;
    const p = parseFlags(rest, {
      json: "switch",
      out: "one",
      definition: "one",
      entry: "one",
      because: "one",
      over: "many",
      human: "one",
      session: "one",
      agent: "one",
      work: "one",
      component: "one",
      evidence: "one",
      disposition: "one",
      terms: "one",
      file: "one",
      sha256: "one",
      download: "switch",
      qualify: "switch",
      help: "switch",
    });
    if (p.switches.has("help")) {
      io.out(glossaryHelp(verb));
      return WORKFLOWS.includes(verb as (typeof WORKFLOWS)[number]) ||
          verb === "help"
        ? 0
        : 1;
    }
    if (
      verb !== "propose" &&
      p.positionals.length >
        (["review", "apply", "similar"].includes(verb ?? "") ? 1 : 0)
    )
      throw new Error("unexpected positional argument; run glossary help");
    const term = p.positionals[0];
    const json = p.switches.has("json");
    const print = (x: unknown) => io.out(JSON.stringify(x, null, 2));
    if (verb === "propose") {
      const [action, name, value, ...extra] = p.positionals;
      if (
        extra.length ||
        !action ||
        !name ||
        !["declare", "define", "alias", "reject", "rename", "retire"].includes(
          action,
        )
      )
        throw new Error(
          "propose needs an action and concept; see glossary help",
        );
      const entry = get(p, "entry")
        ? (JSON.parse(
            readFileSync(confined(io.cwd, get(p, "entry")!), "utf8"),
          ) as Record<string, unknown>)
        : undefined;
      print(
        await propose(io.cwd, {
          action: action as Change["action"],
          name,
          ...(value ? { value } : {}),
          ...(get(p, "definition") !== undefined
            ? { definition: get(p, "definition")! }
            : {}),
          ...(entry ? { entry } : {}),
          ...(p.switches.has("qualify") ? { qualify: true } : {}),
          because: need(p, "because"),
        }),
      );
      return 0;
    }
    if (verb === "apply") {
      if (!term) throw new Error("apply needs a proposal id");
      io.out(
        applyProposal(
          io.cwd,
          term,
          who(p),
          need(p, "because"),
          p.many.get("over") ?? [],
          get(p, "human"),
        ),
      );
      return 0;
    }
    if (verb === "recover") {
      io.out(recoverGlossary(io.cwd));
      return 0;
    }
    if (verb === "help") {
      io.out(glossaryHelp());
      return 0;
    }
    if (verb === "model" || verb === "similar") {
      const { configureModel, downloadModel, similarTerms } = await import(
        "./glossary-similarity.ts"
      );
      if (verb === "model") {
        print(
          p.switches.has("download")
            ? await downloadModel(io.cwd)
            : await configureModel(io.cwd, need(p, "file"), need(p, "sha256")),
        );
        return 0;
      }
      if (!term) throw new Error("similar needs a term or context");
      const result = await similarTerms(io.cwd, term);
      if (json) print(result);
      else io.out(JSON.stringify(result, null, 2));
      return 0;
    }
    if (
      !["coverage", "review", "draft", "baseline", "changes", "ready"].includes(
        verb ?? "",
      )
    )
      throw new Error(`unknown glossary workflow: ${verb}; run glossary help`);
    const report = await glossaryCoverage(io.cwd);
    if (verb === "review" && get(p, "disposition")) {
      if (!term) throw new Error("review needs a term");
      io.out(
        await reviewGlossary(
          io.cwd,
          term,
          need(p, "component"),
          need(p, "evidence"),
          need(p, "disposition"),
          who(p),
          need(p, "because"),
          p.many.get("over") ?? [],
          get(p, "human"),
        ),
      );
      return 0;
    }
    if (verb === "draft") {
      const { coherence, project } = await loadProjectGlossaries(io.cwd);
      const draft = {
        status: "proposed; nothing here is a settled definition",
        source: report.fingerprint,
        existing:
          (
            project ??
            (report.projectGlossary === coherence.path ? coherence : undefined)
          )?.concepts ?? [],
        candidates: report.terms
          .filter((t) => t.state === "unresolved")
          .map((t) => ({
            name: t.term,
            definition: null,
            status: "needs ruling",
            uses: t.uses,
            contexts: t.contexts,
          })),
        candidate_overloads: report.terms
          .filter((t) => t.contexts.length > 1)
          .sort(
            (a, b) =>
              b.contexts.length - a.contexts.length ||
              b.count - a.count ||
              a.term.localeCompare(b.term),
          )
          .map((t) => ({
            term: t.term,
            contexts: t.contexts,
            senses: "not inferred; compare these uses",
          })),
        limits: report.population.limits,
      };
      const out = get(p, "out");
      if (out) {
        const path = confined(io.cwd, out);
        if (path === (await glossaryTarget(io.cwd)))
          throw new Error(
            "an unsettled draft cannot be written as the canonical glossary",
          );
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify(draft, null, 2) + "\n", {
          flag: "wx",
        });
        io.out(
          `Wrote unsettled draft ${relative(io.cwd, path)}; use propose/apply for actual changes.`,
        );
      } else print(draft);
      return 0;
    }
    if (verb === "baseline") {
      saveBaseline(io.cwd, need(p, "session"), report);
      io.out(
        `Baseline saved for ${need(p, "session")}; no sense ruling was created. ${report.totals.unresolved} unresolved terms remain.`,
      );
      return 0;
    }
    if (verb === "changes") {
      const changes = coverageChanges(
        report,
        get(p, "session") ? priorBaseline(io.cwd, get(p, "session")!) : {},
      );
      if (json) print({ changes, totals: report.totals });
      else
        io.out(
          `${changes.length} new/changed contexts; ${report.totals.unreviewedContexts} contexts remain unsettled in all.\n` +
            changes
              .slice(0, 30)
              .map((c) => `${c.term} in ${c.component}: ${c.reason}`)
              .join("\n") +
            (changes.length > 30
              ? "\nUse --json for every changed context."
              : ""),
        );
      return 0;
    }
    if (verb === "ready") {
      const terms = need(p, "terms")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      if (!terms.length) throw new Error("name the slice's terms");
      const pending = terms.flatMap((name) => {
        const found = report.terms.find((t) => t.term === name);
        return !found
          ? [
              {
                term: name,
                reason: "no observed use in the declared population",
              },
            ]
          : found.contexts
              .filter(
                (c) =>
                  c.disposition !== "confirmed" &&
                  c.disposition !== "not-domain",
              )
              .map((c) => ({
                term: name,
                reason: `${c.component}: ${c.disposition}`,
              }));
      });
      const ready =
        pending.length === 0 && report.population.unreadable.length === 0;
      const result = {
        vocabularyReady: ready,
        pending,
        unreadable: report.population.unreadable,
        limits: [
          "This only checks the named terms and current review evidence, not all project semantics.",
          "Fresh host delivery and the remaining work-order success criteria require separate observation.",
        ],
      };
      print(result);
      return ready ? 0 : 1;
    }
    if (verb === "review" && !term) throw new Error("review needs a term");
    if (json)
      print(
        verb === "review"
          ? {
              term,
              entries: report.terms.filter(
                (t) =>
                  t.term === term?.toLowerCase() ||
                  t.concept?.toLowerCase() === term?.toLowerCase(),
              ),
              limits: report.population.limits,
            }
          : report,
      );
    else io.out(coverageText(report, verb === "review" ? term : undefined));
    return 0;
  } catch (e) {
    io.err(`glossary: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}
