; Rust's imports and top-level declarations, as the capture names Coherence reads (docs/plugins.md).
; The parser beside it, tree-sitter-rust.wasm, is the one the tree-sitter-rust 0.24.0 npm package ships, copied as is (language ABI 14).

; Every use declaration is a statement, wherever it stands (in a fn, in an inline mod), so the census can say which sit inside a block.
(use_declaration) @import

; A use path names an item of a module or the module itself, and the text cannot say which, so each is read both ways:
; use a::b is b from a and the module a::b, and where it leads keeps the one that resolves (rust-source.ts RUST_RESOLVE).
(use_declaration argument: (scoped_identifier path: (_) @import.from name: (identifier) @import.name))
(use_declaration argument: [(scoped_identifier) (identifier)] @import.module)
(use_declaration argument: (use_as_clause path: (scoped_identifier path: (_) @import.from name: (identifier) @import.name) alias: (_) @import.alias))
(use_declaration argument: (use_as_clause path: (_) @import.module alias: (_) @import.alias))

; use a::* brings in every name a exports, and depends on a whole
(use_declaration argument: (use_wildcard (_) @import.from) @import.glob)
(use_declaration argument: (use_wildcard (_) @import.module))

; use a::{b, c::{self, d as e}, f::*}: a group's path prefixes every path inside it, to any depth (the core joins them with the separator, ::),
; so each leaf reads as though written alone: b from a, the module a::c (self), d from a::c renamed e, every name of a::f
(scoped_use_list path: (_) @import.prefix)
(scoped_use_list path: (_) @import.from list: (use_list (identifier) @import.name))
(scoped_use_list path: (_) @import.from list: (use_list (use_as_clause path: (identifier) @import.name alias: (_) @import.alias)))
(scoped_use_list path: (_) @import.from list: (use_list (use_wildcard . "*") @import.glob))
(scoped_use_list path: (_) @import.module list: (use_list (use_wildcard . "*")))
(use_list [(identifier) (scoped_identifier) (self)] @import.module)
(use_list (scoped_identifier path: (_) @import.from name: (identifier) @import.name))
(use_list (use_as_clause path: (scoped_identifier path: (_) @import.from name: (identifier) @import.name) alias: (_) @import.alias))
(use_list (use_as_clause path: (_) @import.module alias: (_) @import.alias))
(use_list (use_wildcard (_) @import.from) @import.glob)
(use_list (use_wildcard (_) @import.module))

; mod x; brings in the module file x beside this one; an inline mod's keyword prefixes every path inside it,
; so a use there (mod tests { use super::*; }) is read from the inline module, not from the file's
(mod_item name: (identifier) @import.module !body) @import
(mod_item "mod" @import.prefix body: (declaration_list))

; an item at the top level, under any visibility (pub in every form exports it): a fn, struct, enum, union or macro_rules! has a body
; (a type's impl blocks are its methods), a trait or a type alias declares a type, a const or static a value, and a module is counted able to execute
(source_file (function_item (visibility_modifier)? @exported name: (identifier) @name) @declaration.body)
(source_file (struct_item (visibility_modifier)? @exported name: (type_identifier) @name) @declaration.body)
(source_file (enum_item (visibility_modifier)? @exported name: (type_identifier) @name) @declaration.body)
(source_file (union_item (visibility_modifier)? @exported name: (type_identifier) @name) @declaration.body)
(source_file (macro_definition name: (identifier) @name) @declaration.body)
(source_file (trait_item (visibility_modifier)? @exported name: (type_identifier) @name) @declaration.type)
(source_file (type_item (visibility_modifier)? @exported name: (type_identifier) @name) @declaration.type)
(source_file (const_item (visibility_modifier)? @exported name: (identifier) @name) @declaration.value)
(source_file (static_item (visibility_modifier)? @exported name: (identifier) @name) @declaration.value)
(source_file (mod_item (visibility_modifier)? @exported name: (identifier) @name) @declaration.unknown)
