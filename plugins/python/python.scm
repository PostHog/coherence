; Python's imports and top-level declarations, as the capture names Coherence reads (docs/plugins.md).
; The parser beside it, tree-sitter-python.wasm, is the one the tree-sitter-python 0.25.0 npm package ships, copied as is (language ABI 15).

; from m import a, b as c, (d, e) -- one match per imported name, whatever lines the statement spans
(import_from_statement
  module_name: (_) @import.from
  name: (dotted_name) @import.name) @import
(import_from_statement
  module_name: (_) @import.from
  name: (aliased_import name: (dotted_name) @import.name alias: (identifier) @import.alias)) @import
(import_from_statement
  module_name: (_) @import.from
  (wildcard_import) @import.glob) @import

; from __future__ import annotations -- a statement of its own kind, whose module is the keyword
(future_import_statement
  "__future__" @import.from
  name: (dotted_name) @import.name) @import

; import a.b, import a.b as c -- the whole module
(import_statement name: (dotted_name) @import.module) @import
(import_statement name: (aliased_import name: (dotted_name) @import.module alias: (identifier) @import.alias)) @import

; a def or class at the top level, decorated or not, declares a body
(module (function_definition name: (identifier) @name) @declaration.body)
(module (class_definition name: (identifier) @name) @declaration.body)
(module (decorated_definition definition: [(function_definition name: (identifier) @name) (class_definition name: (identifier) @name)]) @declaration.body)

; a constant assigned there declares a value; any other name assigned there is bound, not declared
; (a module's logger or app is no part of what it offers, and each declaration costs the interface reading a question)
((module (expression_statement (assignment left: (identifier) @name right: (_))) @declaration.value)
  (#match? @name "^[A-Z_][A-Z0-9_]*$"))
(module (expression_statement (assignment left: (identifier) @name right: (_))) @bound)
