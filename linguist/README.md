# GitHub Linguist assets

This directory keeps the SultanC-owned material needed to prepare an upstream GitHub Linguist contribution without embedding or forking GitHub Linguist itself.

- TextMate grammar: `../grammars/sultanc.tmLanguage.json`
- Language identity: `../metadata/language.json`
- Representative sources: `samples/*.sn`

The grammar is the same grammar consumed by editor integrations. Do not create a GitHub-only SultanC grammar.

An upstream Linguist contribution should reference the canonical `source.sultanc` grammar and use these samples. GitHub-specific upstream files are intentionally not copied into this repository.
