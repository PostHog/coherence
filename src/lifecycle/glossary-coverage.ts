import { readFile } from "node:fs/promises";
/** Vocabulary coverage is a reproducible reading of observed uses, not a claim about every word's meaning. */
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { loadJournal } from "../journal/store.ts";
import {
  identifierWords,
  normalizeTerm,
  readCorpus,
  type UnreadablePath,
} from "./check.ts";
import {
  acceptedNames,
  aliasNames,
  rejectedNames,
  type Concept,
  type Glossary,
} from "./glossary.ts";
import { loadProjectGlossaries } from "./project.ts";
import { STOPLIST } from "./stoplist.ts";

export interface VocabularyUse {
  file: string;
  line: number;
  component: string;
  text: string;
  kind: string;
  fingerprint: string;
}
export interface VocabularyTerm {
  term: string;
  state:
    | "concept"
    | "alias"
    | "instance"
    | "declared"
    | "rejected"
    | "unresolved";
  concept: string | null;
  layer: "coherence" | "project" | null;
  definition: string | null;
  properties: Record<string, unknown>;
  confusables: string[];
  /** Present when one observed spelling names properties owned by multiple concepts. */
  meaningAlternatives?: {
    concept: string;
    layer: "coherence" | "project";
    definition: string;
    properties: Record<string, unknown>;
    confusables: string[];
  }[];
  fingerprint: string;
  count: number;
  uses: VocabularyUse[];
  contexts: {
    component: string;
    fingerprint: string;
    disposition: string;
    because: string | null;
  }[];
}
export interface Coverage {
  version: 1;
  projectGlossary: string | null;
  fingerprint: string;
  population: {
    files: { file: string; kind: string; lines: number }[];
    excluded: UnreadablePath[];
    unreadable: UnreadablePath[];
    extraction: string;
    limits: string[];
  };
  terms: VocabularyTerm[];
  totals: {
    terms: number;
    uses: number;
    known: number;
    rejected: number;
    unresolved: number;
    unreviewedContexts: number;
  };
}
export const digest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const clean = (s: string): string =>
  normalizeTerm(
    s
      .replace(/([a-z\d])([A-Z])/g, "$1 $2")
      .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2"),
  );
const WORD = /[A-Za-z][A-Za-z0-9_-]*/g;

/** Recover only glossary review decisions with a matching current evidence key. Old answers are history. */
function rulings(
  root: string,
): Map<string, { disposition: string; because: string }> {
  const result = new Map<string, { disposition: string; because: string }>();
  for (const r of loadJournal(root).records) {
    if (r.kind !== "decision" || !r.chose.startsWith("glossary review "))
      continue;
    try {
      const data = JSON.parse(
        r.chose.slice("glossary review ".length),
      ) as Record<string, unknown>;
      if (
        typeof data["evidence"] === "string" &&
        typeof data["disposition"] === "string"
      )
        result.set(data["evidence"], {
          disposition: data["disposition"],
          because: r.because,
        });
    } catch {
      /* A prose decision that is not a structured review remains prose. */
    }
  }
  return result;
}
interface KnownMeaning {
  state: VocabularyTerm["state"];
  concept: Concept | null;
  layer: "coherence" | "project";
  propertyOwners?: { concept: Concept; layer: "coherence" | "project" }[];
}

function table(
  glossary: Glossary,
  layer: "coherence" | "project",
  into: Map<string, KnownMeaning>,
  properties: Map<string, { concept: Concept; layer: "coherence" | "project" }[]>,
): void {
  // Project/trust-level declarations have no owning concept; property declarations are attached below.
  for (const name of acceptedNames(glossary))
    if (!into.has(clean(name))) into.set(clean(name), { state: "declared", concept: null, layer });
  for (const c of glossary.concepts) {
    into.set(clean(c.name), { state: "concept", concept: c, layer });
    for (const name of c.instances ?? []) into.set(clean(name), { state: "instance", concept: c, layer });
    for (const alias of c.aliases)
      for (const name of aliasNames(alias)) into.set(clean(name), { state: "alias", concept: c, layer });
    for (const key of Object.keys(c.properties))
      for (const name of aliasNames(key)) {
        const normalized = clean(name);
        const owners = properties.get(normalized) ?? [];
        owners.push({ concept: c, layer });
        properties.set(normalized, owners);
      }
  }
}

