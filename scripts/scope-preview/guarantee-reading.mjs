// Presentation only: eligibility comes from the canonical resolver, never the browser.
export function relianceReading(model, relation) {
  const links = (model.guaranteeLinks?.links ?? []).filter(l => l.kind === 'relies'
    && l.owner === relation.source && l.provider === relation.target);
  return links.map(link => ({ link, guarantee: model.guarantees.find(g => g.id === link.claim) ?? null }));
}
export function connectionLabel(model, members) {
  const rows = members.flatMap(r => relianceReading(model, r));
  const current = rows.filter(r => r.link.status === 'current' && r.guarantee);
  if (!current.length) return rows.length ? 'Guarantee link needs repair' : 'Import only';
  const first = current[0].guarantee.invariant;
  const title = first.length > 76 ? `${first.slice(0, 73)}…` : first;
  return `${title}${current.length > 1 ? ` +${current.length - 1}` : ''}${rows.length > current.length ? ' · link issue' : ''}`;
}
