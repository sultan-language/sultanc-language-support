'use strict';

// Debugging SultanC programs on the debuggers that already speak DAP:
//   - gdb 14+ (`gdb -i=dap`, built in), the default on Linux and Windows;
//   - lldb-dap (LLVM; `xcrun -f lldb-dap` on macOS), the default on macOS.
// The extension adds no adapter of its own. A `sultanc` launch configuration
// names a `.sn` file; before the session starts the file is compiled with the
// configured `sultanc` (debug information is always emitted), and the session
// is handed to the native adapter with `program` set to the executable.
// Breakpoints, stepping and stack frames then come from the DWARF the
// compiler writes; what they can show is the compiler's debug information.

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { compilerPath, compilerInput, outputBinary } = require('./tooling');

const DEBUG_TYPE = 'sultanc';

/** The first executable among `names` found on PATH, else null. */
function findOnPath(names, env = process.env) {
    const dirs = (env.PATH || '').split(path.delimiter).filter(Boolean);
    const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
    for (const name of names) {
        if (path.isAbsolute(name)) {
            if (fs.existsSync(name)) return name;
            continue;
        }
        for (const dir of dirs) {
            for (const ext of exts) {
                const candidate = path.join(dir, name + ext);
                if (fs.existsSync(candidate)) return candidate;
            }
        }
    }
    return null;
}

/** gdb or lldb: the configuration's choice, the setting, else the platform default. */
function chooseDebugger(config, settings = vscode.workspace.getConfiguration('sultanc')) {
    const requested = config.debugger || settings.get('debug.debugger', 'auto');
    if (requested === 'gdb' || requested === 'lldb') return requested;
    return process.platform === 'darwin' ? 'lldb' : 'gdb';
}

/** Command and arguments that start the native DAP server, or an error text. */
function adapterCommand(kind, settings = vscode.workspace.getConfiguration('sultanc'), env = process.env) {
    if (kind === 'gdb') {
        const configured = settings.get('debug.gdbPath', '').trim();
        const gdb = configured || findOnPath(['gdb'], env);
        if (!gdb) return { error: 'gdb not found. Install gdb 14 or later, or set "sultanc.debug.gdbPath".' };
        return { command: gdb, args: ['-i=dap', '-q'] };
    }
    const configured = settings.get('debug.lldbDapPath', '').trim();
    let lldbDap = configured || findOnPath(['lldb-dap', 'lldb-dap-20', 'lldb-dap-19', 'lldb-dap-18', 'lldb-vscode'], env);
    if (!lldbDap && process.platform === 'darwin') {
        try {
            lldbDap = childProcess.execFileSync('xcrun', ['-f', 'lldb-dap'], { encoding: 'utf8' }).trim() || null;
        } catch {
            lldbDap = null;
        }
    }
    if (!lldbDap) return { error: 'lldb-dap not found. Install LLVM lldb-dap, or set "sultanc.debug.lldbDapPath".' };
    return { command: lldbDap, args: [] };
}

/** Launch arguments for the native adapter, from a resolved sultanc configuration. */
function nativeLaunchArguments(config, kind, binary) {
    const launch = {
        ...config,
        type: DEBUG_TYPE,
        program: binary,
        args: config.args || [],
        cwd: config.cwd || path.dirname(config.source || binary),
    };
    if (kind === 'gdb') launch.stopAtBeginningOfMainSubprogram = Boolean(config.stopOnEntry);
    else launch.stopOnEntry = Boolean(config.stopOnEntry);
    return launch;
}

/**
 * The compiler arguments of a debug build: `-O0`, as `cargo build` (the debug
 * profile) does. At the default level small functions are inlined, so a
 * breakpoint on their lines cannot bind and optimised values are
 * `<optimized out>`. Run and Test keep the default level.
 */
function debugBuildArguments(home, source, binary) {
    return ['--lang=en', '-O0', compilerInput(home, source), '-o', binary];
}

/** Compiles `source` to `binary`; resolves to null or rejects with the compiler output. */
function compile(compiler, home, source, binary) {
    return new Promise((resolve, reject) => {
        childProcess.execFile(compiler, debugBuildArguments(home, source, binary),
            { cwd: home, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
                if (error) reject(new Error((stderr || stdout || error.message).trim()));
                else resolve(null);
            });
    });
}

class SultanCDebugConfigurationProvider {
    constructor(getHome) {
        this.getHome = getHome;
    }

    provideDebugConfigurations() {
        return [{
            type: DEBUG_TYPE,
            request: 'launch',
            name: 'Debug current SultanC file',
            program: '${file}',
            args: [],
            stopOnEntry: false,
        }];
    }

    resolveDebugConfiguration(folder, config) {
        // F5 with no launch.json: debug the active SultanC file.
        if (!config.type && !config.request && !config.name) {
            const document = vscode.window.activeTextEditor?.document;
            if (!document || document.languageId !== 'sultanc') return config;
            return { type: DEBUG_TYPE, request: 'launch', name: 'Debug current SultanC file', program: '${file}' };
        }
        return config;
    }

