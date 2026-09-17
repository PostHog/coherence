# Data is Destiny — design brief for Scope

Source: https://accord.exchange/how-to-build-software/data-is-destiny (the
how-to-build-software accord). Named by the owner as the essential input for the
Scope shell. This is a condensation, not the article.

**Thesis.** How a program structures its data matters more than how it structures
its code. Rigid data assumptions make rigid programs; a flexible model lets a
program evolve gracefully.

**Models as contracts.** A model defines the shape of the data a program handles.
Components take the model, never scattered raw values. "Models are an essential
contract for your code: they describe what any given component can expect to
input and output." The model is a layer of indirection: fields can be added
without restructuring. Not `number` but `statistic { labelText, value, lastUpdate }`.

**Model versus state.** The model is the shape; state is the concrete current
value. Keep them distinct.

**Three state rules.**
- Localization: state has to live somewhere, and where it lives has consequences.
- Singularity: state that lives in two places is an invitation to disagreement.
- Derivation: some state is derived from other state; compute it, never store it.

**Rendering as a function of state.** What the user sees is a function of the
ground-truth state. "Store truth once, then compute its consequences." This
removes whole classes of synchronization bugs.

**Design for expansion.** Requirements grow. Design models as extensible
containers rather than the minimum for today's need.

## Applied to Scope

The loaded glossary is the single ground truth. The search query is the only other
state. Every list, count, link target, and the two-layer composition is derived at
render time. The page is `render(state)`, and a second tab or a new field on a
concept is an addition to the model, never a rewrite.
