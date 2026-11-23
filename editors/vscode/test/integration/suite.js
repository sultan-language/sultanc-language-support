'use strict';
// Runs inside the VS Code extension host. Uses VS Code's own provider commands,
// so it exercises the full path: VS Code -> vscode-languageclient -> sultanc-analyzer.
const assert = require('assert');
const path = require('path');
const vscode = require('vscode');

const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function check(name, fn) {
    try {
        await fn();
        results.push(`ok   ${name}`);
    } catch (error) {
        results.push(`FAIL ${name}: ${error.message}`);
    }
}

function positionOf(document, needle, offset = 0, nth = 0) {
    const text = document.getText();
    let index = -1;
    for (let i = 0; i <= nth; i++) index = text.indexOf(needle, index + 1);
    if (index < 0) throw new Error(`not found: ${needle}`);
    return document.positionAt(index + offset);
}

function hoverText(hovers) {
    return (hovers || []).flatMap((h) => h.contents).map((c) => (typeof c === 'string' ? c : c.value)).join('\n');
}

async function until(fn, timeoutMs = 30000) {
    const start = Date.now();
    let last;
    while (Date.now() - start < timeoutMs) {
        try { last = await fn(); if (last) return last; } catch (_) { /* retry */ }
        await new Promise((r) => setTimeout(r, 250));
    }
    return last;
}

