import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Controls, Handle, Position, BaseEdge, EdgeLabelRenderer, getSmoothStepPath, MarkerType, useReactFlow } from '@xyflow/react';
import { regionScene, regionGeometry } from './region-model.mjs';
import { BindingInspector } from './bindings.jsx';
import { bindingLabel } from './binding-reading.mjs';

const dimensions = { symbol: [280, 145], context: [310, 190] };
const handlesFor = (width, height) => [Position.Top, Position.Bottom, Position.Left, Position.Right].flatMap(position => ['source', 'target'].map(type => ({
  id: `${type}-${position}`, type, position, x: position === Position.Left ? 0 : position === Position.Right ? width : width / 2,
  y: position === Position.Top ? 0 : position === Position.Bottom ? height : height / 2, width: 0, height: 0,
})));
function Ports() { return [Position.Top, Position.Bottom, Position.Left, Position.Right].flatMap(position => ['source', 'target'].map(type => <Handle key={`${type}-${position}`} id={`${type}-${position}`} type={type} position={position}/>)); }
const RegionNode = memo(function RegionNode({ data }) {
  return <article className={`scope-region ${data.expanded ? 'expanded' : 'collapsed'}`}><Ports/>
    <header><div><span className="eyebrow">ASSEMBLY · CENTER OF THIS READING</span><h2>{data.subject.label}</h2></div>
      <button className="nodrag" onClick={data.toggle}>{data.expanded ? 'Collapse' : 'Expand subjects'}</button></header>
    <p className="region-intent">{data.subject.intent}</p>
    {!data.expanded && <div className="collapsed-promises">{data.rows.map(row => <button className="nodrag" key={row.id} onClick={() => data.inspect(row.id)}>
      <strong>{row.definition?.title ?? 'Invalid binding'}</strong><span>{bindingLabel(row)}</span></button>)}</div>}
    <footer>{data.rows.length} of {data.total} internal paths shown · {data.subjectCount} named subjects · not component health</footer>
  </article>;
});
const SymbolNode = memo(function SymbolNode({ data }) {
  const [file, symbol] = data.subject.id.split('#');
  return <article className="region-symbol"><Ports/><header><strong>{symbol}</strong></header>
    <code>{file}</code><p>{data.subject.roles.join(' · ')}</p></article>;
});
const ContextNode = memo(function ContextNode({ data }) {
  return <article className="region-context"><Ports/><header>{data.subject.label}</header><p>{data.subject.intent}</p><footer>Infrastructure · no promise inferred</footer></article>;
});
function PromiseEdge(props) {
  const [path, x, y] = getSmoothStepPath({ ...props, offset: 105 + props.data.lane * 85, borderRadius: 20 });
  return <><BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} style={{ stroke: '#476784', strokeWidth: props.selected ? 3 : 2 }} interactionWidth={28}/>
    <EdgeLabelRenderer><button className="region-edge-label nodrag nopan" style={{ zIndex: 10, transform: `translate(-50%, -50%) translate(${x}px,${y}px)` }}
      onClick={() => props.data.inspect(props.data.row.id)} aria-label={`Inspect ${props.data.row.definition?.title}`}>
      <strong>{props.data.promise}</strong><span>{bindingLabel(props.data.row)}</span></button></EdgeLabelRenderer></>;
}
const nodeTypes = { region: RegionNode, symbol: SymbolNode, context: ContextNode };
const edgeTypes = { promise: PromiseEdge };

