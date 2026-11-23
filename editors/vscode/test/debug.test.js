'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const original = Module._load;
Module._load = function load(request, ...rest) {
    if (request === 'vscode') return { workspace: {}, window: {}, EventEmitter: class {} };
    return original.call(this, request, ...rest);
};
const { chooseDebugger, adapterCommand, nativeLaunchArguments, findOnPath } = require('../src/debug');
Module._load = original;

const settings = (values) => ({ get: (key, fallback) => (key in values ? values[key] : fallback) });

test('debugger choice: configuration, then setting, then platform', () => {
    assert.strictEqual(chooseDebugger({ debugger: 'lldb' }, settings({ 'debug.debugger': 'gdb' })), 'lldb');
    assert.strictEqual(chooseDebugger({}, settings({ 'debug.debugger': 'gdb' })), 'gdb');
    assert.strictEqual(chooseDebugger({ debugger: 'auto' }, settings({})), process.platform === 'darwin' ? 'lldb' : 'gdb');
});

test('adapter commands: gdb -i=dap and lldb-dap from PATH, or a clear error', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sultanc-dbg-'));
    for (const name of ['gdb', 'lldb-dap-18']) {
        fs.writeFileSync(path.join(dir, name), '');
    }
    const env = { PATH: dir };
    assert.deepStrictEqual(adapterCommand('gdb', settings({}), env), { command: path.join(dir, 'gdb'), args: ['-i=dap', '-q'] });
    assert.deepStrictEqual(adapterCommand('lldb', settings({}), env), { command: path.join(dir, 'lldb-dap-18'), args: [] });
    assert.deepStrictEqual(adapterCommand('gdb', settings({ 'debug.gdbPath': '/opt/gdb/bin/gdb' }), env),
        { command: '/opt/gdb/bin/gdb', args: ['-i=dap', '-q'] });
    assert.match(adapterCommand('gdb', settings({}), { PATH: '' }).error, /gdb not found/);
    if (process.platform !== 'darwin') assert.match(adapterCommand('lldb', settings({}), { PATH: '' }).error, /lldb-dap not found/);
    assert.strictEqual(findOnPath(['missing-tool'], env), null);
});

test('native launch arguments: program is the built executable', () => {
    const gdb = nativeLaunchArguments({ type: 'sultanc', request: 'launch', name: 'x', program: '/w/prog.sn', source: '/w/prog.sn', stopOnEntry: true }, 'gdb', '/tmp/sultanc-run/prog');
    assert.strictEqual(gdb.program, '/tmp/sultanc-run/prog');
    assert.strictEqual(gdb.cwd, '/w');
    assert.deepStrictEqual(gdb.args, []);
    assert.strictEqual(gdb.stopAtBeginningOfMainSubprogram, true);
    const lldb = nativeLaunchArguments({ program: '/bin/app', args: ['a'], cwd: '/c' }, 'lldb', '/bin/app');
    assert.deepStrictEqual([lldb.program, lldb.args, lldb.cwd, lldb.stopOnEntry], ['/bin/app', ['a'], '/c', false]);
});

test('DAP framing round-trips and splits partial input', () => {
    const { parseFrames: parse, frame: encode } = loadDebug();
    const a = encode({ seq: 1, type: 'request', command: 'launch', arguments: { program: '/tmp/برنامج' } });
    const b = encode({ seq: 2, type: 'request', command: 'configurationDone' });
    const whole = Buffer.concat([a, b]);
    const first = parse(whole.slice(0, a.length + 5));
    assert.deepStrictEqual(first.messages.map((m) => m.seq), [1]);
    assert.strictEqual(first.messages[0].arguments.program, '/tmp/برنامج');
    const second = parse(Buffer.concat([first.rest, whole.slice(a.length + 5)]));
    assert.deepStrictEqual(second.messages.map((m) => m.command), ['configurationDone']);
    assert.strictEqual(second.rest.length, 0);
});

test('gdb proxy holds launch until configurationDone, order otherwise unchanged', () => {
    const { DeferredLaunchProxy, parseFrames: parse } = loadDebug();
    const written = [];
    const { EventEmitter } = require('events');
    const fakeSpawn = () => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stdin = { write: (buf) => written.push(...parse(buf).messages) };
        child.exitCode = null;
        child.kill = () => {};
        return child;
    };
    const proxy = new DeferredLaunchProxy('gdb', ['-i=dap'], fakeSpawn);
    const req = (seq, command) => ({ seq, type: 'request', command });
    proxy.handleMessage(req(1, 'initialize'));
    proxy.handleMessage(req(2, 'launch'));
    proxy.handleMessage(req(3, 'setBreakpoints'));
    proxy.handleMessage(req(4, 'configurationDone'));
    proxy.handleMessage(req(5, 'threads'));
    assert.deepStrictEqual(written.map((m) => m.command), ['initialize', 'setBreakpoints', 'configurationDone', 'launch', 'threads']);
});

function loadDebug() {
    const Module = require('module');
    const saved = Module._load;
    Module._load = function load(request, ...rest) {
        if (request === 'vscode') {
            return { workspace: {}, window: {}, EventEmitter: class { constructor() { this.event = () => {}; } fire() {} dispose() {} } };
        }
        return saved.call(this, request, ...rest);
    };
    delete require.cache[require.resolve('../src/debug')];
    const loaded = require('../src/debug');
    Module._load = saved;
    return loaded;
}

test('debug builds are -O0 (breakpoints in small functions bind, locals keep their values)', () => {
    const { debugBuildArguments } = require('../src/debug');
    assert.deepStrictEqual(debugBuildArguments('/h', '/h/a/p.sn', '/tmp/p'), ['--lang=en', '-O0', 'a/p.sn', '-o', '/tmp/p']);
});
