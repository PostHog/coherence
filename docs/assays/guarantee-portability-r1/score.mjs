// Mechanical accounting only. Semantic scope agreement and usefulness remain separate.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const topics = ['boundary', 'determinism', 'projection', 'persistence'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = row => `${row.caseId}:${row.topic}`;

export function account(corpus, reference, reviews) {
  const ids = new Set(corpus.cases.map(row => row.id));
  assert.equal(ids.size, corpus.cases.length, 'duplicate corpus case');
  const population = corpus.cases.flatMap(row => topics.map(topic => `${row.id}:${topic}`));
  const complete = rows => {
    assert.equal(rows.length, population.length, 'missing or extra row');
    const keys = rows.map(identity);
    assert.equal(new Set(keys).size, keys.length, 'duplicate review/reference row');
    assert.deepEqual([...keys].sort(), [...population].sort(), 'population mismatch');
  };
  complete(reference.rows);
  for (const row of reference.rows) assert(['positive', 'negative', 'unknown'].includes(row.expectation));
  assert.equal(reviews.length, 2);
  for (const review of reviews) {
    complete(review.rows);
    for (const row of review.rows) {
      assert(['applicable', 'not-applicable', 'unknown'].includes(row.applicability));
      assert(['fit', 'mismatch', 'not-applicable', 'unknown'].includes(row.representation));
      assert(['candidate', 'not-selected', 'unknown'].includes(row.suggestion));
      assert(row.reason, 'judgment lacks reason');
    }
  }
  const maps = reviews.map(review => new Map(review.rows.map(row => [identity(row), row])));
  return topics.map(topic => {
    const refs = reference.rows.filter(row => row.topic === topic);
    const positives = refs.filter(row => row.expectation === 'positive');
    const negatives = refs.filter(row => row.expectation === 'negative');
    const projectSet = rows => new Set(rows.map(row => corpus.cases.find(c => c.id === row.caseId).project));
    const domainSet = new Set(positives.map(row => corpus.cases.find(c => c.id === row.caseId).domain));
    const rows = refs.map(ref => {
      const readings = maps.map(map => map.get(identity(ref)));
      const positiveFit = readings.every(row => row.applicability === 'applicable' && row.representation === 'fit');
      const negativeExcluded = readings.every(row => row.applicability === 'not-applicable' && row.representation === 'not-applicable');
      return { caseId: ref.caseId, reference: ref.expectation,
        representation: readings.map(row => row.representation), applicability: readings.map(row => row.applicability),
        suggestion: readings.map(row => row.suggestion),
        provisionalAgreement: ref.expectation === 'positive' ? positiveFit : ref.expectation === 'negative' ? negativeExcluded : null,
        counterexamples: readings.map(row => row.counterexample ?? null),
        unknown: ref.expectation === 'unknown' || readings.some(row => row.applicability === 'unknown' || row.representation === 'unknown') };
    });
    const populationAdequate = positives.length >= 6 && projectSet(positives).size >= 3 && domainSet.size >= 2
      && negatives.length >= 3 && projectSet(negatives).size >= 2;
    return { topic, population: { total: refs.length, positives: positives.length, positiveProjects: projectSet(positives).size,
      positiveDomains: domainSet.size, negatives: negatives.length, negativeProjects: projectSet(negatives).size,
      referenceUnknown: refs.filter(row => row.expectation === 'unknown').length, adequate: populationAdequate },
      representation: { jointlyFitPositives: rows.filter(row => row.reference === 'positive' && row.provisionalAgreement).length,
        jointlyExcludedNegatives: rows.filter(row => row.reference === 'negative' && row.provisionalAgreement).length,
        blockers: rows.filter(row => row.reference !== 'unknown' && !row.provisionalAgreement).map(row => row.caseId),
        scopeAgreement: 'requires-attributed-semantic-comparison-not-string-equality' },
      activation: { candidateOnReferenceNegative: rows.filter(row => row.reference === 'negative' && row.suggestion.includes('candidate')).map(row => row.caseId),
        noCandidateOnReferencePositive: rows.filter(row => row.reference === 'positive' && row.suggestion.some(s => s !== 'candidate')).map(row => row.caseId),
        referenceTaxonomy: 'not-inferred-from-positive-negative-labels' },
      usefulness: 'not-evaluated-by-this-accountant', admission: 'not-established', rows };
  });
}

