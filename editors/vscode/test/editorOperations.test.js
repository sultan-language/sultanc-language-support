'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    toggleLineComment,
    indentLines,
    outdentLines,
} = require('../media/editorOperations');
const operations = require('../media/editorOperations');

test('Cmd/Ctrl+/ comments and uncomments the current indented SultanC line', () => {
    const source = 'def main(): int {\n    return 42;\n}\n';
    const cursor = source.indexOf('return') + 3;
    const commented = toggleLineComment(source, cursor, cursor);
    assert.equal(commented.text, 'def main(): int {\n    // return 42;\n}\n');
    assert.equal(commented.text[commented.selectionStart], 'u');

    const restored = toggleLineComment(commented.text, commented.selectionStart, commented.selectionEnd);
    assert.equal(restored.text, source);
});

test('line comment toggle handles selected Arabic and English lines without changing text direction', () => {
    const source = 'عرف الرئيسية(): عدد {\n    ليكن x: عدد = 1;\n    return x;\n}\n';
    const start = source.indexOf('    ليكن');
    const end = source.indexOf('    return') + '    return x;'.length;
    const commented = toggleLineComment(source, start, end);
    assert.equal(
        commented.text,
        'عرف الرئيسية(): عدد {\n    // ليكن x: عدد = 1;\n    // return x;\n}\n'
    );
    assert.doesNotMatch(commented.text, /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/iu);
});

test('toggle line comment uncomments only when every nonblank selected line is commented', () => {
    const source = '    // first\n\n    // second\n';
    const changed = toggleLineComment(source, 0, source.length);
    assert.equal(changed.text, '    first\n\n    second\n');
});

test('Tab indents selected lines and Shift+Tab removes one indent unit', () => {
    const source = 'one\ntwo\nthree\n';
    const indented = indentLines(source, 0, source.indexOf('three'), '    ');
    assert.equal(indented.text, '    one\n    two\nthree\n');

    const restored = outdentLines(indented.text, 0, indented.text.indexOf('three'), '    ');
    assert.equal(restored.text, source);
});

test('outdent accepts a tab or partial spaces without deleting source content', () => {
    const source = '\talpha\n  beta\ngamma';
    const changed = outdentLines(source, 0, source.length, '    ');
    assert.equal(changed.text, 'alpha\nbeta\ngamma');
});

const { enterEdit, closingBracketEdit } = require('../media/editorOperations');

test('Enter keeps only the current line indentation, not the lines above', () => {
    const source = 'عرف الرئيسية(): عدد {\n    \n}\n';
    const cursor = source.indexOf('    \n') + 4;
    const once = enterEdit(source, cursor, cursor, '    ');
    assert.equal(once.text, 'عرف الرئيسية(): عدد {\n\n    \n}\n');
    const twice = enterEdit(once.text, once.selectionStart, once.selectionEnd, '    ');
    assert.equal(twice.text, 'عرف الرئيسية(): عدد {\n\n\n    \n}\n');
});

test('Enter after an opening brace indents one level, and splits a {} pair', () => {
    const source = 'def main(): int {}\n';
    const cursor = source.indexOf('{') + 1;
    const result = enterEdit(source, cursor, cursor, '    ');
    assert.equal(result.text, 'def main(): int {\n    \n}\n');
    assert.equal(result.selectionStart, source.indexOf('{') + 6);
    const inner = 'def main(): int {\n    if (x) {\n';
    const deeper = enterEdit(inner, inner.length - 1, inner.length - 1, '    ');
    assert.equal(deeper.text, 'def main(): int {\n    if (x) {\n        \n');
});

test('Enter in the middle of a statement keeps its indentation and drops trailing blanks', () => {
    const source = '    let x: int = 1;   rest\n';
    const cursor = source.indexOf('rest');
    const result = enterEdit(source, cursor, cursor, '    ');
    assert.equal(result.text, '    let x: int = 1;\n    rest\n');
});

