-- SultanC buffer defaults (the compiler's style: 4 spaces, // comments).
vim.bo.commentstring = '// %s'
vim.bo.comments = '://'
vim.bo.shiftwidth = 4
vim.bo.tabstop = 4
vim.bo.softtabstop = 4
vim.bo.expandtab = true

-- Tree-sitter highlighting, folding and indentation when the parser is installed.
if pcall(vim.treesitter.start) then
  vim.wo[0][0].foldmethod = 'expr'
  vim.wo[0][0].foldexpr = 'v:lua.vim.treesitter.foldexpr()'
  vim.wo[0][0].foldlevel = 99
  local ok, ts_indent = pcall(require, 'nvim-treesitter.indent')
  if ok and ts_indent then
    vim.bo.indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"
  end
end
