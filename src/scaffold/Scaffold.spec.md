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
  because: a human needs to see the proposed vertebra in the existing security spine before accepting it, but rendering a possibility must not claim that the requirement was written, run, graded, or evidenced; keeping generated output outside the adopter tree also prevents the reading from changing the lexicon population it reads
  crossing: project-source -> reading
  refuted: inverted the preview branch so a preview request only printed the bullet and wrote no page -> the focused scaffold preview detector failed because no preview path was printed; restored, green (2026-09-18)
  kinds: none
- a gap's closure is proposed: For each entrance with no traced control the scaffold proposes a ranked closure in the spec's terms: the exact guard: line where its handler calls or passes a verified chokepoint its route-mates do not, else an invariant bullet in the scaffold shape whose crossing enters from its trust, and control: none first where it plausibly needs none.
  over: a handler calling a verified chokepoint, one the reading traced passing it while a route-mate does not, one whose reach meets no control, and a health check reaching no component beyond its own
  via: scaffold control proposes each gap's closure: a guard: line where its handler calls or passes a verified chokepoint its route-mates do not, else an invariant whose crossing enters from its trust, and control: none first where it plausibly needs none
  because: both outside adoptions left their gaps open (d-a1095ef2); the closure must be the cheapest thing to write, printed from what the reading already knows, not recalled from the grammar
  crossing: record -> reading
  refuted: stopped reading which verified chokepoint symbol a handler's declaration calls, so no guard: line was proposed for it -> the totality oracle went red; restored, green (2026-09-25)
  kinds: none
- a closure is written only where safe: The scaffold writes a guard: line under the entrance's bullet, never a second one nor one beside control: none; control: none only with a real reason, never a placeholder; and an invariant bullet as a requirement with its placeholders; what it writes still parses.
  over: a guard: written, written again, a control: none without a reason, with a placeholder reason, with a reason, beside a guard, and an invariant appended
  via: scaffold control writes only where safe: a guard: line under the entrance's bullet, never twice nor beside control: none; control: none only with a real reason; an invariant as a requirement with its placeholders
  because: a waiver without a reason is a silent one, and a guard beside control: none contradicts itself; a write that left the spec unparseable would cost more than it saved
  crossing: project-source -> reading
  refuted: let writeClosure write control: none without a reason or with a placeholder one -> the totality oracle went red; restored, green (2026-09-25)
  kinds: none
- scaffold control reads the recorded reading: The scaffold control command proposes from the recorded Structure reading while it describes the tree, reading only when it does not, and prints one entrance's closure or every gap's, writes on --write, and records the adoption baseline on --baseline.
  over: one entrance, a control: none written and read back without a new reading, every gap, an unknown entrance, and the baseline
  via: the scaffold control command reads the recorded reading, prints one entrance's closure or every gap's, writes on --write, and records the adoption baseline
  because: a reading takes minutes on a large project; a closure the agent writes one entrance at a time must not cost a reading each, and a spec line the reading never reads leaves it standing
  crossing: record -> reading
  refuted: made the control verb ignore the recorded reading and read the component interfaces every time -> the totality oracle went red; restored, green (2026-09-25)
  kinds: none
- undeclared entrances are proposed in the spec grammar: For every detected entrance no declared entrance covers, scaffold entrances prints one ## entrances bullet in the spec grammar under the spec of the component whose folder holds its file, named apart from that spec's entrances, its handler resolving to that entrance, and its meaning and trust as placeholders, the trust listing the entry spec's levels; filled and pasted where it says, each bullet parses and covers the entrance it was proposed for; it never writes.
  over: the undeclared server functions, server route and package script of a project with a component of its own for its server functions, pasted with the meaning and trust filled, and the specs before and after the command
  via: scaffold entrances proposes a bullet in the spec grammar for every undeclared entrance, under the spec of the component owning its file, that covers it once its meaning and trust are filled, and writes nothing
  because: c-9941b95e: coverage stayed at 11 to 14 percent on praetorium.gg in both arms of the replicated A/B, about 100 server functions and routes never declared; declaring one by hand means recalling the grammar and how the spec resolves a handler, so the complete bullet must be the cheapest thing to write. Only the agent knows what work enters and whose trust it carries, so those stay placeholders and nothing is written, as control: none is never written with a placeholder reason
  crossing: project-source -> reading
  refuted: proposed every symbol handler as a bare name, dropping in <file>, in entranceHandler -> the totality oracle went red; restored, green (2026-09-28)
  kinds: none
