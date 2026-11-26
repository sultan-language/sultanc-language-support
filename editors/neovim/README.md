# SultanC for Neovim (0.11+)

```lua
-- lazy.nvim
{
  dir = '/path/to/sultanc-language-support/editors/neovim',
  config = function()
    require('sultanc').setup({ grammar = '/path/to/sultanc-language-support' })
  end,
}
```

- `ftdetect`/`ftplugin`: `.sn` files, `// %s` comments, 4-space indent,
  tree-sitter folds.
- Parser: with nvim-treesitter run `:TSInstall sultanc` (`setup` registers it
  for both the `master` and `main` branches). Without it, build
  `tree-sitter-sultanc` (`tree-sitter build -o sultanc.so`) and pass
  `parser = '/path/to/sultanc.so'`.
- Queries in `queries/sultanc/` (highlights, locals, folds, indents,
  textobjects) are generated from `tree-sitter-sultanc/queries/`.
- LSP: `vim.lsp.config('sultanc', ...)` starting `sultanc-analyzer` from `PATH`
  (the toolchain's `~/.supax/bin`), else `~/.supax/bin/sultanc-analyzer`, else
  `$SULTANC_HOME/build/sultanc-analyzer`, or `server = '/path/to/sultanc-analyzer'`.
  It finds its standard library next to itself.

`tests/editors/neovim_test.lua` checks all of this headless, including a
diagnostic from sultanc-analyzer.

## Debugging (nvim-dap)

`sultanc` writes DWARF; debug the built program with gdb 14+ (`gdb -i=dap`)
or `lldb-dap`:

```lua
local dap = require('dap')
dap.adapters.gdb = { type = 'executable', command = 'gdb', args = { '-i=dap', '-q' } }
dap.configurations.sultanc = {
  {
    name = 'Build and debug current file',
    type = 'gdb',
    request = 'launch',
    program = function()
      local src = vim.fn.expand('%:p')
      local out = vim.fn.tempname()
      local home = vim.env.SULTANC_HOME
      vim.fn.system({ home .. '/build/sultanc', '-O0', src, '-o', out })  -- -O0: no inlining, locals kept
      return out
    end,
    cwd = '${workspaceFolder}',
  },
}
```

With gdb 14 or 15, set breakpoints after the program stops once (or use
`stopAtBeginningOfMainSubprogram = true`): those versions run the program as
soon as `launch` arrives. gdb 16 waits for the configuration.