test('typing } on a blank line aligns it with the line that opened the block', () => {
    const source = 'عرف الرئيسية(): عدد {\n    إذا (س) {\n        أرجع 1;\n        \n';
    const cursor = source.length - 1;
    const result = closingBracketEdit(source, cursor, cursor, '}');
    assert.equal(result.text, 'عرف الرئيسية(): عدد {\n    إذا (س) {\n        أرجع 1;\n    }\n');
    const braces = 'def f(): int {\n    let s: string = "{";\n    \n';
    const fixed = closingBracketEdit(braces, braces.length - 1, braces.length - 1, '}');
    assert.equal(fixed.text, 'def f(): int {\n    let s: string = "{";\n}\n');
});

test('completion while typing: a dot or a new word opens, more letters filter, anything else closes', () => {
    const { completionTriggerAt, wordStartAt } = operations;
    assert.equal(completionTriggerAt('return outer_value.', 19, null), 'open');
    assert.equal(completionTriggerAt('return d', 8, null), 'open');
    assert.equal(completionTriggerAt('return de', 9, wordStartAt('return de', 9)), 'filter');
    assert.equal(completionTriggerAt('أرجع ن', 6, null), 'open');
    assert.equal(completionTriggerAt('أرجع ن.', 7, null), 'open');
    assert.equal(completionTriggerAt('x = ', 4, 0), 'close');
    assert.equal(completionTriggerAt('let n: int = 12', 15, null), 'close');
    assert.equal(wordStartAt('let z = deep', 12), 8);
    assert.equal(wordStartAt('ليكن ع = عمق_ثاني', 17), 9);
});

test('completion filter: in order, ASCII case ignored, prefixes first, server order kept', () => {
    const items = [{ label: 'middle' }, { label: 'deepest' }, { label: 'Deep_x' }, { label: 'top' }, { label: 'عمق' }];
    assert.deepEqual(operations.filterCompletionItems(items, 'de').map((i) => i.label), ['deepest', 'Deep_x', 'middle']);
    assert.deepEqual(operations.filterCompletionItems(items, 'عم').map((i) => i.label), ['عمق']);
    assert.deepEqual(operations.filterCompletionItems(items, '').map((i) => i.label), items.map((i) => i.label));
});

test('completion match highlight: prefix first, else in-order letters', () => {
    assert.deepEqual(operations.completionMatchIndices('deepest', 'de'), [0, 1]);
    assert.deepEqual(operations.completionMatchIndices('Deep_x', 'de'), [0, 1]);
    assert.deepEqual(operations.completionMatchIndices('middle', 'de'), [2, 5]);
    assert.deepEqual(operations.completionMatchIndices('عمق_ثاني', 'عث'), [0, 4]);
    assert.deepEqual(operations.completionMatchIndices('top', 'x'), []);
});

test('Delete Line removes the touched lines and keeps the caret column', () => {
    const text = 'aaa\nbbbb\ncc\n';
    assert.deepEqual(operations.deleteLines(text, 6, 6), { text: 'aaa\ncc\n', selectionStart: 6, selectionEnd: 6 });
    assert.deepEqual(operations.deleteLines(text, 1, 6), { text: 'cc\n', selectionStart: 1, selectionEnd: 1 });
    assert.deepEqual(operations.deleteLines('a\nlast', 3, 3), { text: 'a', selectionStart: 1, selectionEnd: 1 });
    assert.deepEqual(operations.deleteLines('ليكن س = 1;\nأرجع س;\n', 2, 2), { text: 'أرجع س;\n', selectionStart: 2, selectionEnd: 2 });
});

test('Move and copy lines, and cut of the whole line', () => {
    assert.deepEqual(operations.moveLines('a\nb\nc', 2, 2, -1), { text: 'b\na\nc', selectionStart: 0, selectionEnd: 0 });
    assert.deepEqual(operations.moveLines('a\nb\nc', 2, 2, 1), { text: 'a\nc\nb', selectionStart: 4, selectionEnd: 4 });
    assert.equal(operations.moveLines('a\nb', 0, 0, -1), null);
    assert.deepEqual(operations.copyLines('a\nb', 2, 2, 1), { text: 'a\nb\nb', selectionStart: 4, selectionEnd: 4 });
    assert.deepEqual(operations.lineForCut('a\nbc\nd', 3), { start: 2, end: 5, text: 'bc\n' });
});

