import React, { useEffect, useId, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow, ReactFlowProvider, Handle, Position, EdgeLabelRenderer, Controls, Background, useReactFlow, getViewportForBounds } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './style.css';
import { route, wrap, intersects } from './routing.mjs';


const scene = window.SCENE, model = scene.model, layout = scene.layout;
const terminalNames = scene.presentation?.terminalNames ?? {};
const projectName = layout.root?.label ?? model.project.label;
const purpose = model.project.purposes[0]?.attributes.text ?? layout.root?.intent ?? 'Project purpose has not been declared.';
const component = id => layout.ranked.find(c => c.id === id);
const palette = ['#287e85', '#7765a5', '#b27931'];
const centers = layout.cards.filter(c => c.downtown).sort((a, b) => a.x - b.x);
const architecture = model.relationships.filter(e => e.kind === 'architecture');
const openingIds = new Set(architecture.filter(e => layout.coreIds.includes(e.source) && layout.coreIds.includes(e.target)).map(e => e.id));
for (const entrance of model.project.entrances) {
  const start = `component:${entrance.attributes.component}`, queue = [{ id: start, path: [] }], seen = new Set([start]);
  while (queue.length) {
    const item = queue.shift();
    if (layout.coreIds.includes(item.id)) { item.path.forEach(id => openingIds.add(id)); break; }
    for (const edge of architecture.filter(e => e.source === item.id || e.target === item.id)) {
      const id = edge.source === item.id ? edge.target : edge.source;
      if (!seen.has(id)) { seen.add(id); queue.push({ id, path: [...item.path, edge.id] }); }
    }
  }
}
const colorOf = c => {
  if (c.downtown) return palette[centers.findIndex(v => v.id === c.id)];
  const nearest = [...centers].sort((a, b) => {
    const affinity = v => model.relationships.filter(e => (e.source === c.id && e.target === v.id) || (e.target === c.id && e.source === v.id)).reduce((s, e) => s + (e.kind === 'guarantee-reliance' ? 2 : 1), 0);
    return affinity(b) - affinity(a) || Math.abs(a.x - c.x) - Math.abs(b.x - c.x);
  })[0];
  return palette[centers.indexOf(nearest)];
};

function componentCards() {
  return layout.cards.map(c => {
    const contentWidth = c.width - 36;
    const titleHeight = wrap(c.label, contentWidth, '650 26px system-ui').length * 31 + 10;
    const intentHeight = c.downtown ? wrap(c.intent, contentWidth, '19px system-ui').length * 25 + 12 : 0;
    const metricsHeight = wrap(`${c.counts.guarantees} promises · ${c.counts.peers} connected components`, contentWidth - 6, '15px system-ui').length * 21 + 12;
    const baseHeight = Math.max(c.downtown ? 280 : c.height, titleHeight + intentHeight + metricsHeight + 66);
    return { ...c, nodeKind: 'component', baseHeight, height: baseHeight,
      open: false };
  });
}

