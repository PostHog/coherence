import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Controls, Handle, MarkerType, Position, ReactFlow } from '@xyflow/react';
import { buildStructureModel } from './structure-model.ts';
import { DEFAULT_STRUCTURE_OPTIONS } from './structure-contract.ts';
import { structureLayout } from './structure-layout.mjs';

const structureState = new Map();

const StackNode = memo(function StackNode({ data }) {
  const { component, open, detail, options, onExpand, onSelect, onFocusRelationship, localRelationships, relationshipFocused } = data;
  const routedGuarantees = new Set(localRelationships.flatMap(relationship => relationship.guaranteeIds));
  const shownGuarantees = component.guarantees.filter((guarantee, index) => index < options.summaryGuarantees || routedGuarantees.has(guarantee.id));
  return <article onClick={event => event.stopPropagation()} className={`structure-stack ${open ? 'is-open' : ''} ${relationshipFocused ? 'relationship-focused' : ''}`} data-structure-stack={component.id}>
    <Handle id="in" type="target" position={Position.Left}/><Handle id="out" type="source" position={Position.Right}/>
    <header>
      <span className="structure-kicker">{open ? 'Opened component stack' : 'Component stack'} · {component.density.total} declared signals</span>
      <div className="structure-card-actions"><button className="structure-select" onClick={() => onSelect(component.id)}>{component.label}</button>
        <button data-structure-expand={component.id} aria-expanded={open} onClick={() => onExpand(component.id)}>{open ? 'Fold' : 'Unfold'}</button></div>
      {detail !== 'tile' && <p>{component.intent || 'No declared purpose is available for this component.'}</p>}
    </header>
    {detail === 'summary' && <div className="structure-summary"><span>{component.guarantees.length} promise{component.guarantees.length === 1 ? '' : 's'}</span><span>{component.density.boundaries} boundar{component.density.boundaries === 1 ? 'y' : 'ies'}</span>
      {component.taxonomy.subjects > 0 && <span>{component.taxonomy.subjects} taxonomy observation{component.taxonomy.subjects === 1 ? '' : 's'}</span>}</div>}
    {detail === 'detail' && !open && shownGuarantees.slice(0, 1).map(guarantee => <button className="structure-near-promise" title={guarantee.label} key={guarantee.id} onClick={event => { event.stopPropagation(); onSelect(guarantee.id); }}>{guarantee.label}</button>)}
    {open && <section className="structure-unfurled" aria-label={`${component.label} architectural detail`}>
      {shownGuarantees.length > 0 && <div><h3>Promises</h3>{shownGuarantees.map(guarantee => <article className="structure-promise-card" key={guarantee.id}><Handle id={`promise:${guarantee.id}`} type="target" position={Position.Left}/><Handle id={`promise:${guarantee.id}`} type="source" position={Position.Right}/><button className="structure-detail-link" onClick={event => { event.stopPropagation(); onSelect(guarantee.id); }}>{guarantee.label}</button>{guarantee.evidence.map(evidence => <button className="structure-evidence" key={evidence.id} onClick={event => { event.stopPropagation(); onSelect(evidence.id); }}>{String(evidence.attributes.verdict ?? evidence.attributes.grade ?? 'recorded evidence')} · {String(evidence.attributes.chokepoint ?? evidence.attributes.oracle ?? evidence.label)}</button>)}</article>)}</div>}
      {(component.boundaries.length + component.resources.length + component.entrances.length) > 0 && <div><h3>Architectural detail</h3>
        {[...component.entrances, ...component.boundaries, ...component.resources].slice(0, 3).map(asset => <button className="structure-detail-link" key={asset.id} onClick={() => onSelect(asset.id)}>{asset.label}</button>)}</div>}
      {localRelationships.length > 0 && <div><h3>Declared crossings</h3>{localRelationships.map(relationship => <button className="structure-detail-link" key={relationship.id} onClick={() => onFocusRelationship(relationship.id)}>{relationship.label} → {relationship.source === component.id ? relationship.target : relationship.source}</button>)}</div>}
      {!shownGuarantees.length && !component.boundaries.length && !component.resources.length && !component.entrances.length && <p className="structure-muted">No additional declared architectural detail.</p>}
    </section>}
  </article>;
});

