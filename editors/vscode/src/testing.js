'use strict';

// SultanC tests in VS Code's Test Explorer and gutter, as vscode-go and
// rust-analyzer show theirs. The tests of a file come from the language
// server (`sultanc/tests`), which asks the compiler's own discovery
// (compiler/test_mode/discovery.sn): no text search here. Running is
// `sultanc test <file>` (docs/en/reference/testing.md), one process per run,
// with `--filter` for a single test; each `PASS name` / `FAIL name: reason`
// line of its report sets that test's result.

const childProcess = require('child_process');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const vscode = require('vscode');
const { compilerPath, compilerInput } = require('./tooling');

const DEBUG_TYPE = 'sultanc';

/**
 * Parses a `sultanc --lang=en test` report.
 * Returns [{ name, passed, reason, details }] in report order; `details` are
 * the indented lines under a FAIL (location, captured output).
 */
function parseTestReport(text) {
    const results = [];
    let current = null;
    for (const line of text.split(/\r?\n/)) {
        let match = /^PASS (.+)$/.exec(line);
        if (match) {
            current = null;
            results.push({ name: match[1], passed: true, reason: '', details: [] });
            continue;
        }
        match = /^FAIL (.+?): (.+)$/.exec(line);
        if (match) {
            current = { name: match[1], passed: false, reason: match[2], details: [] };
            results.push(current);
            continue;
        }
        if (current && /^\s+\S/.test(line)) current.details.push(line.trim());
        else if (line.trim() !== '') current = null;
    }
    return results;
}

/**
 * `sultanc test` arguments for one file, optionally exactly one test
 * (`--test=<name>`: `doubles` does not run `doubles_wrong`). In a Supax
 * package the graph comes on standard input (`--package-graph=-`).
 */
function testArguments(home, file, name, packageGraph = false) {
    const args = ['--lang=en', 'test', compilerInput(home, file)];
    if (name) args.push(`--test=${name}`);
    if (packageGraph) args.push('--package-graph=-');
    return args;
}

/**
 * `sultanc test` arguments that build one test's program for a debugger
 * without running it (docs: "Debugging one test"): `--no-run -o PATH`, `-O0`
 * so the debugger can read its variables.
 */
function debugTestArguments(home, file, name, binary, packageGraph = false) {
    const args = ['--lang=en', 'test', compilerInput(home, file), `--test=${name}`, '-O0', '-o', binary, '--no-run'];
    if (packageGraph) args.push('--package-graph=-');
    return args;
}

/** The index `--no-run` printed for a test (`0 adding_works`), or -1. */
function testIndex(output, name) {
    for (const line of String(output).split(/\r?\n/)) {
        const match = /^(\d+) (.+)$/.exec(line.trim());
        if (match && match[2] === name) return Number(match[1]);
    }
    return -1;
}

/** Where a test's debug program goes: one stable path per file and test. */
function debugTestBinary(file, name) {
    const hash = crypto.createHash('sha1').update(`${file}\0${name}`).digest('hex').slice(0, 12);
    return path.join(os.tmpdir(), `sultanc-test-${hash}${process.platform === 'win32' ? '.exe' : ''}`);
}

/** The package graph for a file in a Supax package (from the server), else null. */
async function packageGraph(client, uri) {
    if (!client || !client.isRunning?.()) return null;
    try {
        const reply = await client.sendRequest('sultanc/packageGraph', { textDocument: { uri: uri.toString() } });
        return reply && typeof reply.graph === 'string' ? reply.graph : null;
    } catch {
        return null;
    }
}

