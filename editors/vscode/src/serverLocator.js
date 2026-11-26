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

// The Supax home, where Supax's installer puts the toolchain: bin/sultanc,
// bin/sultanc-analyzer, lib/sultanc/library (as rustup's ~/.cargo/bin).
function supaxHome(env) {
    return env.SUPAX_HOME || path.join(env.HOME || env.USERPROFILE || require('os').homedir(), '.supax');
}

/**
 * Server resolution order:
 *   1. `sultanc.server.path` (absolute, or relative to the first workspace folder)
 *   2. <workspace>/build/sultanc-analyzer, then <workspace>/<subfolder>/build/sultanc-analyzer
 *      (a SultanC checkout being worked on)
 *   3. $SULTANC_HOME/build/sultanc-analyzer
 *   4. the installed toolchain: $SUPAX_HOME/bin/sultanc-analyzer (~/.supax)
 *   5. sultanc-analyzer on PATH
 * In each place the former name sultanc-lsp is tried after it.
 */
function findServer({ configuredPath = '', workspaceFolders = [], env = process.env, isFile = defaultIsFile, listDirs = defaultListDirs } = {}) {
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
    for (const name of NAMES) candidates.push(path.join(supaxHome(env), 'bin', name));
    for (const dir of (env.PATH || '').split(path.delimiter)) {
        if (dir) for (const name of NAMES) candidates.push(path.join(dir, name));
    }
    for (const candidate of candidates) {
        if (isFile(candidate)) return { path: candidate, candidates };
    }
    return { path: null, candidates };
}

// The standard library next to a server executable, as the compiler finds its
// own (compiler/driver/std_location.sn): <bin>/library, <bin>/../library (a
// checkout's build/), <bin>/../lib/sultanc/library (an install prefix such as
// ~/.supax). The directory holding that library/.
function homeNextTo(serverPath, isFile) {
    const bin = path.dirname(serverPath);
    const parent = path.dirname(bin);
    for (const dir of [bin, parent, path.join(parent, 'lib', 'sultanc')]) {
        if (isHome(dir, isFile)) return dir;
    }
    return null;
}

/**
 * SultanC home resolution order (the server resolves `std` under it):
 *   1. `sultanc.home`
 *   2. the library next to the server, which it was built against
 *   3. $SULTANC_HOME
 *   4. a workspace folder holding library/std
 */
function findHome({ configuredHome = '', serverPath = null, workspaceFolders = [], env = process.env, isFile = defaultIsFile, listDirs = defaultListDirs } = {}) {
    const configured = (configuredHome || '').trim();
    if (configured) return configured;
    if (serverPath) {
        const next = homeNextTo(serverPath, isFile);
        if (next) return next;
    }
    if (env.SULTANC_HOME) return env.SULTANC_HOME;
    for (const root of searchRoots(workspaceFolders, listDirs)) {
        if (isHome(root, isFile)) return root;
    }
    return null;
}

module.exports = { EXECUTABLE, LEGACY_EXECUTABLE, supaxHome, findServer, findHome };
