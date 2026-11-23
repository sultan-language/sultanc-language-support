; tree-sitter tags (code navigation, GitHub symbol search).
(function_declaration name: (identifier) @name) @definition.function
(type_declaration name: (identifier) @name) @definition.class
(enum_variant name: (identifier) @name) @definition.constant
(const_declaration name: (identifier) @name) @definition.constant
(alias_declaration name: (path) @name) @definition.type
(field_declaration name: (identifier) @name) @definition.field
(call_expression function: (identifier) @name) @reference.call
(call_expression function: (field_expression field: (identifier) @name)) @reference.call
(named_type name: (path (identifier) @name .)) @reference.type
(import_declaration module: (_) @name) @reference.module
