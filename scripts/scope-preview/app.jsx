import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as Tabs from '@radix-ui/react-tabs';
import { ReactFlow, ReactFlowProvider, Controls, ControlButton, Handle, Position,
  MarkerType, useReactFlow, useStore, BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, getStraightPath } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './style.css';
import { defaults, layoutScope, lightOf } from './layout.mjs';
import { HooksPanel, JournalPanel } from './panels.jsx';
import { useLiveReadings } from './live.jsx';
import { TaxonomyPanel } from './taxonomy-panel.jsx';
import { taxonomyWithin } from './card-taxonomy.mjs';
import { specEvidence } from './spec-evidence.mjs';
import { scopeScene } from './scene.mjs';
import { OrbitCanvas } from './orbits.jsx';
import { relianceReading } from './guarantee-reading.mjs';
import { BindingInspector } from './bindings.jsx';
import { bindingLabel } from './binding-reading.mjs';
import { attention, detailLevel, mapConnections, declaredSubjects, subjectGeometry } from './semantic.mjs';

const snapshot = JSON.parse(document.getElementById('scope-data').textContent);
const emptyModel = { nodes: [], relations: [], guarantees: [], center: null };
const labels = { fail: '× Failing', stale: '◷ Stale evidence', unknown: '? Unknown', pass: '✓ Passing', unmeasured: '— Unmeasured' };
const ports = [[Position.Left, 0, 0.5], [Position.Right, 1, 0.5], [Position.Top, 0.5, 0], [Position.Bottom, 0.5, 1]];

const readDetail = state => detailLevel(state.transform[2]);
function SubjectMap({ subjects }) {
  const geometry = useMemo(() => subjectGeometry(subjects), [subjects]);
  const positions = new Map(geometry.nodes.map(n => [n.id, n]));
  return <div className="subject-map nodrag nowheel">
    <p>Local gravity: guarantee incidence across {subjects.nodes.length} declared subjects.
      {subjects.centers.length > 1 ? ` ${subjects.centers.length} tied centers; no unique center.` : ' Double outline marks the incidence center.'}</p>
    <svg viewBox={geometry.bounds} role="img" aria-label="Declared subjects and directed guarantee paths">
      {geometry.edges.map((e, i) => { const a = positions.get(e.source), b = positions.get(e.target);
        const side = i % 2 ? -1 : 1, port = side > 0 ? Position.Bottom : Position.Top;
        const [path] = getBezierPath({ sourceX: a.x, sourceY: a.y + side * 35, sourcePosition: port,
          targetX: b.x, targetY: b.y + side * 35, targetPosition: port });
        const marker = `local-arrow-${encodeURIComponent(e.id)}`;
        return <g key={e.id}><defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#566b80"/></marker></defs><path d={path} fill="none" stroke="#566b80" strokeWidth="2" markerEnd={`url(#${marker})`}><title>{e.label}: {e.source} → {e.target}</title></path></g>;
      })}
      {geometry.nodes.map(n => <g key={n.id} className="local-subject" data-subject={n.id}>
        <title>{n.id} · {n.grade} · {n.mass} guarantees</title>
        <rect x={n.x - 85} y={n.y - 35} width="170" height="70" rx="10" fill="white" stroke="#526b83"/>
        {subjects.centers.includes(n.id) && <rect x={n.x - 81} y={n.y - 31} width="162" height="62" rx="7" fill="none" stroke="#526b83"/>}
        <text x={n.x} y={n.y - 4} textAnchor="middle" fontSize="13">{n.label.length > 23 ? n.label.slice(0, 22) + '…' : n.label}</text>
        <text x={n.x} y={n.y + 17} textAnchor="middle" fontSize="12">{n.mass} scoped guarantees</text>
      </g>)}
    </svg>
    {geometry.withheld > 0 && <p>{geometry.withheld} subjects outside this bounded reading.</p>}
    {!subjects.nodes.length && <p>No declared enforcement subjects. Internal topology is unknown.</p>}
    {subjects.edges.map(e => <details key={e.id}><summary>{e.label} · {bindingLabel(e.row)}</summary><code>{e.source} → {e.target}</code></details>)}
    <p>Declared population only, not a complete call graph. Anchors without bindings are spec names, not resolved addresses.</p>
  </div>;
}

