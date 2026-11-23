'use strict';

const crypto = require('crypto');
const vscode = require('vscode');

function makeNonce() {
    return crypto.randomBytes(18).toString('base64');
}

/** Build a CSP-locked webview that loads only extension-local assets. */
function buildWebviewHtml(webview, extensionUri) {
    const nonce = makeNonce();
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'editor.css'));
    const rendererUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'syntaxRenderer.js'));
    const operationsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'editorOperations.js'));
    const diagnosticsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'diagnosticRenderer.js'));
    const markdownUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'markdown.js'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'editor.js'));
    const csp = [
        "default-src 'none'",
        `style-src ${webview.cspSource}`,
        `script-src 'nonce-${nonce}' ${webview.cspSource}`,
        "img-src data:",
        "font-src 'none'",
        "connect-src 'none'",
    ].join('; ');

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>SultanC Source Editor</title>
<link rel="stylesheet" href="${cssUri}">
</head>
<body data-palette="nvim">
<nav class="breadcrumbs" id="breadcrumbs" aria-label="Breadcrumbs"></nav>
<section class="editor-shell" id="editor-shell" data-direction="rtl" data-line-numbers="true">
    <pre class="lines" id="lines" aria-hidden="true">1</pre>
    <div class="editor-stack">
        <pre id="highlight" aria-hidden="true"></pre>
        <pre id="diagnostics-overlay" aria-hidden="true"></pre>
        <textarea id="editor" spellcheck="false" autocomplete="off" autocorrect="off"
            autocapitalize="off" wrap="off" aria-label="SultanC source editor"></textarea>
    </div>
</section>
<div id="lsp-hover" class="lsp-popup lsp-hover" hidden></div>
<div id="lsp-completion" class="lsp-popup lsp-completion" hidden></div>
<div id="lsp-signature" class="lsp-popup lsp-signature" hidden></div>
<div id="lsp-peek" class="lsp-peek" hidden></div>
<div class="status" aria-hidden="true">
    <span id="position">Ln 1, Col 1</span>
    <span id="diagnostic-count"></span>
    <span class="spacer"></span>
    <span id="mode">RTL · UTF-8 · SultanC · LSP</span>
</div>
<script nonce="${nonce}" src="${rendererUri}"></script>
<script nonce="${nonce}" src="${operationsUri}"></script>
<script nonce="${nonce}" src="${diagnosticsUri}"></script>
<script nonce="${nonce}" src="${markdownUri}"></script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

module.exports = { buildWebviewHtml };
