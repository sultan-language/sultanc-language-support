'use strict';

const path = require('path');
const vscode = require('vscode');
const { LanguageClient, State, RevealOutputChannelOn } = require('vscode-languageclient/node');
const { findServer, findHome } = require('./serverLocator');
const { VIEW_TYPE, SultanCBidiEditorProvider } = require('./rtlEditorProvider');
const { registerTooling, compilerPath } = require('./tooling');
const { registerTesting } = require('./testing');
const { registerDebug } = require('./debug');
const { registerFeatures } = require('./features');

const CLIENT_ID = 'sultanc';
const CLIENT_NAME = 'SultanC Language Server';

/**
 * The RTL webview editor talks to the server through this adapter: requests go
 * through the shared LanguageClient, and the raw LSP diagnostics the client
 * receives are kept for the webview's own diagnostic overlay. VS Code's text
 * document sync covers both editors, so `didOpen` is a no-op here.
 */
class LanguageServiceAdapter {
    constructor(output) {
        this.client = null;
        this.output = output;
        this.raw = new Map();
        this.emitter = new vscode.EventEmitter();
    }

    get started() {
        return Boolean(this.client) && this.client.state === State.Running;
    }

    get capabilities() {
        return this.client?.initializeResult?.capabilities || {};
    }

    request(method, params) {
        if (!this.started) return Promise.reject(new Error('SultanC language server is not running.'));
        const request = this.client.sendRequest(method, params);
        return busy ? busy.track(request) : request;
    }

    didOpen() { /* synchronised by the LanguageClient */ }

    onDiagnostics(listener) {
        return this.emitter.event(listener);
    }

    getRawDiagnostics(uri) {
        return this.raw.get(uri.toString()) || [];
    }

    recordDiagnostics(uri, raw) {
        this.raw.set(uri.toString(), raw);
        this.emitter.fire({ uri, raw });
    }
}

let client = null;
let adapter = null;
let editorProvider = null;
let statusItem = null;
let output = null;
let busy = null;
let tests = null;

function locateServer(folders, config) {
    return findServer({ configuredPath: config.get('server.path', ''), workspaceFolders: folders });
}

// SultanC home for compiler commands (run/check/build/explain), resolved like
// the server's working directory even when the server is not running.
function resolveHome() {
    const folders = workspaceFolderPaths();
    const config = configuration();
    const server = locateServer(folders, config);
    return findHome({ configuredHome: config.get('home', ''), serverPath: server.path, workspaceFolders: folders });
}

function configuration() {
    return vscode.workspace.getConfiguration('sultanc');
}

function workspaceFolderPaths() {
    return (vscode.workspace.workspaceFolders || [])
        .filter((folder) => folder.uri.scheme === 'file')
        .map((folder) => folder.uri.fsPath);
}

function setStatus(state, detail) {
    if (!statusItem) return;
    const icons = { starting: '$(sync~spin)', running: '$(check)', stopped: '$(circle-slash)', error: '$(error)' };
    statusItem.text = `${icons[state] || ''} SultanC`;
    statusItem.tooltip = new vscode.MarkdownString(detail || 'SultanC language server');
    statusItem.backgroundColor = state === 'error' ? new vscode.ThemeColor('statusBarItem.errorBackground') : undefined;
    statusItem.show();
}