const ComponentCard = memo(function ComponentCard({ data }) {
  const { subject, center, guarantees, taxonomy } = data;
  const detail = useStore(readDetail);
  const [expanded, setExpanded] = useState(false);
  const subjects = useMemo(() => declaredSubjects(guarantees, data.bindings ?? []), [guarantees, data.bindings]);
  const attentionText = attention(guarantees, data.bindings, data.linkIssues);
  return <Tabs.Root defaultValue={guarantees.length || data.bindings?.length ? 'guarantees' : 'description'} asChild><article data-detail={detail} className={`component-card ${center ? 'gravity-center' : ''}`}>
    <header title={subject.label}><strong>{subject.label}</strong>{center && <span title="Project center of gravity">✦</span>}
      <Tabs.List className="card-views nodrag" onClick={e => e.stopPropagation()} aria-label={`${subject.label} card reading`}>
        <Tabs.Trigger value="description" data-card-view="description">Description</Tabs.Trigger>
        <Tabs.Trigger value="guarantees" data-card-view="guarantees">Guarantees</Tabs.Trigger>
      </Tabs.List></header>
    <div className="semantic-summary"><strong>{guarantees.length} guarantees</strong><p className="scope-attention">{attentionText}</p>
      <p className="summary-purpose">{subject.intent || 'No authored description.'}</p>
      <p className="summary-taxonomy">{taxonomy.roles.slice(0, 2).map(r => r.label).join(' · ') || 'No taxonomy assessments'}</p>
      <div className="summary-promises">{guarantees.slice(0, 2).map(g => <p key={g.id}>{g.invariant}</p>)}{guarantees.length > 2 && <small>+{guarantees.length - 2} guarantees · zoom to read</small>}</div>
    </div>
    <button className="expand-subjects nodrag" onClick={e => { e.stopPropagation(); setExpanded(!expanded); }}>{expanded ? 'Collapse subjects' : `Expand subjects · ${subjects.nodes.length}`}</button>
    {expanded && detail === 'detail' && <SubjectMap subjects={subjects}/>}
    <Tabs.Content value="description" forceMount className={`card-description card-reading nodrag nowheel ${expanded ? 'subjects-expanded' : ''}`} tabIndex={0} aria-label={`${subject.label} spec description`}>
      <p className="spec-intent">{subject.intent || 'No authored description.'}</p>
      {subject.prose && <p className="spec-prose">{subject.prose}</p>}
    </Tabs.Content>
    <Tabs.Content value="guarantees" forceMount className={`card-reading card-guarantees nodrag nowheel ${expanded ? 'subjects-expanded' : ''}`} tabIndex={0} aria-label="Declared guarantees">
        <h3>GUARANTEES · {guarantees.length}</h3>
        <small>{data.obligationsAvailable ? `${data.obligations.filter(o => o.mapping === 'unlinked').length} unlinked taxonomy obligations` : 'Obligation reading unavailable'} · satisfaction unverified</small>
        {!!data.linkIssues && <small role="alert">{data.linkIssues} guarantee links need repair</small>}
        {(data.bindings ?? []).map((b, i) => <div key={`${b.id}:${i}`} className="card-binding"><strong>{b.definition?.title ?? 'Invalid binding'}</strong><p>{guarantees.find(g => g.id === b.binding?.claim)?.invariant}</p><code>{b.binding?.subject}</code><small>{bindingLabel(b)}</small></div>)}
        {guarantees.filter(g => !(data.bindings ?? []).some(b => b.binding?.claim === g.id)).map(g => <div key={g.id}><span className={`status ${g.verdict}`}>{labels[g.verdict]}</span><p>{g.invariant}</p></div>)}
        {!guarantees.length && <p>No declared guarantees · not a pass.</p>}
    </Tabs.Content>
    <div className={`card-taxonomy ${taxonomy.stale ? 'has-stale' : ''} ${taxonomy.items.length ? '' : 'no-assessments'}`} aria-label="Taxonomy within component">
      <div className="taxonomy-kicker">TAXONOMY WITHIN <span>{taxonomy.available ? `${taxonomy.items.length} subject${taxonomy.items.length === 1 ? '' : 's'}` : 'UNAVAILABLE'}</span></div>
      {!taxonomy.available ? <strong className="taxonomy-empty">{taxonomy.message}</strong>
        : !taxonomy.items.length ? <strong className="taxonomy-empty">No assessments recorded</strong>
          : !taxonomy.roles.length ? <strong className="taxonomy-empty">No selected roles</strong>
            : <div className="card-taxonomy-roles">{taxonomy.roles.slice(0, 2).map(role => <div key={role.id} title={`${role.label}: ${role.count} subject(s), ${role.stale} stale`}><strong>{role.label}</strong><span>×{role.count}{role.stale ? ' ◷' : ''}</span></div>)}</div>}
      <div className="card-taxonomy-facets">{taxonomy.facets.slice(0, 2).map(facet => <span key={facet.id} title={`${facet.count} subject(s), ${facet.stale} stale`}>{facet.label}</span>)}
        {(taxonomy.roles.length > 2 || taxonomy.facets.length > 2) && <small>+{Math.max(0, taxonomy.roles.length - 2)} roles · +{Math.max(0, taxonomy.facets.length - 2)} facets</small>}</div>
      <div className="card-taxonomy-state" title={taxonomy.issues?.join(' · ')}>{taxonomy.issues?.join(' · ') || (taxonomy.items.length ? 'Caller-assessed · not verified' : 'File / symbol assessments · not component roles')}</div>
    </div>
    <div className="card-body">
      <div className="card-counts">{subject.mass.ownedFiles} files <span>·</span> {guarantees.length} guarantees <span>·</span> {data.transitions} transitions</div>
      <footer><span className="status unmeasured">{attentionText} · not component health</span><code>{subject.id}</code></footer>
    </div>
    {data.handles.map(handle => <Handle key={handle.id} id={handle.id} type={handle.type}
      position={handle.position} isConnectable={false} style={{ left: handle.x, top: handle.y,
        right: 'auto', bottom: 'auto', width: 0, height: 0, minWidth: 0, minHeight: 0, border: 0, transform: 'none' }}/>) }
  </article></Tabs.Root>;
});
const nodeTypes = { component: ComponentCard };
function MapEdge(props) {
  const { data } = props;
  const route = data.route === 'straight' ? getStraightPath : data.route === 'smoothstep' ? getSmoothStepPath : getBezierPath;
  const [path] = route(props);
  const offset = props.sourcePosition === Position.Left ? 'translate(-100%, -50%) translateX(-8px)' : props.sourcePosition === Position.Right ? 'translate(0, -50%) translateX(8px)' : props.sourcePosition === Position.Top ? 'translate(-50%, -100%) translateY(-8px)' : 'translate(-50%, 0) translateY(8px)';
  return <><BaseEdge {...props} path={path}/>{data.kind === 'promise' && <EdgeLabelRenderer>
    <button className="map-promise-label nodrag nopan" data-owner={props.source} style={{ transform: `translate(${props.sourceX}px, ${props.sourceY}px) scale(var(--scope-reading-scale, 1)) ${offset}`, transformOrigin: '0 0' }}
      title={`${data.targetLabel}: ${data.title}`} onClick={e => { e.stopPropagation(); data.inspect(props.id); }} aria-label={`Inspect guarantee connection: ${data.title}`}>
      G·{data.count}
    </button>
  </EdgeLabelRenderer>}</>;
}
const edgeTypes = { scope: MapEdge };
// Select one of the library's four standard ports. No custom curves or routing.
function facing(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  return Math.abs(dx) / defaults.width > Math.abs(dy) / defaults.height ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top');
}

