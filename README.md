# SultanC Language Support

Editor-neutral SultanC language presentation assets.

This repository owns the reusable syntax/highlighting metadata consumed by editor integrations and prepared for GitHub Linguist. It does **not** own compiler semantics, the LSP, or any editor UI.

## Contents

```text
grammars/
  sultanc.tmLanguage.json      TextMate grammar for SultanC
metadata/
  language.json                editor-neutral language identity
  syntax-surface.json          generated lexical presentation surface
linguist/
  samples/                     representative SultanC sources for Linguist
  README.md                    upstream Linguist integration notes
tools/
  generate-syntax.py           deterministic generator
  sync-from-compiler.sh        refresh generated syntax assets from sultanc
 tests/
  verify_language_support.py   consistency checks
```

## Source of truth

SultanC token spellings and identifier policy remain compiler-owned. `metadata/syntax-surface.json` and `grammars/sultanc.tmLanguage.json` are generated outputs and must not be patched by hand.

Refresh them from a `sultanc` checkout:

```bash
./tools/sync-from-compiler.sh /path/to/sultanc
python3 tests/verify_language_support.py
```

## Consumers

- `sultanc-vscode` stages the grammar and syntax surface when testing/packaging.
- GitHub Linguist submission material lives under `linguist/`.
- Future editor integrations should consume these assets rather than maintain their own SultanC keyword/operator tables.

## String forms

SultanC has two string surfaces. `"..."` uses escape sequences such as `\\n`, `\\t`, `\\"`, and `\\\\`. `«...»` is a raw balanced string: backslashes have no escape meaning, embedded quotes are literal, and nested `«...»` pairs are supported. The shared TextMate grammar models the same distinction for GitHub/editor highlighting.