class SultanCTests {
    constructor(context, getClient, getHome) {
        this.getClient = getClient;
        this.getHome = getHome;
        this.controller = vscode.tests.createTestController('sultanc', 'SultanC');
        // The last result of each test id ('passed' / 'failed: …'), for tests.
        this.results = new Map();
        context.subscriptions.push(this.controller);
        this.controller.resolveHandler = async (item) => {
            if (!item) {
                for (const document of vscode.workspace.textDocuments) await this.refresh(document);
            }
        };
        this.controller.refreshHandler = async () => {
            for (const document of vscode.workspace.textDocuments) await this.refresh(document);
        };
        this.controller.createRunProfile('Run', vscode.TestRunProfileKind.Run,
            (request, token) => this.run(request, token), true);
        this.controller.createRunProfile('Debug', vscode.TestRunProfileKind.Debug,
            (request, token) => this.debugRun(request, token), true);
        const refresh = (document) => { this.refresh(document); };
        context.subscriptions.push(
            vscode.workspace.onDidOpenTextDocument(refresh),
            vscode.workspace.onDidSaveTextDocument(refresh),
            vscode.workspace.onDidCloseTextDocument((document) => this.controller.items.delete(document.uri.toString())),
        );
    }

    /** Asks the server for a document's tests and mirrors them as test items. */
    async refresh(document) {
        if (document.languageId !== 'sultanc' || document.uri.scheme !== 'file') return;
        const client = this.getClient();
        if (!client || !client.isRunning?.()) return;
        let tests;
        try {
            tests = await client.sendRequest('sultanc/tests', { textDocument: { uri: document.uri.toString() } });
        } catch {
            return;
        }
        const key = document.uri.toString();
        if (!Array.isArray(tests) || tests.length === 0) {
            this.controller.items.delete(key);
            return;
        }
        const file = this.controller.createTestItem(key, vscode.workspace.asRelativePath(document.uri), document.uri);
        for (const test of tests) {
            const item = this.controller.createTestItem(`${key}#${test.name}`, test.name, document.uri);
            item.range = new vscode.Range(test.range.start.line, test.range.start.character,
                test.range.end.line, test.range.end.character);
            if (!test.runnable) item.error = 'This test cannot run: see its diagnostic.';
            file.children.add(item);
        }
        this.controller.items.add(file);
    }

