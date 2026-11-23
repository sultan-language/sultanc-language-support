'use strict';

const { wordStartAt: wordStartBefore, textHash } = require('../media/editorOperations.js');

const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { computeMinimalReplacement } = require('./textDiff');
const { CONFIGURATION_ROOT, readEditorSettings } = require('./settings');
const { buildWebviewHtml } = require('./webviewHtml');
const { fromLspRange, fromLspWorkspaceEdit } = require('./lspConvert');
const {
    hoverText,
    completionItems,
    signatureText,
    locations,
    flattenDocumentSymbols,
    diagnosticsForWebview,
    symbolChainAt,
} = require('./customLspBridge');

const VIEW_TYPE = 'sultanc.bidiEditor';

class SultanCBidiEditorProvider {
    constructor(context, languageService = null) {
        this.context = context;
        this.languageService = null;
        this.documentQueues = new Map();
        this.panels = new Map();
        this.pendingReveal = new Map();
        this.activePanel = null;
        this.diagnosticsSubscription = null;
        this.syntaxSurface = JSON.parse(
            fs.readFileSync(path.join(context.extensionPath, 'resources', 'syntax-surface.json'), 'utf8')
        );
        this.setLanguageService(languageService);
    }

    setLanguageService(languageService) {
        this.diagnosticsSubscription?.dispose();
        this.diagnosticsSubscription = null;
        this.languageService = languageService;
        if (languageService?.onDiagnostics) {
            this.diagnosticsSubscription = languageService.onDiagnostics((event) => {
                const panels = this.panels.get(event.uri.toString());
                if (!panels?.size) return;
                const message = { type: 'diagnostics', diagnostics: diagnosticsForWebview(event.raw) };
                for (const panel of panels) panel.webview.postMessage(message);
            });
        }
        for (const [uri, panels] of this.panels) {
            const ready = Boolean(languageService?.started);
            for (const panel of panels) {
                panel.webview.postMessage({ type: 'lspStatus', ready });
                if (ready) {
                    const document = vscode.workspace.textDocuments.find((item) => item.uri.toString() === uri);
                    if (document) {
                        try { languageService.didOpen(document); } catch (_) { /* server may still be restarting */ }
                        this.postDiagnostics(document, panel.webview);
                    }
                }
            }
        }
    }

    queueDocument(uri, operation) {
        const key = uri.toString();
        const previous = this.documentQueues.get(key) || Promise.resolve();
        const current = previous
            .catch(() => undefined)
            .then(operation)
            .finally(() => {
                if (this.documentQueues.get(key) === current) this.documentQueues.delete(key);
            });
        this.documentQueues.set(key, current);
        return current;
    }

    async applyWebviewText(document, text, localTextCounts) {
        const change = computeMinimalReplacement(document.getText(), text);
        if (!change) return;

        localTextCounts.set(text, (localTextCounts.get(text) || 0) + 1);
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
            document.uri,
            new vscode.Range(document.positionAt(change.start), document.positionAt(change.oldEnd)),
            change.text
        );

