'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { EXECUTABLE, findServer, findHome } = require('../src/serverLocator');

function dirsWith(map) {
    return (dir) => map[path.resolve(dir)] || [];
}

function fsWith(files) {
    const set = new Set(files.map((f) => path.resolve(f)));
    return (candidate) => set.has(path.resolve(candidate));
}

test('configured server path wins and resolves relative to the workspace', () => {
    const isFile = fsWith(['/ws/tools/my-lsp', '/ws/build/' + EXECUTABLE]);
    const found = findServer({ configuredPath: 'tools/my-lsp', workspaceFolders: ['/ws'], env: {}, isFile });
    assert.strictEqual(found.path, path.resolve('/ws/tools/my-lsp'));
});

test('workspace build output is found before PATH', () => {
    const isFile = fsWith(['/ws/build/' + EXECUTABLE, '/usr/bin/' + EXECUTABLE]);
    const found = findServer({ workspaceFolders: ['/ws'], env: { PATH: '/usr/bin' }, isFile });
    assert.strictEqual(found.path, path.join('/ws', 'build', EXECUTABLE));
});

test('falls back to SULTANC_HOME and then PATH', () => {
    let found = findServer({ env: { SULTANC_HOME: '/opt/sultanc', PATH: '/usr/bin' }, isFile: fsWith(['/opt/sultanc/build/' + EXECUTABLE]) });
    assert.strictEqual(found.path, path.join('/opt/sultanc', 'build', EXECUTABLE));
    found = findServer({ env: { PATH: '/usr/bin' }, isFile: fsWith(['/usr/bin/' + EXECUTABLE]) });
    assert.strictEqual(found.path, path.join('/usr/bin', EXECUTABLE));
    found = findServer({ env: {}, isFile: fsWith([]) });
    assert.strictEqual(found.path, null);
});

test('home is derived from a compiler checkout server path', () => {
    const isFile = fsWith(['/src/sultanc/library/std/io/println.sn']);
    assert.strictEqual(findHome({ serverPath: '/src/sultanc/build/' + EXECUTABLE, env: {}, isFile }), path.normalize('/src/sultanc'));
});

test('home: the setting, then the library next to the server, then SULTANC_HOME', () => {
    const isFile = fsWith(['/src/sultanc/library/std/io/println.sn']);
    assert.strictEqual(findHome({ configuredHome: '/mine', serverPath: '/src/sultanc/build/x', env: { SULTANC_HOME: '/env' }, isFile }), '/mine');
    // A server runs against the library it was built with (beside it).
    assert.strictEqual(findHome({ serverPath: '/src/sultanc/build/x', env: { SULTANC_HOME: '/env' }, isFile }), '/src/sultanc');
    assert.strictEqual(findHome({ serverPath: '/opt/x/sultanc-analyzer', env: { SULTANC_HOME: '/env' }, isFile }), '/env');
});

test('home falls back to a workspace folder holding the std library', () => {
    const isFile = fsWith(['/ws/library/std/io/println.sn']);
    assert.strictEqual(findHome({ serverPath: '/usr/bin/' + EXECUTABLE, workspaceFolders: ['/ws'], env: {}, isFile }), '/ws');
    assert.strictEqual(findHome({ serverPath: '/usr/bin/' + EXECUTABLE, workspaceFolders: ['/other'], env: {}, isFile }), null);
});

test('finds the checkout one level below a parent workspace folder', () => {
    const isFile = fsWith(['/w/sultanc/build/' + EXECUTABLE, '/w/sultanc-beta/build/' + EXECUTABLE, '/w/sultanc/library/std/io/println.sn', '/w/sultanc-beta/library/std/io/println.sn']);
    const listDirs = dirsWith({ [path.resolve('/w')]: ['nahr', 'sultanc-beta', 'sultanc', 'playground'] });
    const found = findServer({ workspaceFolders: ['/w'], env: {}, isFile, listDirs });
    assert.strictEqual(found.path, path.join('/w', 'sultanc', 'build', EXECUTABLE));
    assert.strictEqual(findHome({ serverPath: found.path, workspaceFolders: ['/w'], env: {}, isFile, listDirs }), path.join('/w', 'sultanc'));
});

test('finds the checkout one level below the opened folder, preferring sultanc', () => {
    const isFile = fsWith(['/w/sultanc/build/' + EXECUTABLE, '/w/sultanc-beta/build/' + EXECUTABLE, '/w/sultanc/library/std/io/println.sn', '/w/sultanc-beta/library/std/io/println.sn']);
    const listDirs = (dir) => (dir === '/w' ? ['/w/sultanc-beta', '/w/playground', '/w/sultanc'] : []);
    const found = findServer({ workspaceFolders: ['/w'], env: {}, isFile, listDirs });
    assert.strictEqual(found.path, path.join('/w/sultanc', 'build', EXECUTABLE));
    assert.strictEqual(findHome({ serverPath: found.path, workspaceFolders: ['/w'], env: {}, isFile, listDirs }), path.normalize('/w/sultanc'));
});

test('installed toolchain: ~/.supax/bin/sultanc-analyzer after a checkout and SULTANC_HOME, before PATH', () => {
    const server = path.join('/u/.supax', 'bin', EXECUTABLE);
    const isFile = fsWith([server, '/u/.supax/lib/sultanc/library/std/io/println.sn', '/usr/bin/' + EXECUTABLE, '/env/build/' + EXECUTABLE]);
    assert.strictEqual(findServer({ env: { HOME: '/u', PATH: '/usr/bin' }, isFile }).path, server);
    assert.strictEqual(findServer({ env: { SUPAX_HOME: '/u/.supax', PATH: '/usr/bin' }, isFile }).path, server);
    assert.strictEqual(findServer({ env: { HOME: '/u', SULTANC_HOME: '/env', PATH: '/usr/bin' }, isFile }).path, '/env/build/' + EXECUTABLE);
    assert.strictEqual(findServer({ env: { HOME: '/nobody', PATH: '/usr/bin' }, isFile }).path, '/usr/bin/' + EXECUTABLE);
    // The installed server runs against the installed library (as the
    // compiler finds its own: <prefix>/lib/sultanc/library), not $SULTANC_HOME's.
    assert.strictEqual(findHome({ serverPath: server, env: { SULTANC_HOME: '/env' }, isFile }), path.join('/u/.supax', 'lib', 'sultanc'));
    assert.strictEqual(findHome({ configuredHome: '/mine', serverPath: server, env: {}, isFile }), '/mine');
});

test('a server built under the former name sultanc-lsp is still found, after sultanc-analyzer', () => {
    const { LEGACY_EXECUTABLE } = require('../src/serverLocator');
    let found = findServer({ env: { SULTANC_HOME: '/h' }, isFile: fsWith(['/h/build/' + LEGACY_EXECUTABLE]) });
    assert.strictEqual(found.path, path.join('/h', 'build', LEGACY_EXECUTABLE));
    found = findServer({ env: { SULTANC_HOME: '/h' }, isFile: fsWith(['/h/build/' + LEGACY_EXECUTABLE, '/h/build/' + EXECUTABLE]) });
    assert.strictEqual(found.path, path.join('/h', 'build', EXECUTABLE));
});