if (process.argv.includes('--self-test')) {
  const corpus = { cases: [{ id: 'case', project: 'project', domain: 'domain' }] };
  const reference = { rows: topics.map(topic => ({ caseId: 'case', topic, expectation: topic === 'boundary' ? 'positive' : 'negative' })) };
  const rows = topics.map(topic => ({ caseId: 'case', topic, applicability: topic === 'boundary' ? 'applicable' : 'not-applicable',
    representation: topic === 'boundary' ? 'fit' : 'not-applicable', suggestion: topic === 'boundary' ? 'candidate' : 'not-selected', reason: 'fixture' }));
  const good = { rows };
  assert.equal(account(corpus, reference, [good, good])[0].representation.jointlyFitPositives, 1);
  assert.equal(account(corpus, reference, [good, good])[0].population.adequate, false);
  assert.throws(() => account(corpus, reference, [good, { rows: rows.slice(1) }]));
  assert.throws(() => account(corpus, reference, [good, { rows: [rows[0], rows[0], ...rows.slice(2)] }]));
  const damaged = structuredClone(good); damaged.rows[0].representation = 'unknown';
  assert.deepEqual(account(corpus, reference, [good, damaged])[0].representation.blockers, ['case']);
  const overreach = structuredClone(good); overreach.rows[1].suggestion = 'candidate';
  assert.deepEqual(account(corpus, reference, [good, overreach])[1].activation.candidateOnReferenceNegative, ['case']);
  console.log('Accounting controls pass; no semantic or portability evidence created.');
} else {
  const load = path => {
    const bytes = readFileSync(new URL(path, import.meta.url), 'utf8');
    return { value: JSON.parse(bytes), sha256: hash(bytes) };
  };
  const corpus = load('./curation/corpus.json'), reference = load('./curation/reference.json');
  const freeze = load('./curation/freeze.json').value, candidates = load('./candidates.json');
  assert.equal(corpus.sha256, freeze.corpusSha256);
  assert.equal(reference.sha256, freeze.referenceSha256);
  const reviews = ['./review-a/review.json', './review-b/review.json'].map(path => load(path));
  assert(reviews.every(review => review.value.reviewer?.session && review.value.reviewer?.agent));
  assert.notEqual(reviews[0].value.reviewer.session, reviews[1].value.reviewer.session, 'reviewers share a session');
  for (const review of reviews) {
    assert.equal(review.value.corpusSha256, corpus.sha256);
    assert.equal(review.value.candidatesSha256, candidates.sha256);
  }
  const activationConsistency = reviews.map(review => ({ reviewer: review.value.reviewer,
    rows: review.value.rows.map(row => {
      const definition = candidates.value.definitions.find(d => d.topic === row.topic);
      const supplied = [...(Array.isArray(row.taxonomy?.roles) ? row.taxonomy.roles : []),
        ...(Array.isArray(row.taxonomy?.facets) ? row.taxonomy.facets : [])];
      const active = definition.activation.any.some(rule => [...(rule.roles ?? []), ...(rule.facets ?? [])]
        .every(id => supplied.includes(id)));
      return { caseId: row.caseId, topic: row.topic, suppliedTaxaActivateRule: active,
        reported: row.suggestion,
        inconsistent: active ? row.suggestion !== 'candidate' : row.suggestion === 'candidate' };
    }).filter(row => row.inconsistent) }));
  console.log(JSON.stringify({ corpusSha256: corpus.sha256, referenceSha256: reference.sha256,
    candidatesSha256: candidates.sha256, reviewerDigests: reviews.map(r => r.sha256),
    activationConsistency,
    note: 'Joint fit labels are provisional until scoped semantic agreement is assessed. No automatic admission.',
    results: account(corpus.value, reference.value, reviews.map(r => r.value)) }, null, 2));
}
