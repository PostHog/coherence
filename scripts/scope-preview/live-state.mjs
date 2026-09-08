// Full snapshots remain the reconnect protocol. Referential sharing is local
// scheduling only: unchanged sections do not make unrelated tabs do work.
export function shareReadings(previous, incoming) {
  const next = { ...incoming };
  for (const key of Object.keys(next)) {
    if (JSON.stringify(previous?.[key]) === JSON.stringify(next[key])) next[key] = previous[key];
  }
  if (next.structure && previous?.structure && next.structure !== previous.structure
    && JSON.stringify(next.structure.model) === JSON.stringify(previous.structure.model)) {
    next.structure = { ...next.structure, model: previous.structure.model };
  }
  return next;
}