/** Inflection is accepted only when its conservative singular is an already-known complete name. */
function knownMeaning(term: string, known: Map<string, KnownMeaning>): KnownMeaning | undefined {
  const exact = known.get(term);
  if (exact) return exact;
  const words = term.split(" ");
  const last = words.at(-1)!;
  const singulars: string[] = [];
  if (last.endsWith("ies") && last.length > 4) singulars.push(last.slice(0, -3) + "y");
  if (/(?:ss|sh|ch|x|z)es$/.test(last)) singulars.push(last.slice(0, -2));
  if (last.endsWith("s") && !last.endsWith("ss") && last.length > 3) singulars.push(last.slice(0, -1));
  for (const singular of singulars) {
    const candidate = [...words.slice(0, -1), singular].join(" ");
    const meaning = known.get(candidate);
    if (meaning) return { ...meaning, state: "declared" };
  }
  return undefined;
}

function isGlossaryDecision(line: string): boolean {
  try {
    const record = JSON.parse(line) as Record<string, unknown>;
    return (
      record["kind"] === "decision" &&
      typeof record["chose"] === "string" &&
      /^(?:glossary review |glossary apply )/.test(record["chose"])
    );
  } catch {
    return false;
  }
}

function candidate(s: string): boolean {
  return (
    s.length >= 3 &&
    s.length <= 80 &&
    !STOPLIST.has(s) &&
    !/^(?:https?|www|true|false|null|undefined|const|let|return|function|import|export|from|async|await|class|type|interface|public|private|readonly|void|string|number|boolean|assert|test)$/.test(
      s,
    ) &&
    !/^[a-f0-9]{8,}$/i.test(s)
  );
}

