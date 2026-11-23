# tree-sitter-sultanc

Tree-sitter grammar for SultanC, for editor integration (highlighting,
folding, indentation, outline, text objects). It is not part of `std` or the
compiler, and it does no semantic analysis: names, types and diagnostics come
from sultanc-lsp, which runs the compiler's own frontend.

## Compatibility with the compiler

- Keyword spellings are read from `../metadata/syntax-surface.json`, which
  `tools/sync-from-compiler.sh` generates from the compiler's
  `token_registry.def` and `identifier_policy_registry.def`. Each keyword has
  its English spelling and its canonical Arabic spelling as node names.
  Spellings the compiler also accepts are aliased to the canonical Arabic
  node: the Alef forms آ أ إ ا (`إرجع` → `أرجع`) and deprecated words
  (`بينما` → `طالما`, `غ8` → `ط8`).
- Identifiers use the compiler's identifier policy; they are never
  normalized or translated, so Arabic names stay exactly as written.
- Rules follow `compiler/frontend/parser` (precedence from `precedence.sn`,
  `as` binding tighter than unary operators, `>>` closing two type-argument
  lists, contextual `vector`/`option`/`result`, `range a to b` patterns,
  words such as `خطأ` and `none` as names after `.`). The grammar is more
  permissive where strictness buys an editor nothing (statement expressions).
- `«...»` raw strings nest; `src/scanner.c` matches them by depth.

`tests/verify_tree_sitter.py /path/to/SultanC` parses every `.sn` file in a
checkout and requires each file with a tree-sitter error to be rejected by
`sultanc check` with a `SULTANC-PARSE-*`/`SULTANC-LEX-*` diagnostic. On the
2026-11-12 checkpoint (2bf240e): 2221 files, 2194 clean, 26 rejected by the
compiler too.

Known difference: Kashida inside a keyword (`بيـنما`) is a keyword for the
compiler (identifier identity ignores U+0640) but an identifier here, since
keyword tokens are strings. One test file uses it.

## Error tolerance and incremental parsing

Errors stay local (a missing `;` is a `MISSING` node; a broken initializer
is an `ERROR` inside its `let`). The verification script also checks that an
edited reparse, reusing the old tree, matches a fresh parse.

## Development

```sh
npm install            # tree-sitter-cli 0.25.10
npx tree-sitter generate
npx tree-sitter test   # corpus trees + highlight assertions
python3 ../tools/generate-tree-sitter-queries.py   # editor query copies
python3 ../tests/verify_tree_sitter.py /path/to/SultanC
```

Queries in `queries/` use nvim-treesitter capture names; the generator writes
the Neovim, Helix and Zed copies under `../editors/`.
