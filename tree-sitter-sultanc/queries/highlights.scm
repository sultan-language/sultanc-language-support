; SultanC highlights. Capture names follow nvim-treesitter and patterns go
; from general to specific (a later match wins in Neovim and Zed); the Helix
; copy is renamed and reversed by tools/generate-tree-sitter-queries.py.
; Keyword lists between the GENERATED markers come from
; metadata/syntax-surface.json (the compiler's token registry).

(comment) @comment @spell

; ── Variables, fields, modules ─────────────────────────────────────────
(identifier) @variable
(field_expression field: (identifier) @property)
(field_initializer name: (identifier) @property)
(field_pattern name: (identifier) @property)
(constructor_pattern constructor: (identifier) @constructor)
(constructor_pattern type: (identifier) @type)
(binding_pattern (identifier) @variable)
(import_declaration module: (path (identifier) @module))
(import_declaration alias: (identifier) @module)
(from_import_declaration module: (path (identifier) @module))
(from_import_declaration name: (identifier) @function)
(module_declaration name: (identifier) @module)
(module_path (identifier) @module)
(module_spelling language: (identifier) @property)
(module_spelling spelling: (identifier) @module)
(alias_declaration name: (path (identifier) @type))
(const_declaration name: (identifier) @constant)
(attribute "@" @attribute)
(attribute path: (path (identifier) @attribute))
(range_keyword) @keyword.operator
(wildcard_pattern) @character.special

; ── Literals ────────────────────────────────────────────────────────────
(integer) @number
(float) @number.float
(boolean) @boolean
(undefined) @constant.builtin
(character) @character
(string) @string
(raw_string) @string
(escape_sequence) @string.escape

; ── Types ───────────────────────────────────────────────────────────────
(primitive_type) @type.builtin
(type_constructor) @type.builtin
(named_type name: (path (identifier) @module))
(named_type name: (path (identifier) @type .))
(type_parameters (identifier) @type)
(type_declaration name: (identifier) @type.definition)
(enum_variant name: (identifier) @constructor)
(field_declaration name: (identifier) @property)

; ── Functions ───────────────────────────────────────────────────────────
(function_declaration name: (identifier) @function)
(function_declaration alias: (identifier) @function)
(call_expression function: (identifier) @function.call)
(call_expression function: (field_expression field: (identifier) @function.call))
(generic_function function: (identifier) @function.call)
(generic_function function: (field_expression field: (identifier) @function.call))
(parameter name: (identifier) @variable.parameter)
(closure_parameter name: (identifier) @variable.parameter)

; `Type.Constructor(...)`: a field call whose receiver is capitalised or
; whose callee is a known enum constructor is left to semantic tokens; the
; syntax tree cannot tell a constructor from a method.

; ── Keywords (GENERATED) ───────────────────────────────────────────────
; BEGIN GENERATED KEYWORDS
["alias" "مرادف" "let" "ليكن" "asm" "تجميع"] @keyword
["else" "وإلا" "if" "إذا" "match" "طابق" "with" "مع"] @keyword.conditional
["fn" "دالة" "def" "عرف"] @keyword.function
["from" "من" "import" "استورد" "module" "وحدة"] @keyword.import
["comptime" "وقت_الترجمة" "extern" "خارجي" "unsafe" "غير_آمن" "mutable" "متغير" "public" "عام"] @keyword.modifier
["of" "بنوع" "as" "مثل" "slice" "شريحة" "box" "صندوق"] @keyword.operator
["while" "طالما" "for" "لكل" "break" "اخرج_من_حلقة" "continue" "تابع_حلقة"] @keyword.repeat
["return" "أرجع"] @keyword.return
["type" "نوع"] @keyword.type
; END GENERATED KEYWORDS

; ── Operators and punctuation ──────────────────────────────────────────
[
  "+" "-" "*" "/" "%" "==" "!=" "<" "<=" ">" ">=" "&&" "||" "!" "&" "|" "^"
  "~" "<<" ">>" ">>>" ":=" "=" "->" "?" "؟"
] @operator

["(" ")" "[" "]" "{" "}"] @punctuation.bracket
["," ";" ":" "."] @punctuation.delimiter