const baseCards = componentCards();
const entranceAnnotations = cards => model.project.entrances.map(e => {
  const owner = cards.find(c => c.id === `component:${e.attributes.component}`);
  return { ...e, owner: owner.id, x: owner.x + owner.width / 2 - 150, y: owner.y - 190, width: 300, height: 190 };
});
// One base map per captured project, independent of selection and disclosure.
const terminals=baseCards.flatMap(owner=> {
  const ids=[...new Set(model.relationships.filter(e=>e.kind==='guarantee-reliance'&&e.target===owner.id).flatMap(e=>e.guaranteeIds))].sort();
  return ids.map((id,i)=> {
    const guarantee=owner.guarantees.find(g=>g.id===id),width=Math.min(190,(owner.width-12*(ids.length-1))/ids.length);
    const label=terminalNames[guarantee.label]??guarantee.label;
    return {id:`terminal:${id}`,nodeKind:'terminal',owner:owner.id,guaranteeId:id,label,guaranteeLabel:guarantee.label,
      relationshipIds:model.relationships.filter(e=>e.kind==='guarantee-reliance'&&e.target===owner.id&&e.guaranteeIds.includes(id)).map(e=>e.id),
      x:owner.x+(owner.width-(width*ids.length+12*(ids.length-1)))/2+i*(width+12),y:owner.y-62,width,height:54};
  });
});
const withTerminal=e=> {
  if(e.kind!=='guarantee-reliance') return e;
  const terminal=terminals.find(t=>t.owner===e.target&&e.guaranteeIds.includes(t.guaranteeId));
  if(!terminal) throw new Error(`Missing guarantee terminal for ${e.id}`);
  return {...e,target:terminal.id,declaredTarget:e.target,terminalId:terminal.id,
    targetPort:{x:Math.round((terminal.x+terminal.width/2)/10)*10,y:terminal.y,side:'top',dx:0,dy:-1,lead:36}};
};
const baseAnnotations = entranceAnnotations(baseCards);
const baseRouting=(()=> {
  try {return {edges:route([...baseCards,...terminals],model.relationships.map(e=>({...withTerminal(e),priority:openingIds.has(e.id)?1:0})),baseAnnotations),error:null};}
  catch(error) {return {edges:[],error:error.message};}
})();
const baseRoutes=baseRouting.edges;
const baseLabels = baseRoutes.map(e=>e.labelBox).filter(Boolean);
const pathSamples = baseRoutes.flatMap(r=> {
  const path=document.createElementNS('http://www.w3.org/2000/svg','path'); path.setAttribute('d',r.path);
  const points=[],length=path.getTotalLength();
  for(let d=0;d<=length;d+=10) { const p=path.getPointAtLength(d);points.push({x:p.x,y:p.y,width:1,height:1}); }
  return points;
});
const promisePlacements = new Map();
function promiseCards(id) {
  if(promisePlacements.has(id)) return promisePlacements.get(id);
  const owner=baseCards.find(c=>c.id===id);
  if(!owner?.guarantees.length) return [];
  const consumed=model.relationships.filter(e=>e.kind==='guarantee-reliance'&&e.target===id).flatMap(e=>e.guaranteeIds);
  const selected=[...owner.guarantees].sort((a,b)=>Number(consumed.includes(b.id))-Number(consumed.includes(a.id))||a.id.localeCompare(b.id)).slice(0,3);
  const width=320,gap=100,rowWidth=selected.length*width+(selected.length-1)*gap;
  const heights=selected.map(g=> {
    const terminal=terminals.find(t=>t.guaranteeId===g.id);
    const caption=terminal?`${terminal.label} · ${owner.label}`:`PROMISE · ${owner.label}`;
    const hint=terminal?'Detail of the connected guarantee terminal':'Declared responsibility';
    return wrap(g.label,width-44,'22px system-ui').length*29+
      wrap(caption.toUpperCase(),width-44,'13px system-ui',0.4).length*18+
      wrap(hint,width-44,'13px system-ui').length*18+76;
  });
  const occupied=[...baseCards,...terminals,...baseAnnotations,...baseLabels,...[...promisePlacements.values()].flat()];
  const region={x:owner.x+(owner.width-rowWidth)/2,y:owner.y+owner.height+180,width:rowWidth,height:Math.max(...heights)};
  // Reserve a reveal once. Hiding it never frees its address for another fan.
  while(occupied.some(r=>intersects(region,r,100))||pathSamples.some(p=>intersects(region,p,40))) region.y+=100;
  const cards=selected.map((g,i)=>({...g,nodeKind:'promise',owner:id,ownerLabel:owner.label,
    x:region.x+i*(width+gap),y:region.y,width,height:heights[i],reliedOn:consumed.includes(g.id),terminal:terminals.find(t=>t.guaranteeId===g.id)}));
  promisePlacements.set(id,cards);
  return cards;
}
function prepareCards(expanded) {
  return [...baseCards.map(c=>({...c,open:expanded.includes(c.id)&&c.guarantees.length>0})),
    ...terminals,...expanded.flatMap(promiseCards)];
}

