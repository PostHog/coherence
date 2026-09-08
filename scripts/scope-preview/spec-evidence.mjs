// Navigation over original text, not another verifier or a prose synthesizer.
// Rationale links require a literal invariant name; full source remains available
// when prose uses a different spelling. Gates retain the canonical verdict.
export function specEvidence(subject, guarantees) {
  const names = [...new Set([...(subject.invariants ?? []), ...guarantees.map(g => g.invariant)])];
  const paragraphs = (subject.why ?? '').split(/\n\s*\n/).filter(p => p.trim());
  return names.map(name => ({ name,
    declared: (subject.invariants ?? []).includes(name),
    rationale: paragraphs.filter(p => p.includes(name)),
    refutations: (subject.refutations ?? []).filter(r => r.startsWith(`${name}:`)),
    gates: guarantees.filter(g => g.invariant === name),
  }));
}
