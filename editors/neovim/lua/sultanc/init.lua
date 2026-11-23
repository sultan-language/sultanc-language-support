-- SultanC for Neovim: tree-sitter parser registration and sultanc-lsp.
--
--   require('sultanc').setup({
--     home = '/path/to/SultanC',          -- or $SULTANC_HOME
--     grammar = '/path/to/sultanc-language-support',  -- this repository
--   })
local M = {}

local function repo_root()
  local here = debug.getinfo(1, 'S').source:sub(2)
  return vim.fn.fnamemodify(here, ':h:h:h:h:h')
end

--- Registers the parser with nvim-treesitter (both the `master` and the
--- `main` branch APIs), so `:TSInstall sultanc` builds it from this repository.
local function register_parser(grammar)
  local install_info = {
    url = grammar,
    location = 'tree-sitter-sultanc',
    files = { 'src/parser.c', 'src/scanner.c' },
    path = grammar .. '/tree-sitter-sultanc', -- `main` branch: local checkout
    queries = 'editors/neovim/queries/sultanc',
  }
  local ok, parsers = pcall(require, 'nvim-treesitter.parsers')
  if not ok then
    return
  end
  if type(parsers.get_parser_configs) == 'function' then
    parsers.get_parser_configs().sultanc = { install_info = install_info, filetype = 'sultanc' }
  else
    vim.api.nvim_create_autocmd('User', {
      pattern = 'TSUpdate',
      callback = function()
        require('nvim-treesitter.parsers').sultanc = { install_info = install_info }
      end,
    })
  end
end

function M.setup(opts)
  opts = opts or {}
  local home = opts.home or vim.env.SULTANC_HOME
  local grammar = opts.grammar or repo_root()

  vim.filetype.add({ extension = { sn = 'sultanc' } })
  register_parser(grammar)
  -- A parser built by hand (`tree-sitter build -o sultanc.so`) also works:
  if opts.parser then
    vim.treesitter.language.add('sultanc', { path = opts.parser })
  end

  if home and vim.lsp.config then
    vim.lsp.config('sultanc', {
      cmd = { opts.server or (home .. '/build/sultanc-lsp') },
      cmd_cwd = home, -- the compiler finds library/Supax.toml from here
      filetypes = { 'sultanc' },
      root_markers = { 'Supax.toml', '.git' },
    })
    vim.lsp.enable('sultanc')
  end
end

return M
