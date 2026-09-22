# Does the test measure its stated requirement?

Date: September 18, 2026. Session: `01a0b5e4-e0bb-7160-8bc1-356df5308788`.
Work order: `w-33a7d1e8`. Experiment: `x-3de811d1`.

## Result

**The narrower question was promising on these controlled cases: 13 of 14 model judgments matched the predeclared expectations.** There were twelve distinct test forms and two test-title variations; counting distinct forms only, the result was 11 of 12. This is a small selected set, not an estimate of general review accuracy.

The model received **only a bounded requirement and test code**, not the production implementation, labels, or test execution outcomes. Each request asked one Choice question: `measures`, `does_not_measure`, or `insufficient`.

All nine weak-test cases were classified `does_not_measure`. Three of four meaningful-test cases were classified `measures`. The one missing-helper case correctly received `insufficient`. The sole error was a false rejection of a source-population detector whose sensitivity to the declared change was demonstrated by execution. There were no false acceptances in this selected set.

This supports evaluating test-to-requirement correspondence as an advisory use. It does not support automatically accepting an invariant because a model approves its test.

## What changed from the previous experiment

The previous experiment asked the model to connect specs, implementation behavior, and tests. This experiment does not ask whether production code is correct. It asks whether the test's observations and assertions concern the property the requirement states.

For example, the host requirement names a configured host and five observed-host inputs. A direct equality assertion on the production result can measure that finite behavior. Checking that the function exists, giving configured and observed the same value, replacing the target with a mock, or looking for a source string cannot distinguish the chosen violation.

The requirements were bounded to the cases or source syntax actually under review. Approval of the SQL rejection examples does not establish all possible SQL identifier behavior. Approval of the population example does not establish all possible JavaScript source representations.

The cases, context, and question changed together relative to the previous experiment. The results are not a controlled causal demonstration that removing implementation context alone improves accuracy.

## Source and method

- Target remains `daniloc/mnemion`, local source commit `02efce9da182ba7d543e47d8694f39ef9794ed46`.
- The test variants are controlled adaptations of the host, SQL grammar, and resource-kind tests used in the previous study. They are not fourteen untouched production tests.
- Existing production source was copied with `git archive` into a temporary directory. No Mnemion source was edited in place.
- Labels, question wording, and all fourteen cases were persisted before any model request. The experiment expectation and criteria were recorded in the journal beforehand.
- Model: pinned `jev-1.13.0`, matching every response's returned identity.
- Fourteen requests were completed, one independent question per request, with no retry. The question explicitly instructed the model to inspect executable assertions rather than trusting names, and to abstain when test-helper logic was absent.
- Test code and requirements were the only review evidence sent. Expected outputs of the system under test appear where necessary in the requirement and test, but the model's expected classification and the execution results were withheld.
- The test assertion helper in f10 was present for local execution but deliberately omitted from the API input. The appropriate review result was therefore insufficient, despite the actual test detecting the controlled change.
- Some weak tests retain the same reassuring title as a meaningful test. f13 and f14 change only titles, in opposite directions. This checks classification stability under those two title changes, not arbitrary comments or adversarial instructions.

## Executed evidence

Every case passed on the original source. Three independent changes were then staged, each from the original source:

1. **Host:** return a non-null observed host before checking meaningful configuration. The original configured-host return remains in the file, allowing the source-presence test to remain green.
2. **SQL:** remove identifier validation, retaining the quoted return. Valid-input tests still pass, while actual rejection assertions fail.
3. **Population:** change the served required-scope kind from `entry` to `collection`, retaining its pattern-and-id address. A manually synchronized list misses this change; deriving the population from `io.ts` detects it.

The source was restored after the comparisons, and its before/after hashes matched.

| Source state | Passing case tests | Failing case tests |
| --- | --- | --- |
| Original | 14 | 0 |
| Observed host takes precedence | 12 | 2 — f01, f13 |
| SQL validation removed | 12 | 2 — f06, f10 |
| Served resource kind changed | 13 | 1 — f12 |
| Restored | 14 | 0 |

Each complete meaningful test failed the relevant change; every deliberately weak test stayed green despite the violation. The underlying f10 helper also detected the SQL change, but that helper's behavior was not available to the model. These are finite witnessed sensitivity comparisons, not evidence that a test detects every possible violation.

The tests executed with Vitest's Node environment and existing local dependencies, without Cloudflare services or a deployment. No full application suite was executed.

## Case-level judgments

