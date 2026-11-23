'use strict';
// Typing in the RTL editor (a webview, so the extension-host tests cannot type
// into it): starts VS Code (from @vscode/test-electron) with remote debugging,
// types through Playwright into the editor's text area like a person, and
// checks the completion list that opens by itself, in English and Arabic.
//
//   SULTANC_ANALYZER=/path/to/sultanc-analyzer SULTANC_HOME=/path/to/sultanc npm run test:rtl
//
// Needs Playwright (`require('playwright')`) and a display (xvfb-run on Linux).
// SULTANC_RTL_SHOTS=<dir> keeps a screenshot of each case; SULTANC_RTL_THEME sets
// the colour theme (e.g. "Default Light Modern").
const path = require('path');
const fs = require('fs');
const os = require('os');
const childProcess = require('child_process');
const { downloadAndUnzipVSCode } = require('@vscode/test-electron');
const { chromium } = require('playwright');

const PORT = 9333;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const english = `type Inner = { depth: int, label: string };
type Outer = { inner: Inner, count: int };
type Color = | Red | Green;

def make(): Outer { return { inner: { depth: 1, label: "a" }, count: 2 }; }
// Area of a rectangle.
def area(width: int, height: int): int { return width * height; }

def main(): int {
    let outer_value: Outer = make();
    let top: int = 1;
    if (top > 0) {
        let middle: int = 2;
        while (middle > 0) {
            let deepest: int = 3;

        }
    }
    return 0;
}
`;

const arabic = `نوع نقطة = { س: عدد, ص: عدد };

عرف الرئيسية(): عدد {
    ليكن ن: نقطة = { س: 1, ص: 2 };

    أرجع 0;
}
`;

// [file, line marker after which the empty line is, typed text, expected first items, accepted line or null]
const cases = [
    ['scope_test.sn', '= 3;\n', 'let z: int = de', ['deepest'], 'let z: int = deepest'],
    ['scope_test.sn', '= 3;\n', 'let z: int = outer_value.', ['inner', 'count'], null],
    ['scope_test.sn', '= 3;\n', 'let z: int = outer_value.inner.', ['depth', 'label'], null],
    ['scope_test.sn', '= 3;\n', 'let c: Color = Color.', ['Red', 'Green'], null],
    ['scope_test.sn', '= 3;\n', 'let a: int = are', ['area'], null],
    ['scope_test.sn', '= 3;\n', 'let r: string = int_to', ['int_to_text'], null],
    ['scope_ar.sn', 'ص: 2 };\n', 'أرجع ن.', ['س', 'ص'], null],
];

