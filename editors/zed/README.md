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

The server must start from the SultanC home. Any one of these works:

- `SULTANC_HOME` in the environment Zed sees (the extension runs
  `cd $SULTANC_HOME && build/sultanc-analyzer` through `/bin/sh`);
- `sultanc-analyzer-editor` on `PATH` (`sultanc-analyzer/tools/sultanc-analyzer-editor.sh`);
- Zed settings:

```json
{
  "lsp": {
    "sultanc-analyzer": {
      "binary": {
        "path": "/path/to/SultanC/build/sultanc-analyzer",
        "env": { "SULTANC_HOME": "/path/to/SultanC" }
      }
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