function Reliance({ relation, byId, model }) {
  const rows = relianceReading(model, relation);
  return <div className="reliance-record">
    <p><strong>{byId.get(relation.source).label}</strong> → <strong>{byId.get(relation.target).label}</strong></p>
    {!rows.length && <p>No guarantee linked. Import adjacency only.</p>}
    {rows.map(({ link, guarantee }, i) => <div key={i} className="guarantee-evidence">
      <p><strong>{guarantee?.invariant ?? 'Missing or changed guarantee'}</strong></p>
      <p>Link: {link.status} · caller-assessed</p><p>{link.because}</p>
      {guarantee && <><span className={`status ${guarantee.verdict}`}>{labels[guarantee.verdict]}</span><p>At <code>{guarantee.chokepoint}</code> · grade {guarantee.grade}<br/>Oracle: {guarantee.oracle || 'none'}</p></>}
      {link.problems.map(p => <p role="alert" key={p}>{p}</p>)}
    </div>)}
    <small>{relation.kind === 'evidence-import' ? 'Test imports implementation · not proof of an oracle' : relation.crossing ? `${relation.crossing.from} → ${relation.crossing.to}` : 'No declared boundary crossing'}{relation.via ? ` · via ${relation.via}` : ''}</small>
  </div>;
}

function ObligationInspector({ model, subject }) {
  const report = model.guaranteeLinks;
  const rows = (report?.obligations ?? []).filter(o => o.owner === subject.id);
  const issues = (report?.links ?? []).filter(l => l.owner === subject.id && l.status !== 'current');
  return <div className="obligation-inspector"><h3>Taxonomy → guarantees · {rows.length} obligations</h3>
    <p>Applicability and mappings are caller-assessed. Satisfaction remains unverified; test evidence is separate.</p>
    {(!report || report.taxonomy === 'unavailable') && <p role="alert">Obligation reading unavailable.</p>}
    {!rows.length && <p>No activated obligations recorded for this component. This is not coverage.</p>}
    {rows.map(o => <details key={`${o.subject}:${o.obligation}`}><summary>{o.text} · {o.mapping}</summary>
      <p><code>{o.subject}</code><br/>Applicability: {o.applicability} · {o.assessmentState}</p>
      {o.claims.map(id => { const g = model.guarantees.find(g => g.id === id); return g && <p key={id}>{g.invariant}<br/><span className={`status ${g.verdict}`}>{labels[g.verdict]}</span></p>; })}
      <p>Satisfaction: {o.satisfaction}</p>
    </details>)}
    {issues.map((l, i) => <p role="alert" key={i}>{l.kind}: {l.status} — {l.problems.join('; ')}</p>)}
  </div>;
}