function Ports() {
  return ['left', 'right', 'top', 'bottom'].map(side => <React.Fragment key={side}>
    <Handle type="source" position={Position[side[0].toUpperCase() + side.slice(1)]} id={`s-${side}`} />
    <Handle type="target" position={Position[side[0].toUpperCase() + side.slice(1)]} id={`t-${side}`} />
  </React.Fragment>);
}

function PromiseCard({ data }) {
  const { c, select, selected, sparse } = data;
  return <article data-promise-card={c.id} data-owner={c.owner} className={`promise-card ${sparse ? 'sparse' : ''} ${c.reliedOn ? 'consumed' : ''} ${selected ? 'selected' : ''}`} style={{ width: c.width, height: c.height }}>
    <Ports />
    <button data-promise={c.id} className="nodrag" onClick={() => select({ kind: 'guarantee', id: c.id, owner: c.owner })}>
      <small>{c.terminal ? `${c.terminal.label} · ${c.ownerLabel}` : `PROMISE · ${c.ownerLabel}`}</small><span>{c.label}</span>
      <em>{c.reliedOn ? 'Detail of the connected guarantee terminal' : 'Declared responsibility'}</em>
    </button>
  </article>;
}

function EntryArrow({ data }) {
  const { c, select } = data;
  return <button data-entrance={c.id} className="entry-arrow nodrag" style={{ width: c.width, height: c.height }} onClick={() => select({ kind: 'component', id: c.owner })}>
    <strong>ENTRY POINT</strong><span>{c.label}</span>
    <svg width={c.width} height={c.height} aria-hidden="true"><path data-entry-arrow={c.owner} d={`M ${c.width / 2} 100 L ${c.width / 2} ${c.height - 3}`} markerEnd="url(#entry-arrowhead)" /></svg>
  </button>;
}

function Stack({ data }) {
  const { c, select, toggle, selected, sparse } = data;
  return <article data-stack={c.id} data-open={c.open} data-downtown={c.downtown} className={`stack ${c.downtown ? 'downtown' : 'periphery'} ${selected ? 'selected' : ''} ${sparse ? 'sparse' : ''}`}
    style={{ width: c.width, height: c.height, '--district': colorOf(c) }}>
    <Ports />
    <button className="card-body nodrag" onClick={() => select({ kind: 'component', id: c.id })} aria-label={`Inspect ${c.label}`} style={{ height: c.baseHeight - 40 }}>
      <h2>{c.label}</h2>
      {<>
        {c.downtown && <p className="intent">{c.intent}</p>}
        <p className="metrics">{c.counts.guarantees} promises <span>·</span> {c.counts.peers} connected components</p>
      </>}
    </button>
    {<button data-unfurl={c.id} className="unfurl nodrag" aria-expanded={c.open} onClick={event => { event.stopPropagation(); c.guarantees.length ? toggle(c.id) : select({ kind: 'component', id: c.id }); }}>
      {c.open ? '− Fold stack' : c.guarantees.length ? '+ Unfurl promises' : 'Inspect responsibility'}
    </button>}

  </article>;
}

