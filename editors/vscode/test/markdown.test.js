'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { render } = require('../media/markdown');

test('renders hover markdown produced by sultanc-analyzer', () => {
    const html = render('```sultanc\ndef area(shape: Shape): int\n```\n\n---\n\n**Kind:** function  \n**Type:** `fn(Shape): int`');
    assert.match(html, /<pre dir="auto"><code>def area\(shape: Shape\): int<\/code><\/pre>/);
    assert.match(html, /<hr>/);
    assert.match(html, /<strong>Kind:<\/strong> function<br><strong>Type:<\/strong> <code dir="auto">fn\(Shape\): int<\/code>/);
});

test('escapes HTML everywhere, including inside code', () => {
    const html = render('<img src=x onerror=alert(1)> `<b>` \n```\n</code><script>\n```');
    assert.ok(!html.includes('<img'));
    assert.ok(!html.includes('<script>'));
    assert.match(html, /&lt;img/);
    assert.match(html, /<code dir="auto">&lt;b&gt;<\/code>/);
});

test('links keep only file/http(s) targets', () => {
    assert.match(render('[a.sn:1:5](file:///x/a.sn#L1,5)'), /<a href="#" data-href="file:\/\/\/x\/a.sn#L1,5">a.sn:1:5<\/a>/);
    assert.ok(!render('[x](javascript:alert)').includes('data-href'));
});

test('renders Arabic hover labels unchanged', () => {
    const html = render('**الصنف:** دالة  \n**النوع:** `دالة(عدد, عدد): عدد`');
    assert.match(html, /<strong>الصنف:<\/strong> دالة<br>/);
});
