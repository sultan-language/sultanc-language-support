'use strict';

// LSP → VS Code conversions used by the RTL editor's own request paths.
const vscode = require('vscode');

function fromLspPosition(position) {
    return new vscode.Position(position.line, position.character);
}
function fromLspRange(range) {
    return new vscode.Range(fromLspPosition(range.start), fromLspPosition(range.end));
}
function fromLspTextEdit(edit) {
    return vscode.TextEdit.replace(fromLspRange(edit.range), edit.newText || '');
}
function fromLspWorkspaceEdit(result) {
    if (!result) return null;
    const edit = new vscode.WorkspaceEdit();

    for (const [uriText, edits] of Object.entries(result.changes || {})) {
        const uri = vscode.Uri.parse(uriText);
        edit.set(uri, (edits || []).map(fromLspTextEdit));
    }

    for (const change of result.documentChanges || []) {
        if (change?.textDocument && Array.isArray(change.edits)) {
            edit.set(vscode.Uri.parse(change.textDocument.uri), change.edits.map(fromLspTextEdit));
        } else if (change?.kind === 'create' && change.uri) {
            edit.createFile(vscode.Uri.parse(change.uri), change.options || {});
        } else if (change?.kind === 'rename' && change.oldUri && change.newUri) {
            edit.renameFile(vscode.Uri.parse(change.oldUri), vscode.Uri.parse(change.newUri), change.options || {});
        } else if (change?.kind === 'delete' && change.uri) {
            edit.deleteFile(vscode.Uri.parse(change.uri), change.options || {});
        }
    }

    return edit;
}

module.exports = { fromLspPosition, fromLspRange, fromLspTextEdit, fromLspWorkspaceEdit };
