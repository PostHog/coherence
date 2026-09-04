import React, { useMemo, useState } from 'react';
import { journalEntries, filterEntries } from './journal-view.mjs';

function TextBlock({ title, text, empty = 'No text.' }) {
  return <details className="text-block"><summary>{title}</summary><pre>{text || empty}</pre></details>;
}

export function HooksPanel({ readings, session }) {
  const [host, setHost] = useState('codex');
  const [eventName, setEventName] = useState('SessionStart');
  const { control, sessions } = readings.hooks.hosts.find(h => h.host === host);
  const event = readings.hooks.events.find(e => e.event === eventName);
  const observation = session ? sessions[session] : null;
  return <div className="reading-panel hooks-panel">
    <header className="reading-header"><div><span className="eyebrow">AGENT LIFECYCLE</span><h1>Hooks</h1><p>What is configured to reach an agent—and what was actually observed.</p></div>
      <label>Agent host<select aria-label="Hook host" value={host} onChange={e => setHost(e.target.value)}><option value="codex">Codex</option><option value="claude">Claude</option></select></label></header>
    <div className="reading-notice">Read-only snapshot. Configuration is not execution; execution is not proof of repair.</div>
    <div className="hook-summary">
      <article><span className="eyebrow">INSTALLED CONTROL</span><h2>{!control.valid ? 'Unreadable' : control.present ? 'Present' : 'Absent / incomplete'}</h2><p>Canonical wiring: {control.wiringPresent ? 'present' : 'absent'}<br/>Runnable launcher: {control.launcher.present ? 'present' : 'absent'}</p></article>
      <article><span className="eyebrow">SELECTED SESSION</span><h2>{!session ? 'Choose a session' : observation?.unavailable ? 'Unavailable' : observation?.state ?? 'No observation'}</h2>
        {observation && !observation.unavailable ? <p>{observation.exactLauncherEvents} exact-bundle launcher events<br/>{observation.staleLauncherEvents} other-host / other-bundle events · {observation.directEvents} direct probes<br/>Last exact event: {observation.lastExactAt ?? 'none'}<br/>Trace attribution: {observation.trace.attribution}<br/>{observation.unreadableActivity} unreadable activity rows · {observation.trace.unreadable} unreadable trace rows</p>
          : <p>{observation?.unavailable ?? 'Use the session selector above. Absence of activity is not evidence of successful delivery.'}</p>}</article>
    </div>
    {!!control.warnings.length && <div className="reading-warning">{control.warnings.map((w, i) => <p key={i}>{w}</p>)}</div>}
    <div className="hook-workspace"><nav className="event-list" aria-label="Lifecycle events">
      {readings.hooks.events.map(e => <button key={e.event} aria-pressed={e.event === eventName} onClick={() => setEventName(e.event)}>
        <strong>{e.event}</strong><span>{e.override ? 'Project override' : 'Canonical'}{e.append ? ' + addition' : ''}</span></button>)}
    </nav><section className="hook-detail"><span className="eyebrow">TEXT & PROVENANCE</span><h2>{event.event}</h2>
      <p>{event.dynamic}</p>
      {event.runtimeDependent && <p className="reading-notice">Partial static template only. Runtime-dependent content is not captured here.</p>}
      {event.override && <p className="reading-notice">The project override replaces the entire canonical emission, including its dynamic parts.</p>}
      {!!event.problems.length && <div className="reading-warning">Customization damage: {event.problems.join('\n')}</div>}
      <TextBlock title="Composed static template" text={event.template} empty={event.runtimeDependent ? 'Text is composed at invocation; no fixed body is available.' : 'Silent — no static text is emitted.'}/>
      <TextBlock title="Canonical base" text={event.canonical} empty={event.event === 'SubagentStop' ? 'Runtime-composed child report.' : 'No canonical text.'}/>
      <TextBlock title={`Project override${event.override ? ` · ${event.override.path}` : ' · absent'}`} text={event.override?.text} empty={event.override ? 'Empty override: the canonical emission is silenced.' : 'No override file.'}/>
      <TextBlock title={`Project addition${event.append ? ` · ${event.append.path}` : ' · absent'}`} text={event.append?.text} empty="No added text."/>
      <p className="muted">Unsubstituted tokens remain visible. The template uses “coherence” as the illustrative CLI spelling; this is not a receipt of text delivered to a session.</p>
    </section></div>
    <TextBlock title="Installed bundle and inspection details" text={JSON.stringify(control, null, 2)}/>
  </div>;
}

