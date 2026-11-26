'use strict';

// Compiler-facing features, as mature language extensions provide them
// (rust-analyzer's Run lens and $rustc matcher, vscode-go's tasks):
//   - Run / Check / Build the current file as VS Code tasks with a problem matcher
//   - "▶ Run | ✓ Check" CodeLens above the program entry (main / الرئيسية)
//   - "Explain SULTANC-…" quick action backed by `sultanc explain`
// The compiler runs from the SultanC home, where it resolves library/.

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');

const TASK_TYPE = 'sultanc';

function isArabicDocument(document) {
    const text = document.getText();
    const arabic = (text.match(/[؀-ۿ]/g) || []).length;
    const latin = (text.match(/[A-Za-z]/g) || []).length;
    return arabic > latin;
}

/** Compiler executable: `sultanc.compiler.path`, else <home>/build/sultanc. */
/**
 * The compiler for Run / Check / Build / tests and the check on save:
 *   1. `sultanc.compiler.path`
 *   2. <home>/build/sultanc (a checkout)
 *   3. $SULTANC
 *   4. ~/.supax/bin/sultanc (Supax's tools/install.sh)
 *   5. sultanc on PATH
 */
function compilerPath(home, env = process.env, isFile = (p) => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } }) {
    const configured = vscode.workspace.getConfiguration('sultanc').get('compiler.path', '').trim();
    if (configured) return configured;
    const name = process.platform === 'win32' ? 'sultanc.exe' : 'sultanc';
    const candidates = [];
    if (home) candidates.push(path.join(home, 'build', name));
    if (env.SULTANC) candidates.push(env.SULTANC);
    candidates.push(path.join(os.homedir(), '.supax', 'bin', name));
    for (const dir of (env.PATH || '').split(path.delimiter)) if (dir) candidates.push(path.join(dir, name));
    return candidates.find(isFile) || null;
}

/** As `sultanc check` expects: relative to the home when inside it. */
function compilerInput(home, file) {
    const relative = path.relative(home, file);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : file;
}

function outputBinary(file) {
    const dir = path.join(os.tmpdir(), 'sultanc-run');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, path.basename(file, '.sn') + (process.platform === 'win32' ? '.exe' : ''));
}

function quote(value) {
    if (process.platform === 'win32') return `"${value.replace(/"/g, '\\"')}"`;
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

function makeTask(kind, file, home, compiler, scope) {
    const input = quote(compilerInput(home, file));
    const binary = quote(outputBinary(file));
    const sultanc = quote(compiler);
    let command;
    if (kind === 'check') command = `${sultanc} --lang=en check ${input}`;
    else if (kind === 'build') command = `${sultanc} --lang=en ${input} -o ${binary}`;
    else command = `${sultanc} --lang=en ${input} -o ${binary} && ${binary}`;
    const definition = { type: TASK_TYPE, command: kind, file };
    const label = `${kind} ${path.basename(file)}`;
    const task = new vscode.Task(definition, scope || vscode.TaskScope.Workspace, label, 'sultanc',
        new vscode.ShellExecution(command, { cwd: home }), ['$sultanc']);
    task.group = kind === 'build' ? vscode.TaskGroup.Build : kind === 'check' ? vscode.TaskGroup.Test : undefined;
    task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, clear: true, focus: kind === 'run' };
    return task;
}

class ExplainCodeActionProvider {
    provideCodeActions(document, range, context) {
        const seen = new Set();
        const actions = [];
        for (const diagnostic of context.diagnostics) {
            if (diagnostic.source !== 'SultanC') continue;
            const code = typeof diagnostic.code === 'object' ? diagnostic.code?.value : diagnostic.code;
            if (!code || seen.has(code)) continue;
            seen.add(code);
            const action = new vscode.CodeAction(`Explain ${code}`, vscode.CodeActionKind.QuickFix);
            action.diagnostics = [diagnostic];
            action.command = { command: 'sultanc.explain', title: `Explain ${code}`, arguments: [String(code), document.uri] };
            actions.push(action);
        }
        return actions;
    }
}

