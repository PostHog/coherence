# Plugin

What every plugin owes, by its shape: each bullet holds for every plugin of the shape it names, whether or not the plugin's author wrote a spec. A plugin's own spec, beside its plugin.json, sets a bullet aside only under its ## overrides, with because:. coherence plugin check grades each bullet over the plugin's check.json, then grades it again with the reading emptied, and a bullet that still holds proves nothing for that plugin and fails.

## invariants
- file rule: The files check.json names as the language's are read as it, and those it names as not are not.
  holds: provider
  reads: language
  emptied: a file rule that takes no file
- declarations: The topLevel slot says which names a file's top level declares, and which it does not.
  holds: provider, slot topLevel
  reads: declarations
  emptied: the topLevel slot left empty
- source: The source slot reads the names each file declares at its top level, whether its file exports each, and the file each import leads to.
  holds: provider, slot source
  reads: source
  emptied: the source slot left empty
- interfaces: The interfaces slot says which declarations are types only, and the modules a file glob-imports.
  holds: provider, slot interfaces
  reads: interfaces
  emptied: the interfaces slot left empty
- declares: The declares slot says what a declaration line can run: a type, a value, or a body.
  holds: provider, slot declares
  reads: declares
  emptied: the declares slot left empty
- entrances: The entrance rules find the sample project's entrances, each by file and name, and nothing else.
  holds: provider, slot entrances
  reads: entrances
  emptied: the entrances slot left empty
- references: The adapter reports every reference to the protected thing, and none else.
  holds: language
  reads: references
  emptied: an adapter that reports no reference, which this bullet fails by name
- chokepoint: The check grades the protected thing through the chokepoint as check.json expects, its bypasses named, its refutation seen or refused, never missing.
  holds: language
  reads: grade, bypasses
  emptied: the run's own refutation, which removes the chokepoint and must see the grade change
- one answer each: No two of the plugin's slots give one answer: no two of their functions are one function or two spelled alike.
  holds: slots
  reads: the manifest
- verifier forms: Each via form the plugin declares proves a true name and refutes a false one, as check.json's proofs expect.
  holds: verifier
  reads: proofs
  emptied: a form that never fails, which the proof expected to fail catches
- lexicon: The plugin's lexicon layer reads, and none of its concepts takes a name Coherence's own lexicon holds.
  holds: lexicon
  reads: the lexicon layer