function Terminal({data}) {
  const {c,select,selected,sparse}=data;
  return <button data-terminal={c.id} data-guarantee={c.guaranteeId} data-owner={c.owner}
    className={`guarantee-terminal nodrag ${sparse?'sparse':''} ${selected?'selected':''}`}
    style={{width:c.width,height:c.height}} title={c.guaranteeLabel}
    aria-label={`Inspect guarantee: ${c.guaranteeLabel}`}
    onClick={()=>select({kind:'guarantee',id:c.guaranteeId,owner:c.owner})}>
    <Ports/><small>GUARANTEE</small><span>{c.label}</span><i aria-hidden="true"/>
  </button>;
}
function RoutedEdge({ data }) {
  const { e, selected, select } = data;
  const local=e.kind==='continuation',ownership=e.kind==='ownership';
  const maskId=`detail-${useId().replace(/[^a-zA-Z0-9]/g,'')}`;
  const xs=e.points.map(p=>p.x),ys=e.points.map(p=>p.y),end=e.points.at(-1);
  return <>
    {local && <defs><mask id={maskId} maskUnits="userSpaceOnUse" x={Math.min(...xs)-300} y={Math.min(...ys)-300} width={Math.max(...xs)-Math.min(...xs)+600} height={Math.max(...ys)-Math.min(...ys)+600}>
      <path data-detail-reveal={e.id} className="detail-reveal" d={e.path} pathLength="1" fill="none" stroke="white" strokeWidth="18" />
    </mask></defs>}
    <g mask={local?`url(#${maskId})`:undefined}>
      <path d={e.path} className="route-halo" />
      <path data-route={e.id} d={e.path} className={`route ${e.kind==='guarantee-reliance'?'reliance':''} ${selected?'active':''} ${ownership?'ownership':''} ${local?'continuation':''}`}
        markerEnd={ownership||local?undefined:`url(#arrow-${e.kind})`} />
      {local && <circle cx={end.x} cy={end.y} r="5" fill="#fff8e9" stroke="#ac7025" strokeWidth="2"/>}
    </g>
    {e.labelBox && <EdgeLabelRenderer><button data-route-label={e.id} className={`route-label nodrag nopan ${selected ? 'active' : ''} ${e.kind === 'guarantee-reliance' ? 'reliance' : ''}`}
      style={{ transform: `translate(${e.labelBox.x}px, ${e.labelBox.y}px)`, width: e.labelBox.width, height: e.labelBox.height }}
      onClick={() => select({ kind: 'relationship', id: e.id })}>{e.labelBox.lines.map((line, i) => <React.Fragment key={i}>{i > 0 && <br />}{line}</React.Fragment>)}</button></EdgeLabelRenderer>}
  </>;
}
const nodeTypes = { stack: Stack, promise: PromiseCard, entry: EntryArrow, terminal:Terminal }, edgeTypes = { routed: RoutedEdge };