function TransitionInspector({ model, subject }) {
  const [limit, setLimit] = useState(6);
  const transitions = (model.transitions ?? []).filter(t => t.component === subject.id || (subject.role === 'project' && t.component === null));
  return <div className="transition-inspector">
    {subject.role === 'project' && model.charts && <details><summary>Trust domains · {Object.keys(model.charts).length}</summary>{Object.entries(model.charts).map(([name, description]) => <p key={name}><strong>{name}</strong><br/>{description}</p>)}</details>}
    <h3>{subject.role === 'project' ? 'Unassigned boundary declarations' : 'Boundary meanings'} · {transitions.length}</h3>
    <p className="muted">Project-authored atlas semantics. These are not import edges or new verification results.</p>
    {!transitions.length && <p className="muted">No atlas transitions assigned to this component.</p>}
    {transitions.slice(0, limit).map(t => <details key={t.symbol} className="transition-reading"><summary>{t.from} → {t.to}<br/><code>{t.symbol}</code>{t.security && ' · security crossing'}</summary>
      <p className="preserve-text">{t.translates}</p>{t.ownerWhy && <p>{t.ownerWhy}</p>}
      {t.declaredAnchor && <p>Declared anchor: <code>{t.declaredAnchor}</code></p>}
      <h4>Named enforcement references · {t.guarantees.length}</h4>
      {t.guarantees.map(id => { const g = model.guarantees.find(g => g.id === id); return g && <p key={id}><span className={`status ${g.verdict}`}>{labels[g.verdict]}</span> {g.invariant}<br/>Oracle: {g.oracle}</p>; })}
      {!t.guarantees.length && <p>No matching canonical boundary claim. The description is not proof.</p>}
    </details>)}
    {transitions.length > limit && <button onClick={() => setLimit(limit + 6)}>Show more boundary meanings · {transitions.length - limit} remaining</button>}
  </div>;
}

function SpecInspector({ subject, guarantees }) {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(8);
  const rows = specEvidence(subject, guarantees);
  const matches = rows.filter(row => [row.name, ...row.rationale, ...row.refutations,
    ...row.gates.map(g => `${g.chokepoint} ${g.oracle} ${g.verdict}`)].join(' ').toLowerCase().includes(query.toLowerCase()));
  return <div className="spec-inspector">
    {subject.prose && <p className="spec-prose">{subject.prose}</p>}
    <span className="muted">Original spec text · no generated briefing</span>
    <h3>Invariants & enforcement · {rows.length}</h3>
    {!guarantees.length && <p>Unmeasured — no guarantees. This is not a pass.</p>}
    {!!rows.length && <>
      <label className="evidence-search">Find an invariant or oracle<input type="search" value={query} onChange={e => { setQuery(e.target.value); setLimit(8); }}/></label>
      <p className="muted">Showing {Math.min(limit, matches.length)} of {matches.length}. Rationale links are literal-name mentions, not verification.</p>
      {matches.slice(0, limit).map(row => <details className="invariant-evidence" key={row.name}>
        <summary>{row.name}<span className="evidence-states">{row.gates.length ? labels[lightOf(row.gates)] : '— Unanchored'}</span></summary>
        {!row.declared && <p>Boundary names this property; no matching declaration in the spec’s invariant list.</p>}
        <h4>Why</h4>{row.rationale.length ? row.rationale.map((p, i) => <p className="spec-prose" key={i}>{p}</p>) : <p>No literal-name rationale link. See the original why below.</p>}
        <h4>Enforcement · {row.gates.length}</h4>{!row.gates.length && <p>No canonical boundary for this declaration.</p>}
        {row.gates.map(g => <div className="guarantee-evidence" key={g.id}><span className={`status ${g.verdict}`}>{labels[g.verdict]}</span>
          <p>Grade {g.grade} · <code>{g.chokepoint}</code></p><p>Oracle: {g.oracle}</p>{g.crossing && <p>{g.crossing.from} → {g.crossing.to}</p>}</div>)}
        <h4>Recorded refutations · {row.refutations.length}</h4>{row.refutations.length ? row.refutations.map((r, i) => <p className="spec-prose" key={i}>{r}</p>) : <p>No named negative control recorded. Absence is not a pass.</p>}
      </details>)}
      {matches.length > limit && <button className="more-records" onClick={() => setLimit(limit + 8)}>Show 8 more invariants · {matches.length - limit} remaining</button>}
    </>}
    <details className="spec-source"><summary>Original why · full text</summary><p className="spec-prose">{subject.why || 'No authored rationale.'}</p></details>
    <details className="spec-source"><summary>All works-when claims · {subject.claims?.length ?? 0}</summary>{(subject.claims ?? []).map((c, i) => <p className="spec-prose" key={i}>{c}{subject.claimKinds?.[c] && ` [${subject.claimKinds[c]}]`}</p>)}</details>
    <details className="spec-source"><summary>All recorded refutations · {subject.refutations?.length ?? 0}</summary>{(subject.refutations ?? []).map((r, i) => <p className="spec-prose" key={i}>{r}</p>)}</details>
  </div>;
}

function StructureReading(props) {
  return <Structure {...props}/>;
}

