'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    offsetFromLspPosition,
    diagnosticsAtOffset,
    renderOverlay,
    formatDiagnostic,
} = require('../media/diagnosticRenderer');

const range = { start: { line: 2, character: 4 }, end: { line: 2, character: 10 } };
const source = 'def main(): i32 {\n    print("Hello\\n")\n    return 0;\n}\n';

test('LSP UTF-16 positions map to logical source offsets', () => {
    assert.equal(source.slice(offsetFromLspPosition(source, range.start), offsetFromLspPosition(source, range.end)), 'return');
});

test('diagnostic lookup uses the compiler-provided range', () => {
    const diagnostic = { range, severity: 1, message: 'syntax error' };
    const offset = offsetFromLspPosition(source, { line: 2, character: 6 });
    assert.deepEqual(diagnosticsAtOffset(source, [diagnostic], offset), [diagnostic]);
});

test('overlay underlines exactly the diagnostic source range', () => {
    const diagnostic = { range, severity: 1, message: 'syntax error' };
    const identity = (_presentation, offset) => offset;
    const html = renderOverlay(source, source, [diagnostic], identity);
    assert.match(html, /<span class="diagnostic-span diagnostic-error">return<\/span>/);
    assert.equal(html.includes('<span class="diagnostic-span diagnostic-error">    </span>'), false);
});



test('RTL presentation anchors do not shift diagnostic underlines', () => {
    const { createPresentationText, presentationOffsetFromSource } = require('../media/syntaxRenderer');
    const rtlSource = 'عرف الرئيسية(): عدد {\n    أرجع missing;\n}\n';
    const line = '    أرجع missing;';
    const start = line.indexOf('missing');
    const rtlRange = { start: { line: 1, character: start }, end: { line: 1, character: start + 'missing'.length } };
    const presentation = createPresentationText(rtlSource, 'rtl');
    const html = renderOverlay(rtlSource, presentation, [{ range: rtlRange, severity: 1 }], presentationOffsetFromSource);
    assert.match(html, /<span class="diagnostic-span diagnostic-error">missing<\/span>/);
});
test('rich diagnostic text preserves compiler facts and quick-fix availability', () => {
    const text = formatDiagnostic({
        range,
        code: 'SULTANC-E0001',
        message: 'syntax error: expected `;`, found `return`',
        relatedInformation: [{ location: { uri: 'file:///tmp/a.sn', range }, message: 'related context' }],
        data: {
            primaryRoleLabel: 'parser discovered the problem here',
            arguments: [
                { key: 'expected', label: 'expected', value: ';' },
                { key: 'found', label: 'found', value: 'return' },
            ],
            notes: [{ message: 'note text' }],
            help: [{ message: 'insert `;` after this construct' }],
            fixes: [{ message: 'insert `;` after this construct', applicability: 'machine-applicable' }],
            trace: [],
        },
    });
    assert.match(text, /SULTANC-E0001/);
    assert.match(text, /Ln 3, Col 5-11/);
    assert.match(text, /expected: ;/);
    assert.match(text, /found: return/);
    assert.match(text, /parser discovered the problem here/);
    assert.match(text, /related: related context/);
    assert.match(text, /help: insert `;` after this construct/);
    assert.match(text, /fix: insert `;` after this construct · machine-applicable/);
    assert.match(text, /Quick Fix:/);
});
