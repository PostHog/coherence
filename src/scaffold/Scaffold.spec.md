# Scaffold

The command that makes the complete shape the cheapest thing to produce: a component with its intent, an invariant with every slot and its checklist.

## invariants
- every slot printed: A scaffolded invariant prints every slot as a placeholder and one checklist line per applicable shape, and nothing for a shape that does not apply.
  protects: PLACEHOLDERS
  chokepoint: renderInvariant
  over: every key of the grammar and every shape of the checklist seed
  via: scaffold invariant prints every slot and only the applicable checklist shapes
  because: the complete shape must be the cheapest thing to produce; if a slot were missing the agent would have to recall the grammar, and a shape that does not apply would be dismissed by rote, which is the unexamined gap the checklist exists to prevent; the placeholder text lives in one table read by one function
  crossing: reading -> project-source
  refuted: made renderInvariant skip the first applicable shape -> "scaffold invariant prints every slot and only the applicable checklist shapes" went red in scaffold.test.ts; restored, green (2026-09-17)
  kinds: none
- written bullet parses as a requirement: A bullet the scaffold writes lands in the invariants section and parses as a requirement with its unfilled slots listed.
  over: every bullet the scaffold appends to a spec
  via: scaffold invariant --write appends to the invariants section, and the result parses as a requirement with unfilled slots
  because: what is written first must still parse, or the agent would have to fill every slot in one sitting; a requirement with its unfilled slots listed is the honest state of a bullet written and not yet settled
  crossing: reading -> project-source
  refuted: made appendInvariant write the spec back without the bullet -> "scaffold invariant --write appends to the invariants section, and the result parses as a requirement with unfilled slots" went red in scaffold.test.ts; restored, green (2026-09-17)
  kinds: none
- a component lives under its project: The folder a component is scaffolded into is confined to the project root; one that reaches above it is refused and nothing is created.
  protects: confineToRoot
  chokepoint: src/scaffold/scaffold.ts
  over: every folder given to scaffold component and scaffold invariant, relative, absolute, and reaching upward
  via: scaffold confines a component folder to the project root
  because: the folder comes from a command line or from spec text an agent wrote, neither of which is trusted to stay inside the tree it names; a scaffold that followed one upward would write a spec into a neighbouring project, and the invariant verb would then read and append to it
  crossing: reading -> project-source
  refuted: resolved the folder against the root and made it, so "..", an absolute path and "src/../../up" each created a component above the project -> "scaffold confines a component folder to the project root" went red in scaffold.test.ts, no exception where one was expected; restored, green (2026-09-18)
  kinds: none
- no overwrite: Scaffolding a component creates the folder and its spec with the intent and an empty invariants section, and refuses to overwrite a spec that exists.
  over: every folder the scaffold is asked to make a component
  via: scaffold component creates the folder and a spec with the intent and an empty invariants section, and refuses to overwrite
  because: a spec is the settled claims of a component; a scaffold that replaced one with an empty section would delete every invariant in it in the name of convenience
  crossing: reading -> project-source
  refuted: relaxed the existing-spec check so one spec could be overwritten -> "scaffold component creates the folder and a spec with the intent and an empty invariants section, and refuses to overwrite" went red in scaffold.test.ts; restored, green (2026-09-17)
  kinds: revision
  checklist: revision-preservation declared as no overwrite
- preview is a proposal, not evidence: A scaffold preview writes a self-contained Scope page outside the project tree whose Structure view adds the declared crossing as a dashed, unverified proposal; it changes no spec unless write is explicit, and identical inputs produce identical page bytes.
  over: every scaffold invariant invocation with preview, with and without write, including invalid components, crossing syntax, trust levels, and markup-bearing names
  via: scaffold invariant --preview writes only an ephemeral proposed, dashed, unverified Structure edge
  because: a human needs to see the proposed vertebra in the existing security spine before accepting it, but rendering a possibility must not claim that the requirement was written, run, graded, or evidenced; keeping generated output outside the adopter tree also prevents the reading from changing the glossary population it reads
  crossing: project-source -> reading
  refuted: inverted the preview branch so a preview request only printed the bullet and wrote no page -> the focused scaffold preview detector failed because no preview path was printed; restored, green (2026-09-18)
  kinds: none