function App() {
  const [selected, setSelected] = useState(null), [expanded, setExpanded] = useState([]), [sparse, setSparse] = useState(false);
  const [mode, setMode] = useState('opening');
  const [connectionFocus, setConnectionFocus] = useState(null);
  const [frameRequest, setFrameRequest] = useState(null);
  const flow = useReactFlow();

  const toggle = id => {
    if (component(id).guarantees.length) { setExpanded(ids => ids.includes(id) ? ids.filter(v => v !== id) : [...ids, id]);  }
  };
  const select = selection => setSelected(selection);
  const selectedComponent = selected?.kind === 'component' ? component(selected.id) : selected?.owner ? component(selected.owner) : null;
  const selectedGuarantee = selected?.kind === 'guarantee' ? selectedComponent.guarantees.find(g => g.id === selected.id) : null;
  const selectedRelationship = selected?.kind === 'relationship' ? model.relationships.find(e => e.id === selected.id) : null;
  const cards = useMemo(() => prepareCards(expanded), [expanded]);
  const annotations = useMemo(() => entranceAnnotations(cards), [cards]);
  const relationshipsFor = subject => model.relationships.filter(e =>
    subject?.kind === 'guarantee' ? e.guaranteeIds.includes(subject.id) :
    subject?.kind === 'relationship' ? e.id === subject.id :
    subject?.kind === 'component' ? e.source === subject.id || e.target === subject.id : false);
  const inspectedRelationships = relationshipsFor(selected);
  const visible = useMemo(() => connectionFocus ? relationshipsFor(connectionFocus) :
    model.relationships.filter(e => mode === 'opening' ? openingIds.has(e.id) : mode === 'architecture' ? e.kind === 'architecture' : e.kind === 'guarantee-reliance'),
  [connectionFocus, mode]);
  const projected = useMemo(() => [
    ...visible.map(withTerminal),
    ...cards.filter(c=>c.nodeKind==='promise').map(c=> {
      const terminal=terminals.find(t=>t.guaranteeId===c.id);
      return terminal?{id:`detail:${c.id}`,source:terminal.id,target:c.id,kind:'continuation',label:`Detail of ${terminal.label}`,
        guaranteeIds:[c.id],relationshipIds:terminal.relationshipIds,owner:c.owner}:
        {id:`ownership:${c.id}`,source:c.owner,target:c.id,kind:'ownership',label:`Promise owned by ${c.ownerLabel}`,guaranteeIds:[]};
    }),
  ], [visible, cards]);
  const routing = useMemo(() => {
    try {
      if(baseRouting.error) throw new Error(baseRouting.error);
      // The external network always ends at stable terminals. Only local detail
      // is added during disclosure; no reliance changes its target.
      const unchanged=baseRoutes.filter(e=>projected.some(p=>p.id===e.id&&p.target===e.target));
      const added=projected.filter(e=>!unchanged.some(r=>r.id===e.id));
      return {edges:[...unchanged,...route(cards,added,annotations,baseLabels)],error:null};
    } catch(error) {return {edges:[],error:error.message};}
  }, [cards, projected, annotations]);
  useEffect(() => {
    if (!frameRequest) return;
    // Camera changes are explicit. Frame the promise fan at a readable scale;
    // stable surrounding landmarks remain reachable by panning.
    const fullCards = prepareCards(expanded);
    const ids = new Set(fullCards.filter(c => c.nodeKind === 'promise' && c.owner === frameRequest).map(c => c.id));
    const subjects = fullCards.filter(c => ids.has(c.id));
    const bounds = { x: Math.min(...subjects.map(c => c.x)), y: Math.min(...subjects.map(c => c.y)) };
    bounds.width = Math.max(...subjects.map(c => c.x + c.width)) - bounds.x;
    bounds.height = Math.max(...subjects.map(c => c.y + c.height)) - bounds.y;
    const timer = setTimeout(() => {
      const map = document.querySelector('.map');
      flow.setViewport(getViewportForBounds(bounds, map.clientWidth, map.clientHeight, 0.64, 0.85, 0.08), { duration: 300 });
      setFrameRequest(null);
    }, 100);
    return () => clearTimeout(timer);
  }, [frameRequest, expanded, cards]);
  window.BLOCKOUT = { terminals, baseLabels, cards, annotations, routes: routing.edges, selected, expanded, mode, connectionFocus, sparse, error: routing.error, viewport: flow.getViewport() };
  const nodes = cards.map(c => ({ id: c.id, type: c.nodeKind === 'terminal' ? 'terminal' : c.nodeKind === 'promise' ? 'promise' : 'stack', position: { x: c.x, y: c.y },
    width: c.width, height: c.height, draggable: false, selectable: false, style: { pointerEvents: 'all' },
    data: { c, select, toggle, sparse, selected: selected?.id === c.id || (c.nodeKind === 'terminal' && selected?.id === c.guaranteeId) || selectedComponent?.id === c.id || selectedRelationship?.source === c.id || selectedRelationship?.target === c.id } }));
  for (const c of annotations) nodes.push({ id: c.id, type: 'entry', position: { x: c.x, y: c.y }, width: c.width, height: c.height,
    selectable: false, draggable: false, style: { pointerEvents: 'all' }, data: { c, select } });
  const occupied = [...cards, ...annotations, ...routing.edges.map(e => e.labelBox).filter(Boolean), ...routing.edges.flatMap(e => e.points.map(p => ({ ...p, width: 1, height: 1 })))];
  const min = { x: Math.min(...occupied.map(r => r.x)) - 20, y: Math.min(...occupied.map(r => r.y)) - 20 };
  const max = { x: Math.max(...occupied.map(r => r.x + r.width)) + 20, y: Math.max(...occupied.map(r => r.y + r.height)) + 20 };
  for (const [id, position] of [['frame-start', min], ['frame-end', max]]) nodes.push({ id, position, width: 1, height: 1, data: {}, selectable: false, style: { opacity: 0, pointerEvents: 'none' } });
  const edges = routing.edges.map(e => ({ id: e.id, source: e.source, target: e.target, type: 'routed',
    sourceHandle: 's-right', targetHandle: 't-left', data: { e, select, selected: Boolean(selected) } }));
  const reset = () => { setSelected(null); setConnectionFocus(null); setExpanded([]); setMode('opening'); setTimeout(() => flow.fitView({ padding: 0.07, duration: 350 }), 80); };
  const focus = id => {
    setSelected({ kind: 'component', id });
    flow.fitView({ nodes: [{ id }], padding: 0.5, maxZoom: 1.05, duration: 350 });
  };
  return <div className="app">
    <header><div><span className="eyebrow">{projectName} / STRUCTURE · LAYOUT STUDY</span><h1>{projectName}: how the project works.</h1><p className="project-purpose">{purpose}{!model.relationships.length && <strong className="study-notice"> No architectural handoffs or guarantee consumers declared; inspect cards for existing responsibilities.</strong>}{scene.presentation?.notice && <strong className="study-notice"> {scene.presentation.notice}</strong>}</p></div>
      <div className="header-actions"><button onClick={() => setSelected({ kind: 'overview' })}>Project notes</button><button onClick={reset}>Return to overview</button></div></header>
    <div className="toolbar">
      <div className="mode"><button className={mode === 'opening' ? 'chosen' : ''} onClick={() => { setMode('opening'); setConnectionFocus(null); setSelected(null); }}>Opening route</button><button className={mode === 'architecture' ? 'chosen' : ''} onClick={() => { setMode('architecture'); setConnectionFocus(null); setSelected(null); }}>All handoffs · {architecture.length}</button><button className={mode === 'guarantees' ? 'chosen' : ''} onClick={() => { setMode('guarantees'); setConnectionFocus(null); setSelected(null); }}>Guarantee reliances · {model.relationships.length - architecture.length}</button></div>
      <span>{visible.length} of {model.relationships.length} declared connections{connectionFocus ? ` · focused on ${connectionFocus.label}` : ''}</span>
      {connectionFocus && <button onClick={() => setConnectionFocus(null)}>Show all in this layer</button>}
      <span className="map-key"><i /> Downtown: obligations + reliance</span>
    </div>
    <main className={selected ? 'with-inspector' : ''}><section className="map" aria-label={`${projectName} architecture`}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} minZoom={0.3} maxZoom={1.7}
        fitView fitViewOptions={{ padding: 0.07 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
        onMove={(_, viewport) => setSparse(previous => previous ? viewport.zoom < 0.50 : viewport.zoom < 0.46)} onPaneClick={() => setSelected(null)} proOptions={{ hideAttribution: true }}>
        <svg><defs><marker id="entry-arrowhead" viewBox="0 0 12 12" refX="12" refY="6" markerUnits="userSpaceOnUse" markerWidth="24" markerHeight="24" orient="auto"><path d="M 0 0 L 12 6 L 0 12 z" fill="#ad650d" /></marker>{['architecture', 'guarantee-reliance'].map(kind => <marker id={`arrow-${kind}`} key={kind} viewBox="0 0 10 10" refX="10" refY="5" markerUnits="userSpaceOnUse" markerWidth="16" markerHeight="16" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill={kind === 'architecture' ? '#567276' : '#ac7025'} /></marker>)}</defs></svg>
        <Background gap={24} size={1} color="#dcded9" /><Controls showInteractive={false} />
      </ReactFlow>
      {routing.error && <div className="routing-error" role="alert">Layout rejected: {routing.error}</div>}
      <div className="map-caption">Component stacks · Amber tab: guarantee · Dashed arrow: relies on · Dotted line: local detail</div>
    </section>
    {selected && <aside data-sidebar>
      {selected.kind === 'overview' && <>
        <span className="eyebrow">START WITH THE PROJECT</span><h2>{projectName}</h2>
        <p>{purpose}</p>
        <h3>Declared entry points · {model.project.entrances.length}</h3>{model.project.entrances.map(e => <button className="entry-button" key={e.id} onClick={() => focus(`component:${e.attributes.component}`)}><strong>↳ {e.label}</strong><span>{component(`component:${e.attributes.component}`).label}</span></button>)}
        <h3>Why these components are downtown</h3><p>Shared responsibilities with substantial declared obligations and reliance.</p>
        {layout.ranked.filter(c => layout.coreIds.includes(c.id)).map(c => <button className="rank-row" key={c.id} onClick={() => setSelected({ kind: 'component', id: c.id })}><strong>{c.label}</strong><span>{c.counts.guarantees} promises · {c.counts.peers} peers</span></button>)}
        <details><summary>Placement rule and source limits</summary><p>Score = 3 ln(1 + peers) + 2 ln(1 + promises) + ln(1 + security boundaries) + 2 ln(1 + guarantee consumers).</p><p>Counts describe declarations, not measured risk or proven satisfaction. Peripheral does not mean unimportant. The project root is this frame.</p><p>Captured {scene.capturedAt}.</p>{model.issues.map(i => <p key={i.source}>{i.source}: {i.message}</p>)}<button onClick={() => setSelected({ kind: 'root' })}>Inspect project root</button></details>
      </>}
      {selected && <button className="back" onClick={() => setSelected(null)}>Close inspector</button>}
      {(selectedComponent || selectedRelationship) && <button className="primary" onClick={() => setConnectionFocus({...selected, label: selectedGuarantee?.label ?? selectedRelationship?.label ?? selectedComponent.label})}>Focus connections</button>}
      {selected?.kind === 'root' && <><h2>{layout.root.label}</h2><p>{layout.root.intent}</p><p>{layout.root.rationale}</p></>}
      {selectedComponent && !selectedGuarantee && <>
        <span className="eyebrow">{layout.coreIds.includes(selectedComponent.id) ? 'DOWNTOWN' : 'PERIPHERY'} / COMPONENT</span><h2>{selectedComponent.label}</h2><p>{selectedComponent.intent}</p>
        {!!selectedComponent.entrances.length && <div className="callout">{selectedComponent.entrances.map(e => <p key={e.id}><strong>{e.label}</strong><br />{e.attributes.description}</p>)}</div>}
        <h3>Why this position</h3><p>Rank {layout.ranked.findIndex(c => c.id === selectedComponent.id) + 1} · score {selectedComponent.score.toFixed(2)}. The top {layout.coreIds.length} form downtown.</p>
        <dl>{[['guarantees', 'Distinct promises'], ['security', 'Security-marked boundaries'], ['peers', 'Connected components'], ['consumers', 'Explicit guarantee consumers']].map(([key, label]) => <React.Fragment key={key}><dt>{label}</dt><dd>{selectedComponent.counts[key]}</dd></React.Fragment>)}</dl>
        <p className="muted">A security declaration is an authored sensitivity signal. Missing guarantees do not establish low importance.</p>
        {!!selectedComponent.guarantees.length && <button className="primary" onClick={() => toggle(selectedComponent.id)}>{expanded.includes(selectedComponent.id) ? 'Fold local promises' : 'Unfurl local promises'}</button>}
        {expanded.includes(selectedComponent.id) && <button className="primary" onClick={()=>setFrameRequest(selectedComponent.id)}>Frame local promises</button>}
        {!!terminals.filter(t=>t.owner===selectedComponent.id).length && <><h3>Guarantee terminals</h3><p className="muted">External reliance stays on these tabs. Unfurl reveals the same guarantees in detail.</p>{terminals.filter(t=>t.owner===selectedComponent.id).map(t=><button className="relation-row" key={t.id} onClick={()=>select({kind:'guarantee',id:t.guaranteeId,owner:t.owner})}><strong>{t.label}</strong><span>{t.guaranteeLabel}</span></button>)}</>}
        <h3>Connected responsibilities</h3>{inspectedRelationships.map(e => <button className="relation-row" key={e.id} onClick={() => setSelected({ kind: 'relationship', id: e.id })}><strong>{component(e.source).label} → {component(e.target).label}</strong><span>{e.label}</span></button>)}
        <details><summary>All {selectedComponent.guarantees.length} promises</summary>{selectedComponent.guarantees.map(g => <button className="relation-row" key={g.id} onClick={() => setSelected({ kind: 'guarantee', id: g.id, owner: selectedComponent.id })}>{g.label}</button>)}</details>
        <details><summary>Spec rationale and taxonomy</summary><p>{selectedComponent.rationale}</p><p>{selectedComponent.taxonomy.labels.join(', ') || 'No assessed taxonomy labels'}</p><p>{selectedComponent.taxonomy.stale} stale assessments.</p></details>
      </>}
      {selectedGuarantee && <>
        <span className="eyebrow">PROMISE / {selectedComponent.label}</span><h2>{selectedGuarantee.label}</h2>
        <p>Declared by {selectedComponent.label}. Canonical reading: <strong>{selectedGuarantee.verdict}</strong>.</p>
        {terminals.some(t=>t.guaranteeId===selectedGuarantee.id) && <div className="callout"><strong>Connected at {terminals.find(t=>t.guaranteeId===selectedGuarantee.id).label}</strong><p>The external reliance stays on its terminal when this promise is revealed.</p><button onClick={()=>toggle(selectedComponent.id)}>{expanded.includes(selectedComponent.id)?'Fold local promises':'Unfurl local promises'}</button></div>}
        <h3>Who explicitly relies on this</h3>{inspectedRelationships.length ? inspectedRelationships.map(e => <div className="callout" key={e.id}><button onClick={() => focus(e.source)}>{component(e.source).label} → {selectedComponent.label}</button><p>{e.because}</p></div>) : <p>No explicit guarantee consumers declared. This is not evidence that no consumers exist.</p>}
        <h3>Evidence</h3>{selectedGuarantee.evidence.map(e => <div className="evidence" key={e.id}><strong>{String(e.attributes.verdict)}</strong><p>{String(e.attributes.oracle)}</p><small>{e.id}</small></div>)}
        <details><summary>Source declaration</summary><pre>{JSON.stringify(selectedGuarantee.asset.attributes, null, 2)}</pre></details>
        {!!selectedGuarantee.refutations.length && <><h3>Recorded refutations</h3>{selectedGuarantee.refutations.map((r, i) => <p key={i}>{r}</p>)}</>}
      </>}
      {selectedRelationship && <>
        <span className="eyebrow">{selectedRelationship.kind === 'architecture' ? 'DECLARED HANDOFF' : 'GUARANTEE RELIANCE'}</span><h2>{selectedRelationship.label}</h2>
        <div className="callout"><strong>{component(selectedRelationship.source).label} → {component(selectedRelationship.target).label}</strong></div>
        <p>{selectedRelationship.because}</p><button className="primary" onClick={() => { if (component(selectedRelationship.target).guarantees.length && !expanded.includes(selectedRelationship.target)) setExpanded(ids => [...ids, selectedRelationship.target]); setSelected({ kind: 'component', id: selectedRelationship.target }); }}>Explore receiving component</button>
        <h3>Declaration provenance</h3><code>{selectedRelationship.declarationId}</code>{selectedRelationship.problems.map(p => <p key={p}>{p}</p>)}
      </>}
    </aside>}</main>
  </div>;
}
createRoot(document.getElementById('root')).render(<ReactFlowProvider><App /></ReactFlowProvider>);
