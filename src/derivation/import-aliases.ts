import { Unrunnable } from '../verification/floor.ts';

/** Exact and trailing-star aliases, deliberately not a TypeScript module resolver.
 * Only a unique member of the canonical walked population can become an edge. */
export function compileImportAliases(value: unknown): (specifier: string, files: ReadonlyMap<string, string>, exts: readonly string[]) => { target?: string; reason: string } | undefined {
  const refuse = (reason: string): never => { throw new Unrunnable([`✗ [config] importAliases: ${reason}`]); };
  if (value === undefined) return () => undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) refuse('expected an object of alias keys to nonempty path arrays');
  const safePath = (path: string) => !!path && !/^[/.]|[\\:\x00-\x1f\x7f]/.test(path) && path.split('/').every(p => p && p !== '.' && p !== '..');
  const entries = Object.entries(value as Record<string, unknown>).map(([key, paths]) => {
    const wildcard = key.endsWith('/*');
    const prefix = wildcard ? key.slice(0, -1) : key;
    if (!safePath(wildcard ? key.slice(0, -2) : key) || prefix.includes('*')) refuse(`invalid alias ${JSON.stringify(key)}; use an exact bare name or trailing /*`);
    if (!Array.isArray(paths) || !paths.length) refuse(`${JSON.stringify(key)} needs a nonempty path array`);
    const targets = (paths as unknown[]).map(path => {
      if (typeof path !== 'string') return refuse(`${JSON.stringify(key)} targets must be strings`);
      const normalized = path.startsWith('./') ? path.slice(2) : path;
      const base = wildcard && normalized.endsWith('/*') ? normalized.slice(0, -2) : normalized;
      if (wildcard !== normalized.endsWith('/*') || base.includes('*') || !safePath(base)) refuse(`${JSON.stringify(key)} has an invalid or escaping target ${JSON.stringify(path)}`);
      return wildcard ? base + '/' : base;
    });
    return { key, prefix, wildcard, targets };
  }).sort((a, b) => Number(a.wildcard) - Number(b.wildcard) || b.prefix.length - a.prefix.length || (a.key < b.key ? -1 : 1));
  return (specifier, files, exts) => {
    const entry = entries.find(e => e.wildcard ? specifier.startsWith(e.prefix) : specifier === e.key);
    if (!entry) return undefined;
    const capture = entry.wildcard ? specifier.slice(entry.prefix.length) : '';
    if (entry.wildcard && !safePath(capture)) return { reason: 'invalid alias capture' };
    const hits = new Set<string>();
    for (const base of entry.targets) {
      const target = base + capture;
      for (const candidate of [target, ...exts.map(e => `${target}.${e}`), ...exts.map(e => `${target}/index.${e}`)]) {
        if (files.has(candidate)) hits.add(candidate);
      }
    }
    return hits.size === 1 ? { target: [...hits][0], reason: 'declared alias' } : { reason: hits.size ? 'ambiguous declared alias' : 'missing declared alias target' };
  };
}