        if (!(await vscode.workspace.applyEdit(edit))) {
            decrementTextCount(localTextCounts, text);
            throw new Error('VS Code rejected the SultanC document edit.');
        }
    }

    registerPanel(document, panel) {
        const key = document.uri.toString();
        let values = this.panels.get(key);
        if (!values) {
            values = new Set();
            this.panels.set(key, values);
        }
        values.add(panel);
        this.activePanel = { document, panel };

        const pending = this.pendingReveal.get(key);
        if (pending) {
            this.pendingReveal.delete(key);
            setTimeout(() => panel.webview.postMessage({ type: 'reveal', offset: pending.offset }), 0);
        }

        panel.onDidChangeViewState(() => {
            if (panel.active) {
                this.activePanel = { document, panel };
                // The text area keeps its caret when the editor comes back.
                panel.webview.postMessage({ type: 'focus' });
            }
        });
        panel.onDidDispose(() => {
            values.delete(panel);
            if (values.size === 0) this.panels.delete(key);
            if (this.activePanel?.panel === panel) this.activePanel = null;
        });
    }

    postDiagnostics(document, webview) {
        const raw = this.languageService?.getRawDiagnostics?.(document.uri) || [];
        webview.postMessage({ type: 'diagnostics', diagnostics: diagnosticsForWebview(raw) });
    }

    ensureLspDocument(document) {
        if (!this.languageService?.started) {
            throw new Error('SultanC language server is not running.');
        }
        this.languageService.didOpen(document);
    }

    lspPosition(document, sourceOffset) {
        const safe = Math.max(0, Math.min(Number(sourceOffset) || 0, document.getText().length));
        const position = document.positionAt(safe);
        return { line: position.line, character: position.character };
    }

    documentParams(document, sourceOffset) {
        return {
            textDocument: { uri: document.uri.toString() },
            position: this.lspPosition(document, sourceOffset),
        };
    }

    async requestAt(document, method, sourceOffset, extra = {}) {
        this.ensureLspDocument(document);
        return this.languageService.request(method, {
            ...this.documentParams(document, sourceOffset),
            ...extra,
        });
    }

    // Hover links use `file:///path#L<line>,<column>` (1-based), as VS Code does.
    async openLink(href) {
        const uri = vscode.Uri.parse(href);
        const match = /^L(\d+)(?:,(\d+))?$/.exec(uri.fragment || '');
        const target = uri.with({ fragment: '' });
        if (!match) {
            await vscode.commands.executeCommand('vscode.open', target);
            return;
        }
        const line = Math.max(0, Number(match[1]) - 1);
        const character = Math.max(0, Number(match[2] || 1) - 1);
        await this.revealLocation({
            uri: target.toString(),
            range: { start: { line, character }, end: { line, character } },
        });
    }

    async revealLocation(location) {
        if (!location?.uri || !location.range) return;
        const uri = vscode.Uri.parse(location.uri);
        const document = await vscode.workspace.openTextDocument(uri);
        const range = fromLspRange(location.range);
        const offset = document.offsetAt(range.start);
        const key = uri.toString();
        const existing = this.panels.get(key);

        if (existing?.size) {
            const panel = [...existing][0];
            panel.reveal(panel.viewColumn, false);
            panel.webview.postMessage({ type: 'reveal', offset });
            this.activePanel = { document, panel };
            return;
        }

        this.pendingReveal.set(key, { offset });
        await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE, {
            preview: false,
            preserveFocus: false,
        });
    }

    async chooseLocation(items, title) {
        if (!items.length) return;
        if (items.length === 1) {
            await this.revealLocation(items[0]);
            return;
        }
        const choices = items.map((location) => {
            const uri = vscode.Uri.parse(location.uri);
            return {
                label: `${vscode.workspace.asRelativePath(uri)}:${location.range.start.line + 1}:${location.range.start.character + 1}`,
                description: uri.fsPath,
                location,
            };
        });
        const selected = await vscode.window.showQuickPick(choices, { title, matchOnDescription: true });
        if (selected) await this.revealLocation(selected.location);
    }

    /**
     * The edits of an accepted completion item, in source offsets of the
     * document as it is now: the item replaces from the server's start (or the
     * word's start) to the caret now, never past it, plus its additional edits
     * (an added import). Null when the item no longer fits (erased back past
     * the word's start).
     */
    completionEdits(document, rawItem, sourceOffset, cursorOffset = sourceOffset) {
        if (!rawItem) return null;
        const text = document.getText();
        const length = text.length;
        const cursor = Math.max(0, Math.min(Number.isInteger(cursorOffset) ? cursorOffset : sourceOffset, length));
        let newText = typeof rawItem.insertText === 'string' ? rawItem.insertText : completionLabel(rawItem);
        let start;
        const editRange = rawItem.textEdit && (rawItem.textEdit.range || rawItem.textEdit.replace || rawItem.textEdit.insert);
        if (editRange) {
            start = document.offsetAt(fromLspRange(editRange).start);
            newText = rawItem.textEdit.newText || newText;
        } else {
            start = wordStartBefore(text, cursor);
        }
        if (start > cursor) return null;
        const inserted = plainSnippetText(newText);
        const edits = [{ start, end: cursor, text: inserted, primary: true }];
        for (const additional of rawItem.additionalTextEdits || []) {
            if (!additional?.range) continue;
            const range = fromLspRange(additional.range);
            edits.push({ start: document.offsetAt(range.start), end: document.offsetAt(range.end), text: additional.newText || '' });
        }
        return { edits, base: text, caretInPrimary: inserted.length };
    }

    /**
     * Accepting a completion: the webview applies the edits to its own text,
     * as it does for typing, so the caret lands right after the inserted text
     * and the view stays where it is (an import added above shifts the view by
     * its lines, so the line being edited does not move on screen). The text
     * then reaches the document through the webview's usual `edit` message.
     */
    async applyCompletion(document, rawItem, sourceOffset, cursorOffset, webview) {
        const result = this.completionEdits(document, rawItem, sourceOffset, cursorOffset);
        if (!result) return;
        if (webview) {
            webview.postMessage({
                type: 'completionEdits',
                edits: result.edits,
                baseLength: result.base.length,
                baseHash: textHash(result.base),
                caretInPrimary: result.caretInPrimary,
            });
            return;
        }
        const edit = new vscode.WorkspaceEdit();
        for (const item of result.edits) {
            edit.replace(document.uri, new vscode.Range(document.positionAt(item.start), document.positionAt(item.end)), item.text);
        }
        if (!(await vscode.workspace.applyEdit(edit))) throw new Error('VS Code rejected the completion edit.');
    }

    postReveal(uri, offset) {
        const panels = this.panels.get(uri.toString());
        if (!panels?.size) return;
        for (const panel of panels) panel.webview.postMessage({ type: 'reveal', offset });
    }

    async handleReferences(document, sourceOffset) {
        const result = await this.requestAt(document, 'textDocument/references', sourceOffset, {
            context: { includeDeclaration: true },
        });
        await this.chooseLocation(locations(result), 'SultanC References');
    }

    async handleRename(document, sourceOffset) {
        const prepared = await this.requestAt(document, 'textDocument/prepareRename', sourceOffset);
        if (!prepared) {
            vscode.window.showInformationMessage('SultanC: symbol cannot be renamed here.');
            return;
        }

        const range = prepared.range ? fromLspRange(prepared.range) : fromLspRange(prepared);
        const placeholder = prepared.placeholder || document.getText(range);
        const newName = await vscode.window.showInputBox({
            title: 'Rename SultanC Symbol',
            value: placeholder,
            valueSelection: [0, placeholder.length],
            validateInput: (value) => value.trim() ? null : 'Name cannot be empty.',
        });
        if (newName === undefined || newName === placeholder) return;

        const result = await this.requestAt(document, 'textDocument/rename', sourceOffset, { newName });
        const edit = fromLspWorkspaceEdit(result);
        if (edit && !(await vscode.workspace.applyEdit(edit))) {
            throw new Error('VS Code rejected the SultanC rename edit.');
        }
    }

    // Breadcrumbs: the file's path in the workspace, then the symbols around the
    // cursor (VS Code draws breadcrumbs only for its own text editor).
    async postBreadcrumbs(document, webview, sourceOffset) {
        const relative = vscode.workspace.asRelativePath(document.uri, true);
        const segments = relative.split(/[\\/]/).filter(Boolean);
        let symbols = [];
        if (this.languageService?.started) {
            const key = `${document.uri.toString()}@${document.version}`;
            if (!this.symbolCache || this.symbolCache.key !== key) {
                this.ensureLspDocument(document);
                const result = await this.languageService.request('textDocument/documentSymbol', {
                    textDocument: { uri: document.uri.toString() },
                });
                this.symbolCache = { key, result: Array.isArray(result) ? result : [] };
            }
            const position = document.positionAt(sourceOffset);
            symbols = symbolChainAt(this.symbolCache.result, { line: position.line, character: position.character })
                .map((symbol) => ({
                    name: symbol.name,
                    kind: symbol.kind,
                    offset: document.offsetAt(fromLspRange(symbol.selectionRange).start),
                }));
        }
        webview.postMessage({ type: 'breadcrumbs', segments, symbols });
    }

    // Peek Definition (Alt+F12): the definition's surrounding lines, shown in place.
    async postPeek(document, webview, sourceOffset) {
        const result = await this.requestAt(document, 'textDocument/definition', sourceOffset);
        const items = locations(result);
        if (!items.length) {
            webview.postMessage({ type: 'peek', empty: true });
            return;
        }
        const location = items[0];
        const uri = vscode.Uri.parse(location.uri);
        const target = await vscode.workspace.openTextDocument(uri);
        const line = location.range.start.line;
        const first = Math.max(0, line - 3);
        const last = Math.min(target.lineCount - 1, line + 12);
        const lines = [];
        for (let index = first; index <= last; index += 1) lines.push(target.lineAt(index).text);
        webview.postMessage({
            type: 'peek',
            title: `${vscode.workspace.asRelativePath(uri, true)}:${line + 1}`,
            lines,
            firstLine: first,
            targetLine: line,
            location,
            offset: sourceOffset,
        });
    }

    async handleDocumentSymbols(document) {
        this.ensureLspDocument(document);
        const result = await this.languageService.request('textDocument/documentSymbol', {
            textDocument: { uri: document.uri.toString() },
        });
        const symbols = flattenDocumentSymbols(result);
        if (!symbols.length) return;
        const choices = symbols.map((symbol) => ({
            label: `${'  '.repeat(symbol.depth)}${symbol.name}`,
            description: symbol.detail || symbol.parent,
            symbol,
        }));
        const selected = await vscode.window.showQuickPick(choices, {
            title: 'SultanC Document Symbols',
            matchOnDescription: true,
        });
        if (!selected) return;
        const range = fromLspRange(selected.symbol.range);
        this.postReveal(document.uri, document.offsetAt(range.start));
    }

    async handleCodeActions(document, sourceOffset) {
        const position = document.positionAt(sourceOffset);
        const range = new vscode.Range(position, position);
        const rawDiagnostics = this.languageService.getRawDiagnostics(document.uri);
        const result = await this.languageService.request('textDocument/codeAction', {
            textDocument: { uri: document.uri.toString() },
            range: {
                start: { line: position.line, character: position.character },
                end: { line: position.line, character: position.character },
            },
            context: { diagnostics: rawDiagnostics },
        });
        if (!Array.isArray(result) || result.length === 0) return;
        const choices = result.map((action, index) => ({
            label: action.title || `Code action ${index + 1}`,
            description: action.kind || '',
            action,
        }));
        const selected = await vscode.window.showQuickPick(choices, { title: 'SultanC Code Actions' });
        if (!selected) return;
        if (selected.action.edit) {
            const edit = fromLspWorkspaceEdit(selected.action.edit);
            if (edit) await vscode.workspace.applyEdit(edit);
        }
        if (selected.action.command?.command) {
            await vscode.commands.executeCommand(
                selected.action.command.command,
                ...(selected.action.command.arguments || [])
            );
        }
    }

    async resolveCustomTextEditor(document, panel) {
        const webview = panel.webview;
        webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
        };
        webview.html = buildWebviewHtml(webview, this.context.extensionUri);
        this.registerPanel(document, panel);

        const localTextCounts = new Map();
        const completionCache = new Map();
        const disposables = [];

        const postDocument = () => webview.postMessage({
            type: 'document',
            text: document.getText(),
            version: document.version,
            fileName: path.basename(document.fileName),
        });
        const postConfiguration = () => webview.postMessage({
            type: 'configuration',
            settings: readEditorSettings(document),
        });

        if (this.languageService?.started) {
            try { this.languageService.didOpen(document); } catch (_) { /* status below reports disconnected */ }
        }

        disposables.push(vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document.uri.toString() !== document.uri.toString()) return;
            // The event for a dirty-state change carries no content change: the
            // text is the one already sent, and posting it again would replace
            // what was typed since (the first letter after the first edit).
            if (!event.contentChanges.length) return;
            const text = document.getText();
            if ((localTextCounts.get(text) || 0) > 0) {
                decrementTextCount(localTextCounts, text);
                return;
            }
            postDocument();
        }));

        disposables.push(vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration(CONFIGURATION_ROOT) || event.affectsConfiguration('editor')) {
                postConfiguration();
            }
        }));

        disposables.push(webview.onDidReceiveMessage(async (message) => {
            if (!message || typeof message.type !== 'string') return;

            try {
                if (message.type === 'ready') {
                    webview.postMessage({ type: 'syntax', syntax: this.syntaxSurface });
                    postConfiguration();
                    postDocument();
                    webview.postMessage({ type: 'lspStatus', ready: Boolean(this.languageService?.started) });
                    this.postDiagnostics(document, webview);
                    return;
                }

                if (message.type === 'edit' && typeof message.text === 'string') {
                    await this.queueDocument(document.uri, () =>
                        this.applyWebviewText(document, message.text, localTextCounts)
                    );
                    return;
                }

                if (message.type === 'save') {
                    await this.queueDocument(document.uri, () => document.save());
                    return;
                }

                if (message.type === 'undo' || message.type === 'redo') {
                    await this.queueDocument(document.uri, () => vscode.commands.executeCommand(message.type));
                    return;
                }

                if (message.type === 'openLink' && typeof message.href === 'string') {
                    await this.openLink(message.href);
                    return;
                }
                if (message.type === 'lspHover') {
                    const result = await this.requestAt(document, 'textDocument/hover', message.offset);
                    webview.postMessage({
                        type: 'lspHoverResult',
                        requestId: message.requestId,
                        text: hoverText(result),
                    });
                    return;
                }

                if (message.type === 'lspCompletion') {
                    // The keystroke's edit first, so the server completes the text just typed.
                    await this.queueDocument(document.uri, () => undefined);
                    const result = await this.requestAt(document, 'textDocument/completion', message.offset);
                    const rawItems = Array.isArray(result) ? result : result?.items || [];
                    completionCache.set(message.requestId, rawItems);
                    while (completionCache.size > 8) completionCache.delete(completionCache.keys().next().value);
                    webview.postMessage({
                        type: 'lspCompletionResult',
                        requestId: message.requestId,
                        items: completionItems(result),
                        // More typing can change the list: ask again then.
                        incomplete: Boolean(result && !Array.isArray(result) && result.isIncomplete),
                    });
                    return;
                }

                if (message.type === 'lspCompletionAccept') {
                    const rawItems = completionCache.get(message.requestId) || [];
                    await this.queueDocument(document.uri, () => undefined);
                    await this.applyCompletion(document, rawItems[message.index], message.offset, message.cursor, webview);
                    completionCache.delete(message.requestId);
                    return;
                }

                if (message.type === 'lspSignature') {
                    const result = await this.requestAt(document, 'textDocument/signatureHelp', message.offset);
                    webview.postMessage({
                        type: 'lspSignatureResult',
                        requestId: message.requestId,
                        text: signatureText(result),
                    });
                    return;
                }

                if (message.type === 'lspDefinition' || message.type === 'lspDeclaration') {
                    const method = message.type === 'lspDefinition'
                        ? 'textDocument/definition'
                        : 'textDocument/declaration';
                    const result = await this.requestAt(document, method, message.offset);
                    await this.chooseLocation(locations(result), message.type === 'lspDefinition'
                        ? 'SultanC Definition'
                        : 'SultanC Declaration');
                    return;
                }

                if (message.type === 'lspReferences') {
                    await this.handleReferences(document, message.offset);
                    return;
                }

                if (message.type === 'lspRename') {
                    await this.handleRename(document, message.offset);
                    return;
                }

                if (message.type === 'cursor' && Number.isInteger(message.offset)) {
                    await this.postBreadcrumbs(document, webview, message.offset);
                    return;
                }

                if (message.type === 'lspPeek') {
                    await this.postPeek(document, webview, message.offset);
                    return;
                }

                if (message.type === 'openLocation' && message.location) {
                    await this.revealLocation(message.location);
                    return;
                }

                if (message.type === 'lspDocumentSymbols') {
                    await this.handleDocumentSymbols(document);
                    return;
                }

                if (message.type === 'lspCodeAction') {
                    await this.handleCodeActions(document, message.offset);
                }
            } catch (error) {
                const text = `SultanC LSP: ${error.message}`;
                webview.postMessage({ type: 'lspError', message: text, requestId: message.requestId });
                if (!String(error.message || '').includes('cancel')) {
                    this.languageService?.output?.appendLine(`[custom-editor] ${error.stack || error.message}`);
                }
            }
        }));

        panel.onDidDispose(() => {
            for (const disposable of disposables) disposable.dispose();
        });
    }
}

function completionLabel(item) {
    return typeof item?.label === 'string' ? item.label : item?.label?.label || '';
}

function plainSnippetText(value) {
    if (typeof value !== 'string') return '';
    return value
        .replace(/\$\{\d+:([^}]*)\}/g, '$1')
        .replace(/\$\{\d+\}/g, '')
        .replace(/\$\d+/g, '');
}

function decrementTextCount(counts, text) {
    const count = counts.get(text) || 0;
    if (count <= 1) counts.delete(text);
    else counts.set(text, count - 1);
}

module.exports = { VIEW_TYPE, SultanCBidiEditorProvider, plainSnippetText };