test('Backspace and Delete on the source text: line breaks, indentation stops, words, lines, pairs of code units', () => {
    const { backspaceEdit, deleteForwardEdit } = operations;
    const text = 'a\n\n    b\n';
    // Empty line: joins with the line above.
    assert.deepEqual(backspaceEdit(text, 2, 2), { text: 'a\n    b\n', selectionStart: 1, selectionEnd: 1 });
    // Start of a line: joins it to the previous one.
    assert.deepEqual(backspaceEdit('ab\ncd', 3, 3), { text: 'abcd', selectionStart: 2, selectionEnd: 2 });
    // In leading spaces: back to the previous indentation stop.
    assert.deepEqual(backspaceEdit(text, 7, 7), { text: 'a\n\nb\n', selectionStart: 3, selectionEnd: 3 });
    assert.deepEqual(backspaceEdit('      x', 6, 6), { text: '    x', selectionStart: 4, selectionEnd: 4 });
    // A whole character beyond the BMP.
    assert.deepEqual(backspaceEdit('a😀', 3, 3), { text: 'a', selectionStart: 1, selectionEnd: 1 });
    // Arabic letters one at a time.
    assert.deepEqual(backspaceEdit('ليكن س', 6, 6), { text: 'ليكن ', selectionStart: 5, selectionEnd: 5 });
    // Word and line.
    assert.deepEqual(backspaceEdit('let outer_value', 15, 15, 'word'), { text: 'let ', selectionStart: 4, selectionEnd: 4 });
    assert.deepEqual(backspaceEdit('x\n    let a', 11, 11, 'line'), { text: 'x\n', selectionStart: 2, selectionEnd: 2 });
    // A selection.
    assert.deepEqual(backspaceEdit('abcdef', 4, 1), { text: 'aef', selectionStart: 1, selectionEnd: 1 });
    assert.equal(backspaceEdit('abc', 0, 0), null);
    // Delete forward: at a line's end joins the next line.
    assert.deepEqual(deleteForwardEdit('ab\ncd', 2, 2), { text: 'abcd', selectionStart: 2, selectionEnd: 2 });
    assert.deepEqual(deleteForwardEdit('ab cd', 0, 0, 'word'), { text: ' cd', selectionStart: 0, selectionEnd: 0 });
    assert.deepEqual(deleteForwardEdit('ab cd\nx', 1, 1, 'line'), { text: 'a\nx', selectionStart: 1, selectionEnd: 1 });
    assert.equal(deleteForwardEdit('ab', 2, 2), null);
});

test('applyTextEdits: a completion with an import above; offsets map through both', () => {
    const ops = require('../media/editorOperations');
    const r = ops.applyTextEdits('abc\nlet x = int_to\n', [
        { start: 12, end: 18, text: 'int_to_text', primary: true },
        { start: 0, end: 0, text: 'import std.text.number;\n' },
    ]);
    assert.strictEqual(r.text, 'import std.text.number;\nabc\nlet x = int_to_text\n');
    assert.strictEqual(r.map(4), 28);
    assert.strictEqual(ops.applyTextEdits('ab', [{ start: 0, end: 2, text: 'x' }, { start: 1, end: 2, text: 'y' }]), null);
});

test('mapOffsetThroughChange keeps the caret with the text around it', () => {
    const ops = require('../media/editorOperations');
    assert.strictEqual(ops.mapOffsetThroughChange('a\nb\nc', 'x\na\nb\nc', 4), 6);
    assert.strictEqual(ops.mapOffsetThroughChange('let a=1;\nb', 'let a = 1;\nb', 9), 11);
    assert.strictEqual(ops.mapOffsetThroughChange('same', 'same', 2), 2);
});

test('revealScrollTop scrolls only when the line is out of view', () => {
    const ops = require('../media/editorOperations');
    assert.strictEqual(ops.revealScrollTop(100, 200, 150, 20, 'minimal'), 100);
    assert.strictEqual(ops.revealScrollTop(100, 200, 320, 20, 'minimal'), 140);
    assert.strictEqual(ops.revealScrollTop(100, 200, 40, 20, 'minimal'), 40);
    assert.strictEqual(ops.revealScrollTop(100, 200, 40, 20, 'center'), 0);
    assert.strictEqual(ops.textHash('abc'), ops.textHash('abc'));
    assert.notStrictEqual(ops.textHash('abc'), ops.textHash('abd'));
});