    /**
     * Runs one test by its file uri and name: the server's "▶︎ Run Test" code
     * lens (`sultanc.runTest`). The result shows in Test Results as a run from
     * the Test Explorer does.
     */
    async runTest(uri, name) {
        const id = `${uri}#${name}`;
        let file = this.controller.items.get(uri);
        if (!file?.children.get(id)) {
            const document = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri);
            if (document) await this.refresh(document);
            file = this.controller.items.get(uri);
        }
        const item = file?.children.get(id);
        if (!item) {
            vscode.window.showWarningMessage(`SultanC: test ${name} was not found.`);
            return;
        }
        const source = new vscode.CancellationTokenSource();
        try {
            await this.run(new vscode.TestRunRequest([item]), source.token);
        } finally {
            source.dispose();
        }
    }

    /**
     * Debugs one test: builds its program with `--no-run`, then starts the
     * debugger on `PROGRAM INDEX`, which runs that test alone. The server's
     * "Debug" code lens and the Test Explorer's Debug profile come here.
     * Returns the debug session's end (true when it started).
     */
    async debugTest(uri, name) {
        const home = this.getHome();
        const compiler = compilerPath(home);
        if (!home || !compiler) {
            vscode.window.showErrorMessage('SultanC: compiler not found. Build the compiler (build/sultanc) or set "sultanc.compiler.path".');
            return false;
        }
        await vscode.workspace.saveAll(false);
        const fileUri = vscode.Uri.parse(uri);
        const file = fileUri.fsPath;
        const binary = debugTestBinary(file, name);
        const graph = await packageGraph(this.getClient(), fileUri);
        const args = debugTestArguments(home, file, name, binary, graph !== null);
        const built = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: `SultanC: building test ${name}` },
            () => new Promise((resolve) => {
                const child = childProcess.execFile(compiler, args, { cwd: home, maxBuffer: 16 * 1024 * 1024 },
                    (error, stdout, stderr) => resolve({ stdout: stdout || '', stderr: stderr || '', code: error?.code ?? 0 }));
                child.stdin.end(graph !== null ? graph : undefined);
            }));
        const index = testIndex(built.stdout, name);
        if (built.code !== 0 || index < 0) {
            const output = (built.stdout + built.stderr).trim();
            vscode.window.showErrorMessage(`SultanC: the test ${name} could not be built for debugging.${output ? ` ${output.split('\n')[0]}` : ''}`);
            return false;
        }
        this.lastDebug = { binary, index, args };
        const folder = vscode.workspace.getWorkspaceFolder(fileUri);
        return vscode.debug.startDebugging(folder, {
            type: DEBUG_TYPE,
            request: 'launch',
            name: `Debug test ${name}`,
            program: binary,
            args: [String(index)],
            cwd: path.dirname(file),
        });
    }

    async debugRun(request, token) {
        const run = this.controller.createTestRun(request);
        const selected = this.selection(request).filter((pair) => pair.name);
        const first = selected[0];
        if (!first) {
            run.appendOutput('SultanC: choose one test to debug.\r\n');
            run.end();
            return;
        }
        run.started(first.item);
        const started = await this.debugTest(first.file.uri.toString(), first.name);
        if (!started) {
            run.errored(first.item, new vscode.TestMessage('The test could not be built for debugging: see the message.'));
            run.end();
            return;
        }
        // The run lasts as long as the debug session.
        await new Promise((resolve) => {
            const done = vscode.debug.onDidTerminateDebugSession(() => { done.dispose(); resolve(); });
            token.onCancellationRequested(() => { vscode.debug.stopDebugging(); });
        });
        run.end();
    }

    /** The (file item, test name or null) pairs a run request covers. */
    selection(request) {
        const pairs = [];
        const add = (item) => {
            if (request.exclude?.includes(item)) return;
            if (item.parent) pairs.push({ file: item.parent, name: item.label, item });
            else pairs.push({ file: item, name: null, item });
        };
        if (request.include) request.include.forEach(add);
        else this.controller.items.forEach(add);
        return pairs;
    }

    async run(request, token) {
        const run = this.controller.createTestRun(request);
        const home = this.getHome();
        const compiler = compilerPath(home);
        if (!home || !compiler) {
            run.appendOutput('SultanC: compiler not found. Build the compiler (build/sultanc) or set "sultanc.compiler.path".\r\n');
            run.end();
            return;
        }
        await vscode.workspace.saveAll(false);
        for (const { file, name, item } of this.selection(request)) {
            if (token.isCancellationRequested) break;
            const tests = [];
            if (name) tests.push(item);
            else file.children.forEach((child) => tests.push(child));
            tests.forEach((test) => run.started(test));
            const started = Date.now();
            const graph = await packageGraph(this.getClient(), file.uri);
            const args = testArguments(home, file.uri.fsPath, name, graph !== null);
            const report = await new Promise((resolve) => {
                const child = childProcess.execFile(compiler, args, { cwd: home, maxBuffer: 64 * 1024 * 1024 },
                    (error, stdout, stderr) => resolve({ stdout: stdout || '', stderr: stderr || '', code: error?.code ?? 0 }));
                child.stdin.end(graph !== null ? graph : undefined);
                token.onCancellationRequested(() => child.kill());
            });
            run.appendOutput(`$ sultanc ${args.join(' ')}\r\n${(report.stdout + report.stderr).replace(/\r?\n/g, '\r\n')}`);
            const results = parseTestReport(report.stdout);
            const elapsed = Date.now() - started;
            for (const test of tests) {
                const result = results.find((r) => r.name === test.label);
                if (!result) {
                    // Exit status 2-4: the tests could not be built (the diagnostics say why).
                    const message = report.code >= 2 ? 'The tests could not be built: see the output.' : 'Not run.';
                    run.errored(test, new vscode.TestMessage(message), elapsed);
                    this.results.set(test.id, `errored: ${message}`);
                } else if (result.passed) {
                    run.passed(test, elapsed);
                    this.results.set(test.id, 'passed');
                } else {
                    const text = [result.reason, ...result.details].join('\n');
                    run.failed(test, new vscode.TestMessage(text), elapsed);
                    this.results.set(test.id, `failed: ${text}`);
                }
            }
        }
        run.end();
    }
}

function registerTesting(context, getClient, getHome) {
    return new SultanCTests(context, getClient, getHome);
}

module.exports = { registerTesting, parseTestReport, testArguments, debugTestArguments, testIndex, debugTestBinary };