function JournalDetail({ entry, onRelated }) {
  if (!entry) return <div className="journal-detail"><p>No entries match this view.</p></div>;
  const r = entry.raw;
  return <article className="journal-detail"><span className="eyebrow">{entry.kind} · {entry.state}</span><h2>{entry.title}</h2>
    <p className="entry-meta"><time>{entry.at}</time><br/>{entry.agent} · {entry.session}<br/><code>{entry.id}</code></p>
    {entry.related && <button onClick={() => onRelated(entry.related)}>Open related record · {entry.related}</button>}
    {r.because && <><h3>Because</h3><p className="preserve-text">{r.because}</p></>}
    {!!r.over?.length && <><h3>Rejected alternatives</h3><ul>{r.over.map((v, i) => <li key={i}>{v}</li>)}</ul></>}
    {!!r.couldBe?.length && <><h3>Candidate explanations</h3><ul>{r.couldBe.map((v, i) => <li key={i}>{v}</li>)}</ul></>}
    {r.discriminatedBy && <><h3>Discriminating observation</h3><p>{r.discriminatedBy}</p></>}
    {r.evidence && <><h3>Agent-assessed evidence</h3><p className="preserve-text">{r.evidence}</p><p className="muted">The defect ledger records an assessment, not machine proof or a repair status.</p></>}
    {r.actions && <><h3>Planned actions</h3><ul>{r.actions.map(a => <li key={a.id}>{a.id}: {a.text}</li>)}</ul><h3>Success criteria</h3><ul>{r.criteria.map(c => <li key={c.id}>{c.id}: {c.text}</li>)}</ul></>}
    {r.criterionResults && <><h3>Criterion evidence</h3>{r.criterionResults.map(c => <p key={c.id}><strong>{c.id} · {c.status}</strong><br/>{c.evidence}</p>)}</>}
    {!!entry.files.length && <><h3>Explicit context / file references</h3><ul>{entry.files.map((f, i) => <li key={i}><code>{f}</code></li>)}</ul></>}
    <TextBlock title="Complete source record" text={JSON.stringify(r, null, 2)}/>
  </article>;
}

export function JournalPanel({ readings, session, onSessionChange, feedStatus = 'snapshot' }) {
  const [mode, setMode] = useState('timeline');
  const [source, setSource] = useState('');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(30);
  const [selectedKey, setSelectedKey] = useState(null);
  const entries = useMemo(() => journalEntries(readings), [readings]);
  const filtered = filterEntries(entries, { session, mode, source, query });
  const selected = filtered.find(e => e.key === selectedKey) ?? filtered[0];
  const outstanding = filterEntries(entries, { session, mode: 'outstanding' }).length;
  const change = (setter, value) => { setter(value); setLimit(30); };
  const related = id => { onSessionChange(''); setMode('timeline'); setSource(''); setQuery(id); setLimit(30); setSelectedKey(null); };
  return <div className="reading-panel journal-panel">
    <header className="reading-header"><div><span className="eyebrow">DURABLE PROJECT MEMORY</span><h1>Journal</h1><p>Decisions, questions, defects and experiments—with their original provenance.</p></div><span className="reading-count">{entries.length} captured records</span></header>
    <div className="reading-notice">{feedStatus === 'snapshot' ? 'Snapshot, not a live feed. Run the local server for automatic updates.' : 'Read-only local feed. New records repopulate automatically; filters and selected entries stay in place.'} {outstanding} outstanding in this session scope.</div>
    {!!readings.journal.unreadable && <div className="reading-warning">{readings.journal.unreadable} unreadable journal rows. This view is incomplete.</div>}
    {readings.errors.map((e, i) => <div className="reading-warning" key={i}>{e.source} unavailable: {e.message}</div>)}
    <div className="journal-filters"><label>View<select aria-label="Journal view" value={mode} onChange={e => change(setMode, e.target.value)}><option value="timeline">Timeline · newest first</option><option value="outstanding">Outstanding</option></select></label>
      <label>Record source<select aria-label="Journal source" value={source} onChange={e => change(setSource, e.target.value)}><option value="">All sources</option><option value="journal">Decisions & questions</option><option value="defects">Defects</option><option value="experiments">Experiments</option></select></label>
      <label className="journal-search">Search<input aria-label="Search journal" value={query} placeholder="Text, evidence, record ID or path…" onChange={e => change(setQuery, e.target.value)}/></label></div>
    {mode === 'outstanding' && <p className="muted">Open conjectures, recorded blockers, and open experiments. Defects have no closure state in their ledger and are not presumed unresolved. Answers and dismissals are resolved over the complete captured journal before session filtering.</p>}
    <div className="journal-workspace"><section className="journal-list" aria-label="Journal entries">
      <p className="list-count">Showing {Math.min(limit, filtered.length)} of {filtered.length} matching records</p>
      {filtered.slice(0, limit).map(e => <button className="journal-row" key={e.key} aria-pressed={selected?.key === e.key} onClick={() => setSelectedKey(e.key)}>
        <span className="entry-meta">{e.at.replace('T', ' ').slice(0, 19)} UTC · {e.agent}</span><strong>{e.title}</strong><span className="entry-kind">{e.kind} · {e.state}</span></button>)}
      {!filtered.length && <p className="empty-reading">No matching records. Try clearing the search or session filter.</p>}
      {filtered.length > limit && <button className="more-records" onClick={() => setLimit(limit + 30)}>Show 30 more · {filtered.length - limit} remaining</button>}
    </section><JournalDetail entry={selected} onRelated={related}/></div>
  </div>;
}