const Structure = memo(function Structure({ model, structure, readings, selected, setSelected }) {
  const [config, setConfig] = useState(defaults);
  const [edgeType, setEdgeType] = useState('default');
  const [connectionId, setConnectionId] = useState(null);
  const [focusEdges, setFocusEdges] = useState(true);
  const [ready, setReady] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [showImports, setShowImports] = useState(true);
  const [showRings, setShowRings] = useState(false);
  const flow = useReactFlow();
  const [owner, setOwner] = useState(undefined);
  const [page, setPage] = useState(0);
  const [all, setAll] = useState(true);
  const scene = useMemo(() => scopeScene(model, { owner, page, all }), [model, owner, page, all]);
  const byId = useMemo(() => new Map(model.nodes.map(n => [n.id, n])), [model.nodes]);
  const guaranteeIndex = useMemo(() => new Map(model.nodes.map(n => [n.id, model.guarantees.filter(g => g.component === n.id)])), [model.nodes, model.guarantees]);
  const guaranteesFor = id => guaranteeIndex.get(id) ?? [];
  const taxonomies = useMemo(() => new Map(model.nodes.map(n => [n.id, taxonomyWithin(readings, n.graphNodeId)])), [model, readings.taxonomy, readings.errors]);
  // Evidence/text updates do not change geometry. Do not cache subject data in
  // this projection, or a reused position could carry an obsolete verdict.
  const geometryKey = JSON.stringify({ center: scene.model.center,
    nodes: scene.model.nodes.map(({ id, ring, disconnected }) => ({ id, ring, disconnected: !!disconnected })),
    relations: scene.model.relations.map(({ id, source, target }) => ({ id, source, target })) });
  const geometry = useMemo(() => layoutScope(JSON.parse(geometryKey), config), [config, geometryKey]);
  const layout = useMemo(() => ({ ...geometry,
    nodes: geometry.nodes.map(n => ({ ...byId.get(n.id), ...n })),
    connections: geometry.connections.map(c => ({ ...c, members: c.members.map(r => model.relations.find(live => live.id === r.id)) })),
  }), [geometry, byId, model.relations]);
  const positioned = useMemo(() => new Map(layout.nodes.map(n => [n.id, n])), [layout]);
  const connections = useMemo(() => mapConnections(model, layout.connections), [model.guaranteeLinks, model.guarantees, layout.connections]);
  const selectedConnection = connections.find(c => c.id === connectionId);
  const subject = positioned.get(selected) ?? byId.get(selected);
  const taxonomy = taxonomies.get(selected);
  const guarantees = subject ? guaranteesFor(subject.id) : [];
  const overview = useCallback(() => flow.fitBounds(geometry.bounds, { padding: 0.04, duration: 0 }), [flow, geometry]);
  // Fit on startup/explicit parameter changes, never on incoming repository updates.
  const [fitted, setFitted] = useState(false);
  useEffect(() => { if (ready && model.nodes.length && !fitted) { overview(); setFitted(true); } }, [ready, model, fitted]);
  useEffect(() => { if (ready && fitted) overview(); }, [config]);
  useEffect(() => { if (ready && fitted) overview(); }, [owner, page, all]);
  useEffect(() => {
    if (connectionId && !connections.some(c => c.id === connectionId)) setConnectionId(null);
  }, [connections, connectionId]);
  const handles = useMemo(() => ports.flatMap(([position, x, y]) => ['source', 'target'].map(type => ({
    id: `${type}-${position}`, type, position,
    x: (x === .5 ? type === 'source' ? .4 : .6 : x) * config.width,
    y: (y === .5 ? type === 'source' ? .4 : .6 : y) * config.height, width: 0, height: 0,
  }))), [config.width, config.height]);
  const cardNodes = useMemo(() => layout.nodes.map(n => ({ id: n.id, type: 'component', position: { x: n.x - config.width / 2, y: n.y - config.height / 2 },
    data: { subject: n, center: n.id === model.center, handles, guarantees: guaranteesFor(n.id), bindings: (model.catalogBindings?.items ?? []).filter(b => b.owner === n.id), taxonomy: taxonomies.get(n.id), transitions: (model.transitions ?? []).filter(t => t.component === n.id).length,
      obligationsAvailable: model.guaranteeLinks?.taxonomy === 'available', obligations: (model.guaranteeLinks?.obligations ?? []).filter(o => o.owner === n.id), linkIssues: (model.guaranteeLinks?.links ?? []).filter(l => l.owner === n.id && l.status !== 'current').length },
    // Fixed geometry is already known. Supplying the library's dimensions and
    // handles avoids a second DOM measurement representation that can stay hidden.
    width: config.width, height: config.height,
    handles, ariaLabel: n.label })), [layout, config.width, config.height, model.center, handles, guaranteeIndex, taxonomies, model.transitions, model.guaranteeLinks, model.catalogBindings]);
  const nodes = useMemo(() => cardNodes.map(n => ({ ...n, selected: selected === n.id && !connectionId })), [cardNodes, selected, connectionId]);
  const inspectConnection = useCallback(id => { setConnectionId(id); setInspecting(true); }, []);
  const edges = useMemo(() => connections.filter(c => showImports || c.kind === 'promise').map(c => {
    const from = positioned.get(c.source), to = positioned.get(c.target);
    const active = connectionId ? c.id === connectionId : c.source === selected || c.target === selected;
    const promise = c.kind === 'promise';
    const color = promise ? '#365a78' : '#9baaba';
    return { id: c.id, source: c.source, target: c.target, type: 'scope',
      sourceHandle: `source-${facing(from, to)}`, targetHandle: `target-${facing(to, from)}`,
      ...(promise ? { markerEnd: { type: MarkerType.ArrowClosed, color, width: 24, height: 24 } } : {}),
      data: { kind: c.kind, route: edgeType, active: c.id === connectionId, count: c.promises?.length ?? 0,
        targetLabel: byId.get(c.target).label,
        title: promise ? c.promises.map(p => p.guarantee?.invariant ?? 'Guarantee link needs repair').join(' · ') : 'Import adjacency', inspect: inspectConnection },
      style: { stroke: color, strokeWidth: promise ? 3 : 1.2, strokeDasharray: promise ? undefined : '6 6', opacity: promise ? 1 : focusEdges && !active ? 0.16 : 0.4 },
      interactionWidth: 24, selected: c.id === connectionId,
      ariaLabel: `${byId.get(c.source).label} → ${byId.get(c.target).label}: ${promise ? 'declared guarantee reliance' : 'import adjacency only'}`,
    };
  }), [connections, positioned, connectionId, selected, edgeType, focusEdges, byId, showImports, inspectConnection]);
  const selectNode = useCallback(id => { setSelected(id); setConnectionId(null); setInspecting(true); }, [setSelected]);
  const onInit = useCallback(() => setReady(true), []);
  const onNodeClick = useCallback((_, n) => selectNode(n.id), [selectNode]);
  const onEdgeClick = useCallback((_, e) => inspectConnection(e.id), [inspectConnection]);
  const onPaneClick = useCallback(() => setConnectionId(null), []);
  const onMove = useCallback((_, viewport) => {
    // CSS-only compensation on zoom; pan does not rerender cards or change type.
    const stage = document.querySelector('.semantic-map .graph-stage');
    const value = String(Math.max(1, 1 / viewport.zoom));
    if (stage && stage.style.getPropertyValue('--scope-reading-scale') !== value) stage.style.setProperty('--scope-reading-scale', value);
  }, []);
  return <main className="structure-view semantic-map">
    <section className={`canvas ${scene.project || scene.total > 4 ? 'has-hierarchy' : ''}`} aria-label="Project scope">
      {(scene.project || scene.total > 4) && <div className="project-context">
        <div><button className="project-name" onClick={() => scene.project && selectNode(scene.project.id)}>{scene.project?.label ?? model.root}</button>
          <span> / </span><select aria-label="Assembly group" value={scene.owner ?? ''} onChange={e => { setOwner(e.target.value || null); setPage(0); }}>{[<option key="all" value="">All groups</option>, ...scene.groups.map(g => <option key={g.id} value={g.id}>{g.label}</option>)]}</select>
          {scene.evidence.map(n => <button key={n.id} className="evidence-surface" onClick={() => selectNode(n.id)}>Evidence: {n.label}</button>)}
        </div>
        <div className="assembly-pagination"><span>{layout.nodes.length} of {scene.total} assemblies shown · {scene.withheld} elsewhere · {scene.omittedRelations} imports outside this view</span>
          {!all && scene.pages > 1 && <><button aria-label="Previous assemblies" disabled={scene.page === 0} onClick={() => setPage(scene.page - 1)}>←</button><span>{scene.page + 1} / {scene.pages}</span><button aria-label="Next assemblies" disabled={scene.page === scene.pages - 1} onClick={() => setPage(scene.page + 1)}>→</button></>}
          <button onClick={() => { setAll(!all); setPage(0); }}>{all ? 'Readable groups' : 'Whole-project overview'}</button>
          <button onClick={() => setInspecting(!inspecting)}>{inspecting ? 'Hide inspector' : 'Inspector & settings'}</button>
        </div>
      </div>}
      {structure?.status === 'unavailable' && <div className="structure-warning" role="alert">Structure unavailable — {structure.model ? 'showing last known model, not current evidence.' : 'waiting for a readable project.'}<details><summary>Details</summary>{structure.message}</details></div>}
      <div className="graph-stage"><OrbitCanvas rings={showRings ? geometry.rings : []}/><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} minZoom={0.1} maxZoom={2}
        nodesDraggable={false} nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null}
        onInit={onInit} onMove={onMove} onNodeClick={onNodeClick} onEdgeClick={onEdgeClick} onPaneClick={onPaneClick}>
        <Controls showFitView={false} showInteractive={false}>
          <ControlButton onClick={overview} title="Fit displayed assemblies" aria-label="Fit displayed assemblies">⊞</ControlButton>
          <ControlButton onClick={() => setInspecting(!inspecting)} title="Inspector & settings" aria-label="Inspector & settings">ⓘ</ControlButton>
        </Controls>
      </ReactFlow></div>
      <div className="canvas-caption"><span>Center of gravity: <strong>{byId.get(model.center)?.label ?? 'none'}</strong></span><span>Solid arrows: declared promises · G: inspect guarantees · dashed: imports · zoom reveals detail · no component health score.</span></div>
      {!model.nodes.length && <div className="empty">No components in this snapshot.</div>}
    </section>
    {inspecting && <aside className="map-inspector">
      <button className="close-inspector" onClick={() => setInspecting(false)}>Close inspector</button>
      <details className="parameters"><summary>View parameters</summary><p>Change the view. The evidence stays put.</p>
        {[['gap', 'Spacing', 16, 180], ['rotation', 'Rotation', -180, 180], ['sweep', 'Arc spread', 140, 330]].map(([key, label, min, max]) =>
          <label key={key}>{label}<output>{config[key]}{key === 'gap' ? ' px' : '°'}</output>
            <input aria-label={label} type="range" min={min} max={max} value={config[key]} onChange={e => setConfig({ ...config, [key]: Number(e.target.value) })}/></label>)}
        <label>Connections<select aria-label="Connection style" value={edgeType} onChange={e => setEdgeType(e.target.value)}><option value="default">Bézier</option><option value="smoothstep">Rounded steps</option><option value="straight">Straight</option></select></label>
        <label className="checkbox"><input type="checkbox" checked={focusEdges} onChange={e => setFocusEdges(e.target.checked)}/> Emphasize selected connections</label>
        <label className="checkbox"><input type="checkbox" checked={showImports} onChange={e => setShowImports(e.target.checked)}/> Show imports</label>
        <label className="checkbox"><input type="checkbox" checked={showRings} onChange={e => setShowRings(e.target.checked)}/> Show reliance rings</label>
        <button onClick={() => { setConfig(defaults); setEdgeType('default'); setFocusEdges(true); }}>Reset view parameters</button>
      </details>
      <section className="inspector" aria-label="Inspector">
        {!!model.guaranteeLinks?.issues.length && <details className="taxonomy-issues"><summary>Guarantee link issues · {model.guaranteeLinks.issues.length}</summary>{model.guaranteeLinks.issues.map((p, i) => <p key={i}>{p}</p>)}</details>}
        {selectedConnection ? <><span className="eyebrow">CONNECTION</span><h2>Guarantees consumed</h2>
          <p>Each direction is a separate authored reliance, not proof of consumption.</p>
          {selectedConnection.members.map(r => <Reliance key={r.id} relation={r} byId={byId} model={model}/>)}
        </> : subject ? <><span className="eyebrow">{subject.role === 'project' ? 'PROJECT CONTAINER' : subject.role === 'evidence' ? 'EVIDENCE SURFACE · NOT RUNTIME RELIANCE' : subject.id === model.center ? 'PROJECT CENTER OF GRAVITY' : subject.disconnected ? 'UNCONNECTED COMPONENT' : `RELIANCE RING ${subject.ring}`}</span>
          <h2>{subject.label}</h2><code>{subject.id}</code><p>{subject.intent}</p>
          {subject.parent && <p className="containment-reading">Contained by <button onClick={() => selectNode(subject.parent)}>{byId.get(subject.parent)?.label ?? subject.parent}</button></p>}
          {!!model.containment?.filter(c => c.parent === subject.id).length && <div className="contained-assemblies"><h3>Contains</h3>{model.containment.filter(c => c.parent === subject.id).map(c => <button key={c.child} onClick={() => selectNode(c.child)}>{byId.get(c.child)?.label ?? c.child}</button>)}</div>}
          <BindingInspector model={model} subject={subject}/>
          <TransitionInspector model={model} subject={subject}/>
          <ObligationInspector model={model} subject={subject}/>
          <SpecInspector key={subject.id} subject={subject} guarantees={guarantees}/>
          <div className="taxonomy-inspector"><h3>Taxonomy within · {taxonomy.items.length} subjects</h3>
            <p>File/symbol assessments under this recorded owner, across all sessions. Not a classification of the whole component or a coverage percentage.</p>
            {!taxonomy.available ? <p role="alert">{taxonomy.message}</p> : <>
              {!!taxonomy.issues.length && <p className="taxonomy-issues">{taxonomy.issues.join(' · ')}</p>}
              <h4>Selected roles</h4>{taxonomy.roles.length ? <ul>{taxonomy.roles.map(role => <li key={role.id}>{role.label} <strong>×{role.count}</strong>{role.stale > 0 && ` · ${role.stale} stale`}</li>)}</ul> : <p>No selected roles.</p>}
              <h4>Independent facets</h4>{taxonomy.facets.length ? <ul>{taxonomy.facets.map(facet => <li key={facet.id}>{facet.label} <strong>×{facet.count}</strong>{facet.stale > 0 && ` · ${facet.stale} stale`}</li>)}</ul> : <p>No assessed facets.</p>}
              <h4>Assessed subjects</h4>{taxonomy.items.length ? <ul>{taxonomy.items.map(item => <li key={item.record.id}><code>{item.record.snapshot.subject.target}</code> · {item.classification.assessment}{item.status === 'stale' && ' · stale'}</li>)}</ul> : <p>No assessments recorded.</p>}
              <p>Caller-assessed; suggestions remain unverified. Full evidence is in the Taxonomy tab.</p>
            </>}
          </div>
          <details><summary>Why this gravitational mass? · {subject.mass.total}</summary>
            <p>{subject.mass.ownedSurface} source surface + {subject.mass.inboundReliance} inbound reliances + {subject.mass.boundaryAuthority} boundary crossings + {subject.mass.guaranteeResponsibility} guarantee responsibilities. Center is the canonical weighted graph medoid.</p></details>
          <h3>Guarantees consumed / provided</h3>{model.relations.filter(r => r.source === subject.id || r.target === subject.id).map(r => <Reliance key={r.id} relation={r} byId={byId} model={model}/>)}
          {!model.relations.some(r => r.source === subject.id || r.target === subject.id) && <p className="muted">No declared reliances. The outer ring does not invent a connection.</p>}
        </> : <p>No component selected.</p>}
      </section>
      <section className="component-index"><h3>Components</h3>{model.nodes.map(n => <button key={n.id} onClick={() => selectNode(n.id)}>{n.label}</button>)}</section>
      <footer className="provenance">React Flow · Cytoscape concentric<br/>{structure ? 'Live project derivation. Recorded verdicts only.' : 'Snapshot: public/scope.json. No live verification.'}<br/>{structure?.git?.dirty && 'Working tree has uncommitted changes. '}{structure && 'Watching never runs tests; edits are not reverified.'}<br/>Parameters are local and reset on reload.</footer>
    </aside>}
  </main>;
});

