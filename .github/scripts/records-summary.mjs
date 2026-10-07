// What a pull request's Coherence records hold, as markdown: the journal
// records and runs it adds, by kind, with each decision, defect, escalation and
// retraction named in one line. CI writes it to the job summary, since the
// records themselves are folded in the diff (.gitattributes).
//
//   node .github/scripts/records-summary.mjs <base> <head>
import { execFileSync } from "node:child_process";

const [base, head] = process.argv.slice(2);
if (!base || !head) {
  console.error("usage: records-summary.mjs <base> <head>");
  process.exit(64);
}
const diff = execFileSync("git", ["diff", "--no-color", "--unified=0", `${base}...${head}`, "--", ".coherence/journal", ".coherence/runs", ".coherence/work"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
const added = { journal: [], runs: [], work: [] };
let area;
let bytes = 0;
for (const line of diff.split("\n")) {
  if (line.startsWith("+++ ")) {
    area = /^\+\+\+ b\/\.coherence\/(journal|runs|work)\//.exec(line)?.[1];
    continue;
  }
  if (!line.startsWith("+") || area === undefined) continue;
  bytes += line.length;
  try {
    added[area].push(JSON.parse(line.slice(1)));
  } catch {
    // A line that is not one record (a torn write) is counted by bytes alone.
  }
}

const count = (items, key) => Object.entries(items.reduce((acc, r) => ((acc[key(r)] = (acc[key(r)] ?? 0) + 1), acc), {})).sort((a, b) => b[1] - a[1]);
const out = [];
const total = added.journal.length + added.runs.length + added.work.length;
out.push(`### Coherence records in this pull request`);
if (total === 0) {
  out.push("", "None.");
} else {
  out.push("", `${total} records, ${(bytes / 1024).toFixed(0)} KB.`);
  if (added.journal.length) {
    out.push("", `**Journal**: ${count(added.journal, (r) => r.kind ?? "?").map(([k, n]) => `${n} ${k}`).join(", ")}`);
    const named = added.journal.filter((r) => ["decision", "defect", "escalation", "retraction"].includes(r.kind));
    for (const r of named.slice(0, 25)) {
      const text = String(r.chose ?? r.what ?? r.question ?? r.because ?? "").replace(/\s+/g, " ");
      out.push(`- \`${r.id}\` ${r.kind}${r.class ? ` (${r.class})` : ""}: ${text.length > 140 ? `${text.slice(0, 140)}…` : text}`);
    }
    if (named.length > 25) out.push(`- and ${named.length - 25} more`);
  }
  const runs = added.runs.filter((r) => Array.isArray(r.invariants));
  const refutations = added.runs.filter((r) => r.kind === "refutation");
  if (added.runs.length) {
    const verdicts = count(runs.flatMap((r) => r.invariants), (e) => e.verdict ?? "?").map(([k, n]) => `${n} ${k}`).join(", ");
    out.push("", `**Runs**: ${runs.length} runs (${verdicts || "no entries"})${refutations.length ? `, ${refutations.length} refutations` : ""}`);
    // A refutation's red is on purpose; what a reviewer needs is the verdict each enforcement is left with.
    const latest = new Map();
    for (const r of [...runs].sort((x, y) => String(x.at).localeCompare(String(y.at)))) for (const e of r.invariants) latest.set(`${e.component}/${e.name} (${e.form})`, e.verdict);
    const left = [...latest].filter(([, v]) => v !== "pass").map(([k, v]) => `${k}: ${v}`);
    out.push(left.length ? `- left not passing by this pull request's latest runs: ${left.slice(0, 15).join("; ")}${left.length > 15 ? `; and ${left.length - 15} more` : ""}` : `- every enforcement these runs checked is left passing`);
  }
  if (added.work.length) out.push("", `**Work orders**: ${count(added.work, (r) => r.kind ?? "?").map(([k, n]) => `${n} ${k}`).join(", ")}`);
}
console.log(out.join("\n"));