    async resolveDebugConfigurationWithSubstitutedVariables(folder, config) {
        if (config.request !== 'launch') {
            vscode.window.showErrorMessage('SultanC: only "launch" configurations are supported.');
            return undefined;
        }
        const program = config.program;
        if (!program) {
            vscode.window.showErrorMessage('SultanC: set "program" to a .sn file or an executable.');
            return undefined;
        }
        const kind = chooseDebugger(config);
        if (!program.endsWith('.sn')) return nativeLaunchArguments({ ...config, debugger: kind }, kind, program);

        const home = this.getHome();
        const compiler = compilerPath(home);
        if (!home || !compiler) {
            vscode.window.showErrorMessage('SultanC: compiler not found. Build the compiler (build/sultanc) or set "sultanc.compiler.path" and "sultanc.home".');
            return undefined;
        }
        await vscode.workspace.saveAll(false);
        const binary = outputBinary(program);
        try {
            await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `SultanC: building ${path.basename(program)}` },
                () => compile(compiler, home, program, binary));
        } catch (error) {
            vscode.window.showErrorMessage(`SultanC: build failed.\n${error.message}`, { modal: false });
            return undefined;
        }
        return nativeLaunchArguments({ ...config, debugger: kind, source: program }, kind, binary);
    }
}

/**
 * Splits a DAP byte stream into messages (Content-Length framing).
 * Returns the parsed messages and the unconsumed rest of the buffer.
 */
function parseFrames(buffer) {
    const messages = [];
    let rest = buffer;
    for (;;) {
        const header = rest.indexOf('\r\n\r\n');
        if (header < 0) break;
        const match = /Content-Length:\s*(\d+)/i.exec(rest.slice(0, header).toString('latin1'));
        if (!match) { rest = rest.slice(header + 4); continue; }
        const length = Number(match[1]);
        if (rest.length < header + 4 + length) break;
        messages.push(JSON.parse(rest.slice(header + 4, header + 4 + length).toString('utf8')));
        rest = rest.slice(header + 4 + length);
    }
    return { messages, rest };
}

function frame(message) {
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'latin1'), body]);
}

/**
 * gdb's DAP server is Python inside gdb, and it decodes names (Arabic
 * function and variable names) with the locale's encoding: under the C
 * locale a stackTrace fails with "'ascii' codec can't decode". Python's UTF-8
 * mode, and a UTF-8 LC_CTYPE when the environment names none, fix that.
 */
function utf8Environment(env = process.env) {
    const result = { ...env, PYTHONUTF8: '1' };
    const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || '';
    if (!/utf-?8/i.test(locale)) {
        delete result.LC_ALL;
        result.LC_CTYPE = 'C.UTF-8';
    }
    return result;
}

/**
 * gdb 14 and 15 run the program as soon as `launch` arrives, before the
 * client's setBreakpoints/configurationDone, so breakpoints fail with
 * "notStopped". DAP lets the client send `launch` before configuration ends,
 * and gdb 16 defers the run itself. This proxy forwards every message
 * unchanged and only holds `launch` until `configurationDone` has been sent;
 * breakpoints set before then are pending (gdb's DAP turns pending on) and
 * resolve when `launch` loads the program.
 */
class DeferredLaunchProxy {
    constructor(command, args, spawn = childProcess.spawn) {
        this.emitter = new vscode.EventEmitter();
        this.onDidSendMessage = this.emitter.event;
        this.held = null;
        this.configured = false;
        this.buffer = Buffer.alloc(0);
        this.child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], env: utf8Environment() });
        this.child.stdout.on('data', (chunk) => {
            const { messages, rest } = parseFrames(Buffer.concat([this.buffer, chunk]));
            this.buffer = rest;
            for (const message of messages) this.emitter.fire(message);
        });
        this.child.on('exit', () => this.emitter.fire({ type: 'event', event: 'terminated', seq: 0 }));
    }

    handleMessage(message) {
        if (message.type === 'request' && message.command === 'launch' && !this.configured) {
            this.held = message;
            return;
        }
        this.child.stdin.write(frame(message));
        if (message.type === 'request' && message.command === 'configurationDone') {
            this.configured = true;
            if (this.held) {
                this.child.stdin.write(frame(this.held));
                this.held = null;
            }
        }
    }

    dispose() {
        if (this.child.exitCode === null) this.child.kill();
        this.emitter.dispose();
    }
}

class SultanCDebugAdapterFactory {
    createDebugAdapterDescriptor(session) {
        const kind = chooseDebugger(session.configuration);
        const adapter = adapterCommand(kind);
        if (adapter.error) {
            vscode.window.showErrorMessage(`SultanC: ${adapter.error}`);
            return undefined;
        }
        if (kind === 'gdb') {
            return new vscode.DebugAdapterInlineImplementation(new DeferredLaunchProxy(adapter.command, adapter.args));
        }
        return new vscode.DebugAdapterExecutable(adapter.command, adapter.args);
    }
}

function registerDebug(context, getHome) {
    context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider(
        DEBUG_TYPE, new SultanCDebugConfigurationProvider(getHome)));
    context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory(
        DEBUG_TYPE, new SultanCDebugAdapterFactory()));
    context.subscriptions.push(vscode.commands.registerCommand('sultanc.debugFile', async (uri) => {
        // The server's "Debug" lens passes the document URI as a string.
        const target = uri instanceof vscode.Uri ? uri : typeof uri === 'string' ? vscode.Uri.parse(uri) : vscode.window.activeTextEditor?.document.uri;
        if (!target || !target.fsPath.endsWith('.sn')) {
            vscode.window.showWarningMessage('SultanC: open a .sn file first.');
            return false;
        }
        return vscode.debug.startDebugging(vscode.workspace.getWorkspaceFolder(target), {
            type: DEBUG_TYPE, request: 'launch', name: `Debug ${path.basename(target.fsPath)}`, program: target.fsPath,
        });
    }));
}

module.exports = { registerDebug, utf8Environment, debugBuildArguments, chooseDebugger, adapterCommand, nativeLaunchArguments, findOnPath, parseFrames, frame, DeferredLaunchProxy, DEBUG_TYPE };
