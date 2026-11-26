/**
 * Tree-sitter grammar for SultanC.
 *
 * Editor-integration component: it follows the compiler's recursive-descent
 * parser (compiler/frontend/parser) closely enough for highlighting, folding,
 * indentation and outline, and it is deliberately more permissive than the
 * compiler where a stricter rule would buy no editor value (statement
 * expressions, attribute placement). It performs no name resolution or type
 * checking: semantics stay in the compiler and sultanc-lsp.
 *
 * Keyword spellings are not written here. They are read from
 * ../metadata/syntax-surface.json, which tools/sync-from-compiler.sh
 * generates from the compiler's token registry, so Arabic and English
 * spellings stay identical to the compiler's lexer.
 */

/* eslint-disable no-undef */
const SURFACE = require('../metadata/syntax-surface.json');

const SPELLINGS = Object.fromEntries(
  SURFACE.keywords.map((k) => [k.token, [k.english, k.arabic]]),
);

const POLICY = SURFACE.identifierPolicy;
const DEPRECATED = {};
for (const d of SURFACE.deprecatedKeywords || []) {
  (DEPRECATED[d.token] = DEPRECATED[d.token] || []).push(d.spelling);
}
// canonical code point -> code points with the same identifier identity.
const SAME_IDENTITY = {};
for (const n of POLICY.normalizedCodepoints || []) {
  (SAME_IDENTITY[n.to] = SAME_IDENTITY[n.to] || [n.to]).push(n.from);
}

function hex(cp) {
  return `\\u{${cp.toString(16)}}`;
}

/**
 * Every spelling the compiler's lexer accepts for a word under identifier
 * identity: the Alef forms آ أ إ ا are one letter
 * (identifier_policy_registry.def). Keywords stay string tokens so
 * tree-sitter's keyword extraction keeps `دالة_مسير` one identifier.
 * Kashida inside a keyword (`عـرف`) is the one identity rule a string
 * token cannot express; such code parses as an identifier.
 */
function identitySpellings(word) {
  let forms = [''];
  for (const ch of word) {
    const cp = ch.codePointAt(0);
    let group = null;
    for (const members of Object.values(SAME_IDENTITY)) {
      if (members.includes(cp)) group = members;
    }
    const options = group ? group.map((c) => String.fromCodePoint(c)) : [ch];
    forms = forms.flatMap((f) => options.map((o) => f + o));
  }
  return forms;
}

/**
 * Both spellings of a compiler keyword token. The English spelling and the
 * canonical Arabic spelling are the node names; the variants the compiler
 * accepts (Alef forms, deprecated words such as `بينما`) are aliased to the
 * canonical Arabic node, so queries name each keyword once per language.
 */
function kw(name) {
  const pair = SPELLINGS[name];
  if (!pair) throw new Error(`unknown SultanC token ${name}`);
  const [english, arabic] = pair;
  const variants = [arabic].concat(DEPRECATED[name] || [])
    .flatMap(identitySpellings)
    .filter((w, i, all) => w !== arabic && all.indexOf(w) === i);
  return choice(english, arabic, ...variants.map((w) => alias(w, arabic)));
}

/** A contextual word: lexed as an identifier by the compiler, matched by spelling. */
function ctx(...words) {
  return choice(...words);
}

const BOOLEANS = SURFACE.booleanLiterals.flatMap((b) => [b.english, b.arabic]);

const PRIMITIVE_TOKENS = [
  'ANY', 'BOOL', 'STRING', 'CHAR', 'INT', 'UINT', 'VOID',
  'I8', 'I16', 'I32', 'I64', 'U8', 'U16', 'U32', 'U64', 'F32', 'F64',
];

