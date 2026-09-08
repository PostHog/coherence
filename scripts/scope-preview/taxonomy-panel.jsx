import React, { useState } from 'react';

export function TaxonomyPanel({ readings, session }) {
  const [query, setQuery] = useState(''), [status, setStatus] = useState(''), [selected, setSelected] = useState(null), [limit, setLimit] = useState(30);
  const taxonomy = readings.taxonomy;
  const error = readings.errors.find(e => e.source === 'taxonomy');
  const items = (taxonomy?.items ?? []).filter(item => (!session || item.record.session === session)
    && (!status || item.status === status) && JSON.stringify(item).toLowerCase().includes(query.toLowerCase()));
  const active = items.find(item => item.record.snapshot.subject.target === selected) ?? items[0];
  const record = active?.record, classification = active?.classification;
  const roleLabel = id => taxonomy?.catalog.roles.find(r => r.id === id)?.label ?? id;
  return <div className="reading-panel taxonomy-panel">
    <header className="reading-header"><div><span className="eyebrow">OBLIGATION DISCOVERY</span><h1>Taxonomy</h1><p>What kind of component is this—and what should we investigate?</p></div><span className="reading-count">{taxonomy?.items.length ?? 0} current classifications</span></header>
    <div className="reading-notice">Caller-assessed roles and facets. Suggested obligations are unverified—not passing guarantees. This view cannot accept classifications or run checks.</div>
    {error ? <div className="reading-warning" role="alert">Taxonomy unavailable: {error.message}. Damaged evidence is not an empty classification set.</div>
      : !taxonomy ? <p className="empty-reading">Taxonomy was not captured in this snapshot. Recapture with the current CLI.</p> : <>
        <div className="journal-filters"><label>Status<select aria-label="Taxonomy status" value={status} onChange={e => { setStatus(e.target.value); setLimit(30); }}><option value="">All statuses</option>{(taxonomy.states ?? []).map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="journal-search">Search<input aria-label="Search taxonomy" value={query} placeholder="Subject, role, facet or evidence…" onChange={e => { setQuery(e.target.value); setLimit(30); }}/></label></div>
        <div className="journal-workspace"><section className="journal-list taxonomy-list" aria-label="Classifications"><p className="list-count">Showing {Math.min(limit, items.length)} of {items.length} matching classifications</p>
          {items.slice(0, limit).map(item => <button className="journal-row" key={item.record.id} aria-pressed={active?.record.id === item.record.id} onClick={() => setSelected(item.record.snapshot.subject.target)}>
            <span className="entry-kind">{item.status} · {item.record.agent}</span><strong>{item.record.snapshot.subject.target}</strong><span>{item.classification.roles.map(roleLabel).join(' + ') || 'No selected role'}</span></button>)}
          {!items.length && <div className="empty-reading"><p>{taxonomy.items.length ? 'No matching classifications. Clear the search, status or session filter.' : 'No classifications recorded. Absence is not a clean bill of health.'}</p><p>Begin in the CLI:</p><code>coherence taxonomy inspect src/example.ts</code><p>Use <code>coherence taxonomy help</code> for evidence and recording commands.</p></div>}
          {items.length > limit && <button className="more-records" onClick={() => setLimit(limit + 30)}>Show 30 more classifications</button>}
        </section><article className="journal-detail taxonomy-detail">
          {record ? <><span className="eyebrow">{active.status} · CALLER-ASSESSED</span><h2>{record.snapshot.subject.label}</h2><code>{record.snapshot.subject.target}</code><p className="entry-meta">{record.agent} · {record.session}<br/>{record.at}<br/>Owner: {record.snapshot.subject.owner ?? 'unowned graph subject'}</p>
            {!!active.staleReasons.length && <div className="reading-warning"><strong>Stale evidence</strong><ul>{active.staleReasons.map(reason => <li key={reason}>{reason}</li>)}</ul><p>The recorded classification remains visible; it has not been silently renewed.</p></div>}
            <h3>Selected roles</h3><p>{classification.roles.map(roleLabel).join(' + ') || 'None selected; retain uncertainty.'}</p>
            <h3>Independent facets</h3><p>{classification.facets.join(' · ') || 'No positive facets recorded. Unanswered facets are unknown, not absent.'}</p>
            <h3>Assessment rationale</h3><p className="preserve-text">{record.because}</p>
            <details><summary>Candidate responsibilities · {classification.candidates.length}</summary>{classification.candidates.map(candidate => <div key={candidate.id}><h4>{candidate.label}</h4><p>Removing it removes the ability to {candidate.responsibility}.</p><p>Support: {candidate.support.join(', ')}{candidate.needsEvidence && ` · Required before selection: ${candidate.needsEvidence}`}</p>{!!candidate.tensions.length && <p>Competing signals, not exclusions: {candidate.tensions.join(', ')}</p>}</div>)}</details>
            <details className="taxonomy-questions"><summary>Next evidence questions · {classification.unanswered} unanswered</summary>{classification.questions.map(q => <p key={q.id}><code>{q.id}</code><br/>{q.question}</p>)}<p>{classification.assessment === 'no-fit' ? 'The relevant questions were answered, but no catalog role fits. Do not force a selection.' : 'Showing at most six focused questions; unanswered evidence remains unknown.'}</p></details>
            <p className="entry-meta">Assessed with {active.assessedCatalogVersion}; current catalog {taxonomy.catalogVersion}.</p>
            <h3>Suggested obligations · {classification.suggestions.length}</h3>
            {!classification.suggestions.length && <p className="muted">No suggestions activated. This does not establish complete coverage.</p>}
            {classification.suggestions.map(suggestion => <details className="taxonomy-obligation" key={suggestion.id}><summary><span>UNVERIFIED</span> {suggestion.id}</summary><p>{suggestion.text}</p><p>Activated by {suggestion.activatedBy} · catalog priority: {suggestion.level}</p><p>Needs a bounded contract and executable evidence. Verification and receipts are not implemented here.</p></details>)}
            <details><summary>Supporting files and freshness scope</summary><ul>{Object.entries(record.snapshot.files).map(([file, digest]) => <li key={file}><code>{file}</code> — {digest ? digest.slice(0, 12) : 'absent at capture'}</li>)}</ul><p>{taxonomy.limit}</p></details>
            <details><summary>Full immutable record</summary><pre>{JSON.stringify(record, null, 2)}</pre></details>
          </> : <p>Select a classification to inspect its evidence and suggested obligations.</p>}
        </article></div>
        <p className="muted">Catalog {taxonomy.catalogVersion}. {taxonomy.limit}</p>
      </>}
  </div>;
}
