import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as Tabs from '@radix-ui/react-tabs';
import { ReactFlow, ReactFlowProvider, Controls, ControlButton, Handle, Position,
  MarkerType, ViewportPortal, useReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './style.css';
import { defaults, layoutScope, lightOf } from './layout.mjs';
import { HooksPanel, JournalPanel } from './panels.jsx';
import { useLiveReadings } from './live.jsx';
import { TaxonomyPanel } from './taxonomy-panel.jsx';

const { model, initial, readings } = JSON.parse(document.getElementById('scope-data').textContent);
const labels = { fail: '× Failing', stale: '◷ Stale evidence', unknown: '? Unknown', pass: '✓ Passing', unmeasured: '— Unmeasured' };
const ports = [[Position.Left, 0, 0.5], [Position.Right, 1, 0.5], [Position.Top, 0.5, 0], [Position.Bottom, 0.5, 1]];
const byId = new Map(model.nodes.map(n => [n.id, n]));
const guaranteesFor = id => model.guarantees.filter(g => g.component === id);

function ComponentCard({ data }) {
  const { subject, center } = data, guarantees = guaranteesFor(subject.id), state = lightOf(guarantees);
  return <article className={`component-card ${center ? 'gravity-center' : ''}`}>
    <header title={subject.label}><strong>{subject.label}</strong>{center && <span title="Project center of gravity">✦</span>}</header>
    <div className="card-body"><p title={subject.intent}>{subject.intent || 'No authored description.'}</p>
      <div className="card-counts">{subject.mass.ownedFiles} files <span>·</span> {guarantees.length} guarantees</div>
      <footer><span className={`status ${state}`}>{labels[state]}</span><code>{subject.id}</code></footer>
    </div>
    {data.handles.map(handle => <Handle key={handle.id} id={handle.id} type={handle.type}
      position={handle.position} isConnectable={false} style={{ left: handle.x, top: handle.y,
        right: 'auto', bottom: 'auto', width: 0, height: 0, minWidth: 0, minHeight: 0, border: 0, transform: 'none' }}/>) }
  </article>;
}
const nodeTypes = { component: ComponentCard };
// Select one of the library's four standard ports. No custom curves or routing.
function facing(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  return Math.abs(dx) / defaults.width > Math.abs(dy) / defaults.height ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top');
}

function Reliance({ relation }) {
  return <div className="reliance-record">
    <p><strong>{byId.get(relation.source).label}</strong> → <strong>{byId.get(relation.target).label}</strong></p>
    <small>{relation.crossing ? `${relation.crossing.from} → ${relation.crossing.to}` : 'No declared boundary crossing'}{relation.via ? ` · via ${relation.via}` : ''}</small>
  </div>;
}

function Structure({ selected, setSelected }) {
  const [config, setConfig] = useState(defaults);
  const [edgeType, setEdgeType] = useState('default');
  const [connectionId, setConnectionId] = useState(null);
  const [focusEdges, setFocusEdges] = useState(true);
  const [ready, setReady] = useState(false);
  const flow = useReactFlow();
  const layout = useMemo(() => config === defaults ? initial : layoutScope(model, config), [config]);
  const positioned = new Map(layout.nodes.map(n => [n.id, n]));
  const selectedConnection = layout.connections.find(c => c.id === connectionId);
  const subject = positioned.get(selected);
  const guarantees = subject ? guaranteesFor(subject.id) : [];
  const centerView = () => flow.fitBounds({ x: -layout.extent.x, y: -layout.extent.y,
    width: layout.extent.x * 2, height: layout.extent.y * 2 }, { padding: 0.04, duration: 0 });
  useEffect(() => { if (ready) centerView(); }, [layout, ready]);
  const handles = ports.flatMap(([position, x, y]) => ['source', 'target'].map(type => ({
    id: `${type}-${position}`, type, position, x: x * config.width, y: y * config.height, width: 0, height: 0,
  })));
  const nodes = layout.nodes.map(n => ({ id: n.id, type: 'component', position: { x: n.x - config.width / 2, y: n.y - config.height / 2 },
    data: { subject: n, center: n.id === model.center, handles }, selected: selected === n.id && !connectionId,
    // Fixed geometry is already known. Supplying the library's dimensions and
    // handles avoids a second DOM measurement representation that can stay hidden.
    width: config.width, height: config.height,
    handles, ariaLabel: n.label }));
  const edges = layout.connections.map(c => {
    const from = positioned.get(c.source), to = positioned.get(c.target);
    const active = connectionId ? c.id === connectionId : c.source === selected || c.target === selected;
    const color = active ? '#365a78' : '#a7b0ba';
    return { id: c.id, source: c.source, target: c.target, type: edgeType,
      sourceHandle: `source-${facing(from, to)}`, targetHandle: `target-${facing(to, from)}`,
      markerEnd: { type: MarkerType.ArrowClosed, color },
      ...(c.mutual ? { markerStart: { type: MarkerType.ArrowClosed, color, orient: 'auto-start-reverse' } } : {}),
      label: c.mutual ? 'mutual reliance' : 'depends on',
      style: { stroke: color, strokeWidth: active ? 2 : 1.4, opacity: focusEdges && !active ? 0.18 : 1 },
      labelStyle: { fill: color, fontSize: 12, fontWeight: 600, opacity: focusEdges && !active ? 0.18 : 1 },
      labelBgStyle: { fill: '#f8f9fc', fillOpacity: 0.96 }, labelBgPadding: [8, 5], labelBgBorderRadius: 5,
      interactionWidth: 24, selected: c.id === connectionId,
      ariaLabel: `${byId.get(c.source).label} ${c.mutual ? 'and' : 'depends on'} ${byId.get(c.target).label}${c.mutual ? ' depend on each other' : ''}`,
    };
  });
  const selectNode = id => { setSelected(id); setConnectionId(null); };
  return <main className="structure-view">
    <section className="canvas" aria-label="Project scope">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} minZoom={0.1} maxZoom={2}
        nodesDraggable={false} nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null}
        onInit={() => setReady(true)} onNodeClick={(_, n) => selectNode(n.id)}
        onEdgeClick={(_, e) => setConnectionId(e.id)} onPaneClick={() => setConnectionId(null)}>
        <ViewportPortal><svg className="orbits" width="1" height="1" aria-hidden="true">
          {layout.rings.map(r => <g key={r.ring} className={r.disconnected ? 'disconnected' : ''}>
            <circle r={r.radius}/><text x="0" y={r.radius + 22} textAnchor="middle">{r.disconnected ? 'UNCONNECTED' : `RELIANCE RING ${r.ring}`}</text>
          </g>)}
        </svg></ViewportPortal>
        <Controls showFitView={false} showInteractive={false}><ControlButton onClick={centerView} title="Center gravity" aria-label="Center gravity">◎</ControlButton></Controls>
      </ReactFlow>
      <div className="canvas-caption">Center of gravity: <strong>{byId.get(model.center)?.label ?? 'none'}</strong><br/>Rings show reliance distance, not a safety ranking.</div>
      {!model.nodes.length && <div className="empty">No components in this snapshot.</div>}
    </section>
    <aside>
      <section className="parameters"><h2>View parameters</h2><p>Change the view. The evidence stays put.</p>
        {[['gap', 'Spacing', 48, 180], ['rotation', 'Rotation', -180, 180], ['sweep', 'Arc spread', 200, 330]].map(([key, label, min, max]) =>
          <label key={key}>{label}<output>{config[key]}{key === 'gap' ? ' px' : '°'}</output>
            <input aria-label={label} type="range" min={min} max={max} value={config[key]} onChange={e => setConfig({ ...config, [key]: Number(e.target.value) })}/></label>)}
        <label>Connections<select aria-label="Connection style" value={edgeType} onChange={e => setEdgeType(e.target.value)}><option value="default">Bézier</option><option value="smoothstep">Rounded steps</option><option value="straight">Straight</option></select></label>
        <label className="checkbox"><input type="checkbox" checked={focusEdges} onChange={e => setFocusEdges(e.target.checked)}/> Emphasize selected connections</label>
        <button onClick={() => { setConfig(defaults); setEdgeType('default'); setFocusEdges(true); }}>Reset view parameters</button>
      </section>
      <section className="inspector" aria-label="Inspector">
        {selectedConnection ? <><span className="eyebrow">CONNECTION</span><h2>{selectedConnection.mutual ? 'Mutual reliance' : 'Depends on'}</h2>
          {selectedConnection.members.map(r => <Reliance key={r.id} relation={r}/>)}
        </> : subject ? <><span className="eyebrow">{subject.id === model.center ? 'PROJECT CENTER OF GRAVITY' : subject.disconnected ? 'UNCONNECTED COMPONENT' : `RELIANCE RING ${subject.ring}`}</span>
          <h2>{subject.label}</h2><code>{subject.id}</code><p>{subject.intent}</p>
          <details><summary>Why this gravitational mass? · {subject.mass.total}</summary>
            <p>{subject.mass.ownedSurface} source surface + {subject.mass.inboundReliance} inbound reliances + {subject.mass.boundaryAuthority} boundary crossings + {subject.mass.guaranteeResponsibility} guarantee responsibilities. Center is the canonical weighted graph medoid.</p></details>
          <h3>Reliances</h3>{model.relations.filter(r => r.source === subject.id || r.target === subject.id).map(r => <Reliance key={r.id} relation={r}/>)}
          {!model.relations.some(r => r.source === subject.id || r.target === subject.id) && <p className="muted">No declared reliances. The outer ring does not invent a connection.</p>}
          <h3>Guarantees · {guarantees.length}</h3>{!guarantees.length && <p>Unmeasured — no guarantees. This is not a pass.</p>}
          {guarantees.map(g => <details key={g.id}><summary><span className={`status ${g.verdict}`}>{labels[g.verdict]}</span> {g.invariant}</summary>
            <p>Grade {g.grade} · <code>{g.chokepoint}</code></p><p>Oracle: {g.oracle}</p>{g.crossing && <p>{g.crossing.from} → {g.crossing.to}</p>}</details>)}
        </> : <p>No component selected.</p>}
      </section>
      <section className="component-index"><h3>Components</h3>{model.nodes.map(n => <button key={n.id} onClick={() => selectNode(n.id)}>{n.label}</button>)}</section>
      <footer className="provenance">React Flow · Cytoscape concentric<br/>Snapshot: public/scope.json. No live verification.<br/>Parameters are local and reset on reload.</footer>
    </aside>
  </main>;
}

