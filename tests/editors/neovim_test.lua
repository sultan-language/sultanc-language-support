-- Headless Neovim check: nvim --headless -u NONE -l tests/editors/neovim_test.lua
-- env: SULTANC_PARSER (built sultanc.so), SULTANC_HOME (checkout with build/sultanc-analyzer)
local root = vim.fn.fnamemodify(debug.getinfo(1, 'S').source:sub(2), ':p:h:h:h')
vim.opt.rtp:prepend(root .. '/editors/neovim')
vim.cmd('filetype plugin on')
vim.cmd('runtime! ftdetect/*.lua')
require('sultanc').setup({ parser = vim.env.SULTANC_PARSER, home = vim.env.SULTANC_HOME })

local failures = 0
local function check(name, cond, detail)
  if cond then
    print('ok   ' .. name)
  else
    failures = failures + 1
    print('FAIL ' .. name .. (detail and (': ' .. vim.inspect(detail)) or ''))
  end
end

local dir = vim.fn.tempname()
vim.fn.mkdir(dir, 'p')
local file = dir .. '/demo.sn'
vim.fn.writefile({
  'عام عرف الأكبر(أ: عدد, ب: عدد): عدد {',
  '    إذا (أ > ب) { أرجع أ; };',
  '    أرجع ب;',
  '}',
  '',
  'def main(): int {',
  '    let s: string = «raw»;',
  '    return undefined_name;',
  '}',
}, file)
vim.cmd('edit ' .. file)
check('filetype', vim.bo.filetype == 'sultanc', vim.bo.filetype)
check('commentstring', vim.bo.commentstring == '// %s', vim.bo.commentstring)
check('parser active', vim.treesitter.highlighter.active[vim.api.nvim_get_current_buf()] ~= nil)

-- Columns are bytes: 'عام ' is 7 bytes, 'عرف' starts at byte 7.
local function captures(row, col)
  local names = {}
  for _, c in ipairs(vim.treesitter.get_captures_at_pos(0, row, col)) do
    table.insert(names, c.capture)
  end
  return names
end
local function has(list, x) return vim.tbl_contains(list, x) end
check('Arabic visibility keyword', has(captures(0, 0), 'keyword.modifier'), captures(0, 0))
check('Arabic def keyword', has(captures(0, 7), 'keyword.function'), captures(0, 7))
check('Arabic function name', has(captures(0, 14), 'function'), captures(0, 14))
check('Arabic return keyword', has(captures(2, 4), 'keyword.return'), captures(2, 4))
check('English def keyword', has(captures(5, 0), 'keyword.function'), captures(5, 0))
check('raw string', has(captures(6, 20), 'string'), captures(6, 20))

vim.wo.foldmethod = 'expr'
vim.wo.foldexpr = 'v:lua.vim.treesitter.foldexpr()'
vim.cmd('normal! zx')
check('function body folds', vim.fn.foldlevel(2) >= 1, vim.fn.foldlevel(2))

if vim.env.SULTANC_HOME then
  local attached = vim.wait(30000, function()
    return #vim.lsp.get_clients({ bufnr = 0, name = 'sultanc' }) > 0
  end, 100)
  check('sultanc-analyzer attaches', attached)
  local got = vim.wait(60000, function()
    return #vim.diagnostic.get(0) > 0
  end, 200)
  local diags = vim.diagnostic.get(0)
  check('diagnostic from sultanc-analyzer', got and diags[1].lnum == 7 and diags[1].code == 'SULTANC-NAME-UNKNOWN',
    vim.tbl_map(function(d) return { d.lnum, d.col, d.code } end, diags))
end

os.exit(failures == 0 and 0 or 1)
