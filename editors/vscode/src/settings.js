'use strict';

const vscode = require('vscode');

const CONFIGURATION_ROOT = 'sultanc.editor';

function clamp(value, minimum, maximum, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return fallback;
    }
    return Math.max(minimum, Math.min(maximum, number));
}

/**
 * Read presentation settings only. Compiler semantics and source normalization
 * are deliberately not duplicated in the extension.
 */
function readEditorSettings(document) {
    const config = vscode.workspace.getConfiguration(CONFIGURATION_ROOT, document?.uri);
    const editor = vscode.workspace.getConfiguration('editor', document?.uri);
    const tabSize = clamp(editor.get('tabSize', 4), 1, 16, 4);

    return {
        direction: config.get('direction', 'auto'),
        fontScale: clamp(config.get('fontScale', 1.3), 0.8, 2.0, 1.3),
        lineHeight: clamp(config.get('lineHeight', 1.65), 1.1, 2.5, 1.65),
        fontFamily: config.get(
            'fontFamily',
            '"IBM Plex Sans Arabic", "SF Arabic", "Noto Sans Arabic", var(--vscode-editor-font-family), "Geeza Pro", sans-serif'
        ),
        palette: config.get('palette', 'nvim'),
        showLineNumbers: config.get('showLineNumbers', true),
        insertSpaces: editor.get('insertSpaces', true),
        tabSize,
    };
}

module.exports = { CONFIGURATION_ROOT, readEditorSettings };
