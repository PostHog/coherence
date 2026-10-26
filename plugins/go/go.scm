; Go's imports, the package names a file uses through them, and its package-level declarations, as the capture names Coherence reads (docs/plugins.md).
; The parser beside it, tree-sitter-go.wasm, is the one the tree-sitter-go 0.25.0 npm package ships, copied as is (language ABI 15).

; import st "shop/store", import . "shop/store", import _ "shop/store" -- the whole package, bound to the name the spec gives it:
; a dot or a blank binds none, so no use is read through it (a local named as the package is no qualifier of it).
; A spec alone is its statement; a spec of an import ( ... ) block is one statement inside the block.
(import_declaration (import_spec name: [(package_identifier) (dot) (blank_identifier)] @import.alias path: [(interpreted_string_literal (interpreted_string_literal_content) @import.module) (raw_string_literal (raw_string_literal_content) @import.module)])) @import
(import_spec_list (import_spec name: [(package_identifier) (dot) (blank_identifier)] @import.alias path: [(interpreted_string_literal (interpreted_string_literal_content) @import.module) (raw_string_literal (raw_string_literal_content) @import.module)]) @import)

; import "shop/store" -- the whole package, bound to its own name (the resolution's boundName)
(import_declaration (import_spec !name path: [(interpreted_string_literal (interpreted_string_literal_content) @import.module) (raw_string_literal (raw_string_literal_content) @import.module)])) @import
(import_spec_list (import_spec !name path: [(interpreted_string_literal (interpreted_string_literal_content) @import.module) (raw_string_literal (raw_string_literal_content) @import.module)]) @import)

; st.Seal(row), store.Row{}, func(r store.Row) -- an exported name used through a package's name, which says which of its names an import brings in;
; a name starting lower case is never one, and a predicate's pattern has no Unicode classes, so a name starting with any other letter is let through
; (Go refuses an unexported one from outside its package, so through an import it is never written)
((selector_expression operand: (identifier) @use.qualifier field: (field_identifier) @use.name) (#not-match? @use.name "^[a-z_]"))
((qualified_type package: (package_identifier) @use.qualifier name: (type_identifier) @use.name) (#not-match? @use.name "^[a-z_]"))

; a func at the package level declares a body; a method (func (r Row) Name()) is its type's, no name of the package's
((source_file (function_declaration name: (identifier) @name) @declaration.body) (#not-eq? @name "_"))

; an interface or an alias declares a type; a struct or any other defined type a body, since its methods are declared apart from it
((source_file (type_declaration (type_spec name: (type_identifier) @name type: (interface_type)) @declaration.type)) (#not-eq? @name "_"))
((source_file (type_declaration (type_alias name: (type_identifier) @name) @declaration.type)) (#not-eq? @name "_"))
((source_file (type_declaration (type_spec name: (type_identifier) @name type: [(type_identifier) (generic_type) (qualified_type) (pointer_type) (struct_type) (array_type) (slice_type) (map_type) (channel_type) (function_type) (negated_type) (parenthesized_type)]) @declaration.body)) (#not-eq? @name "_"))

; a const, alone or in a const ( ... ) block, each name of a list (const A, B = 1, 2) among them, declares a value;
; the names are the spec's own identifiers, since tree-sitter-go puts a list's commas in its name field and a field match reads only the first name
((source_file (const_declaration (const_spec (identifier) @name) @declaration.value)) (#not-eq? @name "_"))

; a var is read by its first value: a func literal is a body; a literal, or an operator's result (no operator yields a func), a value;
; anything else (a call's result, a name, a composite that may hold a func, no value at all) may hold a func, so it is counted as able to execute
((source_file (var_declaration [
  (var_spec name: (identifier) @name value: (expression_list . (func_literal)))
  (var_spec_list (var_spec name: (identifier) @name value: (expression_list . (func_literal))))
] @declaration.body)) (#not-eq? @name "_"))
((source_file (var_declaration [
  (var_spec name: (identifier) @name value: (expression_list . [(int_literal) (float_literal) (imaginary_literal) (rune_literal) (interpreted_string_literal) (raw_string_literal) (nil) (true) (false) (iota) (binary_expression) (unary_expression operator: ["-" "+" "!" "^"])]))
  (var_spec_list (var_spec name: (identifier) @name value: (expression_list . [(int_literal) (float_literal) (imaginary_literal) (rune_literal) (interpreted_string_literal) (raw_string_literal) (nil) (true) (false) (iota) (binary_expression) (unary_expression operator: ["-" "+" "!" "^"])])))
] @declaration.value)) (#not-eq? @name "_"))
((source_file (var_declaration [
  (var_spec name: (identifier) @name !value)
  (var_spec_list (var_spec name: (identifier) @name !value))
  (var_spec name: (identifier) @name value: (expression_list . [(identifier) (selector_expression) (index_expression) (slice_expression) (call_expression) (type_assertion_expression) (type_conversion_expression) (type_instantiation_expression) (composite_literal) (parenthesized_expression) (unary_expression operator: ["*" "&" "<-"])]))
  (var_spec_list (var_spec name: (identifier) @name value: (expression_list . [(identifier) (selector_expression) (index_expression) (slice_expression) (call_expression) (type_assertion_expression) (type_conversion_expression) (type_instantiation_expression) (composite_literal) (parenthesized_expression) (unary_expression operator: ["*" "&" "<-"])])))
] @declaration.unknown)) (#not-eq? @name "_"))