async function startClient(context) {
    const folders = workspaceFolderPaths();
    const config = configuration();
    const server = locateServer(folders, config);
    if (!server.path) {
        setStatus('error', 'SultanC language server not found — hover, completion and navigation are off. Install sultanc-analyzer into the SultanC toolchain or set `sultanc.server.path`.');
        output.appendLine('[client] server not found; searched:');
        for (const candidate of server.candidates) output.appendLine(`  ${candidate}`);
        // As other language extensions do when their toolchain is missing:
        // say what is missing and how to install it; never download binaries
        // that would not match the user's compiler.
        const choice = await vscode.window.showErrorMessage(
            'SultanC: the language server (sultanc-analyzer) is not installed. Install it into your SultanC toolchain (~/.supax), next to the compiler it matches, or set "sultanc.server.path".',
            'How to Install', 'Set Path', 'Show Searched Paths'
        );
        if (choice === 'How to Install') {
            vscode.env.openExternal(vscode.Uri.parse('https://github.com/sultan-language/sultanc-analyzer#install'));
        } else if (choice === 'Set Path') {
            vscode.commands.executeCommand('workbench.action.openSettings', 'sultanc.server.path');
        } else if (choice === 'Show Searched Paths') {
            output.show(true);
        }
        return;
    }
    const home = findHome({ configuredHome: config.get('home', ''), serverPath: server.path, workspaceFolders: folders });
    // The compiler resolves std under library/ relative to its working
    // directory, so the server runs from the SultanC home; documents and
    // workspace folders reach it as absolute URIs.
    const cwd = home || folders[0] || path.dirname(server.path);
    const env = { ...process.env };
    // The server runs `supax metadata` for a folder holding Supax.toml.
    const supax = config.get('supax.path', '').trim();
    if (supax) env.SUPAX = supax;

    const serverOptions = {
        run: { command: server.path, options: { env, cwd } },
        debug: { command: server.path, options: { env, cwd } },
    };
    const clientOptions = {
        documentSelector: [
            { scheme: 'file', language: 'sultanc' },
            { scheme: 'untitled', language: 'sultanc' },
        ],
        // Check on save (as rust-analyzer's `cargo check`): the server runs
        // `sultanc check` and shows its diagnostics for unopened files.
        initializationOptions: {
            language: config.get('diagnostics.language', 'auto'),
            checkOnSave: config.get('checkOnSave', true),
            checkEntries: config.get('check.entries', []),
            compilerPath: compilerPath(home) || '',
            lensRun: config.get('lens.run', true),
            lensReferences: config.get('lens.references', false),
            // VS Code renders hover Markdown as HTML: Arabic lines are
            // isolated right to left by the server (U+2067 … U+2069).
            bidiIsolates: true,
            closingBraceHintsMinLines: config.get('inlayHints.closingBraceHints.enable', true)
                ? Math.max(1, config.get('inlayHints.closingBraceHints.minLines', 25)) : 0,
        },
        // Supax.toml and Supax.lock changes re-run `supax metadata` in the server.
        synchronize: { fileEvents: [
            vscode.workspace.createFileSystemWatcher('**/*.sn'),
            vscode.workspace.createFileSystemWatcher('**/Supax.{toml,lock}'),
        ] },
        outputChannel: output,
        revealOutputChannelOn: RevealOutputChannelOn.Never,
        middleware: busy ? busy.middleware() : {},
    };

    client = new LanguageClient(CLIENT_ID, CLIENT_NAME, serverOptions, clientOptions);
    adapter.client = client;
    client.onDidChangeState((event) => {
        if (event.newState === State.Running) {
            const info = client.initializeResult?.serverInfo;
            setStatus('running', [
                `**${info?.name || CLIENT_NAME}** ${info?.version || ''}`,
                '',
                `Server: \`${server.path}\``,
                `SultanC home: \`${home || 'not found — std imports will not resolve'}\``,
            ].join('\n\n'));
            editorProvider?.setLanguageService(adapter);
            for (const document of vscode.workspace.textDocuments) tests?.refresh(document);
        } else if (event.newState === State.Starting) {
            setStatus('starting', 'Starting the SultanC language server…');
        } else {
            setStatus('stopped', 'SultanC language server stopped.');
            editorProvider?.setLanguageService(adapter);
        }
    });

    setStatus('starting', 'Starting the SultanC language server…');
    output.appendLine(`[client] server: ${server.path}`);
    output.appendLine(`[client] SultanC home (server cwd): ${home || '(not found — std imports will not resolve)'}`);
    try {
        await client.start();
    } catch (error) {
        setStatus('error', `SultanC language server failed to start: ${error.message}`);
        output.appendLine(`[client] start failed: ${error.stack || error.message}`);
    }
    context.subscriptions.push({ dispose: () => client?.stop() });
}

async function stopClient() {
    if (!client) return;
    const current = client;
    client = null;
    adapter.client = null;
    try { await current.stop(); } catch (_) { /* already stopped */ }
}

async function restartClient(context) {
    await stopClient();
    await startClient(context);
}

async function showServerInfo() {
    const info = client?.initializeResult?.serverInfo;
    const caps = Object.keys(client?.initializeResult?.capabilities || {}).sort();
    if (!info) {
        vscode.window.showWarningMessage('SultanC language server is not running.');
        return;
    }
    output.appendLine(`[client] ${info.name} ${info.version || ''}`);
    output.appendLine(`[client] capabilities: ${caps.join(', ')}`);
    output.show(true);
    vscode.window.showInformationMessage(`${info.name} ${info.version || ''} — ${caps.length} capabilities`);
}

async function reopenActive(viewType) {
    const uri = vscode.window.activeTextEditor?.document.uri
        || vscode.window.tabGroups.activeTabGroup.activeTab?.input?.uri;
    if (!uri) return;
    await vscode.commands.executeCommand('vscode.openWith', uri, viewType);
}

