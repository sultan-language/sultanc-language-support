'use strict';

/**
 * Pure source-edit operations used by the SultanC custom editor.
 *
 * These functions operate only on logical SultanC source offsets. They know
 * nothing about bidi presentation marks, so keyboard editing can never leak
 * presentation-only characters into the TextDocument.
 */
(function expose(root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.SultanCEditorOperations = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
    function lineStartAt(text, offset) {
        const clamped = Math.max(0, Math.min(offset, text.length));
        return text.lastIndexOf('\n', Math.max(0, clamped - 1)) + 1;
    }

    function selectedLineBounds(text, start, end) {
        const safeStart = Math.max(0, Math.min(start, text.length));
        const safeEnd = Math.max(safeStart, Math.min(end, text.length));
        const first = lineStartAt(text, safeStart);

        // A selection ending exactly after a newline should not unexpectedly
        // include the following line in line-oriented commands.
        const probe = safeEnd > safeStart && text[safeEnd - 1] === '\n'
            ? safeEnd - 1
            : safeEnd;
        const nextNewline = text.indexOf('\n', probe);
        const last = nextNewline === -1 ? text.length : nextNewline;
        return { start: first, end: last };
    }

    function lineStartsInBounds(text, bounds) {
        const starts = [bounds.start];
        let cursor = bounds.start;
        while (cursor < bounds.end) {
            const newline = text.indexOf('\n', cursor);
            if (newline === -1 || newline >= bounds.end) break;
            starts.push(newline + 1);
            cursor = newline + 1;
        }
        return starts;
    }

    function lineEndAt(text, start) {
        const newline = text.indexOf('\n', start);
        return newline === -1 ? text.length : newline;
    }

    function applyEdits(text, edits) {
        let result = text;
        const ordered = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
        for (const edit of ordered) {
            result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
        }
        return result;
    }

    function mapOffset(offset, edits) {
        const ordered = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
        let delta = 0;
        for (const edit of ordered) {
            const removed = edit.end - edit.start;
            const added = edit.text.length;

            if (removed === 0) {
                if (offset >= edit.start) delta += added;
                continue;
            }

            if (offset >= edit.end) {
                delta += added - removed;
                continue;
            }

            if (offset > edit.start) {
                return edit.start + delta + Math.min(offset - edit.start, added);
            }

            if (offset === edit.start) {
                return edit.start + delta;
            }

            break;
        }
        return offset + delta;
    }

    function resultFromEdits(text, selectionStart, selectionEnd, edits) {
        return {
            text: applyEdits(text, edits),
            selectionStart: mapOffset(selectionStart, edits),
            selectionEnd: mapOffset(selectionEnd, edits),
        };
    }

    function toggleLineComment(text, selectionStart, selectionEnd, marker = '//') {
        const bounds = selectedLineBounds(text, selectionStart, selectionEnd);
        const starts = lineStartsInBounds(text, bounds);
        const lines = starts.map((start) => {
            const end = lineEndAt(text, start);
            const value = text.slice(start, end);
            const indent = (value.match(/^[\t ]*/) || [''])[0];
            const contentStart = start + indent.length;
            return { start, end, value, indent, contentStart };
        });
        const nonBlank = lines.filter((line) => line.value.trim().length > 0);
        if (nonBlank.length === 0) {
            return { text, selectionStart, selectionEnd };
        }

        const allCommented = nonBlank.every((line) =>
            text.slice(line.contentStart, line.contentStart + marker.length) === marker
        );
        const edits = [];

        for (const line of nonBlank) {
            if (allCommented) {
                let end = line.contentStart + marker.length;
                if (text[end] === ' ') end += 1;
                edits.push({ start: line.contentStart, end, text: '' });
            } else {
                edits.push({ start: line.contentStart, end: line.contentStart, text: `${marker} ` });
            }
        }

        return resultFromEdits(text, selectionStart, selectionEnd, edits);
    }

    function indentLines(text, selectionStart, selectionEnd, unit) {
        if (!unit) return { text, selectionStart, selectionEnd };
        const bounds = selectedLineBounds(text, selectionStart, selectionEnd);
        const edits = lineStartsInBounds(text, bounds).map((start) => ({
            start,
            end: start,
            text: unit,
        }));
        return resultFromEdits(text, selectionStart, selectionEnd, edits);
    }

    function outdentLines(text, selectionStart, selectionEnd, unit) {
        const width = Math.max(1, unit ? unit.length : 4);
        const bounds = selectedLineBounds(text, selectionStart, selectionEnd);
        const edits = [];

        for (const start of lineStartsInBounds(text, bounds)) {
            if (text[start] === '\t') {
                edits.push({ start, end: start + 1, text: '' });
                continue;
            }
            let count = 0;
            while (count < width && text[start + count] === ' ') count += 1;
            if (count > 0) edits.push({ start, end: start + count, text: '' });
        }

        return resultFromEdits(text, selectionStart, selectionEnd, edits);
    }

    const OPENERS = { '{': '}', '[': ']', '(': ')' };
    const CLOSERS = { '}': '{', ']': '[', ')': '(' };

    function leadingWhitespace(line) {
        const match = /^[\t ]*/.exec(line);
        return match ? match[0] : '';
    }

    /**
     * Enter, as VS Code does it for brace languages: the new line takes the
     * indentation of the current line only (never of lines above), one unit
     * more after an opening bracket, and a closing bracket right after the
     * cursor moves to its own line at the outer level. Trailing blanks left
     * before the cursor are removed, so empty lines stay empty.
     */
    function enterEdit(text, start, end, unit) {
        const lineStart = lineStartAt(text, start);
        const newline = text.indexOf('\n', end);
        const lineEnd = newline === -1 ? text.length : newline;
        const before = text.slice(lineStart, start);
        const after = text.slice(end, lineEnd);
        const indent = leadingWhitespace(before.trim() ? text.slice(lineStart, lineEnd) : before);
        const kept = before.replace(/[\t ]+$/, '');
        const rest = after.replace(/^[\t ]+/, '');
        const previous = kept.trim() ? kept[kept.length - 1] : '';
        const next = rest[0] || '';
        let insert;
        let cursor;
        if (OPENERS[previous]) {
            const inner = indent + unit;
            if (next === OPENERS[previous]) {
                insert = `\n${inner}\n${indent}`;
                cursor = 1 + inner.length;
            } else {
                insert = `\n${inner}`;
                cursor = insert.length;
            }
        } else {
            insert = `\n${indent}`;
            cursor = insert.length;
        }
        const head = text.slice(0, lineStart) + kept;
        const result = head + insert + rest + text.slice(lineEnd);
        const caret = head.length + cursor;
        return { text: result, selectionStart: caret, selectionEnd: caret };
    }

    // Indentation of the line holding the bracket that `closer` at `offset`
    // closes, skipping strings and comments; null when unmatched.
    function matchingOpenerIndent(text, offset, closer) {
        const stack = [];
        let index = 0;
        while (index < offset) {
            const char = text[index];
            if (char === '/' && text[index + 1] === '/') {
                const next = text.indexOf('\n', index);
                index = next === -1 ? offset : next;
                continue;
            }
            if (char === '"') {
                index += 1;
                while (index < offset && text[index] !== '"' && text[index] !== '\n') index += text[index] === '\\' ? 2 : 1;
                index += 1;
                continue;
            }
            if (char === '«') {
                const close = text.indexOf('»', index);
                index = close === -1 ? offset : close + 1;
                continue;
            }
            if (OPENERS[char]) stack.push(index);
            else if (CLOSERS[char] && stack.length) stack.pop();
            index += 1;
        }
        for (let at = stack.length - 1; at >= 0; at -= 1) {
            if (OPENERS[text[stack[at]]] === closer) {
                const start = lineStartAt(text, stack[at]);
                return leadingWhitespace(text.slice(start, stack[at]));
            }
        }
        return null;
    }

    /**
     * Typing a closing bracket as the first thing on a line puts the line at
     * the indentation of the line that opened the block.
     */
    function closingBracketEdit(text, start, end, closer) {
        const lineStart = lineStartAt(text, start);
        const before = text.slice(lineStart, start);
        if (start !== end || before.trim()) return null;
        const indent = matchingOpenerIndent(text, lineStart, closer);
        if (indent === null || indent === before) return null;
        const result = text.slice(0, lineStart) + indent + closer + text.slice(start);
        const caret = lineStart + indent.length + closer.length;
        return { text: result, selectionStart: caret, selectionEnd: caret };
    }

    // ---- Completion while typing ------------------------------------------
    // As VS Code's text editor does: a word being typed (letters of any
    // script, digits, `_`) or a `.` opens completion; further letters filter
    // the list the server gave for that word.

    const wordCharacter = /[\p{L}\p{N}\p{M}_]/u;

    function isWordCharacter(character) {
        return typeof character === 'string' && character !== '' && wordCharacter.test(character);
    }

    /** Where the word ending at `offset` starts (offset itself when none). */
    function wordStartAt(text, offset) {
        let start = Math.max(0, Math.min(offset, text.length));
        while (start > 0 && isWordCharacter(text[start - 1])) start--;
        return start;
    }

    /**
     * What typing at `offset` asks of the completion list:
     * 'open' (a `.` or the first letter of a word: ask the server),
     * 'filter' (more letters of the word the open list was asked for),
     * 'close' (anything else).
     */
    function completionTriggerAt(text, offset, openWordStart) {
        const previous = text[offset - 1];
        if (previous === '.') return 'open';
        if (!isWordCharacter(previous)) return 'close';
        const start = wordStartAt(text, offset);
        if (openWordStart !== null && openWordStart !== undefined && openWordStart === start) return 'filter';
        // Letters right after a digit-only run are a number, not a name.
        if (/^\p{N}/u.test(text.slice(start, offset))) return 'close';
        return 'open';
    }

    /**
     * The items whose label holds the typed word's characters in order,
     * ignoring ASCII case (VS Code's filter is fuzzy the same way). Labels
     * that start with the word come first; within each group the server's
     * order (the compiler's ranking) is kept.
     */
    function filterCompletionItems(items, word) {
        if (!word) return items.slice();
        const lower = word.toLowerCase();
        const wanted = [...lower];
        const label = (item) => String(item.filterText || item.label || '').toLowerCase();
        const matching = items.filter((item) => {
            const characters = [...label(item)];
            let next = 0;
            for (const character of characters) {
                if (character === wanted[next]) next++;
                if (next === wanted.length) return true;
            }
            return false;
        });
        const prefixed = matching.filter((item) => label(item).startsWith(lower));
        return prefixed.concat(matching.filter((item) => !label(item).startsWith(lower)));
    }

    /**
     * Which characters of `label` the typed `word` matched (code point
     * indices), to highlight them: a prefix match when there is one, else the
     * first in-order match, ASCII case ignored.
     */
    function completionMatchIndices(label, word) {
        const characters = [...String(label || '')];
        const wanted = [...String(word || '').toLowerCase()];
        if (!wanted.length) return [];
        const lower = characters.map((c) => c.toLowerCase());
        if (wanted.every((c, i) => lower[i] === c)) return wanted.map((_, i) => i);
        const indices = [];
        for (let i = 0; i < lower.length && indices.length < wanted.length; i++) {
            if (lower[i] === wanted[indices.length]) indices.push(i);
        }
        return indices.length === wanted.length ? indices : [];
    }

    // ---- Line commands (VS Code's defaults) ------------------------------

    /** The column of `offset` in its line. */
    function columnAt(text, offset) {
        return offset - lineStartAt(text, offset);
    }

    /** `offset` in the line starting at `lineStart`, at most its end. */
    function offsetAtColumn(text, lineStart, column) {
        const newline = text.indexOf('\n', lineStart);
        const lineEnd = newline === -1 ? text.length : newline;
        return Math.min(lineStart + column, lineEnd);
    }

    /**
     * Delete Line (Cmd/Ctrl+Shift+K): the lines the selection touches go,
     * with their line break; the caret keeps its column on the next line.
     */
    function deleteLines(text, start, end) {
        const bounds = selectedLineBounds(text, start, end);
        const column = columnAt(text, start);
        let from = bounds.start;
        let to = bounds.end;
        if (to < text.length) to += 1; // its line break
        else if (from > 0) from -= 1; // the last line: the break before it
        const result = text.slice(0, from) + text.slice(to);
        const lineStart = from === bounds.start ? from : lineStartAt(result, from);
        const caret = offsetAtColumn(result, lineStart, column);
        return { text: result, selectionStart: caret, selectionEnd: caret };
    }

    /** Move Line Up/Down (Alt+Up/Down): the touched lines swap with the next one. */
    function moveLines(text, start, end, direction) {
        const bounds = selectedLineBounds(text, start, end);
        const block = text.slice(bounds.start, bounds.end);
        if (direction < 0) {
            if (bounds.start === 0) return null;
            const previousStart = lineStartAt(text, bounds.start - 1);
            const previous = text.slice(previousStart, bounds.start - 1);
            const result = text.slice(0, previousStart) + block + '\n' + previous + text.slice(bounds.end);
            const shift = bounds.start - previousStart;
            return { text: result, selectionStart: start - shift, selectionEnd: end - shift };
        }
        if (bounds.end >= text.length) return null;
        const nextEndIndex = text.indexOf('\n', bounds.end + 1);
        const nextEnd = nextEndIndex === -1 ? text.length : nextEndIndex;
        const next = text.slice(bounds.end + 1, nextEnd);
        const result = text.slice(0, bounds.start) + next + '\n' + block + text.slice(nextEnd);
        const shift = next.length + 1;
        return { text: result, selectionStart: start + shift, selectionEnd: end + shift };
    }

    /** Copy Line Up/Down (Shift+Alt+Up/Down): the touched lines are duplicated. */
    function copyLines(text, start, end, direction) {
        const bounds = selectedLineBounds(text, start, end);
        const block = text.slice(bounds.start, bounds.end);
        const result = text.slice(0, bounds.end) + '\n' + block + text.slice(bounds.end);
        if (direction < 0) return { text: result, selectionStart: start, selectionEnd: end };
        const shift = block.length + 1;
        return { text: result, selectionStart: start + shift, selectionEnd: end + shift };
    }

    /** Cut with nothing selected (Cmd/Ctrl+X) takes the whole line, with its break. */
    function lineForCut(text, offset) {
        const bounds = selectedLineBounds(text, offset, offset);
        const to = bounds.end < text.length ? bounds.end + 1 : bounds.end;
        return { start: bounds.start, end: to, text: text.slice(bounds.start, to) };
    }

    // ---- Backspace and Delete ---------------------------------------------
    // On the source text, not the text area: the text area holds direction
    // marks at line starts, and a native Backspace there would erase a mark
    // instead of the line break.

    function previousCharacterStart(text, offset) {
        if (offset <= 0) return 0;
        const code = text.charCodeAt(offset - 1);
        if (code >= 0xdc00 && code <= 0xdfff && offset >= 2) {
            const high = text.charCodeAt(offset - 2);
            if (high >= 0xd800 && high <= 0xdbff) return offset - 2;
        }
        return offset - 1;
    }

    function nextCharacterEnd(text, offset) {
        if (offset >= text.length) return text.length;
        const code = text.charCodeAt(offset);
        if (code >= 0xd800 && code <= 0xdbff && offset + 1 < text.length) return offset + 2;
        return offset + 1;
    }

    /** Where a word-wise erase backwards stops (Alt+Backspace on macOS, Ctrl+Backspace elsewhere). */
    function wordBoundaryBefore(text, offset) {
        let at = offset;
        while (at > 0 && text[at - 1] !== '\n' && /\s/.test(text[at - 1])) at--;
        if (at > 0 && text[at - 1] === '\n' && at === offset) return at - 1;
        if (at > 0 && isWordCharacter(text[at - 1])) {
            while (at > 0 && isWordCharacter(text[at - 1])) at--;
        } else if (at > 0 && text[at - 1] !== '\n') {
            const kind = text[at - 1];
            while (at > 0 && text[at - 1] === kind) at--;
        }
        return at;
    }

    function wordBoundaryAfter(text, offset) {
        let at = offset;
        while (at < text.length && text[at] !== '\n' && /\s/.test(text[at])) at++;
        if (at < text.length && text[at] === '\n' && at === offset) return at + 1;
        if (at < text.length && isWordCharacter(text[at])) {
            while (at < text.length && isWordCharacter(text[at])) at++;
        } else if (at < text.length && text[at] !== '\n') {
            const kind = text[at];
            while (at < text.length && text[at] === kind) at++;
        }
        return at;
    }

    /**
     * Backspace. `mode`: 'char' (one character; in leading spaces, back to
     * the previous indentation stop, as VS Code's useTabStops), 'word', or
     * 'line' (to the line's start, Cmd+Backspace on macOS). A selection is
     * erased whatever the mode.
     */
    function backspaceEdit(text, start, end, mode = 'char', indentSize = 4) {
        if (start !== end) {
            const from = Math.min(start, end);
            const to = Math.max(start, end);
            return { text: text.slice(0, from) + text.slice(to), selectionStart: from, selectionEnd: from };
        }
        if (start <= 0) return null;
        let from;
        if (mode === 'word') {
            from = wordBoundaryBefore(text, start);
        } else if (mode === 'line') {
            const lineStart = lineStartAt(text, start);
            from = lineStart === start ? start - 1 : lineStart;
        } else {
            const lineStart = lineStartAt(text, start);
            const before = text.slice(lineStart, start);
            if (before.length > 0 && /^ +$/.test(before) && indentSize > 1) {
                const stop = Math.floor((before.length - 1) / indentSize) * indentSize;
                from = lineStart + stop;
            } else {
                from = previousCharacterStart(text, start);
            }
        }
        return { text: text.slice(0, from) + text.slice(start), selectionStart: from, selectionEnd: from };
    }

    /** Delete (forward). `mode`: 'char', 'word' or 'line' (to the line's end). */
    function deleteForwardEdit(text, start, end, mode = 'char') {
        if (start !== end) return backspaceEdit(text, start, end);
        if (start >= text.length) return null;
        let to;
        if (mode === 'word') to = wordBoundaryAfter(text, start);
        else if (mode === 'line') {
            const newline = text.indexOf('\n', start);
            to = newline === -1 ? text.length : (newline === start ? start + 1 : newline);
        } else to = nextCharacterEnd(text, start);
        return { text: text.slice(0, start) + text.slice(to), selectionStart: start, selectionEnd: start };
    }

    /**
     * Applies non-overlapping text edits ({ start, end, text } in source
     * offsets of `text`) and returns the new text with a function that maps an
     * offset of the old text to the new one (an offset inside a replaced range
     * maps to the end of its replacement).
     */
    function applyTextEdits(text, edits) {
        const sorted = (edits || [])
            .map((edit) => ({ start: edit.start, end: edit.end, text: edit.text || '' }))
            .filter((edit) => edit.start >= 0 && edit.end >= edit.start && edit.end <= text.length)
            .sort((a, b) => a.start - b.start || a.end - b.end);
        let result = '';
        let last = 0;
        for (const edit of sorted) {
            if (edit.start < last) return null;
            result += text.slice(last, edit.start) + edit.text;
            last = edit.end;
        }
        result += text.slice(last);
        const map = (offset) => {
            let delta = 0;
            for (const edit of sorted) {
                if (offset < edit.start) break;
                if (offset < edit.end || (offset === edit.end && edit.end > edit.start)) {
                    return edit.start + delta + edit.text.length;
                }
                delta += edit.text.length - (edit.end - edit.start);
            }
            return offset + delta;
        };
        return { text: result, map };
    }

    /**
     * Maps an offset of `before` into `after` when the text changed outside the
     * editor (a format, a rename, an undo): the common prefix and suffix are
     * kept, an offset after the change moves with it, one inside it goes to
     * the end of the new text of the change.
     */
    function mapOffsetThroughChange(before, after, offset) {
        if (before === after) return offset;
        let prefix = 0;
        const max = Math.min(before.length, after.length);
        while (prefix < max && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix += 1;
        let suffix = 0;
        while (suffix < max - prefix
            && before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)) suffix += 1;
        if (offset <= prefix) return offset;
        if (offset >= before.length - suffix) return offset + (after.length - before.length);
        return after.length - suffix;
    }

    /** The number of line breaks in text[start, end). */
    function countLineBreaks(text, start, end) {
        let count = 0;
        for (let i = Math.max(0, start); i < Math.min(end, text.length); i += 1) if (text.charCodeAt(i) === 10) count += 1;
        return count;
    }

    /**
     * The scroll position that shows a line, as VS Code reveals: unchanged when
     * the line is fully visible; otherwise the smallest scroll that shows it
     * (`minimal`, for the caret after an edit) or the line a third down the
     * view (`center`, for a jump to a definition or a search result).
     */
    function revealScrollTop(scrollTop, viewHeight, lineTop, lineHeight, mode) {
        const lineBottom = lineTop + lineHeight;
        if (lineTop >= scrollTop && lineBottom <= scrollTop + viewHeight) return scrollTop;
        if (mode === 'center') return Math.max(0, lineTop - viewHeight / 3);
        if (lineTop < scrollTop) return Math.max(0, lineTop);
        return Math.max(0, lineBottom - viewHeight);
    }

    /** FNV-1a over UTF-16 code units: both sides check they have the same text. */
    function textHash(text) {
        let hash = 0x811c9dc5;
        for (let i = 0; i < text.length; i += 1) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193) >>> 0;
        }
        return hash;
    }

    return {
        textHash,
        applyTextEdits,
        mapOffsetThroughChange,
        countLineBreaks,
        revealScrollTop,
        backspaceEdit,
        deleteForwardEdit,
        deleteLines,
        moveLines,
        copyLines,
        lineForCut,
        completionMatchIndices,
        isWordCharacter,
        wordStartAt,
        completionTriggerAt,
        filterCompletionItems,
        enterEdit,
        closingBracketEdit,
        matchingOpenerIndent,
        toggleLineComment,
        indentLines,
        outdentLines,
        selectedLineBounds,
    };
});
