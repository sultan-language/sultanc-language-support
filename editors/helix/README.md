# SultanC for Helix

1. Append `languages.toml` to `~/.config/helix/languages.toml` and set `rev`.
2. Link the queries: `ln -s "$PWD/runtime/queries/sultanc" ~/.config/helix/runtime/queries/sultanc`.
3. `hx --grammar fetch && hx --grammar build`.
4. Put `sultanc-analyzer-editor` (`sultanc-analyzer/tools/sultanc-analyzer-editor.sh`) on
   `PATH` and export `SULTANC_HOME`.
5. `hx --health sultanc` should show the server, parser and all three query sets.

The queries are generated: Helix capture names, with pattern order reversed
because Helix lets the first matching pattern win.

## Debugging

Add to the `[[language]]` entry (gdb 14+ speaks DAP; build first with
`sultanc -O0 file.sn -o file`: at the default level small functions are
inlined, so their lines cannot take a breakpoint and locals read
`<optimized out>`):

```toml
[language.debugger]
name = "gdb"
transport = "stdio"
command = "gdb"
args = ["-i=dap", "-q"]

[[language.debugger.templates]]
name = "binary"
request = "launch"
completion = [ { name = "binary", completion = "filename" } ]
args = { program = "{0}" }
```

Start with `:debug-start binary ./file`. With gdb 14 or 15, set breakpoints
after the first stop; gdb 16 waits for them.