// Identifier character classes come from the compiler's identifier policy.
function charClass(ranges, scalars, extra = []) {
  const parts = ranges.map((r) => `${hex(r.start)}-${hex(r.end)}`)
    .concat(scalars.map(hex))
    .concat(extra.map(hex));
  return `[${parts.join('')}]`;
}
const ID_START = charClass(POLICY.startRanges, POLICY.startScalars);
const ID_REST = charClass(
  POLICY.startRanges.concat(POLICY.restRanges),
  POLICY.startScalars.concat(POLICY.restScalars),
  POLICY.ignoredCodepoints,
);

// Binary operator precedence: compiler/frontend/parser/precedence.sn.
const PREC = {
  closure: -1,
  or: 1,
  and: 2,
  bit_or: 3,
  bit_xor: 4,
  bit_and: 5,
  equality: 6,
  compare: 7,
  shift: 8,
  additive: 9,
  multiplicative: 10,
  unary: 11,
  cast: 12,
  try: 13,
  postfix: 14,
};

const BINARY = [
  ['||', PREC.or],
  ['&&', PREC.and],
  ['|', PREC.bit_or],
  ['^', PREC.bit_xor],
  ['&', PREC.bit_and],
  ['==', PREC.equality], ['!=', PREC.equality],
  ['<', PREC.compare], ['<=', PREC.compare], ['>', PREC.compare], ['>=', PREC.compare],
  ['<<', PREC.shift], ['>>', PREC.shift], ['>>>', PREC.shift],
  ['+', PREC.additive], ['-', PREC.additive],
  ['*', PREC.multiplicative], ['/', PREC.multiplicative], ['%', PREC.multiplicative],
];

const prefix = ($) => [repeat($.attribute), optional($.visibility)];
// The comma: `,` or the Arabic comma `،` (U+060C), the same token
// (COMMA_OPERATOR) in the compiler's registry.
const comma = () => choice(',', '،');
const commaSep = (rule) => optional(commaSep1(rule));
const commaSep1 = (rule) => seq(rule, repeat(seq(comma(), rule)), optional(comma()));

