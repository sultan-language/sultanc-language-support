'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
    createRenderer,
    createPresentationText,
    stripPresentationMarks,
    sourceOffsetFromPresentation,
    presentationOffsetFromSource,
    LRM,
    RLM,
} = require('../media/syntaxRenderer');

const root = path.resolve(__dirname, '..');
const surface = JSON.parse(fs.readFileSync(path.join(root, 'resources', 'syntax-surface.json'), 'utf8'));
const renderer = createRenderer(surface);

function visibleText(html) {
    return html
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

test('renderer preserves the exact visible SultanC source', () => {
    const source = 'عرف الرئيسية(): عدد {\n    ليكن س: عدد = 2;\n}\n';
    const html = renderer.render(source);
    assert.equal(visibleText(html), source);
    assert.doesNotMatch(html, /[\u202A-\u202E\u2066-\u2069]/u);
});

test('paired delimiters stay bidi-native so RTL opening and closing braces match the textarea', () => {
    const source = 'عام نوع عقد_دلالي_بدائي = {\n    عدد_الحجج: طبيعي,\n};\n';
    const html = renderer.render(source);
    assert.equal(visibleText(html), source);
    assert.match(html, /<span class="syntax-operator">\{<\/span>/);
    assert.match(html, /<span class="syntax-operator">\}<\/span><span class="syntax-operator">;<\/span>/);
    assert.doesNotMatch(html, /syntax-technical[^>]*>\{<\/bdi>/);
    assert.doesNotMatch(html, /syntax-technical[^>]*>\}<\/bdi>/);
});

test('RTL arrow points with the RTL control flow without changing source bytes', () => {
    const source = 'طابق س مع {\n| مفتاح_صياغة.رسالة_خطأ_نحوي -> {\n    إذا س <= ص { أرجع س; };\n}\n';
    const html = renderer.render(source);
    assert.equal(visibleText(html), source);
    assert.match(html, /<bdi class="syntax-operator syntax-technical syntax-rtl-arrow" dir="ltr">-&gt;<\/bdi>/);
    assert.match(html, /<bdi class="syntax-operator syntax-technical" dir="ltr">&lt;=<\/bdi>/);
});

test('LTR arrow keeps its normal right-pointing presentation', () => {
    const source = 'match value {\n| 2 -> { return 2; }\n}';
    const html = renderer.render(source);
    assert.equal(visibleText(html), source);
    assert.match(html, /<bdi class="syntax-operator syntax-technical" dir="ltr">-&gt;<\/bdi>/);
    assert.doesNotMatch(html, /syntax-rtl-arrow/);
});

test('RTL arrow presentation uses visual mirroring only', () => {
    const css = fs.readFileSync(path.join(root, 'media', 'editor.css'), 'utf8');
    assert.match(css, /\.syntax-rtl-arrow[\s\S]*transform:\s*scaleX\(-1\)/);
});

test('all Latin identifiers remain one LTR run when embedded in Arabic code', () => {
    const source = 'عرف compare_byte_vectors_lexicographically(أ: مؤشر): منطقي {\n    أرجع helper_name(أ);\n}\n';
    const html = renderer.render(source);
    assert.equal(visibleText(html), source);
    assert.match(html, /<bdi class="syntax-function syntax-ltr-identifier" dir="ltr">compare_byte_vectors_lexicographically<\/bdi>/);
    assert.match(html, /<bdi class="syntax-ltr-identifier" dir="ltr">helper_name<\/bdi>/);
});

test('English-first declarations remain naturally LTR', () => {
    const source = 'public alias byte_vectors_equal = متجه_بايتات_متساويان;';
    const html = renderer.render(source);
    assert.match(html, /<span class="syntax-typeName">byte_vectors_equal<\/span>/);
    assert.doesNotMatch(html, /syntax-typeName syntax-ltr-identifier[^>]*>byte_vectors_equal/);
    assert.equal(visibleText(html), source);
});

test('numbers remain source-native while highlighted', () => {
    const source = 'أرجع 0;\nليكن س = 0xFF_FF;';
    const html = renderer.render(source);
    assert.equal(visibleText(html), source);
    assert.match(html, /<span class="syntax-number">0<\/span>/);
    assert.match(html, /<span class="syntax-number">0xFF_FF<\/span>/);
});

test('Kashida remains presentation-equivalent to the compiler identifier policy', () => {
    const normal = renderer.render('أرجع 1;');
    const stretched = renderer.render('أر\u0640ج\u0640ع 1;');
    assert.match(normal, /syntax-control/);
    assert.match(stretched, /syntax-control/);
    assert.equal(renderer.canonicalIdentifier('أر\u0640ج\u0640ع'), 'أرجع');
});

test('editor keeps per-line plaintext bidi plus targeted Latin isolation', () => {
    const css = fs.readFileSync(path.join(root, 'media', 'editor.css'), 'utf8');
    assert.match(css, /unicode-bidi:\s*plaintext/);
    assert.match(css, /\.syntax-ltr-identifier[\s\S]*unicode-bidi:\s*isolate/);
});


test('punctuation-only closing brace inherits its RTL block direction', () => {
    const source = [
        'عام نوع تجهيز_معامل_تجميعي_ذراع = {',
        '    المعرف: معرف_قيمة_مسير,',
        '    public_alias: byte_vectors_equal,',
        '};',
    ].join('\n');
    const presentation = createPresentationText(source, 'rtl');
    const lines = presentation.split('\n');

    assert.equal(lines[0][0], RLM);
    assert.equal(lines[1][0], RLM);
    // Even though the immediately preceding member starts LTR, the block closer
    // uses the direction of the matching Arabic opening brace.
    assert.equal(lines[2][0], LRM);
    assert.equal(lines[3][0], RLM);
    assert.equal(stripPresentationMarks(presentation), source);
});

test('punctuation-only closing brace inherits its LTR block direction', () => {
    const source = [
        'public type Example = {',
        '    الحقل: طبيعي,',
        '};',
    ].join('\n');
    const presentation = createPresentationText(source, 'ltr');
    const lines = presentation.split('\n');

    assert.equal(lines[0][0], LRM);
    assert.equal(lines[1][0], RLM);
    assert.equal(lines[2][0], LRM);
    assert.equal(stripPresentationMarks(presentation), source);
});

test('presentation direction anchors never change source offsets or persisted text', () => {
    const source = 'عام نوع مثال = {\n    قيمة: طبيعي,\n};';
    const presentation = createPresentationText(source, 'rtl');

    for (let offset = 0; offset <= source.length; offset += 1) {
        const presentationOffset = presentationOffsetFromSource(presentation, offset);
        assert.equal(sourceOffsetFromPresentation(presentation, presentationOffset), offset);
    }
    assert.equal(stripPresentationMarks(presentation), source);
});

test('dotted Latin module paths stay one LTR run in Arabic lines', () => {
    const html = renderer.render('استورد compiler.source.provenance;');
    assert.match(html, /<bdi class="syntax-ltr-identifier syntax-module-path" dir="ltr">compiler\.source\.provenance<\/bdi>/);
});
