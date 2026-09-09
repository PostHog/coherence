// Read-only inventory of the known lab stress set. Never runs a classifier or promotes a family.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const lab = resolve(process.argv[2] ?? (() => { throw Error('Supply the coherence-lab directory'); })());
const read = path => readFileSync(resolve(lab, path), 'utf8');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const referencePath = 'results/component-classification-opaque-cli-v3/dichotomous-key-broad-qualification.json';
const manifestPath = 'harness/experiments/component-classification-semantic-all-projects-v1/dossiers/MANIFEST.json';
const referenceText = read(referencePath), manifestText = read(manifestPath);
const reference = JSON.parse(referenceText), manifest = JSON.parse(manifestText);
const cases = manifest.cases.map(item => {
  const dossierPath = item.dossier.replace(/^coherence-lab\//, '');
  const bytes = read(dossierPath), dossier = JSON.parse(bytes);
  const { digest, ...body } = dossier;
  assert.equal(hash(JSON.stringify(body)), digest);
  assert.equal(item.digest, digest);
  const ref = reference.cases.find(c => c.repository === item.repository && `${c.anchor}:${c.symbol}` === item.component);
  assert(ref, `Missing original source reference: ${item.caseId}`);
  const sourcePath = resolve(lab, '..', ref.sourcePath);
  const repoPath = resolve(lab, '../runs/component-classification-opaque-cli-v3/repositories', item.repository);
  let currentCommit = null, currentTrackedStatus = null;
  if (existsSync(resolve(repoPath, '.git'))) {
    const git = (...args) => execFileSync('git', args, { cwd: repoPath, encoding: 'utf8' }).trim();
    assert.equal(git('rev-parse', '--show-toplevel'), repoPath);
    currentCommit = git('rev-parse', 'HEAD');
    currentTrackedStatus = git('status', '--porcelain', '--untracked-files=no');
  }
  return { id: item.caseId, repository: item.repository, component: item.component,
    referenceRole: item.expectedRole, language: item.languageId,
    dossier: { path: dossierPath, bytesDigest: hash(bytes), contentDigest: digest, digestValid: true,
      requestErrors: dossier.requestErrors, hasSymbol: dossier.symbol !== null },
    source: { path: relative(lab, sourcePath), available: existsSync(sourcePath),
      digestNow: existsSync(sourcePath) ? hash(readFileSync(sourcePath)) : null,
      commitNow: currentCommit, trackedStatusNow: currentTrackedStatus,
      historicalCommit: null, historicalSourceMatch: 'not-established' },
    guaranteeReferenceJudgment: 'not-assessed', positiveOrNegative: 'not-assessed' };
});
assert.equal(cases.length, 17);
const catalog = JSON.parse(readFileSync(new URL('./snapshot.json', import.meta.url), 'utf8')).catalog;
const result = { schema: 'guarantee-rejection-assay-readiness/v1', status: 'not-ready',
  attribution: { agent: 'main', session: '01a06cfd-b3bc-7771-b2fb-a270ead577b7' },
  sources: [{ path: referencePath, digest: hash(referenceText) }, { path: manifestPath, digest: hash(manifestText) }],
  counts: { cases: cases.length, projects: new Set(cases.map(c => c.repository)).size,
    roles: new Set(cases.map(c => c.referenceRole)).size,
    languages: [...new Set(cases.map(c => c.language))].sort(),
    availableSources: cases.filter(c => c.source.available).length,
    validDossiers: cases.filter(c => c.dossier.digestValid).length },
  limits: ['This known stress set is not held out and its reference labels are role judgments, not guarantee judgments.',
    'Dossier digests validate stored dossier integrity, not source equivalence. Current checkout commits/digests are observations now; the dossier manifest pins no historical source commit.',
    'LSP request errors are preserved, not interpreted as missing application behavior.',
    'No source-derived guarantee applicability judgment or independent review was performed by this inventory.'],
  prerequisites: { independentCurator: 'unassigned', independentReviewers: 'unassigned',
    freshFrozenCases: 'missing', perFamilyPositiveNegativeMatrix: 'missing',
    candidateClauseAndParameterRevisions: 'not-authored-before-curation',
    usefulnessTaskAnswersAndReaderAssignments: 'missing' },
  families: catalog.value.guarantees.map(g => ({ id: g.id, inheritedPack: g.pack,
    disposition: 'defer-promotion', reason: 'No frozen independent representation/activation/usefulness assay yet.',
    catalogDigest: catalog.digest })), cases };
console.log(JSON.stringify(result, null, 2));