Confidence below is the API's distribution statistic, not an independently calibrated correctness probability.

| Case | Test form | Expected review result | Model result | Confidence |
| --- | --- | --- | --- | --- |
| f01 | Direct host result assertions over declared observed inputs | measures | measures | 0.91 |
| f02 | Only checks that the host function exists | does_not_measure | does_not_measure | 1.00 |
| f03 | Calls the host function with configured and observed values equal | does_not_measure | does_not_measure | 1.00 |
| f04 | Replaces the production host function with a mock returning the expected value | does_not_measure | does_not_measure | 0.99 |
| f05 | Checks host source contains the expected strings | does_not_measure | does_not_measure | 0.97 |
| f06 | Directly asserts invalid SQL inputs throw the specified error | measures | measures | 0.89 |
| f07 | Checks valid SQL names instead of invalid-input rejection | does_not_measure | does_not_measure | 1.00 |
| f08 | Discards target errors and asserts a constant | does_not_measure | does_not_measure | 1.00 |
| f09 | Setup throws the expected error before calling the target | does_not_measure | does_not_measure | 0.96 |
| f10 | Delegates assertions to a helper withheld from the review | insufficient | insufficient | 0.95 |
| f11 | Checks an independently maintained resource-kind list | does_not_measure | does_not_measure | 0.97 |
| f12 | Derives resource kinds from the actual source before checking examples | measures | does_not_measure | 0.32 |
| f13 | Same assertions as f01, but title says it only checks existence | measures | measures | 0.84 |
| f14 | Same existence assertion as f02, but title claims comprehensive behavior verification | does_not_measure | does_not_measure | 1.00 |

The f12 response assigned 0.54 to does_not_measure, 0.45 to measures, and 0.01 to insufficient. The actual detector failed for the changed resource kind and passed with original/restored source. The provider does not return a reasoning explanation, so the experiment cannot establish why it rejected this test.

Both name-only variations retained their corresponding classifications. The model did not promote an existence assertion merely because its title claimed comprehensive behavior, or reject direct assertions because their title understated them.

## Interpretation for Coherence

The useful question is not simply whether a test and requirement discuss the same topic. It is whether the test observes the required outcome under the relevant conditions, without replacing that behavior or allowing an unrelated failure to satisfy the assertion.

Possible advisory behavior when a requirement names a totality oracle:

- Show the requirement beside the executable test and necessary test helpers.
- Ask this single correspondence question.
- A `does_not_measure` answer nominates the relationship for review and an executable experiment; it is not itself a structural defect.
- An `insufficient` answer asks for the missing test evidence, rather than pretending a helper's name establishes its behavior.
- A `measures` answer remains a static judgment. It does not replace observed enforcement, refutation, or the decomposition checklist, and it does not establish coverage outside the declared population.

The prior high-confidence behavioral false acceptance still matters; this result does not undo it. A productive separation may be to use typed judgments to review what a test observes and use execution to establish actual behavior. Further work needs real existing tests and independently reviewed labels, rather than more hand-selected examples alone.

## Usage, preservation, and limitations

- API input tokens: **13,268**; output tokens: **659**.
- Median measured HTTP round-trip: **0.311 seconds**; range **0.260–0.401 seconds**; sum **4.400 seconds**. This excludes preparation, local tests, and analysis.
- At the published model price checked September 18, 2026, $0.042 per million input tokens with output free, estimated token charge: **$0.000557256**. Account billing was not verified.
- Mnemion's tracked/untracked status and pre-existing diff were byte-identical before and after. Its existing config change was neither used nor changed.
- No API credential appears in the generated report or evidence archive. Authentication was supplied only at request time.
- The same agent prepared the requirements, test variants, question, and expectations. Execution corroborated the chosen contrasts, but this is not an independently labeled evaluation.
- The prompt explicitly named several defect patterns; the cases are intentionally clear examples of those patterns. Success does not imply the model will discover subtler omissions in unfamiliar integration tests.
- No downstream runtime judgments were given to the model, no repairs were applied to Mnemion, and these local comparisons were not appended as Mnemion Coherence run records.
- No new Coherence mechanism or vocabulary concept is introduced by this report; it records an experiment about the relationship between a requirement and its detector.

The companion `2026-09-18-typesafe-test-measurement-evidence.zip` contains all submitted request bodies and responses, separately stored expected labels, the controlled test sources and omitted helper, source hashes, local command/results, preserved changed-source versions, usage/timing, and a credential-free request replay helper.