const EndpointNode = memo(function EndpointNode({ data }) {
  return <article className="structure-endpoint" data-structure-endpoint={data.id}><span>Unresolved endpoint</span><strong>{data.id}</strong><p>The declared relationship remains inspectable; this address is not a displayed component.</p></article>;
});
const nodeTypes = { structureStack: StackNode, endpoint: EndpointNode };

function detailAt(zoom, options) {
  if (zoom < options.tileZoom) return 'tile';
  return zoom < options.detailZoom ? 'summary' : 'detail';
}
function sourceStatus(model) {
  const unavailable = model.sources.filter(source => source.status === 'unavailable');
  return unavailable.length ? `${unavailable.length} source reading${unavailable.length === 1 ? '' : 's'} unavailable; displayed architecture may be incomplete.` : '';
}

/** A configured renderer: it consumes the shared semantic projection and adds no meanings. */
export function StructureRenderer({ catalog, view, onSelect }) {
  const model = useMemo(() => buildStructureModel(catalog), [catalog]);
  const options = view.structure ?? DEFAULT_STRUCTURE_OPTIONS;
  const cached = structureState.get(view.id);
  const [expanded, setExpanded] = useState(() => new Set(cached?.expanded ?? []));
  const [focusedRelationship, setFocusedRelationship] = useState(() => cached?.focusedRelationship ?? null);
  const [zoom, setZoom] = useState(() => cached?.zoom ?? cached?.viewport?.zoom ?? 1);
  const flow = useRef(null);
  const detail = detailAt(zoom, options);
  const componentIds = useMemo(() => new Set(model.components.map(component => component.id)), [model]);
  const relationshipIds = useMemo(() => new Set(model.relationships.map(relationship => relationship.id)), [model]);
  useEffect(() => {
    setExpanded(previous => new Set([...previous].filter(id => componentIds.has(id))));
    setFocusedRelationship(previous => previous && relationshipIds.has(previous) ? previous : null);
  }, [componentIds, relationshipIds]);
  useEffect(() => { structureState.set(view.id, { ...(structureState.get(view.id) ?? {}), expanded: [...expanded], focusedRelationship, zoom }); }, [view.id, expanded, focusedRelationship, zoom]);
  const unsupported = useMemo(() => [...new Set(model.relationships.flatMap(relation => [relation.source, relation.target]).filter(id => !componentIds.has(id)))], [model, componentIds]);
  const relationshipCounts = useMemo(() => Object.fromEntries(model.components.map(component => [component.id, model.relationships.filter(relationship => relationship.source === component.id || relationship.target === component.id).length])), [model]);
  const layout = useMemo(() => structureLayout(model.components, expanded, options, relationshipCounts), [model.components, expanded, options, relationshipCounts]);
  const nodes = useMemo(() => {
    const stacks = model.components.map(component => {
      const box = layout.positions[component.id];
      return { id: component.id, type: 'structureStack', position: { x: box.x, y: box.y }, style: { width: box.width, height: box.height },
        data: { component, open: expanded.has(component.id), detail, options, relationshipFocused: focusedRelationship && model.relationships.find(relationship => relationship.id === focusedRelationship && (relationship.source === component.id || relationship.target === component.id)), localRelationships: model.relationships.filter(relationship => relationship.source === component.id || relationship.target === component.id), onExpand: id => setExpanded(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; }), onSelect, onFocusRelationship: id => { setFocusedRelationship(id); onSelect(id); } } };
    });
    return [...stacks, ...unsupported.map((id, index) => ({ id: `endpoint:${id}`, type: 'endpoint', position: { x: layout.bounds.width + 48, y: 38 + index * 170 }, style: { width: 228, height: 138 }, data: { id } }))];
  }, [model.components, model.relationships, layout, expanded, detail, options, unsupported, onSelect, focusedRelationship]);
  const guaranteeOwner = useMemo(() => new Map(model.components.flatMap(component => component.guarantees.map(guarantee => [guarantee.id, component.id]))), [model]);
  const edges = useMemo(() => model.relationships.map(relationship => { const guarantee = relationship.guaranteeIds.find(id => guaranteeOwner.has(id)); const owner = guarantee && guaranteeOwner.get(guarantee); return ({ id: relationship.id, source: componentIds.has(relationship.source) ? relationship.source : `endpoint:${relationship.source}`,
    target: componentIds.has(relationship.target) ? relationship.target : `endpoint:${relationship.target}`, sourceHandle: owner === relationship.source && expanded.has(owner) ? `promise:${guarantee}` : 'out', targetHandle: owner === relationship.target && expanded.has(owner) ? `promise:${guarantee}` : 'in',
    markerEnd: { type: MarkerType.ArrowClosed }, className: `${relationship.problems.length ? 'structure-problem-edge' : 'structure-edge'} ${focusedRelationship === relationship.id ? 'structure-edge-focused' : ''}`, data: { relationship },
  }); }), [model.relationships, componentIds, guaranteeOwner, expanded, focusedRelationship]);
  const selectEdge = useCallback((_, edge) => { setFocusedRelationship(edge.id); onSelect(edge.id); }, [onSelect]);
  const initialize = useCallback(instance => { flow.current = instance; const viewport = structureState.get(view.id)?.viewport; if (viewport) instance.setViewport(viewport); else instance.fitView({ padding: 0.1, minZoom: 0.15, maxZoom: 1 }); }, [view.id]);
  const entrances = model.project.entrances;
  const declarationIssues = model.issues.filter(issue => !model.sources.some(source => source.id === issue.source && source.status === 'unavailable'));
  return <section className="structure-view" data-structure-view>
    <div className="structure-introduction"><div><span className="structure-eyebrow">Current architecture</span><h2>{model.project.label}</h2>
      {model.project.purposes.length ? model.project.purposes.map(purpose => <button className="structure-purpose" key={purpose.id} onClick={() => onSelect(purpose.id)}>{typeof purpose.attributes.text === 'string' ? purpose.attributes.text : purpose.label}</button>) : <p>No declared project purpose is available. Inspect source availability and specifications before drawing conclusions.</p>}</div>
      <div className="structure-entrances"><h3>Entrances</h3>{entrances.length ? entrances.map(entrance => <button key={entrance.id} onClick={() => onSelect(entrance.id)}>{entrance.label}</button>) : <p>No named entrances declared.</p>}</div></div>
    {sourceStatus(model) && <p className="structure-source-warning" role="alert">{sourceStatus(model)}</p>}
    {declarationIssues.length > 0 && <details className="structure-issues"><summary>{declarationIssues.length} declaration issue{declarationIssues.length === 1 ? '' : 's'} retained for inspection</summary>{declarationIssues.map(issue => <p key={`${issue.source}:${issue.message}`}>{issue.source}: {issue.message}</p>)}</details>}
    <div className="structure-toolbar"><span data-structure-detail>{detail === 'tile' ? 'Tile detail' : detail === 'summary' ? 'Summary detail' : 'Detailed cards'}</span><button onClick={() => flow.current?.fitView({ padding: 0.1, minZoom: 0.15, maxZoom: 1 })}>Fit architecture</button><span>{model.components.length} component stacks · density counts declared responsibilities, boundaries and relationships</span></div>
    <details className="structure-relationship-list" data-structure-relationships><summary>{model.relationships.length} declared architectural relationship{model.relationships.length === 1 ? '' : 's'}</summary>{model.relationships.map(relationship => <button key={relationship.id} data-structure-relationship={relationship.id} onClick={() => { setFocusedRelationship(relationship.id); onSelect(relationship.id); }}>{relationship.label} · {relationship.source} → {relationship.target}</button>)}</details>
    <div className="structure-canvas" data-structure-map aria-label="Architectural component stacks">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView={false} defaultViewport={cached?.viewport} nodesDraggable={false} nodesConnectable={false} minZoom={0.12} maxZoom={1.6}
        onInit={initialize} onMove={(_, viewport) => { setZoom(viewport.zoom); structureState.set(view.id, { ...(structureState.get(view.id) ?? {}), viewport }); }} onMoveEnd={(_, viewport) => structureState.set(view.id, { ...(structureState.get(view.id) ?? {}), viewport })} onNodeClick={(_, node) => node.type === 'structureStack' && onSelect(node.id)} onEdgeClick={selectEdge}
        proOptions={{ hideAttribution: true }}><Controls showInteractive={false}/></ReactFlow>
    </div>
  </section>;
}