function ScopeShell() {
  const live = useLiveReadings(readings);
  const currentReadings = live.readings;
  const [tab, setTab] = useState('structure');
  const [session, setSession] = useState('');
  const [selected, setSelected] = useState(model.center);
  return <Tabs.Root className="scope-shell" value={tab} onValueChange={setTab}>
    <header className="topbar"><div><span className="wordmark">Scope</span><span className="preview-tag">READ-ONLY</span></div>
      <label className="session-picker">Session<select aria-label="Scope session" value={session} onChange={e => setSession(e.target.value)}><option value="">All sessions</option>{currentReadings.sessions.map(id => <option key={id} value={id}>{id}</option>)}</select></label></header>
    <div className="tabbar"><Tabs.List aria-label="Scope views"><Tabs.Trigger value="structure">Structure</Tabs.Trigger><Tabs.Trigger value="hooks">Hooks</Tabs.Trigger><Tabs.Trigger value="journal">Journal</Tabs.Trigger><Tabs.Trigger value="taxonomy">Taxonomy</Tabs.Trigger></Tabs.List>
      <span className="feed-controls"><span className="feed-status" role="status">{live.status === 'snapshot' ? 'Snapshot' : `Journal ${live.status}${live.paused ? ' · display paused' : ''}`}</span>{live.status !== 'snapshot' && <button onClick={live.togglePause}>{live.paused ? 'Resume updates' : 'Pause updates'}</button>}<span className="snapshot-label" title={currentReadings.digest}>{currentReadings.digest.slice(0, 10)}</span></span></div>
    <Tabs.Content className="scope-tab" value="structure" forceMount><Structure selected={selected} setSelected={setSelected}/></Tabs.Content>
    <Tabs.Content className="scope-tab" value="hooks" forceMount><HooksPanel readings={currentReadings} session={session}/></Tabs.Content>
    <Tabs.Content className="scope-tab" value="journal" forceMount><JournalPanel readings={currentReadings} session={session} onSessionChange={setSession} feedStatus={live.status}/></Tabs.Content>
    <Tabs.Content className="scope-tab" value="taxonomy" forceMount><TaxonomyPanel readings={currentReadings} session={session}/></Tabs.Content>
  </Tabs.Root>;
}

createRoot(document.getElementById('root')).render(<ReactFlowProvider><ScopeShell/></ReactFlowProvider>);