function RegionGraphInner({ model }) {
  const [owner, setOwner] = useState(model.center), [expanded, setExpanded] = useState(true), [imports, setImports] = useState(false), [selected, setSelected] = useState(null), [page, setPage] = useState(0);
  const scene = useMemo(() => regionScene(model, { owner, page }), [model, owner, page]);
  const flow = useReactFlow(), [ready, setReady] = useState(false);
  const key = JSON.stringify({ symbols: scene.symbols.map(n => n.id), context: scene.context.map(n => n.id), expanded });
  const geometry = useMemo(() => regionGeometry(JSON.parse(key)), [key]);
  const fit = useCallback(() => flow.fitBounds(geometry.bounds, { padding: 0.045, duration: 0 }), [flow, geometry]);
  useEffect(() => { if (ready) fit(); }, [ready, geometry]);
  const inspect = useCallback(id => setSelected(id), []);
  const toggle = useCallback(() => setExpanded(value => !value), []);
  const nodes = useMemo(() => !scene.focus ? [] : [
    { id: scene.focus.id, type: 'region', position: { x: 0, y: 0 }, width: geometry.width, height: geometry.height,
      handles: handlesFor(geometry.width, geometry.height), data: { subject: scene.focus, expanded, toggle, inspect, rows: scene.rows, total: scene.total, subjectCount: scene.symbols.length } },
    ...geometry.symbols.map(p => ({ id: p.id, type: 'symbol', parentId: scene.focus.id, extent: 'parent', position: { x: p.x, y: p.y },
      width: dimensions.symbol[0], height: dimensions.symbol[1], handles: handlesFor(...dimensions.symbol), data: { subject: scene.symbols.find(n => n.id === p.id) } })),
    ...geometry.context.map(p => ({ id: p.id, type: 'context', position: { x: p.x, y: p.y }, width: dimensions.context[0], height: dimensions.context[1],
      handles: handlesFor(...dimensions.context), data: { subject: scene.context.find(n => n.id === p.id) } })),
  ], [scene, geometry, expanded, toggle, inspect]);
  const edges = useMemo(() => [
    ...(expanded ? scene.rows.map((row, index) => {
      const side = index % 2 ? 'bottom' : 'top';
      return { id: row.id, source: row.binding.flow.from.subject, target: row.binding.flow.to.subject, sourceHandle: `source-${side}`, targetHandle: `target-${side}`,
        type: 'promise', zIndex: 5, selected: selected === row.id, markerEnd: { type: MarkerType.ArrowClosed, color: '#476784', width: 18, height: 18 },
        data: { row, lane: Math.floor(index / 2), inspect, promise: model.guarantees.find(g => g.id === row.binding.claim)?.invariant ?? 'Local boundary unavailable' } };
    }) : []),
    ...(imports ? scene.context.map(n => ({ id: `context:${n.id}`, source: scene.focus.id, target: n.id, sourceHandle: 'source-right', targetHandle: 'target-left',
      type: 'smoothstep', style: { stroke: '#a3afbd', strokeDasharray: '5 5' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#a3afbd' }, label: 'import', labelStyle: { fill: '#65758b', fontSize: 12 } })) : []),
  ], [scene, expanded, imports, selected, inspect, model.guarantees]);
  const chosen = scene.rows.find(row => row.id === selected);
  return <div className="region-view">
    <div className="region-toolbar"><div><strong>{scene.project?.label ?? model.root}</strong><span> / </span>
      <select aria-label="Focus assembly" value={scene.focus?.id ?? ''} onChange={e => { setOwner(e.target.value); setExpanded(true); setSelected(null); setPage(0); }}>
        {scene.candidates.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}</select></div>
      <label><input type="checkbox" checked={imports} onChange={e => setImports(e.target.checked)}/> Show imports</label><button onClick={fit}>Fit regions</button>
      <span>{scene.elsewhere} bindings elsewhere · {scene.withheldContext} providers withheld</span></div>
    {scene.pages > 1 && <nav className="region-toolbar" aria-label="Guarantee graph pages"><button disabled={scene.page === 0} onClick={() => setPage(scene.page - 1)}>Previous paths</button><span>{scene.page + 1} / {scene.pages} · {scene.total - scene.rows.length} internal paths elsewhere</span><button disabled={scene.page + 1 === scene.pages} onClick={() => setPage(scene.page + 1)}>Next paths</button></nav>}
    <div className="region-canvas"><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} nodesDraggable={false} nodesConnectable={false}
      minZoom={0.2} maxZoom={1.5} onInit={() => setReady(true)} onEdgeClick={(_, edge) => edge.type === 'promise' && inspect(edge.id)}
      onPaneClick={() => setSelected(null)} proOptions={{ hideAttribution: true }}><Controls showInteractive={false}/></ReactFlow>
      <div className="region-legend">Solid arrows: declared guarantees · dashed arrows: imports · roles and direction are caller-assessed</div>
      {chosen && <aside className="region-inspector" aria-label="Selected guarantee"><button className="close-inspector" onClick={() => setSelected(null)}>Close inspector</button><BindingInspector model={model} subject={{ id: chosen.owner }} bindingId={chosen.id}/></aside>}
    </div>
  </div>;
}
export function RegionGraph(props) { return <ReactFlowProvider><RegionGraphInner {...props}/></ReactFlowProvider>; }