async function activate(context) {
    output = vscode.window.createOutputChannel(CLIENT_NAME);
    adapter = new LanguageServiceAdapter(output);
    statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
    statusItem.command = 'sultanc.showCommands';
    context.subscriptions.push(output, statusItem);

    registerTooling(context, resolveHome);
    tests = registerTesting(context, () => client, resolveHome);
    registerDebug(context, resolveHome);
    ({ busy } = registerFeatures(context));
    editorProvider = new SultanCBidiEditorProvider(context, adapter);
    context.subscriptions.push(vscode.window.registerCustomEditorProvider(VIEW_TYPE, editorProvider, {
        webviewOptions: { enableFindWidget: true, retainContextWhenHidden: false },
        supportsMultipleEditorsPerDocument: true,
    }));

    // Mirror diagnostics into the RTL editor overlay from VS Code's collection.
    context.subscriptions.push(vscode.languages.onDidChangeDiagnostics((event) => {
        for (const uri of event.uris) {
            const raw = vscode.languages.getDiagnostics(uri)
                .filter((d) => d.source === 'SultanC')
                .map(toLspDiagnostic);
            adapter.recordDiagnostics(uri, raw);
        }
    }));

    const register = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
    register('sultanc.restartServer', () => restartClient(context));
    register('sultanc.showOutput', () => output.show(true));
    register('sultanc.showServerInfo', showServerInfo);
    register('sultanc.openRtlEditor', () => reopenActive(VIEW_TYPE));
    register('sultanc.openTextEditor', () => reopenActive('default'));
    // VS Code's own editor has no right-to-left layout, so the RTL editor is the
    // default for .sn; these set the user's standard editor association.
    const setDefaultEditor = async (viewType) => {
        const config = vscode.workspace.getConfiguration('workbench');
        const associations = { ...(config.get('editorAssociations') || {}) };
        associations['*.sn'] = viewType;
        await config.update('editorAssociations', associations, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(viewType === 'default'
            ? 'SultanC: .sn files now open in the text editor.'
            : 'SultanC: .sn files now open in the RTL editor.');
    };
    register('sultanc.useRtlEditorByDefault', () => setDefaultEditor(VIEW_TYPE));
    register('sultanc.useTextEditorByDefault', () => setDefaultEditor('default'));
    register('sultanc.showCommands', async () => {
        const pick = await vscode.window.showQuickPick([
            { label: '$(refresh) Restart Language Server', id: 'sultanc.restartServer' },
            { label: '$(output) Show Output', id: 'sultanc.showOutput' },
            { label: '$(info) Show Server Info', id: 'sultanc.showServerInfo' },
            { label: '$(book) Open in RTL Editor', id: 'sultanc.openRtlEditor' },
            { label: '$(file-code) Open in Text Editor', id: 'sultanc.openTextEditor' },
            { label: '$(settings) Default: RTL Editor', id: 'sultanc.useRtlEditorByDefault' },
            { label: '$(settings) Default: Text Editor', id: 'sultanc.useTextEditorByDefault' },
        ], { placeHolder: 'SultanC' });
        if (pick) vscode.commands.executeCommand(pick.id);
    });
    // The server's code lenses run these client commands (as rust-analyzer's).
    register('sultanc.runTest', (uri, name) => tests.runTest(uri, name));
    register('sultanc.debugTest', (uri, name) => tests.debugTest(uri, name));
    register('sultanc.showReferences', (uri, position, locations) => {
        const toPosition = (p) => new vscode.Position(p.line, p.character);
        return vscode.commands.executeCommand('editor.action.showReferences',
            vscode.Uri.parse(uri), toPosition(position),
            (locations || []).map((l) => new vscode.Location(vscode.Uri.parse(l.uri),
                new vscode.Range(toPosition(l.range.start), toPosition(l.range.end)))));
    });
    // Backwards-compatible id from 0.3.x.
    register('sultanc.restartLanguageServer', () => restartClient(context));

    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
        if (['sultanc.server.path', 'sultanc.home', 'sultanc.diagnostics.language', 'sultanc.supax.path',
            'sultanc.checkOnSave', 'sultanc.check.entries', 'sultanc.compiler.path',
            'sultanc.lens.run', 'sultanc.lens.references', 'sultanc.inlayHints.closingBraceHints'].some((key) => event.affectsConfiguration(key))) {
            restartClient(context);
        }
    }));

    await startClient(context);
    // For the integration tests: the Test Explorer controller and where the
    // server was found.
    return { tests, server: () => locateServer(workspaceFolderPaths(), configuration()), home: resolveHome };
}

function toLspDiagnostic(diagnostic) {
    const code = typeof diagnostic.code === 'object' ? diagnostic.code?.value : diagnostic.code;
    return {
        range: {
            start: { line: diagnostic.range.start.line, character: diagnostic.range.start.character },
            end: { line: diagnostic.range.end.line, character: diagnostic.range.end.character },
        },
        severity: diagnostic.severity + 1,
        code: code ?? null,
        source: diagnostic.source,
        message: diagnostic.message,
        relatedInformation: (diagnostic.relatedInformation || []).map((info) => ({
            location: {
                uri: info.location.uri.toString(),
                range: {
                    start: { line: info.location.range.start.line, character: info.location.range.start.character },
                    end: { line: info.location.range.end.line, character: info.location.range.end.character },
                },
            },
            message: info.message,
        })),
    };
}

async function deactivate() {
    await stopClient();
}

module.exports = { activate, deactivate, LanguageServiceAdapter, toLspDiagnostic };
