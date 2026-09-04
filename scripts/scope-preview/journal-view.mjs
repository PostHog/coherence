export function journalEntries(readings) {
  return [
    ...readings.journal.records.map(raw => ({ key: JSON.stringify(['journal', raw.session, raw.id, raw.at]),
      source: 'journal', id: raw.id, at: raw.at, session: raw.session, agent: raw.agent,
      kind: raw.kind, title: raw.chose, state: readings.journal.states[raw.id]?.state ?? raw.kind,
      related: readings.journal.states[raw.id]?.by ?? raw.supersedes, files: raw.files ?? [], raw,
      outstanding: ['open', 'blocked'].includes(readings.journal.states[raw.id]?.state),
    })),
    ...readings.defects.map(raw => ({ key: JSON.stringify(['defect', raw.session, raw.id]),
      source: 'defects', id: raw.id, at: raw.at, session: raw.session, agent: raw.agent,
      kind: 'defect', title: raw.summary, state: raw.basis, files: raw.files, raw, outstanding: false,
    })),
    ...readings.experiments.map(raw => ({ key: JSON.stringify(['experiment', raw.id]),
      source: 'experiments', id: raw.id, at: raw.at, session: raw.session ?? raw.ownerSession,
      agent: raw.agent ?? raw.assessor.agent, kind: `experiment ${raw.event}`,
      title: raw.hypothesis ?? `Experiment ${raw.experiment}: ${raw.outcome}`,
      state: raw.outcome ?? (readings.openExperiments.includes(raw.id) ? 'open' : 'closed'),
      related: raw.experiment, files: raw.predictedContext ?? [], raw,
      outstanding: raw.event === 'opened' && readings.openExperiments.includes(raw.id),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key));
}

export function filterEntries(entries, { session = '', mode = 'timeline', source = '', query = '' } = {}) {
  const needle = query.trim().toLowerCase();
  return entries.filter(e => (!session || e.session === session) && (!source || e.source === source)
    && (mode !== 'outstanding' || e.outstanding)
    && (!needle || JSON.stringify(e.raw).toLowerCase().includes(needle)));
}
