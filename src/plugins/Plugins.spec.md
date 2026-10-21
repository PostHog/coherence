# Plugins

One interface and registry for what a project adds to Coherence: a language adapter (new, or wrapping a built-in), syntax tables for the readings, a verifier that proves bullets through a via form, and a lexicon layer. A plugin is a folder with a plugin.json manifest, read as data, and a module imported only where its code runs. docs/plugins.md is the author's guide.

## invariants
- a plugin's adapter answers for the language it extends: A plugin that extends a language wraps the adapter that answers for it, the core's own or a providing plugin's, so a chokepoint in that language is graded through the plugin's adapter, and every run entry it grades names the plugin and its version.
  over: a TypeScript project whose config runs the sample fixture plugin by path, a chokepoint checked through instrumentFor's adapter, and the run that records it
  via: a plugin that extends a language answers its chokepoint checks: the adapter is the plugin's, wrapping the core's, and the run entry names the plugin
  because: an enhancement of a language reuses what it does not change, and a verdict a plugin's code reached must say so, or a reader credits the core with an answer an outside module gave (d-5ec9a20a)
  refuted: dropped the loop in instrumentFor that wraps a language's adapter in each plugin extending it -> "a plugin that extends a language answers its chokepoint checks: the adapter is the plugin's, wrapping the core's, and the run entry names the plugin" went red in plugins.test.ts on its own assertion; restored from a copy, byte for byte, green batched and alone (2026-10-21)
  kinds: none
- a via form is proved by the plugin that declares it: A via written [form] name is proved by the plugin whose manifest declares the form, graded as a test's verdict is, with the plugin and the form's evidence label on the run entry; a bracketed form no loaded plugin declares is a spec problem that names the forms loaded, never a test run under that title.
  over: a project whose bullets name the sample plugin's two forms, one answered by its module and one by its command, a property that holds and one that breaks, and a form no plugin declares
  via: a via form is proved by the plugin that declares it, graded like a test with its evidence label; a form no plugin declares is a spec problem naming the forms loaded
  because: a model checker or a property tester proves a bullet as a test does, and the label says what kind of proof a pass is; a form nothing proves would otherwise run as a test title and fail for a reason nobody can read (d-4f34fc4a)
  refuted: made the run never send a [form] via to its plugin, so it ran as a test title -> "a via form is proved by the plugin that declares it, graded like a test with its evidence label; a form no plugin declares is a spec problem naming the forms loaded" went red in plugins.test.ts on its own assertion; restored from a copy, byte for byte, green batched and alone (2026-10-21)
  kinds: none
- two providers of one language are refused: Two plugins that provide one language are refused with both named, as is a plugin written for a pluginApi this core does not run or one whose manifest names itself other than its config key; the spec check reports each on the config.
  over: two manifests providing typescript, a manifest written for pluginApi 0, and a manifest keyed under another name
  via: two plugins that provide one language are refused with both named, and so is a plugin written for another pluginApi
  because: two adapters cannot both answer for a language, and a plugin written against another interface would be run against one it does not know; refusing names what to change (d-5ec9a20a)
  refuted: let two plugins provide one language without a problem -> "two plugins that provide one language are refused with both named, and so is a plugin written for another pluginApi" went red in plugins.test.ts on its own assertion; restored from a copy, byte for byte, green batched and alone (2026-10-21)
  kinds: none
- the lexicon is a stack of layers: The lexicon is read as Coherence's layer, then each plugin's in the config's order, then the project's: a plugin's terms count as declared and carry their layer, its defect classes are legal, its rejected names govern only its own terms, and a plugin concept whose name another layer holds stays out and is reported until the project lexicon declares the name.
  over: the sample plugin's layer with a new concept, a concept that clashes with Coherence's journal, a rejected name, a defect class, and a project lexicon that settles the clash
  via: a plugin's lexicon layer joins the stack: its terms count as declared and show their layer, its rejected names stay its own, its defect classes are read, and a clash is reported until the project settles it
  because: a plugin without its own vocabulary would push its terms into Coherence's lexicon, as #126 did with eight nouns; a clash merged silently would give one name two senses (d-8f5862d5)
  refuted: made composeStack find no clash, so a plugin concept another layer names was neither merged nor reported -> "a plugin's lexicon layer joins the stack: its terms count as declared and show their layer, its rejected names stay its own, its defect classes are read, and a clash is reported until the project settles it" went red in plugins.test.ts on its own assertion; restored from a copy, byte for byte, green batched and alone (2026-10-21)
  kinds: none
- a project without plugins reads none: A project whose config has no plugins key reads no plugin manifest, lexicon layer or bundled plugin folder: its config, spec model, lexicons and defect classes are read exactly as before plugins.
  over: the config, the spec model, the lexicon stack and the defect classes read for a project with no plugins key, every file call counted
  via: a project without a plugins key reads nothing of any plugin: no manifest, no lexicon layer, no bundled folder
  because: a hook has a 3 s latency budget, and a project that runs no plugin must pay nothing for the interface it does not use
  refuted: made readPlugins list the bundled plugins folder when the config names no plugins, as a registry that discovered bundled plugins would -> "a project without a plugins key reads nothing of any plugin: no manifest, no lexicon layer, no bundled folder" went red in plugins.test.ts on its own assertion; restored from a copy, byte for byte, green batched and alone (2026-10-21)
  kinds: none
- a plugin's vocabulary rides only where it is used: A session start carries a plugin's lexicon layer only while the plugin's surface is in use, a language it provides or extends among the project's or a via form it proves on some bullet; coherence lexicon prints every layer.
  over: a Python project with no bullet the plugin proves, the same project with one, and a TypeScript project the plugin extends
  via: a session start carries a plugin's vocabulary only while its surface is in use: a language it extends among the project's, or a via form it proves on a bullet
  because: the start injection rides a context budget shared with the session's work, and a plugin's terms are noise in a session that never meets its surface (d-8f5862d5)
  refuted: made pluginsInUse carry every plugin layer at session start, in use or not -> "a session start carries a plugin's vocabulary only while its surface is in use: a language it extends among the project's, or a via form it proves on a bullet" went red in plugins.test.ts on its own assertion; restored from a copy, byte for byte, green batched and alone (2026-10-21)
  kinds: none