export function StructureSidebar({ catalog, id, onSelect, onClose }) {
  const model = useMemo(() => buildStructureModel(catalog), [catalog]);
  const component = model.components.find(item => item.id === id);
  const relationship = model.relationships.find(item => item.id === id);
  const guarantee = model.components.flatMap(item => item.guarantees).find(item => item.id === id);
  const asset = catalog.assets.find(item => item.id === id);
  const declarationAsset = relationship ? catalog.assets.find(item => item.id === relationship.declarationId) : undefined;
  const declarationOwner = typeof declarationAsset?.attributes.owner === 'string' ? declarationAsset.attributes.owner : undefined;
  const declarationSpec = declarationOwner && catalog.assets.find(item => item.kind === 'spec' && item.attributes.owner === declarationOwner);
  return <aside className="inspector structure-sidebar" data-structure-sidebar aria-label="Architecture details"><header><strong>Architecture detail</strong><button onClick={onClose} aria-label="Close architecture detail">×</button></header>
    {component && <><span className="kind">Component stack</span><h2>{component.label}</h2>{component.parent && <p>Within <button onClick={() => onSelect(component.parent)}>{model.components.find(item => item.id === component.parent)?.label ?? component.parent}</button></p>}<p>{component.intent || 'No declared purpose is available.'}</p><h3>Declared prominence</h3><p>{component.density.invariants} promises · {component.density.boundaries} boundaries · {component.density.relationships} relationships. These are declared signals, not a health grade.</p>
      {component.rationale && <><h3>Rationale</h3><p>{component.rationale}</p></>}{component.guarantees.length > 0 && <><h3>Promises</h3>{component.guarantees.map(item => <button className="structure-detail-link" key={item.id} onClick={() => onSelect(item.id)}>{item.label}</button>)}</>}
      {component.taxonomy.subjects > 0 && <><h3>Exact-owned taxonomy observations</h3><p>{Object.entries(component.taxonomy.states).map(([state, count]) => `${count} ${state}`).join(' · ') || 'No current state count.'}{component.taxonomy.unavailable ? ' · unavailable evidence' : ''}</p>{component.taxonomy.labels.length > 0 && <p>{component.taxonomy.stale ? 'Historical or stale labels: ' : 'Current labels: '}{component.taxonomy.labels.join(' · ')}</p>}</>}{[...component.entrances, ...component.boundaries, ...component.resources].length > 0 && <><h3>Owned architectural assets</h3>{[...component.entrances, ...component.boundaries, ...component.resources].map(item => <button className="structure-detail-link" key={item.id} onClick={() => onSelect(item.id)}>{item.label}</button>)}</>}</>}
    {relationship && <><span className="kind">{relationship.kind}</span><h2>{relationship.label}</h2><p><button onClick={() => onSelect(relationship.source)}>{relationship.source}</button> → <button onClick={() => onSelect(relationship.target)}>{relationship.target}</button></p><h3>Declared meaning</h3><p>{relationship.because || 'No rationale was declared for this relationship.'}</p><p>Declared at <code>{String(declarationAsset?.attributes.declaration ?? declarationSpec?.attributes.path ?? relationship.declarationId)}</code>{declarationAsset && <> · <button onClick={() => onSelect(declarationAsset.id)}>inspect declaration</button></>}</p>{relationship.guaranteeIds.length > 0 && <><h3>Promises involved</h3>{relationship.guaranteeIds.map(item => <button className="structure-detail-link" key={item} onClick={() => onSelect(item)}>{model.components.flatMap(component => component.guarantees).find(guarantee => guarantee.id === item)?.label ?? item}</button>)}</>}{relationship.problems.length > 0 && <><h3>Uncertainty</h3>{relationship.problems.map(problem => <p key={problem}>{problem}</p>)}</>}</>}
    {guarantee && <><span className="kind">Promise</span><h2>{guarantee.label}</h2><p>Owned by <button onClick={() => onSelect(guarantee.owner)}>{guarantee.owner}</button></p><h3>Recorded result</h3><p>{guarantee.verdict || 'No recorded verdict.'}</p>{guarantee.evidence.length > 0 && <><h3>Evidence readings</h3>{guarantee.evidence.map(evidence => <p key={evidence.id}><button onClick={() => onSelect(evidence.id)}>{String(evidence.attributes.verdict ?? evidence.attributes.grade ?? 'recorded')}</button> · {String(evidence.attributes.chokepoint ?? evidence.attributes.oracle ?? evidence.label)}</p>)}</>}{guarantee.rationale && <><h3>Rationale</h3><p>{guarantee.rationale}</p></>}{guarantee.refutations.length > 0 && <><h3>Recorded refutations</h3>{guarantee.refutations.map(item => <p key={item}>{item}</p>)}</>}{guarantee.anchors.length + guarantee.oracles.length > 0 && <><h3>Enforcement references</h3><p>{[...guarantee.anchors, ...guarantee.oracles].join(' · ')}</p></>}</>}
    {!component && !relationship && !guarantee && asset?.kind === 'description' && <><span className="kind">Project purpose</span><h2>{asset.label}</h2><p>{typeof asset.attributes.text === 'string' ? asset.attributes.text : 'Authored project explanation.'}</p><p>Declaration: <code>{String(asset.attributes.declaration ?? asset.source)}</code></p></>}
    {!component && !relationship && !guarantee && asset?.kind === 'entrance' && <><span className="kind">Entrance</span><h2>{asset.label}</h2><p>{typeof asset.attributes.description === 'string' ? asset.attributes.description : 'Declared architectural entrance.'}</p>{typeof asset.attributes.component === 'string' && <p>Owned by <button onClick={() => onSelect(String(asset.attributes.component).replace(/^(?!component:)/, 'component:'))}>{String(asset.attributes.component)}</button></p>}<p>Declaration: <code>{String(asset.attributes.declaration ?? asset.source)}</code></p></>}
    {!component && !relationship && !guarantee && asset?.kind === 'guarantee' && <><span className="kind">Evidence reading</span><h2>{asset.label}</h2><p>Verdict: {String(asset.attributes.verdict ?? 'not recorded')}</p><p>Oracle: {String(asset.attributes.oracle ?? 'not recorded')}</p><p>Chokepoint: {String(asset.attributes.chokepoint ?? 'not recorded')}</p><p>Grade: {String(asset.attributes.grade ?? 'not recorded')}</p><p>Source: <code>{asset.source}</code></p></>}
    {!component && !relationship && !guarantee && (asset?.kind === 'transition' || asset?.kind === 'resource') && <><span className="kind">{asset.kind}</span><h2>{asset.label}</h2><p>{String(asset.attributes.translates ?? asset.attributes.intent ?? asset.attributes.description ?? 'Declared architectural asset.')}</p><p>Source: <code>{asset.source}</code></p></>}
    {!component && !relationship && !guarantee && asset && !['description', 'entrance', 'guarantee', 'transition', 'resource'].includes(asset.kind) && <><span className="kind">Reference</span><h2>{asset.label ?? id}</h2><p>This selected address is outside the current Structure projection. It remains a catalog reference and is not represented as an invented architectural relationship.</p></>}
  </aside>;
}