function registerTooling(context, getHome) {
    const subscriptions = context.subscriptions;

    const activeFile = (uri) => {
        const target = uri instanceof vscode.Uri ? uri : typeof uri === 'string' ? vscode.Uri.parse(uri) : vscode.window.activeTextEditor?.document.uri
            || vscode.window.tabGroups.activeTabGroup.activeTab?.input?.uri;
        if (!target || target.scheme !== 'file' || !target.fsPath.endsWith('.sn')) {
            vscode.window.showWarningMessage('SultanC: open a .sn file first.');
            return null;
        }
        return target;
    };

    const runKind = (kind) => async (uri) => {
        const target = activeFile(uri);
        if (!target) return;
        const home = getHome();
        const compiler = compilerPath(home);
        if (!home || !compiler) {
            vscode.window.showErrorMessage('SultanC: compiler not found. Build the compiler (build/sultanc) or set "sultanc.compiler.path" and "sultanc.home".');
            return;
        }
        await vscode.workspace.saveAll(false);
        await vscode.tasks.executeTask(makeTask(kind, target.fsPath, home, compiler));
    };

    subscriptions.push(vscode.commands.registerCommand('sultanc.runFile', runKind('run')));
    subscriptions.push(vscode.commands.registerCommand('sultanc.checkFile', runKind('check')));
    subscriptions.push(vscode.commands.registerCommand('sultanc.buildFile', runKind('build')));

    subscriptions.push(vscode.tasks.registerTaskProvider(TASK_TYPE, {
        provideTasks() {
            const document = vscode.window.activeTextEditor?.document;
            const home = getHome();
            const compiler = compilerPath(home);
            if (!document || document.languageId !== 'sultanc' || !home || !compiler) return [];
            return ['check', 'build', 'run'].map((kind) => makeTask(kind, document.uri.fsPath, home, compiler));
        },
        resolveTask(task) {
            const home = getHome();
            const compiler = compilerPath(home);
            const { command, file } = task.definition;
            if (!home || !compiler || !file || !['check', 'build', 'run'].includes(command)) return undefined;
            return makeTask(command, file, home, compiler, task.scope);
        },
    }));

    subscriptions.push(vscode.languages.registerCodeActionsProvider({ language: 'sultanc' }, new ExplainCodeActionProvider(), {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    }));

    subscriptions.push(vscode.commands.registerCommand('sultanc.explain', async (code, uri) => {
        let diagnosticCode = code;
        if (!diagnosticCode) {
            diagnosticCode = await vscode.window.showInputBox({ prompt: 'Diagnostic code', placeHolder: 'SULTANC-NAME-UNKNOWN' });
            if (!diagnosticCode) return;
        }
        const home = getHome();
        const compiler = compilerPath(home);
        if (!compiler) {
            vscode.window.showErrorMessage('SultanC: compiler not found (build/sultanc).');
            return;
        }
        let arabic = vscode.workspace.getConfiguration('sultanc').get('diagnostics.language', 'auto') === 'ar';
        if (vscode.workspace.getConfiguration('sultanc').get('diagnostics.language', 'auto') === 'auto' && uri) {
            const document = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
            if (document) arabic = isArabicDocument(document);
        }
        childProcess.execFile(compiler, [`--lang=${arabic ? 'ar' : 'en'}`, 'explain', diagnosticCode], { cwd: home }, async (error, stdout, stderr) => {
            const text = (stdout || stderr || (error ? error.message : '')).trim();
            const body = [`# ${diagnosticCode}`, '', text.split('\n').slice(text.startsWith(diagnosticCode) ? 1 : 0).join('\n').trim()].join('\n');
            const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: body + '\n' });
            await vscode.commands.executeCommand('markdown.showPreviewToSide', document.uri)
                .then(undefined, () => vscode.window.showTextDocument(document, vscode.ViewColumn.Beside));
        });
    }));
}

module.exports = { registerTooling, compilerInput, compilerPath, outputBinary };
