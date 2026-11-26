# SultanC for Zed

Tree-sitter highlighting, brackets, indentation, outline and text objects,
plus sultanc-analyzer (diagnostics, hover, completion, navigation, rename, code
actions).

## Install as a dev extension

1. Set `rev` in `extension.toml` to a commit of this repository that contains
   `tree-sitter-sultanc/` (for a local checkout, use
   `repository = "file:///absolute/path/to/sultanc-language-support"`).
2. In Zed: `zed: install dev extension` and pick `editors/zed`.

## Language server

Install `sultanc-analyzer` into the SultanC toolchain
(`sultanc-analyzer/tools/install.sh`, see its README). The extension starts the
first of:

- `lsp.sultanc-analyzer.binary.path` in Zed settings;
- `sultanc-analyzer` on `PATH` (`~/.supax/bin` after Supax's installer);
- `$SUPAX_HOME/bin/sultanc-analyzer`, else `~/.supax/bin/sultanc-analyzer`;
- `$SULTANC_HOME/build/sultanc-analyzer` (a checkout).

The server finds its standard library next to itself, so no working directory
is needed. Zed settings, for a build elsewhere:

```json
{
  "lsp": {
    "sultanc-analyzer": {
      "binary": { "path": "/path/to/sultanc/build/sultanc-analyzer" }
    }
  }
}
```

The query files in `languages/sultanc/` are generated
(`tools/generate-tree-sitter-queries.py`); edit `tree-sitter-sultanc/queries/`.

## Debugging

Zed's built-in GDB and CodeLLDB adapters debug the program `sultanc` builds
(it always writes DWARF; build with `-O0` so small functions are not inlined
and locals keep their values). `.zed/debug.json`:

```json
[
  {
    "label": "SultanC: current file",
    "adapter": "GDB",
    "request": "launch",
    "program": "/tmp/sultanc-run/$ZED_STEM",
    "build": { "command": "sultanc", "args": ["-O0", "$ZED_FILE", "-o", "/tmp/sultanc-run/$ZED_STEM"] }
  }
]
```
