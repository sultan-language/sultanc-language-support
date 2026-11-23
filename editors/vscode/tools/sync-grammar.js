#!/usr/bin/env node
'use strict';
// The grammar and keyword metadata are owned by this repository's root
// (grammars/, metadata/), synchronised from the compiler registries by
// tools/sync-from-compiler.sh. The extension ships a copy.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..', '..');
const copies = [
    [path.join(root, 'grammars', 'sultanc.tmLanguage.json'), path.join(__dirname, '..', 'syntaxes', 'sultanc.tmLanguage.json')],
    [path.join(root, 'metadata', 'syntax-surface.json'), path.join(__dirname, '..', 'resources', 'syntax-surface.json')],
];
for (const [from, to] of copies) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    console.log(`${path.relative(root, from)} -> ${path.relative(root, to)}`);
}