// Keep mounted state (filters, selection and camera), not hidden rendering work.
const VisiblePanel = memo(function VisiblePanel({ children }) { return children; },
  (previous, next) => !previous.active && !next.active);

function ScopeShell() {
  const live = useLiveReadings(snapshot.readings);
  const currentReadings = live.readings;
  const structure = currentReadings.structure;
  const cardReadings = useMemo(() => ({ taxonomy: currentReadings.taxonomy, errors: currentReadings.errors }), [currentReadings.taxonomy, currentReadings.errors]);
  const model = live.status === 'snapshot' ? snapshot.model : structure?.model ?? emptyModel;
  const [tab, setTab] = useState('structure');
  const [session, setSession] = useState('');
  const [selected, setSelected] = useState(model.center);
  useEffect(() => { if (!model.nodes.some(n => n.id === selected)) setSelected(model.center); }, [model, selected]);
  return <Tabs.Root className="scope-shell" value={tab} onValueChange={setTab}>
    <header className="topbar"><div><span className="wordmark">Scope</span><span className="preview-tag">READ-ONLY</span></div>
      <label className="session-picker">Session<select aria-label="Scope session" value={session} onChange={e => setSession(e.target.value)}><option value="">All sessions</option>{currentReadings.sessions.map(id => <option key={id} value={id}>{id}</option>)}</select></label></header>
    <div className="tabbar"><Tabs.List aria-label="Scope views"><Tabs.Trigger value="structure">Structure</Tabs.Trigger><Tabs.Trigger value="hooks">Hooks</Tabs.Trigger><Tabs.Trigger value="journal">Journal</Tabs.Trigger><Tabs.Trigger value="taxonomy">Taxonomy</Tabs.Trigger></Tabs.List>
      <span className="feed-controls"><span className="feed-status" role="status">{live.status === 'snapshot' ? 'Snapshot' : `Scope ${live.status}${live.paused ? ' · display paused' : ''}`}</span>{live.status !== 'snapshot' && <button onClick={live.togglePause}>{live.paused ? 'Resume updates' : 'Pause updates'}</button>}<span className="snapshot-label" title={currentReadings.updatedAt ? `Last change: ${currentReadings.updatedAt}` : currentReadings.digest}>{currentReadings.digest.slice(0, 10)}</span></span></div>
    <Tabs.Content className="scope-tab" value="structure" forceMount><VisiblePanel active={tab === 'structure'}><StructureReading model={model} structure={structure} readings={cardReadings} selected={selected} setSelected={setSelected}/></VisiblePanel></Tabs.Content>
    <Tabs.Content className="scope-tab" value="hooks" forceMount><VisiblePanel active={tab === 'hooks'}><HooksPanel readings={currentReadings} session={session}/></VisiblePanel></Tabs.Content>
    <Tabs.Content className="scope-tab" value="journal" forceMount><VisiblePanel active={tab === 'journal'}><JournalPanel readings={currentReadings} session={session} onSessionChange={setSession} feedStatus={live.status}/></VisiblePanel></Tabs.Content>
    <Tabs.Content className="scope-tab" value="taxonomy" forceMount><VisiblePanel active={tab === 'taxonomy'}><TaxonomyPanel readings={currentReadings} session={session}/></VisiblePanel></Tabs.Content>
  </Tabs.Root>;
}

createRoot(document.getElementById('root')).render(<ReactFlowProvider><ScopeShell/></ReactFlowProvider>);
