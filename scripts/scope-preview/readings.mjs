// Node-only snapshot adapter. Readers own meaning; the browser receives data, not
// filesystem access, hook execution, or a second resolution implementation.
import { relative } from 'node:path';
import { LIFECYCLE_HOOK_EVENTS, inspectLifecycleHook } from '../../src/control.ts';
import { agentInstructions, currentObservation } from '../../src/hooks.ts';
import { readHookText, composeHookText } from '../../src/hook-text.ts';
import { resolve as resolveJournal } from '../../src/decisions.ts';
import { newTailState, tailJournal } from '../../src/journal.ts';
import { readDefects } from '../../src/defects.ts';
import { readExperiments } from '../../src/experiment.ts';

export function readScopeReadings(cfg) {
  // Use the canonical stream's content identity even for full snapshots: during
  // compaction the same row can temporarily exist in source and destination files.
  const tail = tailJournal(cfg, newTailState());
  const journal = { records: tail.fresh, unreadable: tail.unreadable };
  const errors = [];
  const readLedger = (name, reader, fallback) => {
    try { return reader(cfg); }
    catch (error) { errors.push({ source: name, message: String(error.message ?? error) }); return fallback; }
  };
  const defects = readLedger('defects', readDefects, { records: [] });
  const experiments = readLedger('experiments', readExperiments, { records: [], experiments: [] });
  const sessions = [...new Set([
    ...journal.records.map(r => r.session), ...defects.records.map(r => r.session),
    ...experiments.experiments.map(e => e.opened.session),
  ])].sort();
  // Resolve over the COMPLETE journal before any UI filtering. An answer from a
  // different session must not make the original question look open again.
  const states = {};
  for (const [state, entries] of Object.entries(resolveJournal(journal.records))) {
    for (const entry of entries) {
      const rec = entry.rec ?? entry;
      states[rec.id] = { state, ...(entry.by ? { by: entry.by.id } : {}) };
    }
  }
  const events = LIFECYCLE_HOOK_EVENTS.map(event => {
    const customization = readHookText(cfg, event);
    const startup = event === 'SessionStart' || event === 'SubagentStart';
    const canonical = startup ? agentInstructions('{{session}}', 'coherence', '{{agent}}') : '';
    const dynamic = startup ? 'Exact-session work instructions, journal-control degradation and live due-instrument advisories are appended at invocation.'
      : event === 'SubagentStop' ? 'Child-session journal, open questions and change feedback are composed at invocation.'
        : event === 'Stop' ? 'Main Stop records state; its canonical text is intentionally silent.'
          : 'Records tool activity and explicit file reads; canonical text is intentionally silent.';
    const slot = value => value ? { path: relative(cfg.root, value.path), text: value.text } : null;
    return { event, canonical, dynamic, override: slot(customization.override), append: slot(customization.append),
      problems: customization.problems,
      // This is only the static template. Never call it a captured delivery.
      template: composeHookText(canonical, customization, {}),
      runtimeDependent: customization.override === null && (startup || event === 'SubagentStop'),
    };
  });
  const hosts = ['claude', 'codex'].map(host => {
    const control = inspectLifecycleHook(cfg, host);
    return { host, control, sessions: Object.fromEntries(sessions.map(session => {
      try { return [session, currentObservation(cfg, control, session)]; }
      catch (error) { return [session, { unavailable: String(error.message ?? error) }]; }
    })) };
  });
  return { version: 1, journal: { records: journal.records, states, unreadable: journal.unreadable },
    defects: defects.records, experiments: experiments.records,
    openExperiments: experiments.experiments.filter(e => !e.closed).map(e => e.opened.id),
    sessions, hooks: { events, hosts }, errors,
    limits: 'Offline snapshot. Session choices come from durable journal, defect and experiment records; activity-only sessions are not discovered. Hook observations are local transient evidence, not captured delivery text or proof of agent action.',
  };
}