async function run() {
    const folder = vscode.workspace.workspaceFolders[0].uri;
    const en = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder, 'sample_en.sn'));
    const ar = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder, 'sample_ar.sn'));
    await vscode.window.showTextDocument(en);
    assert.strictEqual(en.languageId, 'sultanc');

    const ext = vscode.extensions.getExtension('sultanc.sultanc');
    await ext.activate();

    await check('hover shows signature, docs and English types', async () => {
        const text = await until(async () => hoverText(await vscode.commands.executeCommand(
            'vscode.executeHoverProvider', en.uri, positionOf(en, 'area(Shape', 1))));
        assert.match(text, /def area\(shape: Shape\): int/);
        assert.match(text, /Area of a shape\./);
        assert.match(text, /`fn\(Shape\): int`/);
    });

    await check('hover on record shows its fields', async () => {
        const text = hoverText(await vscode.commands.executeCommand(
            'vscode.executeHoverProvider', en.uri, positionOf(en, 'Point = {', 1)));
        assert.match(text, /type Point = \{ x: int, y: int \};/);
    });

    await check('Arabic file hover uses Arabic labels and types', async () => {
        const text = await until(async () => hoverText(await vscode.commands.executeCommand(
            'vscode.executeHoverProvider', ar.uri, positionOf(ar, 'الأكبر(الأعداد', 1))));
        assert.match(text, /\*\*الصنف:\*\* دالة/);
        assert.match(text, /دالة\(عدد, عدد\): عدد/);
    });

    await check('completion keeps spelling and offers keywords', async () => {
        const list = await vscode.commands.executeCommand(
            'vscode.executeCompletionItemProvider', ar.uri, positionOf(ar, 'اطبع_سطر('));
        const labels = list.items.map((i) => (typeof i.label === 'string' ? i.label : i.label.label));
        assert.ok(labels.includes('الأعداد'), labels.slice(0, 10).join(','));
        assert.ok(labels.includes('أرجع'), 'Arabic keyword missing');
    });

    await check('signature help names parameters', async () => {
        const help = await vscode.commands.executeCommand(
            'vscode.executeSignatureHelpProvider', en.uri, positionOf(en, 'total, 2', 7), ',');
        assert.strictEqual(help.signatures[0].label, 'def scale(value: int, factor: int): int');
        assert.strictEqual(help.activeParameter, 1);
    });

    await check('definition and references', async () => {
        const defs = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', en.uri, positionOf(en, 'area(Shape', 1));
        assert.strictEqual((defs[0].range || defs[0].targetRange).start.line, 12);
        const refs = await vscode.commands.executeCommand('vscode.executeReferenceProvider', en.uri, positionOf(en, 'scale(value', 1));
        assert.strictEqual(refs.length, 2);
    });

    await check('document symbols and semantic tokens', async () => {
        const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', en.uri);
        const names = symbols.map((s) => s.name);
        for (const n of ['Point', 'Shape', 'area', 'scale', 'main']) assert.ok(names.includes(n), n);
        const tokens = await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokens', en.uri);
        assert.ok(tokens && tokens.data.length > 0);
    });

    await check('folding ranges, selection ranges, import links', async () => {
        const folds = await vscode.commands.executeCommand('vscode.executeFoldingRangeProvider', en.uri);
        assert.ok(folds.some((f) => f.start === 12 && f.end === 15), JSON.stringify(folds));
        const selections = await vscode.commands.executeCommand('vscode.executeSelectionRangeProvider', en.uri, [positionOf(en, 'factor;', 2)]);
        assert.ok(selections[0].parent, 'expected nested selection');
        const links = await vscode.commands.executeCommand('vscode.executeLinkProvider', en.uri);
        assert.ok(links.some((l) => l.target && l.target.path.endsWith('/library/std/io/println.sn')));
    });

    await check('diagnostics on a syntax error, completion still works', async () => {
        const editor = await vscode.window.showTextDocument(en);
        const position = positionOf(en, 'return 0;');
        await editor.edit((b) => b.insert(position, 'let cx: int = corner.\n    '));
        const diags = await until(() => {
            const items = vscode.languages.getDiagnostics(en.uri);
            return items.length ? items : null;
        });
        assert.ok(diags && diags.length > 0, 'no diagnostics');
        assert.strictEqual(diags[0].source, 'SultanC');
        const list = await vscode.commands.executeCommand(
            'vscode.executeCompletionItemProvider', en.uri, positionOf(en, 'corner.\n', 7), '.');
        const labels = list.items.map((i) => (typeof i.label === 'string' ? i.label : i.label.label));
        assert.deepStrictEqual(labels.sort(), ['x', 'y']);
        await vscode.commands.executeCommand('workbench.action.files.revert');
    });

    await check('Cmd+Click on an import opens the module', async () => {
        const defs = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', en.uri, positionOf(en, 'std.io.println', 3));
        const target = defs[0].uri || defs[0].targetUri;
        assert.ok(target.path.endsWith('/library/std/io/println.sn'), target.path);
    });

    await check('Run / Debug CodeLens above the entry (server)', async () => {
        const lenses = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', en.uri);
        const entry = lenses.filter((l) => l.command && ['sultanc.runFile', 'sultanc.debugFile'].includes(l.command.command));
        assert.deepStrictEqual(entry.map((l) => `${l.command.title}|${l.command.command}`), ['▶︎ Run|sultanc.runFile', 'Debug|sultanc.debugFile']);
        assert.strictEqual(entry[0].command.arguments[0], en.uri.toString());
        assert.strictEqual(entry[0].range.start.line, en.getText().split('\n').findIndex((l) => /\bmain\(/.test(l)));
        const arLenses = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', ar.uri);
        assert.deepStrictEqual(arLenses.filter((l) => l.command && l.command.command.endsWith('File')).map((l) => l.command.title), ['▶︎ تشغيل', 'تصحيح الأخطاء']);
        // One provider: no second Run lens from the extension.
        assert.strictEqual(lenses.filter((l) => l.command && /Run/.test(l.command.title)).length, 1);
    });

    await check('check task runs the compiler (exit 0 on a valid file)', async () => {
        const tasks = await vscode.tasks.fetchTasks({ type: 'sultanc' });
        const task = tasks.find((t) => t.definition.command === 'check') || (() => { throw new Error('no check task'); })();
        const done = new Promise((resolve) => {
            const sub = vscode.tasks.onDidEndTaskProcess((e) => { if (e.execution.task.definition.command === 'check') { sub.dispose(); resolve(e.exitCode); } });
        });
        await vscode.tasks.executeTask(task);
        assert.strictEqual(await Promise.race([done, new Promise((r) => setTimeout(() => r('timeout'), 60000))]), 0);
    });

    await check('Explain quick action on a compiler diagnostic', async () => {
        const editor = await vscode.window.showTextDocument(en);
        await editor.edit((b) => b.insert(positionOf(en, 'return 0;'), 'let q: int = nothing_here;\n    '));
        const diags = await until(() => { const d = vscode.languages.getDiagnostics(en.uri).filter((x) => x.source === 'SultanC'); return d.length ? d : null; });
        const actions = await vscode.commands.executeCommand('vscode.executeCodeActionProvider', en.uri, diags[0].range);
        assert.ok(actions.some((a) => /^Explain SULTANC-/.test(a.title)), actions.map((a) => a.title).join(','));
        await vscode.commands.executeCommand('workbench.action.files.revert');
    });

    await check('snippets are contributed in both languages', async () => {
        const list = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', ar.uri, positionOf(ar, 'اطبع_سطر('));
        const kinds = list.items.filter((i) => i.kind === vscode.CompletionItemKind.Snippet).map((i) => (typeof i.label === 'string' ? i.label : i.label.label));
        assert.ok(kinds.includes('الرئيسية') || kinds.includes('عرف'), kinds.slice(0, 10).join(','));
    });

    await check('.sn files open in the RTL editor by default', async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        await vscode.commands.executeCommand('vscode.open', ar.uri);
        await new Promise((r) => setTimeout(r, 1500));
        const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
        assert.strictEqual(tab.input.viewType, 'sultanc.bidiEditor');
    });

    await check('inlay hints name parameters', async () => {
        const hints = await vscode.commands.executeCommand('vscode.executeInlayHintProvider', en.uri, new vscode.Range(0, 0, 40, 0));
        const labels = hints.map((h) => (typeof h.label === 'string' ? h.label : h.label.map((p) => p.value).join('')));
        assert.ok(labels.includes('value:') && labels.includes('factor:'), labels.join(','));
    });

    await check('Organize Imports and Extract Variable code actions', async () => {
        const text = 'import std.text.number;\nimport std.io.println;\nimport std.text.search;\n\ndef main(): int {\n    let n: int = 4;\n    println(int_to_text(n * 2));\n    return 0;\n}\n';
        const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'organize_probe.sn');
        await vscode.workspace.fs.writeFile(uri, Buffer.from(text));
        const probe = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(probe);
        await sleep(3000);
        const organize = await vscode.commands.executeCommand('vscode.executeCodeActionProvider', probe.uri,
            new vscode.Range(0, 0, 0, 0), vscode.CodeActionKind.SourceOrganizeImports.value);
        assert.ok(organize.length === 1, organize.map((a) => a.title).join(','));
        await vscode.workspace.applyEdit(organize[0].edit);
        assert.ok(probe.getText().startsWith('import std.io.println;\nimport std.text.number;\n\n'), probe.getText());
        await sleep(1500);
        const at = probe.positionAt(probe.getText().indexOf('n * 2'));
        const extract = await vscode.commands.executeCommand('vscode.executeCodeActionProvider', probe.uri,
            new vscode.Range(at, at.translate(0, 5)), vscode.CodeActionKind.RefactorExtract.value);
        assert.ok(extract.some((a) => a.title === 'Extract into variable'), extract.map((a) => a.title).join(','));
        await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
        await vscode.workspace.fs.delete(uri);
    });

    await check('go to type definition', async () => {
        const defs = await vscode.commands.executeCommand('vscode.executeTypeDefinitionProvider', en.uri, positionOf(en, 'corner))', 1));
        assert.strictEqual((defs[0].range || defs[0].targetRange).start.line, 4);
    });

    await check('references CodeLens on declarations', async () => {
        const lenses = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', en.uri, 100);
        const titles = lenses.map((l) => l.command && l.command.title).filter(Boolean);
        assert.ok(titles.some((t) => /^\d+ references?$/.test(t)), titles.join(','));
        // One references lens per declaration (the extension no longer adds its own).
        const ranges = lenses.filter((l) => l.command && /references?$/.test(l.command.title)).map((l) => `${l.range.start.line}:${l.range.start.character}`);
        assert.strictEqual(new Set(ranges).size, ranges.length, ranges.join(','));
    });

    await check('keyword hover shows both spellings', async () => {
        const text = hoverText(await vscode.commands.executeCommand('vscode.executeHoverProvider', en.uri, positionOf(en, 'return value', 1)));
        assert.match(text, /أرجع/);
    });

    await check('Test Explorer: tests from the compiler, run with sultanc test', async () => {
        const text = 'import std.debug.assert;\nimport std.error.failure;\n\n@@test\ndef doubles(): void {\n    assert(2 * 2 == 4);\n}\n\n@@test\ndef wrong(): result int, Error {\n    return result.err(error_new("2 * 2 is not 5"));\n}\n\ndef main(): int { return 0; }\n';
        const uri = vscode.Uri.joinPath(folder, 'tests_probe.sn');
        await vscode.workspace.fs.writeFile(uri, Buffer.from(text));
        const probe = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(probe);
        const tests = ext.exports.tests;
        const file = await until(async () => {
            await tests.refresh(probe);
            const item = tests.controller.items.get(uri.toString());
            return item && item.children.size === 2 ? item : null;
        }, 20000);
        assert.ok(file, 'tests were not discovered');
        const ids = [];
        file.children.forEach((child) => ids.push(`${child.label}@${child.range.start.line}`));
        assert.deepStrictEqual(ids.sort(), ['doubles@4', 'wrong@9']);
        const source = new vscode.CancellationTokenSource();
        await tests.run(new vscode.TestRunRequest([file]), source.token);
        assert.strictEqual(tests.results.get(`${uri.toString()}#doubles`), 'passed');
        assert.match(tests.results.get(`${uri.toString()}#wrong`), /^failed: returned an error\n--> .*tests_probe\.sn:10:5\n2 \* 2 is not 5$/);
        // One test runs alone (`--test=<name>`, 35b9d86).
        tests.results.clear();
        await tests.run(new vscode.TestRunRequest([file.children.get(`${uri.toString()}#doubles`)]), source.token);
        assert.deepStrictEqual([...tests.results.keys()], [`${uri.toString()}#doubles`]);
        // The server's "▶︎ Run Test" lens runs the same test through its command.
        const lenses = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', uri);
        const run = (lenses || []).filter((l) => l.command && l.command.title === '▶︎ Run Test');
        assert.deepStrictEqual(run.map((l) => `${l.command.arguments[1]}@${l.range.start.line}`), ['doubles@4', 'wrong@9']);
        tests.results.clear();
        await vscode.commands.executeCommand(run[1].command.command, ...run[1].command.arguments);
        assert.deepStrictEqual([...tests.results.keys()], [`${uri.toString()}#wrong`]);
        assert.match(tests.results.get(`${uri.toString()}#wrong`), /^failed: returned an error/);
        await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
        await vscode.workspace.fs.delete(uri);
    });

    await check('renaming a file updates its imports', async () => {
        const from = vscode.Uri.joinPath(folder, 'helper.sn');
        const to = vscode.Uri.joinPath(folder, 'support.sn');
        const edit = new vscode.WorkspaceEdit();
        edit.renameFile(from, to);
        assert.ok(await vscode.workspace.applyEdit(edit));
        const user = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder, 'uses_helper.sn'));
        const text = await until(() => (user.getText().includes('"support.sn"') ? user.getText() : null), 10000);
        assert.ok(text && text.includes('import "support.sn";'), user.getText());
    });

    for (const debuggerKind of ['gdb', 'lldb']) await check(`debugging a .sn file stops at a breakpoint (${debuggerKind})`, async () => {
        const uri = vscode.Uri.joinPath(folder, 'debug_me.sn');
        const events = [];
        const tracker = vscode.debug.registerDebugAdapterTrackerFactory('sultanc', {
            createDebugAdapterTracker: () => ({
                onDidSendMessage: (m) => { if (m.type === 'event') events.push(m); if (process.env.SULTANC_E2E_TRACE) console.log('DAP <', JSON.stringify(m).slice(0, 300)); },
                onWillReceiveMessage: (m) => { if (process.env.SULTANC_E2E_TRACE) console.log('DAP >', JSON.stringify(m).slice(0, 300)); },
                onError: (e) => console.log('DAP error', e && e.message),
                onExit: (code, signal) => { if (process.env.SULTANC_E2E_TRACE) console.log('DAP exit', code, signal); },
            }),
        });
        // Debug builds are -O0, so ضاعف is not inlined: its line 3 binds and
        // its local keeps its value, and so does ق at line 8.
        const inner = new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Position(2, 4)));
        const bp = new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Position(7, 4)));
        vscode.debug.addBreakpoints([inner, bp]);
        const locals = async (session, frameId) => {
            const { scopes } = await session.customRequest('scopes', { frameId });
            const values = {};
            for (const scope of scopes) {
                const { variables } = await session.customRequest('variables', { variablesReference: scope.variablesReference });
                for (const v of variables) values[v.name] = v.value;
            }
            return values;
        };
        try {
            const started = await vscode.debug.startDebugging(vscode.workspace.workspaceFolders[0],
                { type: 'sultanc', request: 'launch', name: 'e2e', program: uri.fsPath, debugger: debuggerKind });
            assert.ok(started, 'session did not start');
            const session = () => vscode.debug.activeDebugSession;
            const stops = () => events.filter((e) => e.event === 'stopped');
            let stopped = await until(() => stops()[0], 60000);
            assert.ok(stopped, 'no stopped event: ' + JSON.stringify(events.map((e) => e.event)));
            assert.strictEqual(stopped.body.reason, 'breakpoint');
            let trace = await session().customRequest('stackTrace', { threadId: stopped.body.threadId, startFrame: 0, levels: 2 });
            let top = trace.stackFrames[0];
            assert.deepStrictEqual([top.name, top.line], ['ضاعف', 3], JSON.stringify(trace.stackFrames));
            assert.strictEqual(trace.stackFrames[1].name, 'الرئيسية', JSON.stringify(trace.stackFrames));
            const inside = await locals(session(), top.id);
            assert.strictEqual(inside['ن'], '42', JSON.stringify(inside));
            assert.strictEqual(inside['س'], '21', JSON.stringify(inside));
            await session().customRequest('continue', { threadId: stopped.body.threadId });
            stopped = await until(() => stops()[1], 30000);
            assert.ok(stopped, 'no second stop');
            trace = await session().customRequest('stackTrace', { threadId: stopped.body.threadId, startFrame: 0, levels: 1 });
            top = trace.stackFrames[0];
            assert.strictEqual(top.line, 8, JSON.stringify(top));
            assert.ok(top.source && top.source.path.endsWith('debug_me.sn'), JSON.stringify(top.source));
            // DWARF names functions by their source names (e1d4bca), Arabic included.
            assert.strictEqual(top.name, 'الرئيسية', JSON.stringify(top));
            const outer = await locals(session(), top.id);
            assert.strictEqual(outer['ق'], '42', JSON.stringify(outer));
            await session().customRequest('continue', { threadId: stopped.body.threadId });
            const exited = await until(() => events.find((e) => e.event === 'exited' || e.event === 'terminated'), 30000);
            assert.ok(exited, 'program did not finish');
        } finally {
            vscode.debug.removeBreakpoints([inner, bp]);
            tracker.dispose();
            // The program has usually exited already; stopping a session that is
            // terminating rejects with "Canceled", which is not a failure.
            if (vscode.debug.activeDebugSession) await vscode.debug.stopDebugging().then(undefined, () => undefined);
        }
    });

    await check('Debug lens: builds one test with --no-run and stops at a breakpoint inside it', async () => {
        const uri = vscode.Uri.joinPath(folder, 'tests', 'debug_test.sn');
        const text = 'import std.debug.assert;\n\ndef double(x: int): int { return x * 2; }\n\n@@test\ndef doubles(): void {\n    let n: int = double(2);\n    assert(n == 4);\n}\n\ndef main(): int { return 0; }\n';
        await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
        const events = [];
        const tracker = vscode.debug.registerDebugAdapterTrackerFactory('sultanc', {
            createDebugAdapterTracker: () => ({ onDidSendMessage: (m) => { if (m.type === 'event') events.push(m); } }),
        });
        // Line 8, `assert(n == 4)`: n is 4 there.
        const bp = new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Position(7, 4)));
        vscode.debug.addBreakpoints([bp]);
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(document);
            const lens = await until(async () => {
                const lenses = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', uri);
                return (lenses || []).find((l) => l.command && l.command.title === 'Debug');
            }, 30000);
            assert.ok(lens, 'no Debug lens');
            assert.deepStrictEqual(lens.command.arguments, [uri.toString(), 'doubles']);
            const started = await vscode.commands.executeCommand(lens.command.command, ...lens.command.arguments);
            assert.ok(started, 'debug session did not start');
            const stopped = await until(() => events.find((e) => e.event === 'stopped'), 60000);
            assert.ok(stopped, 'no stop: ' + JSON.stringify(events.map((e) => e.event)));
            const session = vscode.debug.activeDebugSession;
            const trace = await session.customRequest('stackTrace', { threadId: stopped.body.threadId, startFrame: 0, levels: 1 });
            const top = trace.stackFrames[0];
            assert.deepStrictEqual([top.name, top.line], ['doubles', 8], JSON.stringify(trace.stackFrames));
            const { scopes } = await session.customRequest('scopes', { frameId: top.id });
            const values = {};
            for (const scope of scopes) {
                const { variables } = await session.customRequest('variables', { variablesReference: scope.variablesReference });
                for (const v of variables) values[v.name] = v.value;
            }
            assert.strictEqual(values.n, '4', JSON.stringify(values));
            await session.customRequest('continue', { threadId: stopped.body.threadId });
            const exited = await until(() => events.find((e) => e.event === 'exited' || e.event === 'terminated'), 30000);
            assert.ok(exited, 'the test did not finish');
            const code = events.find((e) => e.event === 'exited');
            if (code) assert.strictEqual(code.body.exitCode, 0, 'the test failed under the debugger');
        } finally {
            vscode.debug.removeBreakpoints([bp]);
            tracker.dispose();
            if (vscode.debug.activeDebugSession) await vscode.debug.stopDebugging().then(undefined, () => undefined);
            await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
            await vscode.workspace.fs.delete(uri);
        }
    });

    await check('check on save: diagnostics of an unopened file, once when opened', async () => {
        // flycheck/main.sn imports flycheck/broken.sn, which is not open: its
        // error comes from the server's `sultanc check` run.
        const broken = vscode.Uri.joinPath(folder, 'flycheck', 'broken.sn');
        const found = await until(() => {
            const d = vscode.languages.getDiagnostics(broken);
            return d.length ? d : null;
        }, 60000);
        assert.ok(found, 'no check diagnostics for flycheck/broken.sn');
        const summary = (d) => d.map((x) => `${x.range.start.line}:${x.range.start.character}-${x.range.end.line}:${x.range.end.character} ${x.code} ${x.message}`);
        const expected = ['1:11-1:32 SULTANC-NAME-UNKNOWN unknown name: `not_declared_anywhere` — The required name was not found during resolution.'];
        assert.deepStrictEqual(summary(found), expected);
        // Opened, the live analysis owns it: one copy, not two.
        const document = await vscode.workspace.openTextDocument(broken);
        await vscode.window.showTextDocument(document);
        await sleep(3000);
        assert.deepStrictEqual(summary(vscode.languages.getDiagnostics(broken)), expected);
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        await vscode.window.showTextDocument(en);
    });

    if (process.env.SULTANC_E2E_BUNDLED) await check('the bundled server and its library are used', async () => {
        const server = ext.exports.server();
        assert.ok(server.bundled, server.path);
        assert.strictEqual(ext.exports.home(), path.join(ext.extensionPath, 'sultanc'));
    });

    await check('commands are registered', async () => {
        const all = await vscode.commands.getCommands(true);
        for (const id of ['sultanc.restartServer', 'sultanc.showOutput', 'sultanc.showServerInfo', 'sultanc.openRtlEditor']) {
            assert.ok(all.includes(id), id);
        }
    });

    console.log('\n' + results.join('\n') + '\n');
    const failed = results.filter((r) => r.startsWith('FAIL'));
    if (failed.length) throw new Error(`${failed.length} integration check(s) failed`);
}

module.exports = { run };
