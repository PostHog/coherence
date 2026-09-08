// A bounded reading lens, never a replacement model. Every withheld assembly is
// counted and stays in the hierarchy; the canonical center remains in each page.
export function scopeScene(model, { owner, page = 0, all = false } = {}) {
  const assemblies = model.nodes.filter(n => !n.role || n.role === 'assembly');
  const project = model.nodes.find(n => n.role === 'project') ?? null;
  const evidence = model.nodes.filter(n => n.role === 'evidence');
  const anchor = assemblies.find(n => n.id === model.center) ?? assemblies[0];
  const groups = model.nodes.filter(n => model.containment?.some(c => c.parent === n.id));
  const defaultOwner = assemblies.some(n => n.parent === anchor?.id) ? anchor.id : anchor?.parent ?? null;
  const activeOwner = owner === undefined || (owner !== null && !groups.some(n => n.id === owner)) ? defaultOwner : owner;
  const pool = all || activeOwner === null ? assemblies : assemblies.filter(n => n.parent === activeOwner || n.id === activeOwner);
  const peers = pool.filter(n => n.id !== anchor?.id);
  const pages = Math.max(1, Math.ceil(peers.length / 3));
  const activePage = Math.max(0, Math.min(page, pages - 1));
  const selected = all ? assemblies : [...(anchor ? [anchor] : []), ...peers.slice(activePage * 3, activePage * 3 + 3)];
  const ids = new Set(selected.map(n => n.id));
  return { project, evidence, groups, owner: activeOwner, page: activePage, pages,
    total: assemblies.length, groupTotal: new Set([...pool.map(n => n.id), ...(anchor ? [anchor.id] : [])]).size,
    withheld: assemblies.length - selected.length,
    omittedRelations: model.relations.filter(r => !ids.has(r.source) || !ids.has(r.target)).length,
    model: { ...model, center: anchor?.id ?? null, nodes: selected,
      relations: model.relations.filter(r => ids.has(r.source) && ids.has(r.target)) },
  };
}
