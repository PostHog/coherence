; TypeScript's and JavaScript's imports and top-level declarations, as the capture names Coherence reads (docs/plugins.md).
; The parser beside it, tree-sitter-tsx.wasm, is the TSX grammar the tree-sitter-typescript 0.23.2 npm package ships, copied as is (language ABI 14).
; One grammar reads every file the plugin's pattern takes (.ts, .tsx, .mts, .cts, .js, .jsx, .mjs, .cjs): the TSX grammar reads JSX, which the
; package's TypeScript grammar refuses (3,196 of PostHog's 3,510 .tsx files), and reads every .ts file of PostHog's and Coherence's that the
; TypeScript grammar reads, but for an old-style cast (<any>row), which it reads as an error inside the expression and nothing else.

; import x from "m" -- the module's default export, under a name of the file's own
(import_statement
  (import_clause (identifier) @import.default)
  source: (string (string_fragment) @import.from)) @import

; import { a, b as c, type d } from "m", import type { e } from "m" -- one match per imported name
(import_statement
  (import_clause (named_imports (import_specifier name: (_) @import.name !alias)))
  source: (string (string_fragment) @import.from)) @import
(import_statement
  (import_clause (named_imports (import_specifier name: (_) @import.name alias: (_) @import.alias)))
  source: (string (string_fragment) @import.from)) @import

; import * as ns from "m", import "m", import x = require("m") -- the whole module; a namespace's name is no rename of a name the module declares
(import_statement
  (import_clause (namespace_import))
  source: (string (string_fragment) @import.module)) @import
(import_statement . source: (string (string_fragment) @import.module)) @import
(import_statement (import_require_clause source: (string (string_fragment) @import.module))) @import

; export { a, b as c } from "m" -- a re-export: the file imports each name it re-exports
(export_statement
  (export_clause (export_specifier name: (_) @import.name !alias))
  source: (string (string_fragment) @import.from)) @import
(export_statement
  (export_clause (export_specifier name: (_) @import.name alias: (_) @import.alias))
  source: (string (string_fragment) @import.from)) @import

; export * from "m" -- every name the module exports, and the module whole, which the file depends on as a whole-module import does
(export_statement "*" @import.glob source: (string (string_fragment) @import.from)) @import
(export_statement "*" source: (string (string_fragment) @import.module)) @import

; export * as ns from "m" -- the module whole, under one name: no name of it is spread into the file's exports
(export_statement (namespace_export) source: (string (string_fragment) @import.module)) @import

