'use strict';
// Unit tests for the `sultanc test` report parser (src/testing.js).
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const original = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'vscode') return {};
    return original.call(this, request, ...rest);
};
const { parseTestReport, testArguments, debugTestArguments, testIndex, debugTestBinary } = require('../src/testing');
Module._load = original;

test('parses PASS and FAIL lines with their details', () => {
    const report = [
        'PASS doubles',
        'FAIL assertion_fails: exit status 1',
        '    --> tests/main.sn:18:5',
        '    error[SULTANC-RUNTIME-PROGRAM-STOPPED]: the program stopped — An assertion failed.',
        'FAIL returns_error: returned an error',
        '    --> tests/main.sn:28:5',
        '    double(20) is 40, expected 41',
        'PASS يضاعف',
        '',
        'test result: FAILED. passed: 2; failed: 2; filtered out: 0',
    ].join('\n');
    assert.deepStrictEqual(parseTestReport(report), [
        { name: 'doubles', passed: true, reason: '', details: [] },
        { name: 'assertion_fails', passed: false, reason: 'exit status 1', details: [
            '--> tests/main.sn:18:5',
            'error[SULTANC-RUNTIME-PROGRAM-STOPPED]: the program stopped — An assertion failed.'] },
        { name: 'returns_error', passed: false, reason: 'returned an error', details: [
            '--> tests/main.sn:28:5', 'double(20) is 40, expected 41'] },
        { name: 'يضاعف', passed: true, reason: '', details: [] },
    ]);
});

test('builds the command for one file and one test', () => {
    assert.deepStrictEqual(testArguments('/home/s', '/home/s/a/t.sn', null), ['--lang=en', 'test', 'a/t.sn']);
    assert.deepStrictEqual(testArguments('/home/s', '/w/t.sn', 'يضاعف'), ['--lang=en', 'test', '/w/t.sn', '--test=يضاعف']);
    assert.deepStrictEqual(testArguments('/home/s', '/w/t.sn', 'a', true), ['--lang=en', 'test', '/w/t.sn', '--test=a', '--package-graph=-']);
});

test('debugging one test: --no-run build arguments, the printed index, a stable program path', () => {
    assert.deepStrictEqual(debugTestArguments('/home/s', '/w/calc.sn', 'adding_works', '/tmp/p'),
        ['--lang=en', 'test', '/w/calc.sn', '--test=adding_works', '-O0', '-o', '/tmp/p', '--no-run']);
    assert.deepStrictEqual(debugTestArguments('/home/s', '/w/calc.sn', 'يضاعف', '/tmp/p', true).slice(-1), ['--package-graph=-']);
    assert.strictEqual(testIndex('0 adding_works\n', 'adding_works'), 0);
    assert.strictEqual(testIndex('0 a\n1 يضاعف\n', 'يضاعف'), 1);
    assert.strictEqual(testIndex('error: …', 'a'), -1);
    assert.strictEqual(debugTestBinary('/w/a.sn', 't'), debugTestBinary('/w/a.sn', 't'));
    assert.notStrictEqual(debugTestBinary('/w/a.sn', 't'), debugTestBinary('/w/a.sn', 'u'));
});
