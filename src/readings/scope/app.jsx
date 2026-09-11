import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as Tabs from '@radix-ui/react-tabs';
import { ReactFlow, ReactFlowProvider, Controls, Handle, Position, MarkerType } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './style.css';
import { valueAt, textOf } from './catalog.ts';
import { projectView, resolveScopeConfiguration } from './configuration.ts';
import { layoutProjection } from './layout.mjs';

const initial = JSON.parse(document.getElementById('scope-data').textContent);
function fieldText(asset, field) {
  const value = valueAt(asset, field.field);
  if (field.format === 'count') return value == null ? '—' : Array.isArray(value) || typeof value === 'string' ? String(value.length) : typeof value === 'object' ? String(Object.keys(value).length) : '—';
  return field.format === 'json' ? JSON.stringify(value ?? null, null, 2) : textOf(value);
}
function Fields({ asset, fields }) {
  return <dl>{fields.map((field, i) => <div key={i}><dt>{field.label ?? field.field.replace(/^attributes\./, '')}</dt><dd>{fieldText(asset, field)}</dd></div>)}</dl>;
}
const AssetNode = memo(function AssetNode({ data }) {
  return <article className="asset-card graph-card" style={{ height: '100%' }}>
    <Handle id="in" type="target" position={Position.Left}/><Handle id="out" type="source" position={Position.Right}/>
    <header><span className="kind">{data.asset.kind}</span><strong>{data.asset.label}</strong></header>
    <div className="card-fields nodrag nowheel"><Fields asset={data.asset} fields={data.fields}/></div>
  </article>;
});
const nodeTypes = { asset: AssetNode };
const camera = new Map();
function GraphView({ projection, view, onSelect }) {
  const flow = useRef(null);
  const geometryKey = JSON.stringify([view.graph, projection.assets.map(a => [a.id, valueAt(a, view.graph.weight ?? 'attributes.mass.total')]), projection.relations.map(r => [r.id, r.source, r.target])]);
  const geometry = useMemo(() => layoutProjection(projection.assets, projection.relations, view.graph, valueAt), [geometryKey]);
  const nodes = useMemo(() => projection.assets.map(asset => ({ id: asset.id, type: 'asset', position: geometry.positions[asset.id],
    width: geometry.width, height: geometry.height, initialWidth: geometry.width, initialHeight: geometry.height,
    handles: [{ id: 'in', type: 'target', position: Position.Left, x: 0, y: geometry.height / 2, width: 8, height: 8 },
      { id: 'out', type: 'source', position: Position.Right, x: geometry.width, y: geometry.height / 2, width: 8, height: 8 }],
    data: { asset, fields: view.fields }, style: { width: geometry.width, height: geometry.height },
  })), [projection.assets, geometry, view.fields]);
  const edges = useMemo(() => projection.relations.map(r => ({ id: r.id, source: r.source, target: r.target,
    sourceHandle: 'out', targetHandle: 'in', label: view.graph.edgeLabel ? textOf(valueAt(r, view.graph.edgeLabel)) : r.kind,
    markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: '#65768a', strokeWidth: 1.5 }, labelStyle: { fill: '#354559', fontSize: 12 },
    labelBgStyle: { fill: '#faf9f6', fillOpacity: 0.95 },
  })), [projection.relations, view.graph.edgeLabel]);
  const initialize = useCallback(instance => {
    flow.current = instance;
    if (camera.has(view.id)) instance.setViewport(camera.get(view.id));
    else instance.fitBounds(geometry.bounds, { padding: 0.12, minZoom: 0.12, maxZoom: 1 });
  }, []);
  return <div className="graph-shell"><button className="fit-button" onClick={() => flow.current?.fitBounds(geometry.bounds, { padding: 0.12, minZoom: 0.12, maxZoom: 1 })}>Fit displayed assets</button>
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} nodesDraggable={false} nodesConnectable={false}
      minZoom={0.08} maxZoom={2} onInit={initialize} onMoveEnd={(_, viewport) => camera.set(view.id, viewport)}
      onNodeClick={(_, node) => onSelect(node.id)} onEdgeClick={(_, edge) => onSelect(edge.id)}
      proOptions={{ hideAttribution: true }}><Controls showInteractive={false}/></ReactFlow>
  </div>;
}
function TableView({ projection, view, onSelect }) {
  return <div className="table-scroll"><table><thead><tr><th>Asset</th>{view.fields.map((f, i) => <th key={i}>{f.label ?? f.field.replace(/^attributes\./, '')}</th>)}</tr></thead>
    <tbody>{projection.assets.map(asset => <tr key={asset.id}><td><button className="asset-link" onClick={() => onSelect(asset.id)}>{asset.label}</button></td>
      {view.fields.map((f, i) => <td key={i}><span className="cell" title={fieldText(asset, f)}>{fieldText(asset, f)}</span></td>)}</tr>)}</tbody></table></div>;
}
function CardView({ projection, view, onSelect }) {
  const groups = new Map();
  for (const asset of projection.assets) {
    const group = view.groupBy ? textOf(valueAt(asset, view.groupBy)) : '';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(asset);
  }
  return <div className="card-groups">{[...groups].map(([name, assets]) => <section key={name}>{name && <h2>{name}</h2>}<div className="card-grid">{assets.map(asset =>
    <article className="asset-card" key={asset.id}><header><span className="kind">{asset.kind}</span><button className="asset-link" onClick={() => onSelect(asset.id)}>{asset.label}</button></header><Fields asset={asset} fields={view.fields}/></article>
  )}</div></section>)}</div>;
}
const renderers = { graph: GraphView, table: TableView, cards: CardView };
const viewState = new Map();
function Projection({ catalog, view, onSelect }) {
  const [search, setSearch] = useState(viewState.get(view.id)?.search ?? ''), [page, setPage] = useState(viewState.get(view.id)?.page ?? 0);
  useEffect(() => { viewState.set(view.id, { search, page }); }, [view.id, search, page]);
  const projection = useMemo(() => projectView(catalog, view, search, page), [catalog, view, search, page]);
  const Renderer = renderers[view.renderer], lastPage = Math.max(0, Math.ceil(projection.matched / (view.pageSize ?? 50)) - 1);
  useEffect(() => { if (page > lastPage) setPage(lastPage); }, [lastPage]);
  return <section className="projection" aria-label={view.title}><div className="view-toolbar"><div><h1>{view.title}</h1><p>{view.description ?? 'Select an asset to inspect its complete attributes and explicit relationships.'}</p></div>
    <label className="search">Search assets<input type="search" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder="Search all attributes"/></label></div>
    <div className="population"><span>{projection.assets.length} displayed · {projection.matched} matched · {projection.total} in population{projection.withheld > 0 ? ` · ${projection.withheld} on other pages` : ''}{projection.withheldRelations > 0 ? ` · ${projection.withheldRelations} connections to assets outside this view` : ''}</span>
      <div><button disabled={!page} onClick={() => setPage(page - 1)}>Previous</button><span> {Math.min(page, lastPage) + 1} / {lastPage + 1} </span><button disabled={page >= lastPage} onClick={() => setPage(page + 1)}>Next</button></div></div>
    {projection.assets.length ? <ReactFlowProvider><Renderer projection={projection} view={view} onSelect={onSelect}/></ReactFlowProvider>
      : <div className="empty"><h2>No matching assets</h2><p>Absence is not a passing result. Check filters and source availability.</p></div>}
  </section>;
}
function Inspector({ catalog, id, onSelect, onClose }) {
  const asset = catalog.assets.find(a => a.id === id), relation = catalog.relations.find(r => r.id === id), item = asset ?? relation;
  const linked = catalog.relations.filter(r => r.source === id || r.target === id);
  return <aside className="inspector" aria-label="Asset inspector"><header><strong>{item ? 'Inspect' : 'Selection unavailable'}</strong><button onClick={onClose} aria-label="Close inspector">×</button></header>
    {item ? <><span className="kind">{item.kind}</span><h2>{item.label ?? item.kind}</h2><code>{id}</code>
      {asset && <p>Source: {asset.source} · {catalog.sources.find(s => s.id === asset.source)?.status ?? 'reference'}</p>}
      {relation && <p><button onClick={() => onSelect(relation.source)}>{relation.source}</button> → <button onClick={() => onSelect(relation.target)}>{relation.target}</button></p>}
      <h3>Attributes</h3><pre>{JSON.stringify(item.attributes, null, 2)}</pre>
      <h3>Relationships · {linked.length}</h3>{linked.map(r => <div className="related" key={r.id}><button onClick={() => onSelect(r.id)}>{r.kind}</button><span>{r.source === id ? ' → ' : ' ← '}</span><button onClick={() => onSelect(r.source === id ? r.target : r.source)}>{r.source === id ? r.target : r.source}</button></div>)}
    </> : <p>This address is no longer present in the captured catalog.</p>}
  </aside>;
}
function download(name, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function ConfigurationEditor({ configuration, catalog, onApply, onClose }) {
  const [text, setText] = useState(JSON.stringify({ ...configuration, extends: false }, null, 2)), [error, setError] = useState('');
  function apply(save = false) {
    try { const config = resolveScopeConfiguration(JSON.parse(text)); if (save) download('coherence.scope.json', { ...config, extends: false }); else onApply(config); setError(''); }
    catch (e) { setError(e.message); }
  }
  return <section className="configuration-editor" aria-label="Configure Scope"><header><h2>Configure Scope</h2><button onClick={onClose}>Close</button></header>
    <p>Preview changes here, then save <code>coherence.scope.json</code> in your project root to share them. Configurations select and present assets; the complete catalog stays inspectable.</p>
    <textarea aria-label="Scope JSON configuration" spellCheck={false} value={text} onChange={e => setText(e.target.value)}/>
    {error && <p role="alert">{error}</p>}<div className="editor-actions"><button onClick={() => apply()}>Apply preview</button><button onClick={() => apply(true)}>Download configuration</button><button onClick={() => download('scope-schema.json', catalog.schema)}>Download attribute inventory</button></div>
  </section>;
}
function App() {
  const [snapshot, setSnapshot] = useState(initial), [localConfig, setLocalConfig] = useState(null);
  const configuration = localConfig ?? snapshot.configuration;
  const [tab, setTab] = useState(configuration.initialView), [selected, setSelected] = useState(null), [editing, setEditing] = useState(false);
  const [live, setLive] = useState('Offline snapshot'), [error, setError] = useState(''), [paused, setPaused] = useState(false);
  const hold = useRef(false), pending = useRef(null);
  useEffect(() => {
    const meta = document.querySelector('meta[name="scope-live"]'); if (!meta) return;
    const stream = new EventSource(new URL(meta.content, location.href));
    stream.addEventListener('snapshot', event => {
      const packet = JSON.parse(event.data);
      if (hold.current) pending.current = packet; else setSnapshot(packet);
      setError(''); setLive('Live · read only');
    });
    stream.addEventListener('unavailable', event => { setError(JSON.parse(event.data).message); setLive('Last snapshot · unavailable'); });
    stream.onerror = () => setLive('Reconnecting · last snapshot');
    return () => stream.close();
  }, []);
  useEffect(() => { if (!configuration.views.some(v => v.id === tab)) setTab(configuration.initialView); }, [configuration, tab]);
  const failures = snapshot.catalog.sources.filter(s => s.status === 'unavailable');
  return <><header className="app-header"><a className="brand" href="#">◉ {configuration.title}</a><span className="project-name">{snapshot.catalog.project}</span><span className="live-state">{paused ? 'Paused · incoming updates held' : live}</span>
    {live !== 'Offline snapshot' && <button onClick={() => { hold.current = !paused; setPaused(!paused); if (paused && pending.current) { setSnapshot(pending.current); pending.current = null; } }}>{paused ? 'Resume' : 'Pause'}</button>}
    <button onClick={() => setEditing(!editing)}>Configure</button>{localConfig && <button onClick={() => setLocalConfig(null)}>Use project configuration</button>}</header>
    {(error || failures.length > 0) && <div className="source-alert" role="alert">{error}{failures.length > 0 && <details><summary>{failures.length} unavailable sources · this view may be incomplete</summary>{failures.map(s => <p key={s.id}><strong>{s.id}</strong>: {s.message}</p>)}</details>}</div>}
    {editing && <ConfigurationEditor configuration={configuration} catalog={snapshot.catalog} onApply={setLocalConfig} onClose={() => setEditing(false)}/>}
    <Tabs.Root value={tab} onValueChange={setTab} className="scope-tabs"><Tabs.List aria-label="Scope views">{configuration.views.map(v => <Tabs.Trigger key={v.id} value={v.id}>{v.title}</Tabs.Trigger>)}</Tabs.List>
      {configuration.views.map(view => <Tabs.Content value={view.id} key={view.id}><Projection catalog={snapshot.catalog} view={view} onSelect={setSelected}/></Tabs.Content>)}
    </Tabs.Root>
    <footer className="app-footer"><span>{snapshot.catalog.assets.length} assets · {snapshot.catalog.relations.length} explicit relationships</span><details><summary>Evidence and projection limits</summary>{snapshot.catalog.limits.map(t => <p key={t}>{t}</p>)}</details></footer>
    {selected && <Inspector catalog={snapshot.catalog} id={selected} onSelect={setSelected} onClose={() => setSelected(null)}/>}
  </>;
}
createRoot(document.getElementById('root')).render(<App/>);