async function main() {
    const server = process.env.SULTANC_ANALYZER;
    const home = process.env.SULTANC_HOME;
    if (!server || !home) throw new Error('Set SULTANC_ANALYZER and SULTANC_HOME.');
    const shots = process.env.SULTANC_RTL_SHOTS || '';
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sultanc-rtl-'));
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sultanc-rtl-user-'));
    fs.mkdirSync(path.join(workspace, '.vscode'));
    fs.writeFileSync(path.join(workspace, '.vscode', 'settings.json'), JSON.stringify({
        'sultanc.server.path': server, 'sultanc.home': home, 'sultanc.checkOnSave': false,
        // SULTANC_RTL_THEME: another colour theme, to check the popup in it.
        ...(process.env.SULTANC_RTL_THEME ? { 'workbench.colorTheme': process.env.SULTANC_RTL_THEME } : {}),
    }));
    fs.writeFileSync(path.join(workspace, 'scope_test.sn'), english);
    fs.writeFileSync(path.join(workspace, 'scope_ar.sn'), arabic);
    // A file longer than the view, and a match on a record field.
    const longLines = ['def main(): int {'];
    for (let i = 0; i < 120; i++) longLines.push(`    let v${i}: int = ${i};`);
    longLines.push('    return 0;', '}', '');
    fs.writeFileSync(path.join(workspace, 'long_view.sn'), longLines.join('\n'));
    fs.writeFileSync(path.join(workspace, 'match_field.sn'), [
        'type Name = {', '    ahmad: string,', '    Ali: string', '};', '',
        'def get_name(name: Name): int {', '    match name with', '    | "Ahmad" -> { return 1; }',
        '    | _ -> { return 0; };', '}', ''].join('\n'));

    const code = await downloadAndUnzipVSCode(process.env.VSCODE_VERSION || 'stable');
    const vscodeProcess = childProcess.spawn(code, [
        '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`,
        `--extensions-dir=${path.join(userData, 'extensions')}`, `--extensionDevelopmentPath=${path.resolve(__dirname, '..', '..')}`,
        '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', workspace,
    ], { stdio: 'ignore' });

    const failures = [];
    let browser;
    try {
        for (let i = 0; i < 60 && !browser; i++) {
            try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); } catch { await sleep(1000); }
        }
        if (!browser) throw new Error('VS Code did not start');
        const context = browser.contexts()[0];
        let page;
        for (let i = 0; i < 30 && !page; i++) {
            page = context.pages().find((p) => p.url().includes('workbench'));
            if (!page) await sleep(1000);
        }
        await page.waitForTimeout(6000);

        const open = async (name) => {
            await page.keyboard.press('Control+P');
            await page.waitForTimeout(800);
            await page.keyboard.type(name);
            await page.waitForTimeout(800);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(6000);
            for (let i = 0; i < 20; i++) {
                for (const frame of page.frames()) {
                    try {
                        if (await frame.evaluate((n) => Boolean(document.getElementById('editor'))
                            && document.getElementById('editor').value.length > 0
                            && n, name)) {
                            const text = await frame.evaluate(() => document.getElementById('editor').value);
                            if (name === 'scope_ar.sn' ? text.includes('نقطة') : name === 'long_view.sn' ? text.includes('v119') : name === 'match_field.sn' ? text.includes('ahmad') : text.includes('outer_value')) return frame;
                        }
                    } catch { /* not a webview frame */ }
                }
                await page.waitForTimeout(500);
            }
            throw new Error(`no RTL editor for ${name}`);
        };

        const frames = {};
        const plain = (t) => t.replace(/[\u200e\u200f\u2066-\u2069\u202a-\u202e]/g, '');
        const textOf = async (frame) => plain(await frame.evaluate(() => document.getElementById('editor').value));
        const caretAfter = async (frame, marker) => frame.evaluate((m) => {
            const editor = document.getElementById('editor');
            editor.focus();
            const at = editor.value.indexOf(m) + m.length;
            editor.setSelectionRange(at, at);
        }, marker);
        // The caret at a source offset (the text without direction marks).
        const placeAt = (frame, offset) => frame.evaluate((target) => {
            const editor = document.getElementById('editor');
            editor.focus();
            const isMark = (c) => /[\u200e\u200f\u2066-\u2069\u202a-\u202e\u061c]/.test(c);
            let count = 0;
            for (let i = 0; i <= editor.value.length; i++) {
                if (count === target) {
                    while (i < editor.value.length && isMark(editor.value[i])) i++;
                    editor.setSelectionRange(i, i);
                    return;
                }
                if (i < editor.value.length && !isMark(editor.value[i])) count++;
            }
        }, offset);
        // Backspace/Delete remove line breaks, not the invisible marks at line starts.
        const deleting = async (frame) => {
            const base = await textOf(frame);
            const emptyLine = base.indexOf('\n\n') + 1;
            const checks = [
                ['Backspace on an empty line', emptyLine, 'Backspace', '\n'],
                ['Backspace at a line start', base.indexOf('\nlet') + 1 || base.indexOf('\n') + 1, 'Backspace', '\n'],
                ['Delete at a line end', base.indexOf('\n'), 'Delete', '\n'],
            ];
            for (const [name, offset, key, expected] of checks) {
                await placeAt(frame, offset);
                const before = await textOf(frame);
                await page.keyboard.press(key);
                await page.waitForTimeout(600);
                const after = await textOf(frame);
                let k = 0;
                while (k < after.length && before[k] === after[k]) k++;
                const removed = before.slice(k, k + before.length - after.length);
                if (removed !== expected) failures.push(`${name}: removed ${JSON.stringify(removed)}`);
                else console.log(`ok   ${name}`);
                await page.keyboard.press('Control+Z');
                await page.waitForTimeout(600);
            }
        };
        // Editing checks in the English file, before the Arabic one opens.
        const editing = async (frame) => {
            await deleting(frame);
            // Accepting after erasing letters replaces up to the caret, not past it.
            await caretAfter(frame, '= 3;\n');
            await frame.evaluate(() => { const e = document.getElementById('editor'); const end = e.value.indexOf('\n', e.selectionStart); e.setSelectionRange(end, end); });
            await page.keyboard.type('let c: Color = Color.Re', { delay: 60 });
            await page.waitForTimeout(2500);
            await page.keyboard.press('Backspace');
            await page.waitForTimeout(400);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(1500);
            let text = await textOf(frame);
            // A constructor in a value position is a call: `Red()`.
            if (!/let c: Color = Color\.Red\(\)\n\s*\}/.test(text)) failures.push(`accept after Backspace: ${JSON.stringify(text.slice(text.indexOf('let c:'), text.indexOf('let c:') + 40))}`);
            else console.log('ok   accept after Backspace replaces up to the caret only');
            // Delete Line (Ctrl+Shift+K here; Cmd+Shift+K on macOS).
            const lines = text.split('\n').length;
            await page.keyboard.press('Control+Shift+K');
            await page.waitForTimeout(800);
            text = await textOf(frame);
            if (text.includes('let c: Color') || text.split('\n').length !== lines - 1) failures.push('Delete Line did not delete the line');
            else console.log('ok   Delete Line');
            // Move Line Up and back down.
            await caretAfter(frame, 'let top: int = 1;');
            await page.keyboard.press('Alt+ArrowUp');
            await page.waitForTimeout(800);
            text = await textOf(frame);
            if (!/let top: int = 1;\n\s*let outer_value/.test(text)) failures.push('Move Line Up did not move the line');
            else console.log('ok   Move Line Up');
            await page.keyboard.press('Alt+ArrowDown');
            await page.waitForTimeout(800);
            if (!/let outer_value[^\n]*\n\s*let top: int = 1;/.test(await textOf(frame))) failures.push('Move Line Down did not move it back');
            else console.log('ok   Move Line Down');
        };
        let previousFile = null;
        for (const [file, marker, typed, expected, accepted] of cases) {
            if (previousFile === 'scope_test.sn' && file !== previousFile) await editing(frames[previousFile]);
            previousFile = file;
            frames[file] = frames[file] || await open(file);
            const frame = frames[file];
            // The caret at the end of the empty line after the marker.
            await frame.evaluate((m) => {
                const editor = document.getElementById('editor');
                editor.focus();
                const at = editor.value.indexOf(m) + m.length;
                const end = editor.value.indexOf('\n', at);
                editor.setSelectionRange(end, end);
            }, marker);
            await page.keyboard.type(typed, { delay: 60 });
            await page.waitForTimeout(3500);
            const items = await frame.evaluate(() => {
                const popup = document.getElementById('lsp-completion');
                return popup.hidden ? [] : [...popup.querySelectorAll('.lsp-completion-label')].map((x) => x.textContent);
            });
            if (shots) await page.screenshot({ path: path.join(shots, `${file}-${typed.replace(/[^\w]+/g, '_')}.png`) });
            const got = items.slice(0, expected.length);
            if (JSON.stringify(got) !== JSON.stringify(expected)) failures.push(`${typed}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(items.slice(0, 8))}`);
            else console.log(`ok   ${typed} -> ${items.slice(0, 4).join(', ')}`);
            if (accepted) {
                await page.keyboard.press('Enter');
                await page.waitForTimeout(1500);
                const line = await frame.evaluate(() => {
                    const editor = document.getElementById('editor');
                    const text = editor.value;
                    const at = editor.selectionStart;
                    return text.slice(text.lastIndexOf('\n', at - 1) + 1, text.indexOf('\n', at)).replace(/[‎‏⁦-⁩‪-‮]/g, '').trim();
                });
                if (line !== accepted) failures.push(`accepting after "${typed}": expected "${accepted}", got "${line}"`);
                else console.log(`ok   accept -> ${line}`);
            } else {
                await page.keyboard.press('Escape');
                // A closed list leaves nothing on screen (not even its border).
                const shown = await frame.evaluate(() => {
                    const popup = document.getElementById('lsp-completion');
                    const box = popup.getBoundingClientRect();
                    return getComputedStyle(popup).display !== 'none' || box.width > 0 || box.height > 0;
                });
                if (shown) failures.push(`after Escape on "${typed}": the closed list is still drawn`);
            }
            await page.keyboard.press('Home');
            await page.keyboard.press('Shift+End');
            await page.keyboard.press('Backspace');
            await page.waitForTimeout(500);
        }

        await deleting(frames[cases[cases.length - 1][0]]);

        // Accepting a completion keeps the view where it is and the caret right
        // after the inserted text, also when it adds an import at the top.
        const viewOf = (frame) => frame.evaluate(() => {
            const editor = document.getElementById('editor');
            const marks = /[\u200e\u200f\u2066-\u2069\u202a-\u202e\u061c]/g;
            const before = editor.value.slice(0, editor.selectionStart);
            const line = before.split('\n').length - 1;
            const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight);
            return {
                scrollTop: editor.scrollTop,
                caretLineOnScreen: line * lineHeight - editor.scrollTop,
                caretLine: line,
                lineText: editor.value.split('\n')[line].replace(marks, ''),
                column: before.slice(before.lastIndexOf('\n') + 1).replace(marks, '').length,
            };
        });
        const longFrame = await open('long_view.sn');
        // The first letters typed after the first edit of a file stay (a
        // dirty-state event used to send the text back without them).
        await caretAfter(longFrame, 'let v40: int = 40;');
        await page.keyboard.press('Enter');
        await page.keyboard.type('xyz', { delay: 60 });
        await page.waitForTimeout(1000);
        const firstEdit = (await viewOf(longFrame)).lineText;
        if (firstEdit !== '    xyz') failures.push(`typing right after the first edit: ${JSON.stringify(firstEdit)}`);
        else console.log('ok   letters typed right after the first edit stay');
        await page.keyboard.press('Control+Z');
        await page.waitForTimeout(600);
        await caretAfter(longFrame, 'let v80: int = 80;');
        await longFrame.evaluate(() => {
            const editor = document.getElementById('editor');
            editor.scrollTop = editor.scrollHeight / 2;
            editor.dispatchEvent(new Event('scroll'));
        });
        await page.keyboard.press('Enter');
        await page.keyboard.type('let t: string = int_to', { delay: 60 });
        await page.waitForTimeout(3500);
        const beforeAccept = await viewOf(longFrame);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1500);
        const afterAccept = await viewOf(longFrame);
        const longText = await textOf(longFrame);
        if (!longText.startsWith('import std.text.number;')) failures.push('accept with import: no import added at the top');
        else if (afterAccept.lineText.trim() !== 'let t: string = int_to_text') failures.push(`accept with import: line ${JSON.stringify(afterAccept.lineText)}`);
        else if (afterAccept.column !== afterAccept.lineText.length) failures.push(`accept with import: caret at column ${afterAccept.column} of ${afterAccept.lineText.length}`);
        else if (Math.abs(afterAccept.caretLineOnScreen - beforeAccept.caretLineOnScreen) > 1) failures.push(`accept with import: the line moved on screen from ${beforeAccept.caretLineOnScreen} to ${afterAccept.caretLineOnScreen}`);
        else console.log('ok   accept with an added import keeps the line on screen and the caret after the item');
        await page.waitForTimeout(1500);
        const settled = await viewOf(longFrame);
        if (Math.abs(settled.scrollTop - afterAccept.scrollTop) > 1 || settled.column !== afterAccept.column) failures.push(`after the document update: scroll ${afterAccept.scrollTop} -> ${settled.scrollTop}, column ${afterAccept.column} -> ${settled.column}`);
        else console.log('ok   the document update after the accept moves neither the view nor the caret');

        const matchFrame = await open('match_field.sn');
        await caretAfter(matchFrame, 'match name');
        await page.keyboard.type('.', { delay: 60 });
        await page.waitForTimeout(3500);
        const fields = await matchFrame.evaluate(() => [...document.querySelectorAll('#lsp-completion .lsp-completion-label')].map((x) => x.textContent));
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1500);
        const matchView = await viewOf(matchFrame);
        if (JSON.stringify(fields.slice(0, 2)) !== JSON.stringify(['ahmad', 'Ali'])) failures.push(`match name.: ${JSON.stringify(fields)}`);
        else if (matchView.lineText.trim() !== 'match name.ahmad with') failures.push(`match name. accept: ${JSON.stringify(matchView.lineText)}`);
        else if (matchView.lineText.slice(0, matchView.column).trim() !== 'match name.ahmad') failures.push(`match name. accept: caret at column ${matchView.column}`);
        else console.log('ok   match name. -> ahmad, Ali; accept -> match name.ahmad with, caret after ahmad');

        // Coming back to the window gives the text area its caret back.
        const frame = matchFrame;
        await frame.evaluate(() => document.getElementById('editor').blur());
        await frame.evaluate(() => window.dispatchEvent(new Event('focus')));
        await page.waitForTimeout(300);
        const focused = await frame.evaluate(() => document.activeElement && document.activeElement.id);
        if (focused !== 'editor') failures.push(`focus on return: ${focused}`);
        else console.log('ok   caret back in the editor on return');
    } finally {
        if (browser) await browser.close().catch(() => undefined);
        vscodeProcess.kill();
    }
    if (failures.length) {
        for (const failure of failures) console.log(`FAIL ${failure}`);
        process.exit(1);
    }
}

main().catch((error) => { console.error(error); process.exit(1); });
