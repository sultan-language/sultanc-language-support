# SultanC for Visual Studio Code

Language support for [SultanC](https://github.com/sultan-language), the Arabic-first systems programming language. It runs the native SultanC language server and offers an optional Arabic-first RTL editor.

## Features

All semantic features come from `sultanc-analyzer`, which runs the compiler's own frontend. The extension never parses SultanC itself.

| Feature | Notes |
|---|---|
| Diagnostics | Compiler diagnostics in **Arabic or English** (per file, or set `sultanc.diagnostics.language`) for the files you have open, live as you type. An error in an imported module shows at the top of the file as information, with its location |
| Check on save | As rust-analyzer's `cargo check`: after each save the server runs `sultanc check` on the project (`src/main.sn` or `main.sn`, or `sultanc.check.entries`) and shows its errors in **files you have not opened**, in each file's language. Turn off with `sultanc.checkOnSave`. For a SultanC checkout set `"sultanc.check.entries": ["compiler/main.sn"]` |
| Code lens | **▶︎ Run Test** above each test (runs it in the Test Explorer); optional **N references** above declarations (`sultanc.lens.references`) |
| Hover | Signature as written, doc comment (`//` block above the declaration), full record/enum body. Types are shown in the file's language (`int` / `عدد`), with a link to the definition |
| Completion | Names in scope with their original spelling; `Enum.` → constructors, `value.` → record fields; keywords in the file's language |
| Signature help | Declaration as written, with named parameters, while you type `(` and `,` |
| Navigation | Go to definition/declaration, **implementation** (a declaration written once per target: `if (target.platform == …)` blocks), find references, document highlight, call and type hierarchy |
| Symbols | Outline, breadcrumbs, workspace symbol search (fuzzy; Alef forms and Kashida match as the compiler resolves names) |
| Rename | Project-wide, with prepare-rename |
| Semantic highlighting | Functions, types, records, enums, constructors, parameters, variables |
| Folding / selection | Blocks, comment and import groups; smart expand-selection |
| Import links | `import "file.sn"` and `import std.io.println` open the module |
| Code actions | Compiler quick fixes (including **add missing import** and **add missing match arms**, from the compiler's suggestions); **Organize Imports** (sort, remove duplicates and unused imports); **Extract into variable**; **Inline variable**; **invert `إذا` and swap branches**; **add `وإلا`**. Each refactoring is re-checked by the compiler before it is offered |
| Inlay hints | Parameter names at call sites; types of match-pattern and loop bindings; closing brace hints after long declarations (`} // def main`, `sultanc.inlayHints.closingBraceHints.*`) |
| Format on type | With `"editor.formatOnType": true`: `;` formats the line, `}` the block, with the compiler's formatter |
| Debugging | **F5** or the 🐞 Debug lens builds the file with `sultanc -O0` (as `cargo build`'s debug profile; Run and Test keep the default level) and debugs it with gdb 14+ (`gdb -i=dap`) or `lldb-dap`; breakpoints, stepping and stack frames in `.sn` files |
| Indentation | Enter keeps the current line's indentation and goes one level in after `{`; `}` returns to its block's level |

Hover, completion and signature help keep answering while the file has syntax errors: the server falls back to the last clean analysis.

## Setup

Install the extension; VS Code picks the package for your platform. The packages for **Linux, macOS and Windows on x64 and arm64** bundle the language server and the standard library it was built with, so hover, completion, navigation and diagnostics work with nothing else installed.

Running, checking, testing and debugging programs need the SultanC compiler. The extension uses, in this order: `sultanc.compiler.path`, `<home>/build/sultanc`, `$SULTANC`, `~/.supax/bin/sultanc` (Supax's installer), then `sultanc` on `PATH`.

### Using another server

The extension finds the server in this order:

1. `sultanc.server.path`;
2. `build/sultanc-analyzer` in a workspace folder or one of its subfolders (a SultanC checkout you are working on);
3. `$SULTANC_HOME/build/sultanc-analyzer`;
4. the bundled server;
5. `sultanc-analyzer` on `PATH`.

To build one against a checkout: `sultanc-analyzer/tools/build.sh /path/to/sultanc` (writes `/path/to/sultanc/build/sultanc-analyzer`).

The server runs from the SultanC home, the directory that holds `library/`, where the compiler resolves `std`. The home is, in this order: `sultanc.home`; the bundle, for the bundled server; `$SULTANC_HOME`; the checkout that contains the server; a workspace folder.

The status bar item shows the server state, version, server path and SultanC home. Click it for the command menu.

## Settings

| Setting | Default | |
|---|---|---|
| `sultanc.server.path` | `""` | Path to `sultanc-analyzer`; empty uses the bundled server (see Setup) |
| `sultanc.home` | `""` | SultanC home (the server's working directory) |
| `sultanc.compiler.path` | `""` | The `sultanc` compiler for Run, Check, Build, tests and the check on save |
| `sultanc.lens.run` | `true` | "▶︎ Run · Debug" above the program entry and "▶︎ Run Test · Debug" above each test |
| `sultanc.lens.references` | `false` | Reference counts above declarations |
| `sultanc.diagnostics.language` | `auto` | `auto` follows each file's surface language; `ar`; `en` |
| `sultanc.trace.server` | `off` | JSON-RPC trace in the output channel |
| `sultanc.debug.debugger` | `auto` | `gdb`, `lldb`, or `auto` (lldb on macOS, gdb elsewhere) |
| `sultanc.debug.gdbPath` / `sultanc.debug.lldbDapPath` | `""` | Debugger executables; empty uses PATH |
| `sultanc.editor.*` | | RTL editor presentation (direction, font, palette, line numbers) |

## RTL editor

**Reopen in RTL Editor** (editor title bar) opens the Arabic-first editor:

- Arabic lines render RTL;
- English identifiers stay intact LTR runs;
- source bytes are never altered;
- a breadcrumb bar shows the symbols around the cursor (click to jump);
- **Alt+F12** peeks the definition in place (Escape closes, **Open** goes there);
- F12 definition, Shift+F12 references, F2 rename, Cmd/Ctrl+. code actions, Cmd/Ctrl+Shift+O symbols.

The editor shares the same `TextDocument` and language server, so hover, completion, navigation, rename and diagnostics are available in both editors.

## Development

```bash
npm install
npm test                # unit tests (node --test)
npm run sync-grammar    # copy grammar + metadata from the repository root
npm run package         # dist/sultanc-<version>.vsix
```

## Other editors

The language server works in any LSP editor (Neovim, Helix, Emacs, Sublime Text). See `docs/EDITORS.md` in the sultanc-analyzer repository.
