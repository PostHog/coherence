import { useState } from 'react';
import { challengeCommand, bindingLabel } from './binding-reading.mjs';

function Challenge({ row }) {
  const [observation, setObservation] = useState(''), [session, setSession] = useState('');
  const command = challengeCommand(row, observation, session);
  return <details className="binding-challenge"><summary>Challenge this promise</summary>
    <p>Describe a concrete failing observation. Redact secrets and customer data.</p>
    <label>Observation<textarea aria-label="Counterexample observation" maxLength={2000} value={observation} onChange={e => setObservation(e.target.value)}/></label>
    <label>Your session<input aria-label="Challenge session" maxLength={120} value={session} onChange={e => setSession(e.target.value)}/></label>
    {command && <><p>Run from this project's root:</p><pre data-challenge-command>{command}</pre></>}
    <p>Draft only · not recorded · not delivered. Running the command records an open question in Journal; it does not prove an agent received it.</p>
  </details>;
}
export function BindingInspector({ model, subject, bindingId }) {
  const rows = model.catalogBindings?.items.filter(b => b.owner === subject.id && (!bindingId || b.id === bindingId)) ?? [];
  if (!rows.length) return null;
  return <section className="binding-inspector"><h3>Scoped catalog promises · {rows.length}</h3>
    <p>Explicit subjects, not component health or coverage.</p>
    {rows.map((row, index) => <details key={`${row.id}:${index}`} open><summary>{row.definition?.title ?? 'Invalid binding'}</summary>
      <p className="binding-state">{bindingLabel(row)}</p>
      {row.problems.map(p => <p role="alert" key={p}>{p}</p>)}
      {row.binding && <><p><code>{row.binding.subject}</code></p><p>{row.binding.because}</p>
        <p>Applicability assessed by {row.binding.assessor} · {row.status}</p>
        <dl>{Object.entries(row.binding.parameters).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
        <p><strong>Excluded:</strong> {row.binding.excludes}</p>
        <p><strong>Falsifier:</strong> {row.binding.falsifier}</p>
        <p>Oracle: <code>{row.observation.oracle}</code><br/>Run: {row.observation.at ?? 'none with this binding'}</p>
        {row.observation.detail && <p>{row.observation.detail}</p>}
        <details><summary>Definition and input identity</summary><p>{row.definition?.promise}</p><code>{row.id}</code>
          <p>Definition: {row.binding.definition} · candidate, portability unproven</p>
          <p>Input digest: {row.inputDigest ?? 'unavailable'}</p>
          <ul>{Object.keys(row.binding.evidence).map(p => <li key={p}><code>{p}</code></li>)}</ul>
          <p>Catalog example: {row.definition?.example.grade}. This is historical reference evidence, not this project's run.</p>
        </details><Challenge key={row.id} row={row}/></>}
    </details>)}<p>{model.catalogBindings.limit}</p>
  </section>;
}

function Endpoint({ endpoint }) {
  const [file, symbol] = endpoint.subject.split('#');
  return <div className="path-endpoint"><header>{endpoint.title}</header><code>{file}<br/><strong>{symbol}</strong></code></div>;
}

export function GuaranteePaths({ model, rows }) {
  const [selection, setSelection] = useState(null), [limit, setLimit] = useState(4);
  const selected = rows.find(r => r.id === selection) ?? rows[0];
  return <div className="guarantee-path-view">
    <section className="guarantee-paths" aria-label="Guarantee paths">
      <header><span className="eyebrow">WITHIN THE ASSEMBLY</span><h1>What may happen—and what must not</h1>
        <p>Authored relationships between implementation symbols. Each arrow carries a local promise, not an import.</p>
        <p>{Math.min(rows.length, limit)} paths shown · {Math.max(0, rows.length - limit)} withheld. Selected declarations—not coverage or component health.</p></header>
      {rows.slice(0, limit).map(row => <article className={`guarantee-path ${selected?.id === row.id ? 'selected' : ''}`} key={row.id}>
        <header><span>{model.nodes.find(n => n.id === row.owner)?.label ?? row.owner}</span><strong>{row.definition?.title}</strong></header>
        <div className="path-relationship"><Endpoint endpoint={row.binding.flow.from}/><span className="path-arrow" aria-hidden="true">→</span>
          <button className="path-promise" onClick={() => setSelection(row.id)} aria-pressed={selected?.id === row.id}>
            <strong>{model.guarantees.find(g => g.id === row.binding.claim)?.invariant ?? 'Local boundary unavailable'}</strong>
            <span className="binding-state">{bindingLabel(row)}</span><span>Inspect scope, falsifier and run ↗</span>
          </button><span className="path-arrow" aria-hidden="true">→</span><Endpoint endpoint={row.binding.flow.to}/></div>
        <p className="path-rationale">{row.binding.because}</p>
        {row.status !== 'current' && <p role="alert">Relationship declaration needs reassessment: {row.problems.join('; ')}</p>}
      </article>)}
      {rows.length > limit && <button onClick={() => setLimit(limit + 4)}>Show 4 more paths</button>}
      <section className="path-context"><h2>Infrastructure context</h2><p>These providers are separate from the internal paths above. Their imports do not establish guarantees.</p>
        {model.nodes.filter(n => model.relations.some(r => rows.some(b => b.owner === r.source) && r.target === n.id) && !rows.some(b => b.owner === n.id)).map(n => <div key={n.id}><h3>{n.label}</h3><p>{n.intent}</p>{n.prose && <p>{n.prose}</p>}</div>)}
      </section>
    </section>
    <aside aria-label="Selected guarantee">{selected && <BindingInspector model={model} subject={{ id: selected.owner }} bindingId={selected.id}/>}</aside>
  </div>;
}
