# Data is Destiny — design brief for Scope

Source: "Data is destiny" by Danilo Campos, from the how-to-build-software accord,
https://accord.exchange/how-to-build-software/data-is-destiny, CC BY-SA 4.0. The
owner named it as the essential input for the Scope shell. This is a condensation
in the article's own phrases; read the source for the argument.

**Thesis.** Structuring code is the obvious part of making a program, but
structuring data might be even more consequential. If our assumptions about the
data are too rigid, the program will be correspondingly rigid as our needs change.

**Models.** A model is the definition of data held by a program; all data in the
program is shaped by it. Wrapping values in a model is a layer of indirection: a
`number` becomes a `statistic` with `labelText` and `value`, and a third field,
`lastUpdate`, can be added while each component stays responsible for handling
the same `statistic` as before. Models can be complex, and often data is
concealed, not displayed to the user at all, but used to make the program more
reliably perform its role. "Models are an essential contract for your code: they
describe what any given component can expect to input and output." Models will
inevitably evolve, and those changes can impact many components: data is the job
your program does.

**State.** A model is the shape of data; state is the concrete value of that data.
State management is one of the great sources of bugs. Three things to keep in mind:

- State has to live somewhere. Where it lives can have consequences.
- State that lives in multiple places is an invitation to disagreement. That is
  what "single source of truth" is trying to narrow.
- Some state is derived from other state. The items in a cart are the ground
  truth the count is derived from; storing the count separately lets it fall out
  of date. Calculate it from the truly consequential state.

**Rendering.** Modern programs work hard to make what the user sees a function of
that underlying, ground-truth state. The ideal program turns a metaphorical crank
against a set of data and always gets the same output. Store truth once, then
compute its consequences.

## Applied to Scope

The loaded glossary is the single ground truth. The search query is the only other
state. Every list, count, link target, and the two-layer composition is derived at
render time. The page is `render(state)`, and turning the crank on the same
glossary must always produce the same page. A second tab or a new field on a
concept is an addition to the model, and the components that handle a concept keep
handling the same model as before. Fields the page does not display still belong
in the model.
