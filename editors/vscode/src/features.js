'use strict';

// A busy indicator while the server answers (rust-analyzer's status spinner).
// CodeLens, the Test Explorer and import updates on rename come from the
// language server (textDocument/codeLens, sultanc/tests via src/testing.js,
// workspace/willRenameFiles), so the compiler answers them once.

const vscode = require('vscode');

// ---- Busy indicator ----------------------------------------------------------------

class BusyIndicator {
    constructor() {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -1);
        this.pending = 0;
        this.timer = null;
    }

    /** Shows "SultanC: analysing…" when a request takes longer than 300 ms. */
    track(promise) {
        this.pending += 1;
        if (!this.timer) {
            this.timer = setTimeout(() => {
                if (this.pending > 0) {
                    this.item.text = '$(sync~spin) SultanC: analysing…';
                    this.item.show();
                }
            }, 300);
        }
        const done = () => {
            this.pending = Math.max(0, this.pending - 1);
            if (this.pending === 0) {
                clearTimeout(this.timer);
                this.timer = null;
                this.item.hide();
            }
        };
        return Promise.resolve(promise).then((value) => { done(); return value; }, (error) => { done(); throw error; });
    }

    /** vscode-languageclient middleware wrapping the requests users wait on. */
    middleware() {
        // The status bar shows the work the user is waiting for: checking the
        // file (pull diagnostics) as well as navigation and refactoring requests.
        const wrap = (name) => (...args) => this.track(args[args.length - 1](...args.slice(0, -1)));
        const middleware = {};
        for (const name of ['provideHover', 'provideDefinition', 'provideTypeDefinition', 'provideReferences',
            'provideCompletionItem', 'provideSignatureHelp', 'provideRenameEdits', 'prepareRename',
            'provideDocumentSymbols', 'provideWorkspaceSymbols', 'provideInlayHints',
            'provideDiagnostics', 'provideCodeActions', 'provideDocumentSemanticTokens',
            'provideDocumentSemanticTokensEdits', 'provideCallHierarchyIncomingCalls',
            'provideCallHierarchyOutgoingCalls']) {
            middleware[name] = wrap(name);
        }
        return middleware;
    }

    dispose() { this.item.dispose(); }
}

function registerFeatures(context) {
    const busy = new BusyIndicator();
    context.subscriptions.push(busy);
    return { busy };
}

module.exports = { registerFeatures, BusyIndicator };
