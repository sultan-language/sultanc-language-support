'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    hoverText,
    completionItems,
    signatureText,
    locations,
    flattenDocumentSymbols,
    diagnosticsForWebview,
} = require('../src/customLspBridge');

test('hover text preserves LSP content without HTML interpretation', () => {
    assert.equal(hoverText({ contents: [{ language: 'sultanc', value: 'دالة جمع' }, 'detail'] }), 'دالة جمع\n\ndetail');
});

test('completion normalization preserves raw index for acceptance', () => {
    assert.deepEqual(completionItems({ items: [
        { label: 'اطبع', detail: 'function', kind: 3 },
        { label: { label: 'print' } },
        { label: 'degrees_f64', kind: 3, detail: 'import std.math.float;', additionalTextEdits: [{ newText: 'import std.math.float;\n' }] },
    ] }), [
        { index: 0, label: 'اطبع', detail: 'function', documentation: '', kind: 3, importFrom: '' },
        { index: 1, label: 'print', detail: '', documentation: '', kind: 1, importFrom: '' },
        { index: 2, label: 'degrees_f64', detail: 'import std.math.float;', documentation: '', kind: 3, importFrom: 'std.math.float' },
    ]);
});

test('signature normalization selects active signature', () => {
    assert.equal(signatureText({
        activeSignature: 1,
        signatures: [{ label: 'a()' }, { label: 'b(x)', documentation: 'docs' }],
    }), 'b(x)\ndocs');
});

test('location normalization accepts single and array results', () => {
    const item = { uri: 'file:///a.sn', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } };
    assert.deepEqual(locations(item), [item]);
    assert.deepEqual(locations([item, null]), [item]);
});

test('document symbols flatten nested symbols in source hierarchy order', () => {
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
    const result = flattenDocumentSymbols([{ name: 'A', range, selectionRange: range, children: [{ name: 'b', range }] }]);
    assert.equal(result.length, 2);
    assert.equal(result[1].parent, 'A');
    assert.equal(result[1].depth, 1);
});

test('diagnostics forwarded to webview retain compiler identity and structured facts', () => {
    const range = { start: { line: 2, character: 1 }, end: { line: 2, character: 4 } };
    const relatedInformation = [{ location: { uri: 'file:///a.sn', range }, message: 'previous use' }];
    const data = {
        primaryRole: 'parser-found',
        arguments: [{ key: 'expected', value: ';', label: 'expected' }],
        help: [{ message: 'insert `;`' }],
        fixes: [{ message: 'insert `;`', applicability: 'machine-applicable' }],
    };
    assert.deepEqual(diagnosticsForWebview([{
        range, severity: 1, code: 'SULTANC-E1', source: 'sultanc', message: 'bad', relatedInformation, data,
    }]), [
        { range, severity: 1, code: 'SULTANC-E1', source: 'sultanc', message: 'bad', relatedInformation, data },
    ]);
});

test('breadcrumb chain lists the enclosing symbols, outermost first', () => {
    const { symbolChainAt } = require('../src/customLspBridge');
    const range = (a, b, c, d) => ({ start: { line: a, character: b }, end: { line: c, character: d } });
    const symbols = [
        { name: 'نقطة', kind: 23, range: range(4, 0, 4, 30), selectionRange: range(4, 4, 4, 8) },
        { name: 'الرئيسية', kind: 12, range: range(11, 0, 16, 1), selectionRange: range(11, 4, 11, 12) },
        { name: 'النتيجة', kind: 13, range: range(13, 4, 13, 50), selectionRange: range(13, 7, 13, 14) },
    ];
    assert.deepEqual(symbolChainAt(symbols, { line: 13, character: 20 }).map((s) => s.name), ['الرئيسية', 'النتيجة']);
    assert.deepEqual(symbolChainAt(symbols, { line: 12, character: 2 }).map((s) => s.name), ['الرئيسية']);
    assert.deepEqual(symbolChainAt(symbols, { line: 2, character: 0 }), []);
});
