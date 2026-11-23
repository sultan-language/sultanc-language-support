'use strict';

const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// features.js needs `vscode` only at call sites; stub it.
const original = Module._load;
Module._load = function load(request, ...rest) {
    if (request === 'vscode') return { window: {}, StatusBarAlignment: {} };
    return original.call(this, request, ...rest);
};
const features = require('../src/features');
Module._load = original;

test('the extension adds no second CodeLens, Test Explorer or rename handler', () => {
    // CodeLens, tests and import updates on rename are the server's.
    assert.deepStrictEqual(Object.keys(features).sort(), ['BusyIndicator', 'registerFeatures']);
});

test('busy middleware wraps the waited-on requests', () => {
    const busy = Object.create(features.BusyIndicator.prototype);
    busy.track = (p) => p;
    const middleware = busy.middleware();
    assert.ok(middleware.provideCompletionItem && middleware.provideReferences && middleware.provideDiagnostics);
    assert.strictEqual(middleware.provideCodeLenses, undefined);
});