export async function glossaryCoverage(root: string): Promise<Coverage> {
  const { coherence, project } = await loadProjectGlossaries(root);
  const rawEntries = new Map<string, Record<string, unknown>>();
  for (const g of [coherence, ...(project ? [project] : [])]) {
    const raw = JSON.parse(await readFile(g.path, "utf8")) as {
      concepts: Record<string, unknown>[];
    };
    for (const c of raw.concepts)
      rawEntries.set(
        (g === project ? "project" : "coherence") + ":" + String(c["name"]),
        c,
      );
  }
  const corpus = await readCorpus({ root, coherence, project });
  const known = new Map<string, KnownMeaning>();
  const propertyOwners = new Map<string, { concept: Concept; layer: "coherence" | "project" }[]>();
  table(coherence, "coherence", known, propertyOwners);
  const rejected = new Map(
    rejectedNames(coherence).map((r) => [clean(r.name), r]),
  );
  if (project) {
    table(project, "project", known, propertyOwners);
    for (const r of rejectedNames(project)) rejected.set(clean(r.name), r);
  }
  for (const [name, owners] of propertyOwners) {
    const current = known.get(name);
    // An exact concept/alias/instance remains the primary meaning, but every property owner is still exposed.
    if (current?.concept) current.propertyOwners = owners;
    else if (owners.length === 1) known.set(name, { state: "declared", concept: owners[0]!.concept, layer: owners[0]!.layer, propertyOwners: owners });
    else if (owners.length > 1) known.set(name, { state: "declared", concept: null, layer: owners[0]!.layer, propertyOwners: owners });
  }
  // A project's explicit vocabulary owns its own sense, even where the tool refused the spelling.
  const projectNames = project
    ? new Set([...acceptedNames(project)].map(clean))
    : new Set<string>();
  for (const name of projectNames) rejected.delete(name);
  const phrases = [...new Set([...known.keys(), ...rejected.keys()])].sort(
    (a, b) => b.length - a.length || a.localeCompare(b),
  );
  const components = corpus.files
    .filter((f) => f.rel.endsWith(".spec.md"))
    .map((f) => dirname(f.rel))
    .sort((a, b) => b.length - a.length);
  const uses = new Map<string, VocabularyUse[]>();
  const componentFor = (file: string): string =>
    components.find((c) => c === "." || file.startsWith(c + "/")) ??
    "(no declared component)";
  const add = (term: string, use: VocabularyUse): void => {
    if (!term) return;
    const list = uses.get(term) ?? [];
    if (!list.some((u) => u.file === use.file && u.line === use.line))
      list.push(use);
    uses.set(term, list);
  };
  for (const f of corpus.files) {
    const fileFingerprint = digest(
      f.lines.filter(
        (line) => !(f.kind === "record" && isGlossaryDecision(line)),
      ),
    );
    for (let n = 0; n < f.lines.length; n++) {
      const source = f.lines[n]!;
      // Review/maintenance decisions are outcomes, not fresh source-language observations of themselves.
      if (f.kind === "record" && isGlossaryDecision(source)) continue;
      const observed = /(^|\/)\.env(?:$|\.)/.test(f.rel)
        ? source.replace(/=.*/, "")
        : source;
      const normalized =
        " " + clean(observed).replace(/[^a-z0-9 ]/g, " ") + " ";
      const use: VocabularyUse = {
        file: f.rel,
        line: n + 1,
        component: componentFor(f.rel),
        text: (/(^|\/)\.env(?:$|\.)/.test(f.rel)
          ? source.replace(/=.*/, "=<redacted>")
          : source
        )
          .trim()
          .slice(0, 360),
        kind: f.kind,
        fingerprint: f.kind === "record" ? digest(source) : fileFingerprint,
      };
      const spans: string[] = [];
      for (const phrase of phrases)
        if (normalized.includes(" " + phrase + " ")) {
          add(phrase, use);
          spans.push(phrase);
        }
      const tokens = new Set<string>();
      if (f.kind === "code" || f.kind === "data") {
        for (const m of observed.matchAll(WORD)) {
          if (
            /[A-Z_-]/.test(m[0]) ||
            /^\s*(?:def|class|function|const|let|export|public)\b/.test(
              observed,
            )
          ) {
            tokens.add(clean(m[0]));
            for (const w of identifierWords(m[0])) tokens.add(clean(w));
          }
        }
      } else {
        for (const m of observed.matchAll(
          /`([^`\n]+)`|\b([A-Z][a-z]+(?:[A-Z][a-z]+)*)\b/g,
        ))
          tokens.add(clean(m[1] ?? m[2] ?? ""));
        if (/^#{1,6}\s/.test(observed))
          for (const m of observed.matchAll(WORD)) tokens.add(clean(m[0]));
      }
      for (const token of tokens)
        if (
          candidate(token) &&
          !spans.some((p) => p !== token && p.split(" ").includes(token))
        )
          add(token, use);
    }
  }
  for (const c of components)
    if (c !== ".") {
      const term = clean(c.split("/").at(-1)!);
      if (candidate(term))
        add(term, {
          file: c,
          line: 0,
          component: c,
          text: "Declared component folder",
          kind: "component",
          fingerprint: digest(c),
        });
    }
  const decisions = rulings(root);
  const terms: VocabularyTerm[] = [...uses]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([term, locations]) => {
      locations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
      const item = knownMeaning(term, known);
      const refused = rejected.get(term);
      const original = item?.concept
        ? rawEntries.get(item.layer + ":" + item.concept.name)
        : undefined;
      const alternatives = item?.propertyOwners?.map((owner) => ({
        concept: owner.concept.name,
        layer: owner.layer,
        definition: owner.concept.definition,
        properties: (rawEntries.get(owner.layer + ":" + owner.concept.name)?.["properties"] as Record<string, unknown> | undefined) ?? owner.concept.properties,
        confusables: owner.concept.notToBeConfusedWith,
      }));
      const fingerprint = digest({
        term,
        concept: original ?? item?.concept ?? null,
        layer: item?.layer ?? null,
        propertyOwners: alternatives ?? null,
        rejected: refused ?? null,
      });
      const contexts = [...new Set(locations.map((u) => u.component))]
        .sort()
        .map((component) => {
          // Content, not line numbers, identifies a context; moving a line does not erase a human's answer.
          const evidence = digest({
            fingerprint,
            component,
            uses: [
              ...new Set(
                locations
                  .filter((u) => u.component === component)
                  .map((u) => u.fingerprint + ":" + u.text),
              ),
            ].sort(),
          });
          const ruling = decisions.get(evidence);
          return {
            component,
            fingerprint: evidence,
            disposition: ruling?.disposition ?? "unreviewed",
            because: ruling?.because ?? null,
          };
        });
      return {
        term,
        state: refused ? "rejected" : (item?.state ?? "unresolved"),
        concept: item?.concept?.name ?? refused?.concept ?? null,
        layer: item?.layer ?? null,
        definition: item?.concept?.definition ?? null,
        properties:
          (original?.["properties"] as Record<string, unknown> | undefined) ??
          item?.concept?.properties ??
          {},
        confusables: item?.concept?.notToBeConfusedWith ?? [],
        ...(alternatives && alternatives.length > 1 ? { meaningAlternatives: alternatives } : {}),
        fingerprint,
        count: locations.length,
        uses: locations,
        contexts,
      };
    });
  const population: Coverage["population"] = {
    files: corpus.files
      .map((f) => ({ file: f.rel, kind: f.kind, lines: f.lines.length }))
      .sort((a, b) => a.file.localeCompare(b.file)),
    excluded: corpus.excluded.sort((a, b) => a.file.localeCompare(b.file)),
    unreadable: corpus.unreadable,
    extraction:
      "Exact declared phrases plus heuristic Latin-alphabet code identifiers, keys, backticked names, title-case prose, headings and declared component names. Counts refer only to these observed candidates.",
    limits: [
      "No exhaustive extraction or automatic proof of meaning.",
      "SQL/data/notebook bodies are text, not resolved language symbols; unsupported/binary files and symlinks are reported as excluded.",
      "Known words in a new component require sense review; a matched spelling is not a confirmed meaning.",
      "Unknowns and deferred reviews are not covered. Journal review decisions do not nominate themselves.",
    ],
  };
  return {
    version: 1,
    projectGlossary:
      project?.path ??
      (coherence.path.startsWith(root + "/") ? coherence.path : null),
    fingerprint: digest({ population, terms }),
    population,
    terms,
    totals: {
      terms: terms.length,
      uses: terms.reduce((n, t) => n + t.count, 0),
      known: terms.filter((t) => !["unresolved", "rejected"].includes(t.state))
        .length,
      rejected: terms.filter((t) => t.state === "rejected").length,
      unresolved: terms.filter((t) => t.state === "unresolved").length,
      unreviewedContexts: terms.reduce(
        (n, t) =>
          n +
          t.contexts.filter(
            (c) =>
              c.disposition !== "confirmed" && c.disposition !== "not-domain",
          ).length,
        0,
      ),
    },
  };
}
export function coverageText(report: Coverage, term?: string): string {
  const entries = term
    ? report.terms.filter(
        (t) => t.term === clean(term) || clean(t.concept ?? "") === clean(term),
      )
    : [...report.terms].sort(
        (a, b) =>
          Number(b.state === "unresolved") - Number(a.state === "unresolved") ||
          b.contexts.length - a.contexts.length ||
          b.count - a.count ||
          a.term.localeCompare(b.term),
      );
  return [
    `Glossary coverage: ${report.population.files.length} files; ${report.totals.terms} observed candidate terms; ${report.totals.known} declared, ${report.totals.rejected} rejected, ${report.totals.unresolved} unresolved.`,
    `${report.totals.unreviewedContexts} contexts need review; ${report.population.excluded.length} exclusions; ${report.population.unreadable.length} unreadable. This is not a semantic coverage percentage.`,
    ...entries
      .slice(0, term ? entries.length : 40)
      .flatMap((t) => [
        `${t.term} [${t.state}${t.concept ? "; " + t.concept : ""}] ${t.count} uses`,
        ...(term
          ? [
              t.definition ?? "No settled definition.",
              `  properties: ${JSON.stringify(t.properties)}; confusables: ${t.confusables.join("; ") || "none declared"}`,
              ...(t.meaningAlternatives ? t.meaningAlternatives.map((meaning) => `  applicable property meaning: ${meaning.concept} (${meaning.layer}) — ${meaning.definition}; properties ${JSON.stringify(meaning.properties)}`) : []),
              ...t.contexts.map(
                (c) =>
                  `  ${c.component}: ${c.disposition}; evidence ${c.fingerprint}`,
              ),
              ...t.uses.map((u) => `  ${u.file}:${u.line} ${u.text}`),
            ]
          : [
              `  ${t.uses[0]?.file}:${t.uses[0]?.line}; ${t.contexts.length} context(s)`,
            ]),
      ]),
    ...(!term && entries.length > 40
      ? [
          `${entries.length - 40} more terms; use --json or review <term> for the full reading.`,
        ]
      : []),
    ...report.population.limits,
  ].join("\n");
}
