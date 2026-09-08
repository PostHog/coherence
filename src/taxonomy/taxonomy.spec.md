# Taxonomy

Classifies repository subjects against a shared catalog and preserves caller-assessed evidence, ambiguity and staleness.

Classification suggestions are not verification. The catalog, classifier, CLI and immutable assessment ledger form one ownership surface.

## invariants

- taxonomy representation roles require operational evidence under their recorded catalog
- taxonomy suggestions never acquire verification authority
- taxonomy revisions preserve scoped evidence and refuse damaged history
- taxonomy wire records require canonical internally consistent caller assessments

## refutations

- taxonomy representation roles require operational evidence under their recorded catalog: representation=yes alone proposed identical parser, validator, transformer and optimizer candidates for parseSpec and declarations-only types.ts, and allowed any one to be selected. V2 requires the corresponding operational observation; the exact V1 catalog remains the witness for historical records, which become stale rather than being silently reinterpreted. During the repair, authority=yes produced a validator candidate whose required validates-rules question was absent. Question relevance now derives from candidate requirements too; the guard covers authority and execution entry paths.
- taxonomy suggestions never acquire verification authority: the lab's semantic classifier allowed a caller to mark a guarantee satisfied using prose evidence and a falsifier string, without executing the falsifier. The port removes that state and mutation entirely: every suggestion is unverified, unknown evidence cannot select a role, and conflicting signals retain plural candidates rather than forcing one winner.
- taxonomy revisions preserve scoped evidence and refuse damaged history: integration fixtures remove a record's final newline, displace its filename, and redirect its directory through a symlink; each read/write refuses. Two actual CLI writers racing the same initial predecessor slot produce one recorded revision and one refusal. A changed direct dependency makes the retained classification stale rather than silently renewing it.

## works when

- boundary "taxonomy representation roles require operational evidence under their recorded catalog" at classifyTaxonomy via guard "taxonomy interview — operational discriminators separate representation roles and preserve no-fit"
- boundary "taxonomy revisions preserve scoped evidence and refuse damaged history" at taxonomyView via guard "taxonomy history — old catalog assessments retain their meaning and expire without silent migration"
- boundary "taxonomy suggestions never acquire verification authority" at classifyTaxonomy via guard "taxonomy classification — unknowns and plural responsibilities never become a single guessed role or passing guarantee"
- boundary "taxonomy suggestions never acquire verification authority" at TAXONOMY via guard "taxonomy catalog — every frozen lab subject survives the namespaced port without added authority"
- boundary "taxonomy revisions preserve scoped evidence and refuse damaged history" at recordTaxonomy via guard "taxonomy concurrency — two CLI writers cannot both own the initial predecessor slot"
- boundary "taxonomy revisions preserve scoped evidence and refuse damaged history" at readTaxonomyRecords via guard "taxonomy damage — malformed or displaced history refuses instead of shrinking into a clean empty view"
- boundary "taxonomy wire records require canonical internally consistent caller assessments" at validateTaxonomyRecord via guard "taxonomy damage — malformed or displaced history refuses instead of shrinking into a clean empty view"
- boundary "taxonomy revisions preserve scoped evidence and refuse damaged history" at captureTaxonomy via guard "taxonomy subjects — only resolved graph addresses enter evidence; absent, compound and escaped paths refuse"

## why

**taxonomy representation roles require operational evidence under their recorded catalog.**
A broad family resemblance is useful for choosing the next question, not for settling
the answer. Parsing, validation, transformation and optimization impose different duties;
declarations need not perform any of them. Unknown evidence and an exhausted no-fit
must stay distinct, and new knowledge must not rewrite the meaning of an old assessment.

**taxonomy wire records require canonical internally consistent caller assessments.**
A content address detects damage only when the reader also checks what was addressed.
The reader reconstructs the entire typed relation, including evidence membership,
caller attribution and the absence of a verification verdict; re-addressing a malformed
record cannot turn it into a usable assessment.

**taxonomy suggestions never acquire verification authority.** A familiar component role
can reveal useful obligations without establishing that any of them hold. The lab's
prose-only closure confused these two products. Role plurality, unknown evidence, and
unverified suggestions preserve the discovery benefit without borrowing the verifier's
authority. The catalog is bounded empirical knowledge, not a complete ontology.

**taxonomy revisions preserve scoped evidence and refuse damaged history.** An assessment
is reusable only while its supporting addresses and bytes remain available. Silent history
loss, a competing writer, or a changed dependency must cost visible uncertainty, never
look like an unclassified clean project or a renewed decision. The freshness grade names
its direct-file horizon; it does not imply transitive or behavioral verification.
