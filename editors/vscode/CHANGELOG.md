# Changelog

## 0.15.0

### Added
- **Bundled language server**: platform-specific packages for Linux, macOS and Windows on x64 and arm64 include `sultanc-lsp` and its standard library (`sultanc/` in the package). The extension uses it when no other server is configured or found; `sultanc.server.path` still selects any server.
- "▶︎ Run · Debug" above the program entry now comes from the server (the compiler's entry symbol), in the file's language.
- The compiler is also found in `$SULTANC`, `~/.supax/bin/sultanc` and on `PATH`.

### Fixed
- **Accepting a completion no longer moves the view or the caret.** The RTL editor applies the item itself, as it does typing: the caret lands right after the inserted text, and an import added at the top shifts the view by its line, so the line being edited stays where it is on screen.
- The view scrolls only when the caret leaves it (it used to jump so the line sat a third down after every accept); jumps to a definition still center the target.
- A change from outside the editor (format, rename, undo) keeps the caret with the text around it and the view on the same lines.
- The first letters typed right after the first edit of a file were lost: a dirty-state event sent the old text back.
- Arabic hover text reads right to left (`bidiIsolates`): signatures such as `عرف الأكبر(الأول: عدد, الثاني: عدد): عدد` and the Arabic labels are no longer reordered by the surrounding left-to-right hover.

### Changed
- ⚠️ The Arabic `let` keyword is **`ليكن`** (was `دع`): syntax surface and grammars regenerated from the compiler's token registry with the new spelling, tree-sitter parser regenerated, snippets, samples and tests updated.
- The language server is now **sultanc-analyzer** (formerly sultanc-lsp). The extension looks for `build/sultanc-analyzer` first and still finds a `build/sultanc-lsp` made before the rename. The e2e test variables are `SULTANC_ANALYZER` and `SULTANC_HOME`.

### Removed
- The extension's own references CodeLens, header-comment Test Explorer, regex rename-imports and regex entry lens. The server provides each of them once (`textDocument/codeLens`, `sultanc/tests`, `workspace/willRenameFiles`), so there is one Test Explorer and one references lens.
- Settings `sultanc.codeLens.run`, `sultanc.codeLens.references` and `sultanc.updateImportsOnRename`; use `sultanc.lens.run` and `sultanc.lens.references`.

## 0.14.0

### Added
- **Debug one test**: a "Debug" lens beside "▶︎ Run Test", and a Debug profile in the Test Explorer. The test is built with `sultanc test --test=NAME -O0 -o PATH --no-run` and debugged with gdb or lldb as `PATH INDEX`, so breakpoints inside the test stop and its variables show (sultanc-lsp 0.20).
- Completion inserts constructors as calls where a value is written: `Color.` → `Red()`, `Shape.` → `Circle(`; a match arm keeps `Color.Red`.
- Quick fix for `Color.Red` without `()`: adds the `()` (the compiler's `SULTANC-NAME-CONSTRUCTOR-NOT-CALLED`).

## 0.13.2

### Fixed
- RTL editor: **Backspace and Delete work everywhere** as in any editor. At the start of a line or on an empty line, Backspace did nothing: the text area keeps an invisible direction mark at each line start, and the key erased that mark (put back right away) instead of the line break. Both keys now edit the source text: a line start joins the line above, Delete at a line end joins the next line, Backspace in leading spaces goes back one indentation stop, Option+Delete (Ctrl+Backspace) erases a word, Cmd+Delete erases to the line start, Fn+Delete deletes forward.

## 0.13.1

### Fixed
- RTL editor: a closed suggestion list left a thin line under the code (its border was still drawn).
- RTL editor: accepting a suggestion after erasing letters deleted as many characters after the caret (`Color.Re`, Backspace, Enter gave `Color.Reddef main`). The item now replaces from the word's start to the caret, never past it.

### Added
- RTL editor: **Delete Line** (Cmd/Ctrl+Shift+K), **Move Line** (Alt+Up/Down), **Copy Line** (Shift+Alt+Up/Down), and Cut with nothing selected cuts the line, as in VS Code's editor.

## 0.13.0

### Changed
- RTL editor completion list redesigned: an icon for each kind (function, variable, field, type, enum, enum member, module, keyword…) in VS Code's own symbol colours; the typed letters marked in each name; the type on the side, or the module an auto-import adds; a details pane with the selected item's signature, docs and the `import` it adds. Translucent surface, smooth opening, VS Code's suggest-widget theme colours only (light, dark, high contrast). Right to left in Arabic files.
- The list opens under the line being typed, or above it when there is no room, never over it.
- Auto-import names now keep coming as you type (`int_to` → `int_to_text`): the server marks a list that more letters can change as incomplete (sultanc-lsp 0.18.1), and the editor asks again.

## 0.12.1

### Fixed
- RTL editor: completion opens **by itself while typing**, as VS Code's text editor does: after `.` and at the start of a word (Arabic and English), filtered as you keep typing. Before, it opened only with Ctrl+Space (which macOS takes for switching keyboard languages) and closed at every key.
- RTL editor: a list whose request the server dropped because the text changed meanwhile (ContentModified) is asked again; before, fast typing left no list.
- RTL editor: accepting an item replaces the whole typed word (`de` → `deepest`, not `deepestde`).
- RTL editor: the caret stays in the editor when you switch to another app and back.
- `npm run test:rtl`: types into the RTL editor in a real VS Code (Playwright) and checks the list, in English and Arabic.

## 0.12.0

### Added
- **Check on save** (sultanc-lsp 0.18), as rust-analyzer's `cargo check`: after each save, and at start, the server runs `sultanc check` on the project and shows its errors in files that are not open, in each file's language. Opening a file switches it to live diagnostics (one copy, never two); closing it brings the check's back. Settings: `sultanc.checkOnSave`, `sultanc.check.entries`.
- **Code lens**: "▶︎ Run Test" above each test runs it in the Test Explorer; "N references" above declarations with `sultanc.lens.references` (off by default, as rust-analyzer).
- **Format on type** (`editor.formatOnType`): `;` and `}` format with the compiler's formatter.
- **Closing brace hints**: `} // def main` after declarations of 25 lines or more (`sultanc.inlayHints.closingBraceHints.*`).

## 0.11.1

### Added
- The `module` / `وحدة` keyword (token `MODULE`, interp2) is highlighted, shows both spellings on hover (sultanc-lsp 0.17.1), and is parsed by tree-sitter (Neovim, Helix, Zed): `module text { ar: نصوص };` and the re-export `module io = std.io;`. Regenerated from the compiler's token registry with `tools/sync-from-compiler.sh`.

## 0.11.0

### Changed
- Works with the layered standard library (`library/core`, `library/alloc`, `library/std`; sultanc-lsp 0.17). Auto-import completion finds names in every layer (`int_to_text` → `import std.text.number;`), and workspace symbols leave out all of them.
- "Add missing match arms" and "add missing import" are the compiler's own fixes (`add-missing-arms`, `import-module`), shown on the diagnostic. The server's text-based versions are removed.
- The "language server not found" message names the build command for the opened checkout: `sultanc-lsp/tools/build.sh <checkout>`.

## 0.10.0

### Changed
- Faster after an edit (sultanc-lsp 0.16): in `compiler/`, references after editing `compiler/main.sn` take 0.45 s instead of 1.75 s, and diagnostics 0.38 s instead of 1.2 s. The server no longer copies the analysed program between its cache and requests, and prepares the compiler's next analysis while you are not typing.
- Running one test from the Test Explorer runs exactly that test (`sultanc test --test=<name>`): `doubles` no longer runs `doubles_wrong` too.
- Tests in a Supax package run with the package graph (sultanc-lsp 0.15, `sultanc/packageGraph`, given to `sultanc test --package-graph=-`), so their imports of other packages resolve.
- An invalid test (`@@test` with parameters, a wrong result type, not a function) is underlined while you type, with the compiler's `SULTANC-TEST-*` diagnostic.

## 0.9.0

### Added
- Test Explorer: the `@@test` / `@@اختبار` functions of each open file, found by the compiler (sultanc-lsp 0.14, `sultanc/tests`), with run buttons in the gutter. A run is `sultanc test <file>` (`--filter <name>` for one test); each test shows passed or failed, and a failure shows why (returned error, assertion, exit status, signal) and where.
- `import std.` / `استورد المكتبة.` completion lists the document's own spellings: canonical module names in an English file; Arabic spellings first (each naming its module) in an Arabic file.

### Changed
- Debug builds use `-O0`, as Cargo's debug profile does: a breakpoint inside a small function (`ضاعف`) stops on its line, and its locals show their values (`ن = 42`) instead of `<optimized out>`. Run and Test keep the default level. The e2e test checks both under gdb and lldb.
- The server keeps the compiler's incremental analysis between requests: after an edit only the edited file and the files that import it are analysed again.

## 0.8.0

### Added
- Completion while you type (sultanc-lsp 0.13), answered by the compiler on the unfinished line: `p.` lists the fields of `p`, `import std.` / `استورد المكتبة.دخ.` the modules there, `std.io.` the module's names, and inside a function the locals and parameters first, then the module's functions, imports and std.
- Format Document and Format Selection (sultanc-lsp 0.12): the compiler's formatter, the same as `sultanc fmt`.
- Debugging shows Arabic function names: gdb's DAP server now runs in UTF-8 mode, so a stack frame named `الرئيسية` no longer fails under a non-UTF-8 locale.
- Supax projects: in a folder holding `Supax.toml` (or inside one), the server (sultanc-lsp 0.11) compiles with the package graph from `supax metadata` and re-runs it when `Supax.toml` or `Supax.lock` changes. New setting `sultanc.supax.path`; default: `supax` on PATH, else `~/.supax/bin/supax`. A warning names the problem when supax is missing or fails.
- Quick fixes come from the compiler's structured suggestions: declare `mutable`, read through a reference (`*`), a similar name, a missing import, and the earlier keyword and semicolon fixes. Machine-applicable fixes are marked preferred.
- Find references reports which importing files could not be analysed; rename refuses with the compiler's conflict.
- Extract Function, unused-import hints (faded) and organize imports that removes them.

### Changed
- Cancelling a request, or editing its file, now stops an analysis that is already running.
- The SultanC home is found by its standard library (`library/std`), not by a manifest file.

## 0.7.0

### Added
- Debugging: a `sultanc` launch configuration (F5, or the 🐞 Debug lens on the entry) builds the `.sn` file with `sultanc` and debugs it on gdb 14+ (`gdb -i=dap`) or `lldb-dap`. Breakpoints in `.sn` files, stepping, stack frames. With gdb 14/15 the extension holds `launch` until the breakpoints are set, so they hit on the first run.
- Go to Implementation (sultanc-lsp 0.8): every target's version of a declaration written in `if (target.platform == …)` blocks.
- Compiler quick fixes are titled in the file's language and attached to their diagnostic.
- Workspace symbol search is fuzzy and matches Alef forms and Kashida as the compiler does.

### Changed
- Requests the editor cancels, or that a later edit makes stale, are dropped by the server instead of answered late.
- Find references and rename cover the whole project with no 300-file cap.

## 0.6.0

### Added
- Code actions from sultanc-lsp 0.7:
  - add the missing match arms (`طابق` / `match`);
  - invert an `إذا` condition and swap its branches;
  - add a missing `وإلا` branch.
- The status bar shows "SultanC: analysing…" while a file is being checked, and during code actions and coloring.
- Snippets (Arabic and English):
  - `لكل` / `for` loops;
  - `وإلا إذا` chains;
  - matches on اختياري / نتيجة;
  - public records;
  - printing a line;
  - compiler test headers.
- Marketplace metadata (homepage, issues, gallery banner) and `PUBLISHING.md`.

## 0.5.2

### Fixed
- RTL editor: two lines no longer show above the code. The Peek panel's style overrode its `hidden` state.

## 0.5.1

### Changed
- Follows the compiler's new spelling `إذا` (was `لو`) in highlighting, keywords, snippets and samples.

## 0.5.0

### Added
- RTL editor:
  - breadcrumb bar with the symbols around the cursor;
  - Peek Definition (Alt+F12) in place, in the peeked file's direction.
- Code actions from sultanc-lsp 0.6:
  - add missing import;
  - Organize Imports;
  - Extract into variable;
  - Inline variable.
- Inlay type hints for match-pattern and loop bindings.

### Fixed
- Enter keeps the current line's indentation only, goes one level in after `{`, and leaves empty lines empty. Typing `}` on a blank line returns it to its block's level.
- Diagnostics follow open files only, with one copy per problem.

## 0.4.0

The extension is rebuilt on `vscode-languageclient`, the client used by rust-analyzer, clangd and gopls.

### Changed
- `.sn` files open in VS Code's own editor. Hover, completion, peek, outline, breadcrumbs, folding and inlay UI are native.
- The Arabic-first RTL editor is still available, now as an option: **Reopen in RTL Editor** in the editor title bar, or *Reopen Editor With… → SultanC RTL Editor*.
- The server runs from the SultanC home (`sultanc.home`, `$SULTANC_HOME`, the compiler checkout containing the server, or a workspace folder), where the compiler finds `library/`. The standard library therefore resolves for projects anywhere, not only inside the compiler checkout.
- The grammar and keyword metadata come from this repository's root (`grammars/`, `metadata/`), which is synchronised from the compiler registries.

### Added
- Status bar item showing server state, version, server path and SultanC home, plus a command menu.
- Commands: Restart Language Server, Show Output, Show Server Info, Reopen in RTL/Text Editor.
- Settings:
  - `sultanc.diagnostics.language` (`auto`/`ar`/`en`): message language;
  - `sultanc.home`;
  - `sultanc.trace.server`.
- RTL editor:
  - hover renders Markdown (code blocks, links, Arabic labels) instead of raw text;
  - "Defined in" links open the target.

### Server features available with sultanc-lsp 0.5.0
- Hover with doc comments and full record/enum declarations. Types are shown in the file's language.
- Completion:
  - keeps the original spelling;
  - member completion after `.` (enum constructors, record fields);
  - keywords in the file's language.
- Signature help with named parameters.
- Folding ranges, selection ranges, import links.
- Diagnostics in Arabic or English; errors in other modules are reported at the top of the file.
- Hover, completion and signature help keep working while the file has syntax errors.

## 0.3.12
- Last release of the webview-first editor with a custom JSON-RPC client.