; export default foo, export = foo, export { foo as default } -- a name exported as the module's default
(program (export_statement "default" value: (identifier) @default))
(program (export_statement "=" (identifier) @default))
((program (export_statement (export_clause (export_specifier name: (identifier) @default alias: (identifier) @_alias)) !source))
  (#eq? @_alias "default"))

; a function or class at the top level declares a body, exported or not, the default export or not, declared ambient or not
(program
  [(function_declaration name: (identifier) @name)
   (generator_function_declaration name: (identifier) @name)
   (function_signature name: (identifier) @name)
   (class_declaration name: (type_identifier) @name)
   (abstract_class_declaration name: (type_identifier) @name)] @declaration.body)
(program
  (export_statement
    "default"? @default
    declaration: [(function_declaration name: (identifier) @name)
                  (generator_function_declaration name: (identifier) @name)
                  (function_signature name: (identifier) @name)
                  (class_declaration name: (type_identifier) @name)
                  (abstract_class_declaration name: (type_identifier) @name)] @declaration.body) @exported)
(program
  (ambient_declaration
    [(function_signature name: (identifier) @name)
     (class_declaration name: (type_identifier) @name)
     (abstract_class_declaration name: (type_identifier) @name)] @declaration.body))
(program
  (export_statement
    declaration: (ambient_declaration
      [(function_signature name: (identifier) @name)
       (class_declaration name: (type_identifier) @name)
       (abstract_class_declaration name: (type_identifier) @name)] @declaration.body)) @exported)

; an interface or a type alias declares a type
(program [(interface_declaration name: (type_identifier) @name) (type_alias_declaration name: (type_identifier) @name)] @declaration.type)
(program (export_statement "default"? @default declaration: [(interface_declaration name: (type_identifier) @name) (type_alias_declaration name: (type_identifier) @name)] @declaration.type) @exported)
(program (ambient_declaration [(interface_declaration name: (type_identifier) @name) (type_alias_declaration name: (type_identifier) @name)] @declaration.type))
(program (export_statement declaration: (ambient_declaration [(interface_declaration name: (type_identifier) @name) (type_alias_declaration name: (type_identifier) @name)] @declaration.type)) @exported)

; an enum or a namespace declares a value
(program [(enum_declaration name: (identifier) @name) (internal_module name: (identifier) @name)] @declaration.value)
(program (export_statement declaration: [(enum_declaration name: (identifier) @name) (internal_module name: (identifier) @name)] @declaration.value) @exported)
(program (ambient_declaration [(enum_declaration name: (identifier) @name) (internal_module name: (identifier) @name)] @declaration.value))
(program (export_statement declaration: (ambient_declaration [(enum_declaration name: (identifier) @name) (internal_module name: (identifier) @name)] @declaration.value)) @exported)

; const, let or var: each name bound declares what its value is -- a function or class a body; a literal, an object or an instance a value,
; asserted to a type or not, twice at most (x as unknown as T, [..] as const satisfies T);
; no value at all a value; anything else (a call's result, another name) unknown, since it may hold a function. The unknown pattern matches
; every value, and a declaration whose value a pattern above it knows is read as that (syntax-trees.ts).
(program (_ (variable_declarator name: (identifier) @name value: [(arrow_function) (function_expression) (generator_function) (class)]) @declaration.body))
(program (export_statement declaration: (_ (variable_declarator name: (identifier) @name value: [(arrow_function) (function_expression) (generator_function) (class)]) @declaration.body)) @exported)
(program
  (_ (variable_declarator
    name: (identifier) @name
    value: [(object) (array) (string) (template_string) (number) (true) (false) (null) (undefined) (regex) (new_expression) (unary_expression) (jsx_element) (jsx_self_closing_element)
            [(as_expression . [(object) (array) (string) (template_string) (number) (true) (false) (null) (undefined) (new_expression)]) (satisfies_expression . [(object) (array) (string) (template_string) (number) (true) (false) (null) (undefined) (new_expression)])]
            [(as_expression . [(as_expression . [(object) (array) (string) (template_string) (number) (true) (false) (null) (undefined) (new_expression)]) (satisfies_expression . [(object) (array) (string) (template_string) (number) (true) (false) (null) (undefined) (new_expression)])]) (satisfies_expression . [(as_expression . [(object) (array) (string) (template_string) (number) (true) (false) (null) (undefined) (new_expression)]) (satisfies_expression . [(object) (array) (string) (template_string) (number) (true) (false) (null) (undefined) (new_expression)])])]]) @declaration.value))
(program
  (export_statement
    declaration: (_ (variable_declarator
      name: (identifier) @name
      value: [(object) (array) (string) (template_string) (number) (true) (false) (null) (undefined) (regex) (new_expression) (unary_expression) (jsx_element) (jsx_self_closing_element)
              [(as_expression . [(object) (array) (string) (template_string) (number) (true) (false) (null) (undefined) (new_expression)]) (satisfies_expression . [(object) (array) (string) (template_string) (number) (true) (false) (null) (undefined) (new_expression)])]
              [(as_expression . [(as_expression . [(object) (array) (string) (template_string) (number) (true) (false) (null) (undefined) (new_expression)]) (satisfies_expression . [(object) (array) (string) (template_string) (number) (true) (false) (null) (undefined) (new_expression)])]) (satisfies_expression . [(as_expression . [(object) (array) (string) (template_string) (number) (true) (false) (null) (undefined) (new_expression)]) (satisfies_expression . [(object) (array) (string) (template_string) (number) (true) (false) (null) (undefined) (new_expression)])])]]) @declaration.value)) @exported)
((program (_ (variable_declarator name: (identifier) @name value: (call_expression function: (identifier) @_callee)) @declaration.value))
  (#eq? @_callee "Symbol"))
((program (export_statement declaration: (_ (variable_declarator name: (identifier) @name value: (call_expression function: (identifier) @_callee)) @declaration.value)) @exported)
  (#eq? @_callee "Symbol"))
; arithmetic, a comparison or a concatenation (10 * 60 * 1000) is a value; a || b, a && b and a ?? b may be either operand, a function among them
((program (_ (variable_declarator name: (identifier) @name value: (binary_expression operator: _ @_operator)) @declaration.value))
  (#not-any-of? @_operator "||" "&&" "??"))
((program (export_statement declaration: (_ (variable_declarator name: (identifier) @name value: (binary_expression operator: _ @_operator)) @declaration.value)) @exported)
  (#not-any-of? @_operator "||" "&&" "??"))
(program (_ (variable_declarator name: (identifier) @name !value) @declaration.value))
(program (export_statement declaration: (_ (variable_declarator name: (identifier) @name !value) @declaration.value)) @exported)
(program (ambient_declaration (_ (variable_declarator name: (identifier) @name) @declaration.value)))
(program (export_statement declaration: (ambient_declaration (_ (variable_declarator name: (identifier) @name) @declaration.value))) @exported)
(program (_ (variable_declarator name: (identifier) @name value: (_)) @declaration.unknown))
(program (export_statement declaration: (_ (variable_declarator name: (identifier) @name value: (_)) @declaration.unknown)) @exported)

; a destructuring binds each name it takes, two patterns deep (export const { handlers: { GET, POST }, auth } = NextAuth(...)):
; bound at the top level, where a framework finds the name, not declared; braces that assign nothing bind nothing
(program
  (_ (variable_declarator
    name: [(object_pattern [(shorthand_property_identifier_pattern) @name (pair_pattern value: (identifier) @name) (object_assignment_pattern left: (shorthand_property_identifier_pattern) @name) (pair_pattern value: (assignment_pattern left: (identifier) @name)) (rest_pattern (identifier) @name)])
           (object_pattern (pair_pattern value: (object_pattern [(shorthand_property_identifier_pattern) @name (pair_pattern value: (identifier) @name) (object_assignment_pattern left: (shorthand_property_identifier_pattern) @name) (pair_pattern value: (assignment_pattern left: (identifier) @name)) (rest_pattern (identifier) @name)])))
           (object_pattern (pair_pattern value: (array_pattern [(identifier) @name (assignment_pattern left: (identifier) @name) (rest_pattern (identifier) @name)])))
           (array_pattern [(identifier) @name (assignment_pattern left: (identifier) @name) (rest_pattern (identifier) @name)])
           (array_pattern (object_pattern [(shorthand_property_identifier_pattern) @name (pair_pattern value: (identifier) @name) (object_assignment_pattern left: (shorthand_property_identifier_pattern) @name) (pair_pattern value: (assignment_pattern left: (identifier) @name)) (rest_pattern (identifier) @name)]))
           (array_pattern (array_pattern [(identifier) @name (assignment_pattern left: (identifier) @name) (rest_pattern (identifier) @name)]))]
    value: (_)) @bound))
(program
  (export_statement
    declaration: (_ (variable_declarator
      name: [(object_pattern [(shorthand_property_identifier_pattern) @name (pair_pattern value: (identifier) @name) (object_assignment_pattern left: (shorthand_property_identifier_pattern) @name) (pair_pattern value: (assignment_pattern left: (identifier) @name)) (rest_pattern (identifier) @name)])
             (object_pattern (pair_pattern value: (object_pattern [(shorthand_property_identifier_pattern) @name (pair_pattern value: (identifier) @name) (object_assignment_pattern left: (shorthand_property_identifier_pattern) @name) (pair_pattern value: (assignment_pattern left: (identifier) @name)) (rest_pattern (identifier) @name)])))
             (object_pattern (pair_pattern value: (array_pattern [(identifier) @name (assignment_pattern left: (identifier) @name) (rest_pattern (identifier) @name)])))
             (array_pattern [(identifier) @name (assignment_pattern left: (identifier) @name) (rest_pattern (identifier) @name)])
             (array_pattern (object_pattern [(shorthand_property_identifier_pattern) @name (pair_pattern value: (identifier) @name) (object_assignment_pattern left: (shorthand_property_identifier_pattern) @name) (pair_pattern value: (assignment_pattern left: (identifier) @name)) (rest_pattern (identifier) @name)]))
             (array_pattern (array_pattern [(identifier) @name (assignment_pattern left: (identifier) @name) (rest_pattern (identifier) @name)]))]
      value: (_)) @bound)))

; an export list, with or without a from, binds each name it exports, under the name it exports (export { handle as GET }):
; the re-exporting file is where a framework finds the name, and the source is not followed (d-7155e46f)
(program (export_statement (export_clause (export_specifier name: (_) @name !alias))) @bound)
(program (export_statement (export_clause (export_specifier alias: (_) @name))) @bound)
(program (export_statement (namespace_export (identifier) @name)) @bound)
