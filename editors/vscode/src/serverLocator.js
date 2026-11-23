'use strict';

// Locates the SultanC language server and the SultanC home (the directory that
// holds the standard library, library/std). Pure functions over an injectable filesystem so the
// resolution order is unit-tested without VS Code.

const fs = require('fs');
const path = require('path');

const EXE = process.platform === 'win32' ? '.exe' : '';
const EXECUTABLE = 'sultanc-analyzer' + EXE;
// The name before 0.15 (sultanc-lsp): builds made with it are still found.
const LEGACY_EXECUTABLE = 'sultanc-lsp' + EXE;
const NAMES = [EXECUTABLE, LEGACY_EXECUTABLE];

function defaultIsFile(candidate) {
    try { return fs.statSync(candidate).isFile(); } catch (_) { return false; }
}

// Workspace folders plus their immediate subfolders: a folder that holds the
// SultanC checkout next to other projects (e.g. ~/sultan/{sultanc,playground})
// is a common layout. A subfolder named `sultanc` is tried first.
function defaultListDirs(dir) {
    try {
        return fs.readdirSync(dir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
            .map((entry) => path.join(dir, entry.name));
    } catch (_) { return []; }
}

function searchRoots(workspaceFolders, listDirs) {
    const roots = [];
    for (const folder of workspaceFolders) {
        roots.push(folder);
        // listDirs may return entry names or full paths.
        const children = listDirs(folder).map((entry) => (path.isAbsolute(entry) ? entry : path.join(folder, entry))).sort((a, b) => {
            const rank = (p) => (path.basename(p) === 'sultanc' ? 0 : 1);
            return rank(a) - rank(b) || a.localeCompare(b);
        });
        roots.push(...children);
    }
    return roots;
}

// The std sources themselves, not a manifest: how the compiler describes std
// (library/Supax.toml, then library/package-graph.toml) has changed between
// checkpoints, the library/std tree has not.
function isHome(dir, isFile) {
    return Boolean(dir) && isFile(path.join(dir, 'library', 'std', 'io', 'println.sn'));
}

/**
 * Server resolution order:
 *   1. `sultanc.server.path` (absolute, or relative to the first workspace folder)
 *   2. <workspace>/build/sultanc-analyzer, then <workspace>/<subfolder>/build/sultanc-analyzer
 *      (a SultanC checkout being worked on)
 *   3. $SULTANC_HOME/build/sultanc-analyzer
 *   4. the server bundled in a platform-specific extension package:
 *      <extension>/sultanc/build/sultanc-analyzer, with its standard library in
 *      <extension>/sultanc/library (the layout of a checkout)
 *   5. sultanc-analyzer on PATH
 * In each place but the bundle, the former name sultanc-lsp is tried after it.
 */
function findServer({ configuredPath = '', workspaceFolders = [], env = process.env, bundledDir = null, isFile = defaultIsFile, listDirs = defaultListDirs } = {}) {
    const candidates = [];
    const configured = (configuredPath || '').trim();
    if (configured) {
        candidates.push(path.isAbsolute(configured)
            ? configured
            : path.resolve(workspaceFolders[0] || process.cwd(), configured));
    }
    for (const root of searchRoots(workspaceFolders, listDirs)) {
        for (const name of NAMES) candidates.push(path.join(root, 'build', name));
    }
    if (env.SULTANC_HOME) for (const name of NAMES) candidates.push(path.join(env.SULTANC_HOME, 'build', name));
    if (bundledDir) candidates.push(path.join(bundledDir, 'build', EXECUTABLE));
    for (const dir of (env.PATH || '').split(path.delimiter)) {
        if (dir) for (const name of NAMES) candidates.push(path.join(dir, name));
    }
    for (const candidate of candidates) {
        if (isFile(candidate)) {
            const bundled = Boolean(bundledDir) && candidate === path.join(bundledDir, 'build', EXECUTABLE);
            return { path: candidate, candidates, bundled };
        }
    }
    return { path: null, candidates, bundled: false };
}

/**
 * SultanC home resolution order (the server resolves `std` under it):
 *   1. `sultanc.home`
 *   2. the bundle's own directory for the bundled server: it was built against
 *      that standard library, so $SULTANC_HOME does not replace it
 *   3. $SULTANC_HOME
 *   4. an ancestor of the server executable holding library/std
 *      (a compiler checkout's build/sultanc-analyzer, or an install prefix)
 *   5. a workspace folder holding library/std
 */
function findHome({ configuredHome = '', serverPath = null, bundledDir = null, workspaceFolders = [], env = process.env, isFile = defaultIsFile, listDirs = defaultListDirs } = {}) {
    const configured = (configuredHome || '').trim();
    if (configured) return configured;
    if (bundledDir && serverPath === path.join(bundledDir, 'build', EXECUTABLE) && isHome(bundledDir, isFile)) return bundledDir;
    if (env.SULTANC_HOME) return env.SULTANC_HOME;
    if (serverPath) {
        let dir = path.dirname(serverPath);
        for (let depth = 0; depth < 4; depth++) {
            if (isHome(dir, isFile)) return dir;
            const parent = path.dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
    }
    for (const root of searchRoots(workspaceFolders, listDirs)) {
        if (isHome(root, isFile)) return root;
    }
    return null;
}

module.exports = { EXECUTABLE, LEGACY_EXECUTABLE, findServer, findHome };
