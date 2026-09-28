// usage: node measure-model.ts <coherence checkout> <project root>, after `query structure` recorded a reading.
// The spec model, the gaps against the recorded reading, the baselines and the control lines, as JSON.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
const [C, root] = process.argv.slice(2);
const gapsMod = await import(join(C!, "src/readings/scope/gaps.ts"));
const modelMod = await import(join(C!, "src/spec/model.ts"));
const journal = await import(join(C!, "src/journal/store.ts"));
const model = modelMod.loadSpecModel(root, {});
const trusted = new Set(model.trustLevels.filter((l: any) => !l.outside).map((l: any) => l.name));
const ents = model.components.flatMap((c: any) => c.entrances);
const g = gapsMod.currentGaps(root);
let baselines: any[] = [];
const { records } = journal.loadJournal(root);
for (const r of records) if (r.kind === "decision" && /^structure baseline /.test(r.chose)) {
  let n = -1; try { n = JSON.parse(r.chose.replace(/^structure baseline /, "")).gaps.length; } catch {}
  baselines.push({ id: r.id, size: n });
}
let effective: any; try { effective = gapsMod.readGapBaseline(root); } catch (e) { effective = { error: String(e) }; }
const specFiles: string[] = model.components.map((c: any) => join(root!, c.specPath));
let guardLines = 0, trustLines = 0, controlLines = 0;
for (const f of specFiles) { if (!existsSync(f)) continue; for (const l of readFileSync(f, "utf8").split("\n")) { if (/^\s*guard:/.test(l)) guardLines++; if (/^\s*trust:/.test(l)) trustLines++; if (/^\s*control:/.test(l)) controlLines++; } }
console.log(JSON.stringify({
  components: model.components.length,
  trustLevels: model.trustLevels.map((l: any) => ({ name: l.name, outside: !!l.outside })),
  entrances: ents.length,
  entrancesWithTrust: ents.filter((e: any) => e.trust !== undefined).length,
  entrancesUntrustedOrUnknown: ents.filter((e: any) => e.trust === undefined || !trusted.has(e.trust)).length,
  entrancesWithGuard: ents.filter((e: any) => e.guard !== undefined).length,
  waivers: ents.filter((e: any) => e.noControl !== undefined).map((e: any) => ({ component: e.component, name: e.name, reason: e.noControl })),
  guardLines, trustLines, controlLines,
  counts: model.counts,
  specProblems: model.problems.length,
  gaps: g === undefined ? null : g.gaps.map((x: any) => [x.component, x.name, x.trust.join("|")]),
  gapReadingAt: g?.at ?? null,
  baselines,
  effectiveBaseline: effective === undefined ? null : (effective.error ?? effective.entrances.size),
  journalRecords: records.length,
}));
