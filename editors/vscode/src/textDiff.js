'use strict';

/**
 * Return the smallest single replacement that transforms oldText into newText.
 *
 * SultanC's custom editor edits VS Code's authoritative TextDocument through a
 * WorkspaceEdit. Keeping the replacement minimal preserves useful undo history
 * and avoids replacing an entire compiler source file on every keypress.
 */
function computeMinimalReplacement(oldText, newText) {
    if (oldText === newText) {
        return null;
    }

    let start = 0;
    const shortest = Math.min(oldText.length, newText.length);
    while (start < shortest && oldText.charCodeAt(start) === newText.charCodeAt(start)) {
        start += 1;
    }

    let oldEnd = oldText.length;
    let newEnd = newText.length;
    while (
        oldEnd > start &&
        newEnd > start &&
        oldText.charCodeAt(oldEnd - 1) === newText.charCodeAt(newEnd - 1)
    ) {
        oldEnd -= 1;
        newEnd -= 1;
    }

    return { start, oldEnd, text: newText.slice(start, newEnd) };
}

module.exports = { computeMinimalReplacement };