module.exports = grammar({
  name: 'sultanc',

  word: ($) => $.identifier,

  externals: ($) => [$.raw_string, $._raw_string_error],

  extras: ($) => [
    /[ \t\r\n]/,
    // Unicode separators the compiler's lexer skips (lexer.sn): NBSP,
    // U+2000-200A, LRM/RLM, ALM, line/paragraph separators, NNBSP, MMSP,
    // ideographic space and the byte-order mark.
    new RegExp('[\\u00a0\\u2000-\\u200a\\u200e\\u200f\\u061c\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]'),
    $.comment,
  ],

  supertypes: ($) => [$._item, $._statement, $._expression, $._type, $._pattern],

  inline: ($) => [$._place_root],

  conflicts: ($) => [
    // `f<T>(x)` against `a < b`: the compiler tries type arguments first
    // and backtracks (parser/expressions.sn جرب_حجج_نوع_صريحة).
    [$._expression, $.generic_function],
  ],

  rules: {
    source_file: ($) => repeat($._item),

    _item: ($) => choice(
      $.import_declaration,
      $.from_import_declaration,
      $.module_declaration,
      $.alias_declaration,
      $.function_declaration,
      $.type_declaration,
      $.const_declaration,
      $.assembly_item,
      $.target_conditional,
    ),

    // ── Attributes and visibility ─────────────────────────────────────────
    attribute: ($) => seq(
      '@',
      optional(field('on_definition', '@')),
      field('path', $.path),
      optional(field('arguments', $.arguments)),
    ),

    visibility: ($) => kw('PUBLIC'),

    // ── Imports ───────────────────────────────────────────────────────────
    import_declaration: ($) => seq(
      repeat($.attribute),
      kw('IMPORT'),
      field('module', choice($.string, $.raw_string, $.path)),
      optional(seq(kw('AS'), field('alias', $.identifier))),
      ';',
    ),

    from_import_declaration: ($) => seq(
      kw('FROM'),
      field('module', $.path),
      kw('IMPORT'),
      commaSep1(field('name', $.identifier)),
      ';',
    ),

    // `module NAME { ar: س, en: x };` gives a child module its spellings;
    // `module NAME = LIBRARY.path;` (spellings optional) re-exports another
    // library's module (parser/declarations.sn تخط_تصريح_وحدة). NAME is a name
    // on disk and may be a keyword (`module float { ar: عائم };`).
    module_declaration: ($) => seq(
      kw('MODULE'),
      field('name', $._module_name),
      optional(seq('=', field('target', $.module_path))),
      optional(field('spellings', $.module_spellings)),
      ';',
    ),

    module_path: ($) => seq($._module_name, repeat(seq('.', $._module_name))),

    module_spellings: ($) => seq('{', commaSep($.module_spelling), '}'),

    module_spelling: ($) => seq(
      field('language', $.identifier),
      ':',
      field('spelling', $._module_name),
    ),

    _module_name: ($) => choice(
      $.identifier,
      alias(choice(...SURFACE.keywords.flatMap((k) => [k.english, k.arabic])), $.identifier),
    ),

    alias_declaration: ($) => seq(
      ...prefix($),
      kw('ALIAS'),
      // `alias colour.dark = colour.red;` names a constructor alias.
      field('name', $.path),
      '=',
      field('target', $.path),
      ';',
    ),

    // ── Functions ─────────────────────────────────────────────────────────
    function_declaration: ($) => seq(
      ...prefix($),
      optional(seq(
        field('extern', kw('EXTERN')),
        optional(field('library', choice($.string, $.raw_string))),
      )),
      kw('FUNCTION_DEF'),
      field('name', $.identifier),
      optional(field('type_parameters', $.type_parameters)),
      optional(seq(kw('ALIAS'), commaSep1(field('alias', $.identifier)))),
      field('parameters', $.parameters),
      ':',
      field('result', $._type),
      choice(
        field('body', $.block),
        seq(optional(seq('=', field('link_name', choice($.string, $.raw_string)))), ';'),
      ),
    ),

    type_parameters: ($) => seq('<', commaSep1($.identifier), '>'),

    parameters: ($) => seq('(', commaSep($.parameter), ')'),

    parameter: ($) => seq(
      optional(field('comptime', kw('COMPTIME'))),
      field('name', $.identifier),
      ':',
      field('type', $._type),
    ),

    // ── Types ─────────────────────────────────────────────────────────────
    type_declaration: ($) => seq(
      ...prefix($),
      kw('TYPE'),
      field('name', $.identifier),
      optional(field('type_parameters', $.type_parameters)),
      '=',
      field('value', choice($.record_type, $.enum_type, $._type)),
      ';',
    ),

    record_type: ($) => seq('{', repeat(seq($.field_declaration, optional(comma()))), '}'),

    field_declaration: ($) => seq(field('name', $.identifier), ':', field('type', $._type)),

    enum_type: ($) => repeat1(seq('|', $.enum_variant)),

    enum_variant: ($) => seq(
      field('name', $._contextual_name),
      optional(seq(
        kw('OF'),
        field('payload', choice(alias(prec(1, seq('(', commaSep1($._type), ')')), $.payload_list), $._type)),
      )),
    ),

    const_declaration: ($) => seq(
      ...prefix($),
      optional(field('extern', kw('EXTERN'))),
      kw('LET'),
      field('name', $.identifier),
      ':',
      field('type', $._type),
      '=',
      field('value', $._expression),
      ';',
    ),

    assembly_item: ($) => seq(optional($.visibility), kw('ASSEMBLY'), choice($.string, $.raw_string), ';'),

    // `if (target_condition) { items } else { items };` at module level.
    target_conditional: ($) => seq($._target_if, optional(';')),

    _target_if: ($) => seq(
      kw('IF'),
      '(',
      field('condition', $._expression),
      ')',
      field('consequence', $.item_block),
      optional(seq(kw('ELSE'), field('alternative', choice($.item_block, alias($._target_if, $.target_conditional))))),
    ),

    item_block: ($) => seq('{', repeat($._item), '}'),

    _type: ($) => choice(
      $.primitive_type,
      $.named_type,
      $.function_type,
      $.tuple_type,
      $.mutable_type,
      $.box_type,
      $.reference_type,
      $.pointer_type,
      $.slice_type,
      $.vector_type,
      $.option_type,
      $.result_type,
    ),

    primitive_type: ($) => choice(...PRIMITIVE_TOKENS.map(kw)),

    named_type: ($) => prec.right(seq(
      field('name', $.path),
      optional(field('arguments', $.type_arguments)),
    )),

    // `>>` never closes two lists: inside type arguments only `>` is valid,
    // so the context-aware lexer splits `<a<b>>` as the compiler does.
    type_arguments: ($) => seq('<', commaSep($._type), '>'),

    function_type: ($) => prec.right(seq(
      kw('FUNCTION_TYPE'),
      '(',
      commaSep($._type),
      ')',
      ':',
      field('result', $._type),
    )),

    tuple_type: ($) => seq('(', commaSep($._type), ')'),

    mutable_type: ($) => prec.right(seq(kw('MUTABLE'), $._type)),
    box_type: ($) => prec.right(seq(kw('BOX_OPERATOR'), $._type)),
    reference_type: ($) => prec.right(seq('&', $._type)),
    pointer_type: ($) => prec.right(seq('*', $._type)),
    slice_type: ($) => prec.right(choice(seq(kw('SLICE_OPERATOR'), $._type), seq('[', ']', $._type))),

    // Contextual type constructors (compiler/frontend/type_name_surface_generated.sn).
    vector_type: ($) => prec.right(seq(alias(ctx('vector', 'متجه'), $.type_constructor), $._type)),
    option_type: ($) => prec.right(seq(alias(ctx('option', 'اختياري', 'اختيار'), $.type_constructor), $._type)),
    result_type: ($) => prec.right(seq(alias(ctx('result', 'نتيجة'), $.type_constructor), $._type, comma(), $._type)),

    // ── Statements ────────────────────────────────────────────────────────
    // The trailing expression without `;` only occurs in `comptime { ... }`
    // value blocks; allowing it in every block keeps typing errors local.
    block: ($) => seq('{', repeat($._statement), optional(field('value', $._expression)), '}'),

    _statement: ($) => choice(
      $.let_statement,
      $.return_statement,
      $.while_statement,
      $.for_statement,
      $.break_statement,
      $.continue_statement,
      $.if_statement,
      $.match_statement,
      $.assembly_statement,
      $.unsafe_statement,
      $.comptime_statement,
      $.assignment_statement,
      $.expression_statement,
    ),

    let_statement: ($) => seq(
      kw('LET'),
      field('name', $.identifier),
      ':',
      field('type', $._type),
      optional(seq('=', field('value', $._expression))),
      ';',
    ),

    return_statement: ($) => seq(kw('RETURN'), optional(field('value', $._expression)), ';'),

    while_statement: ($) => seq(
      kw('WHILE'),
      '(',
      field('condition', $._expression),
      ')',
      field('body', $.block),
      optional(';'),
    ),

    for_statement: ($) => seq(
      kw('FOR'),
      '(',
      field('initializer', $.let_statement),
      field('condition', $._expression),
      ';',
      field('update', $.assignment),
      ')',
      field('body', $.block),
      optional(';'),
    ),

    break_statement: ($) => seq(kw('BREAK'), ';'),
    continue_statement: ($) => seq(kw('CONTINUE'), ';'),

    if_statement: ($) => seq($._if, optional(';')),

    _if: ($) => seq(
      kw('IF'),
      '(',
      field('condition', $._expression),
      ')',
      field('consequence', $.block),
      optional(field('alternative', $.else_clause)),
    ),

    else_clause: ($) => seq(kw('ELSE'), choice($.block, alias($._if, $.if_statement))),

    match_statement: ($) => prec.right(seq(
      kw('MATCH'),
      field('value', $._expression),
      kw('WITH'),
      repeat1($.match_arm),
      optional(';'),
    )),

    match_arm: ($) => seq('|', field('pattern', $._pattern), '->', field('body', $.block)),

    assembly_statement: ($) => seq(kw('ASSEMBLY'), choice($.string, $.raw_string), ';'),

    unsafe_statement: ($) => seq(kw('UNSAFE'), $.block, optional(';')),

    comptime_statement: ($) => prec(1, seq(kw('COMPTIME'), $.block, optional(';'))),

    assignment: ($) => seq(field('left', $._expression), ':=', field('right', $._expression)),

    assignment_statement: ($) => seq($.assignment, ';'),

    expression_statement: ($) => seq($._expression, ';'),

    // ── Patterns ──────────────────────────────────────────────────────────
    _pattern: ($) => choice(
      $.wildcard_pattern,
      $.literal_pattern,
      $.or_pattern,
      $.range_pattern,
      $.constructor_pattern,
      $.record_pattern,
      $.tuple_pattern,
      $.binding_pattern,
    ),

    wildcard_pattern: (_) => '_',

    literal_pattern: ($) => choice(
      $.integer,
      seq('-', $.integer),
      $.float,
      $.character,
      $.boolean,
      $.string,
      $.raw_string,
    ),

    or_pattern: ($) => prec.left(seq($.literal_pattern, repeat1(seq('|', $.literal_pattern)))),

    range_pattern: ($) => seq(
      alias(ctx('range', 'مدى'), $.range_keyword),
      field('low', $._range_bound),
      alias(ctx('to', 'إلى'), $.range_keyword),
      field('high', $._range_bound),
    ),

    _range_bound: ($) => choice($.integer, seq('-', $.integer), $.character),

    constructor_pattern: ($) => prec(1, seq(
      field('type', $.identifier),
      '.',
      field('constructor', $._contextual_name),
      optional(seq('(', commaSep($._pattern), ')')),
    )),

    record_pattern: ($) => seq('{', commaSep($.field_pattern), '}'),

    field_pattern: ($) => seq(field('name', $.identifier), ':', field('pattern', $._pattern)),

    tuple_pattern: ($) => seq('(', commaSep($._pattern), ')'),

    binding_pattern: ($) => $.identifier,

    // ── Expressions ───────────────────────────────────────────────────────
    _expression: ($) => choice(
      $.identifier,
      $.integer,
      $.float,
      $.character,
      $.boolean,
      $.undefined,
      $.string,
      $.raw_string,
      $.parenthesized_expression,
      $.tuple_expression,
      $.box_expression,
      $.vector_expression,
      $.record_expression,
      $.field_expression,
      $.index_expression,
      $.call_expression,
      $.try_expression,
      $.cast_expression,
      $.unary_expression,
      $.binary_expression,
      $.closure_expression,
      $.comptime_expression,
    ),

    parenthesized_expression: ($) => seq('(', $._expression, ')'),

    // Initializer forms (parser/initialization.sn): `()`, `(a, b)`, `box v`.
    tuple_expression: ($) => choice(seq('(', ')'), seq('(', $._expression, comma(), commaSep($._expression), ')')),

    box_expression: ($) => prec(PREC.unary, seq(kw('BOX_OPERATOR'), $._expression)),

    vector_expression: ($) => seq('[', commaSep($._expression), ']'),

    record_expression: ($) => seq('{', commaSep1($.field_initializer), '}'),

    field_initializer: ($) => seq(field('name', $.identifier), ':', field('value', $._expression)),

    field_expression: ($) => prec(PREC.postfix, seq(
      field('value', $._expression),
      '.',
      field('field', $._contextual_name),
    )),

    index_expression: ($) => prec(PREC.postfix, seq(
      field('value', $._expression),
      '[',
      field('index', $._expression),
      ']',
    )),

    call_expression: ($) => prec(PREC.postfix, seq(
      field('function', choice($._expression, $.generic_function)),
      field('arguments', $.arguments),
    )),

    generic_function: ($) => prec.dynamic(1, seq(
      field('function', choice($.identifier, $.field_expression)),
      field('type_arguments', $.type_arguments),
    )),

    arguments: ($) => seq('(', commaSep($._expression), ')'),

    try_expression: ($) => prec(PREC.try, seq($._expression, choice('?', '؟'))),

    cast_expression: ($) => prec.left(PREC.cast, seq(
      field('value', $._expression),
      kw('AS'),
      field('type', $._type),
    )),

    unary_expression: ($) => prec(PREC.unary, choice(
      seq(field('operator', choice('!', '~', '-', '*')), field('operand', $._expression)),
      seq(field('operator', '&'), optional(kw('MUTABLE')), field('operand', $._expression)),
    )),

    binary_expression: ($) => choice(...BINARY.map(([op, p]) => prec.left(p, seq(
      field('left', $._expression),
      field('operator', op),
      field('right', $._expression),
    )))),

    closure_expression: ($) => prec.right(PREC.closure, seq(
      kw('FUNCTION_TYPE'),
      field('parameters', $.closure_parameters),
      ':',
      field('result', $._type),
      '->',
      field('body', $._expression),
    )),

    closure_parameters: ($) => seq('(', commaSep($.closure_parameter), ')'),

    closure_parameter: ($) => seq(field('name', $.identifier), ':', field('type', $._type)),

    comptime_expression: ($) => prec.right(PREC.unary, seq(
      kw('COMPTIME'),
      choice($.block, $._expression),
    )),

    // ── Names ─────────────────────────────────────────────────────────────
    path: ($) => prec.right(seq($.identifier, repeat(seq('.', $._contextual_name)))),

    _place_root: ($) => $.identifier,

    // After `.` and in constructor position the compiler takes a contextual
    // name, so words that are keywords elsewhere (`خطأ`, `none`, `true`)
    // are names there.
    _contextual_name: ($) => choice(
      $.identifier,
      alias(choice(...BOOLEANS), $.identifier),
      alias(kw('LIT_UNDEF'), $.identifier),
    ),

    identifier: (_) => token(new RegExp(`${ID_START}${ID_REST}*`, 'u')),

    // ── Literals (compiler/frontend/lexer) ────────────────────────────────
    integer: (_) => token(choice(
      /0[bB][01_]+/,
      /0[xX][0-9a-fA-F_]+/,
      /[0-9][0-9_]*/,
    )),

    float: (_) => token(choice(
      /[0-9][0-9_]*\.[0-9][0-9_]*([eE][+-]?[0-9]+)?/,
      /[0-9][0-9_]*[eE][+-]?[0-9]+/,
    )),

    boolean: (_) => choice(...BOOLEANS),

    undefined: (_) => kw('LIT_UNDEF'),

    character: ($) => seq("'", choice($.escape_sequence, token.immediate(/[^'\\\n]/)), token.immediate("'")),

    string: ($) => seq(
      '"',
      repeat(choice(token.immediate(prec(1, /[^"\\\n]+/)), $.escape_sequence)),
      token.immediate('"'),
    ),

    escape_sequence: (_) => token.immediate(seq('\\', choice(
      /[nrt0\\'"]/,
      /x[0-9a-fA-F]{2}/,
      /u[0-9a-fA-F]{4}/,
      /U[0-9a-fA-F]{8}/,
      /u\{[0-9a-fA-F]+\}/,
    ))),

    comment: (_) => token(seq('//', /[^\r\n]*/)),
  },
});
