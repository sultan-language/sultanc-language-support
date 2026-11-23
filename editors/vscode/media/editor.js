'use strict';

(() => {
    const vscode = acquireVsCodeApi();
    const shell = document.getElementById('editor-shell');
    const editor = document.getElementById('editor');
    const highlight = document.getElementById('highlight');
    const diagnosticOverlay = document.getElementById('diagnostics-overlay');
    const lines = document.getElementById('lines');
    const position = document.getElementById('position');
    const diagnosticCount = document.getElementById('diagnostic-count');
    const mode = document.getElementById('mode');
    const hoverPopup = document.getElementById('lsp-hover');
    const completionPopup = document.getElementById('lsp-completion');
    const signaturePopup = document.getElementById('lsp-signature');
    const breadcrumbs = document.getElementById('breadcrumbs');
    const peekPanel = document.getElementById('lsp-peek');

    const {
        createPresentationText,
        stripPresentationMarks,
        sourceOffsetFromPresentation,
        presentationOffsetFromSource,
    } = SultanCSyntaxRenderer;

    const {
        toggleLineComment,
        indentLines,
        outdentLines,
        enterEdit,
        closingBracketEdit,
        wordStartAt,
        completionTriggerAt,
        filterCompletionItems,
        completionMatchIndices,
        deleteLines,
        backspaceEdit,
        deleteForwardEdit,
        moveLines,
        copyLines,
        lineForCut,
        textHash,
        applyTextEdits,
        mapOffsetThroughChange,
        countLineBreaks,
        revealScrollTop,
    } = SultanCEditorOperations;

    const {
        diagnosticsAtOffset,
        renderOverlay,
        formatDiagnostic,
    } = SultanCDiagnosticRenderer;

    const pairs = new Map([
        ['(', ')'], ['[', ']'], ['{', '}'], ['«', '»'], ['"', '"'], ["'", "'"],
    ]);
    const closing = new Set([...pairs.values()]);

    let renderer = null;
    let sourceText = '';
    let initialized = false;
    let composing = false;
    let currentFileName = '';
    let lspReady = false;
    let diagnostics = [];
    let hoverTimer = null;
    let hoverRequestId = 0;
    let pendingHoverPoint = null;
    let completionRequestId = 0;
    let completionState = null;
    let signatureRequestId = 0;
    let signatureState = null;
    let cursorTimer = null;
    let lastCursorOffset = -1;
    let peekState = null;
    let settings = {
        direction: 'auto',
        fontScale: 1.3,
        lineHeight: 1.65,
        fontFamily: 'var(--vscode-editor-font-family)',
        palette: 'nvim',
        showLineNumbers: true,
        insertSpaces: true,
        tabSize: 4,
    };

    function severityClass(value) {
        if (value === 1) return 'diagnostic-error';
        if (value === 2) return 'diagnostic-warning';
        return 'diagnostic-info';
    }

    function updateLines() {
        const count = Math.max(1, sourceText.split('\n').length);
        const severity = new Map();
        for (const item of diagnostics) {
            const line = Number(item?.range?.start?.line);
            if (!Number.isInteger(line) || line < 0 || line >= count) continue;
            const current = severity.get(line) || 99;
            severity.set(line, Math.min(current, Number(item.severity) || 4));
        }
        lines.innerHTML = Array.from({ length: count }, (_, index) => {
            const level = severity.get(index);
            const cls = level ? ` class="${severityClass(level)}"` : '';
            return `<span${cls}>${index + 1}</span>`;
        }).join('\n');

        if (diagnostics.length === 0) {
            diagnosticCount.textContent = '';
            diagnosticCount.removeAttribute('data-severity');
        } else {
            const errors = diagnostics.filter((item) => item.severity === 1).length;
            const warnings = diagnostics.filter((item) => item.severity === 2).length;
            diagnosticCount.textContent = errors ? `${errors} error${errors === 1 ? '' : 's'}` : `${warnings} warning${warnings === 1 ? '' : 's'}`;
            diagnosticCount.dataset.severity = errors ? 'error' : 'warning';
        }
    }

    function sourceSelection() {
        return {
            start: sourceOffsetFromPresentation(editor.value, editor.selectionStart),
            end: sourceOffsetFromPresentation(editor.value, editor.selectionEnd),
        };
    }

    function setSourceSelection(start, end = start) {
        editor.selectionStart = presentationOffsetFromSource(editor.value, Math.min(start, sourceText.length));
        editor.selectionEnd = presentationOffsetFromSource(editor.value, Math.min(end, sourceText.length));
    }

    function presentationForSource() {
        const direction = detectDocumentDirection(sourceText);
        const forced = settings.direction === 'rtl' || settings.direction === 'ltr' ? settings.direction : null;
        return createPresentationText(sourceText, direction, forced);
    }

    function rebuildPresentationFromSource(start = null, end = null) {
        const selection = start === null ? sourceSelection() : { start, end: end ?? start };
        editor.value = presentationForSource();
        setSourceSelection(selection.start, selection.end);
    }

    function normalizePresentationInput() {
        const start = sourceOffsetFromPresentation(editor.value, editor.selectionStart);
        const end = sourceOffsetFromPresentation(editor.value, editor.selectionEnd);
        sourceText = stripPresentationMarks(editor.value);
        editor.value = presentationForSource();
        setSourceSelection(start, end);
    }

    function updatePosition() {
        const cursor = sourceOffsetFromPresentation(editor.value, editor.selectionStart);
        const before = sourceText.slice(0, cursor).split('\n');
        position.textContent = `Ln ${before.length}, Col ${[...before[before.length - 1]].length + 1}`;
        scheduleBreadcrumbs(cursor);
    }

    // Breadcrumbs follow the cursor, asked for once the cursor settles.
    function scheduleBreadcrumbs(cursor) {
        if (cursor === lastCursorOffset) return;
        lastCursorOffset = cursor;
        if (cursorTimer) clearTimeout(cursorTimer);
        cursorTimer = setTimeout(() => vscode.postMessage({ type: 'cursor', offset: cursor }), 150);
    }

    function renderBreadcrumbs(segments, symbols) {
        breadcrumbs.textContent = '';
        // VS Code's own breadcrumb bar above already shows the file path; this
        // bar adds what it cannot show for a custom editor: the symbols.
        const items = symbols.map((symbol) => ({ name: symbol.name, offset: symbol.offset, kind: symbol.kind }));
        items.forEach((item, index) => {
            if (index > 0) {
                const separator = document.createElement('span');
                separator.className = 'breadcrumb-separator';
                separator.textContent = '›';
                breadcrumbs.appendChild(separator);
            }
            const element = document.createElement(item.offset === null ? 'span' : 'button');
            element.className = item.offset === null ? 'breadcrumb' : 'breadcrumb breadcrumb-symbol';
            element.dir = 'auto';
            element.textContent = item.name;
            if (item.offset !== null) {
                element.type = 'button';
                element.addEventListener('click', () => revealOffset(item.offset));
            }
            breadcrumbs.appendChild(element);
        });
    }

    function hidePeek() {
        peekPanel.hidden = true;
        peekPanel.textContent = '';
        peekState = null;
    }

    function showPeek(message) {
        if (message.empty) {
            hidePeek();
            return;
        }
        peekState = message;
        peekPanel.textContent = '';
        const header = document.createElement('div');
        header.className = 'lsp-peek-header';
        const title = document.createElement('span');
        title.className = 'lsp-peek-title';
        title.dir = 'ltr';
        title.textContent = message.title;
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'lsp-peek-action';
        open.textContent = 'Open';
        open.addEventListener('click', () => {
            vscode.postMessage({ type: 'openLocation', location: message.location });
            hidePeek();
        });
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'lsp-peek-action';
        close.textContent = '×';
        close.title = 'Close (Escape)';
        close.addEventListener('click', () => { hidePeek(); editor.focus(); });
        header.append(title, open, close);
        const body = document.createElement('div');
        body.className = 'lsp-peek-body';
        // The peeked file's own direction, as the editor would show it.
        const peekDirection = detectDocumentDirection(message.lines.join('\n'));
        body.dir = peekDirection;
        message.lines.forEach((text, index) => {
            const lineNumber = message.firstLine + index;
            const row = document.createElement('div');
            row.className = lineNumber === message.targetLine ? 'lsp-peek-line lsp-peek-target' : 'lsp-peek-line';
            const number = document.createElement('span');
            number.className = 'lsp-peek-number';
            number.textContent = String(lineNumber + 1);
            const code = document.createElement('span');
            code.className = 'lsp-peek-code';
            const presentation = createPresentationText(text, peekDirection);
            code.dir = peekDirection;
            if (renderer) code.innerHTML = renderer.render(presentation);
            else code.textContent = presentation;
            row.append(number, code);
            body.appendChild(row);
        });
        peekPanel.append(header, body);
        peekPanel.hidden = false;
        const rect = caretRectForSourceOffset(message.offset);
        const top = Math.min((rect?.bottom ?? 40) + 4, window.innerHeight - 120);
        const peekTop = Math.max(28, top);
        peekPanel.style.top = `${peekTop}px`;
        // Stay above the editor's status line.
        peekPanel.style.maxHeight = `${Math.max(120, Math.min(window.innerHeight * 0.42, window.innerHeight - peekTop - 26))}px`;
    }

    function syncScroll() {
        highlight.scrollTop = editor.scrollTop;
        highlight.scrollLeft = editor.scrollLeft;
        diagnosticOverlay.scrollTop = editor.scrollTop;
        diagnosticOverlay.scrollLeft = editor.scrollLeft;
        lines.scrollTop = editor.scrollTop;
    }

    function detectDocumentDirection(text) {
        if (settings.direction === 'rtl' || settings.direction === 'ltr') return settings.direction;
        let arabic = 0;
        let latin = 0;
        for (const char of text.slice(0, 16384)) {
            const value = char.codePointAt(0);
            if ((value >= 0x0600 && value <= 0x06FF) ||
                (value >= 0x0750 && value <= 0x077F) ||
                (value >= 0x08A0 && value <= 0x08FF)) {
                arabic += 1;
            } else if ((value >= 0x41 && value <= 0x5A) || (value >= 0x61 && value <= 0x7A)) {
                latin += 1;
            }
        }
        return arabic > 0 && arabic >= latin ? 'rtl' : 'ltr';
    }

    function applyDirection() {
        const direction = detectDocumentDirection(sourceText);
        shell.dataset.direction = direction;
        editor.dir = direction;
        highlight.dir = direction;
        diagnosticOverlay.dir = direction;
        breadcrumbs.dir = direction;
        const suffix = currentFileName ? ` · ${currentFileName}` : '';
        mode.textContent = `${direction.toUpperCase()} · UTF-8 · SultanC · ${lspReady ? 'LSP' : 'LSP offline'}${suffix}`;
    }

    function applyConfiguration() {
        const style = getComputedStyle(document.documentElement);
        const baseFontSize = Number.parseFloat(style.getPropertyValue('--vscode-editor-font-size')) || 13;
        document.documentElement.style.setProperty('--sultanc-font-size', `${baseFontSize * settings.fontScale}px`);
        document.documentElement.style.setProperty('--sultanc-line-height', String(settings.lineHeight));
        document.documentElement.style.setProperty('--sultanc-font-family', settings.fontFamily);
        document.body.dataset.palette = settings.palette === 'vscode' ? 'vscode' : 'nvim';
        shell.dataset.lineNumbers = settings.showLineNumbers ? 'true' : 'false';
        editor.style.tabSize = String(settings.tabSize);
        highlight.style.tabSize = String(settings.tabSize);
        diagnosticOverlay.style.tabSize = String(settings.tabSize);
        rebuildPresentationFromSource();
        applyDirection();
        syncScroll();
    }

    function saveViewState() {
        const selection = sourceSelection();
        vscode.setState({
            selectionStart: selection.start,
            selectionEnd: selection.end,
            scrollTop: editor.scrollTop,
            scrollLeft: editor.scrollLeft,
        });
    }

    function renderDiagnostics() {
        diagnosticOverlay.innerHTML = renderOverlay(
            sourceText, editor.value, diagnostics, presentationOffsetFromSource
        );
    }

    function refresh() {
        if (renderer) highlight.innerHTML = renderer.render(editor.value) + '\n';
        else highlight.textContent = editor.value + '\n';
        renderDiagnostics();
        updateLines();
        updatePosition();
        applyDirection();
        syncScroll();
    }

    function sendEdit() {
        vscode.postMessage({ type: 'edit', text: sourceText });
    }

    function replaceSelection(text, selectionOffset = text.length) {
        const selection = sourceSelection();
        sourceText = sourceText.slice(0, selection.start) + text + sourceText.slice(selection.end);
        const cursor = selection.start + selectionOffset;
        rebuildPresentationFromSource(cursor, cursor);
        refresh();
        saveViewState();
        sendEdit();
    }

    function applySourceOperation(operation) {
        const selection = sourceSelection();
        const result = operation(sourceText, selection.start, selection.end);
        if (!result || result.text === sourceText) return false;
        sourceText = result.text;
        rebuildPresentationFromSource(result.selectionStart, result.selectionEnd);
        refresh();
        saveViewState();
        sendEdit();
        return true;
    }

    function selectionSpansLines(selection) {
        return selection.start !== selection.end && sourceText.slice(selection.start, selection.end).includes('\n');
    }

    function currentLineIndent() {
        const cursor = sourceOffsetFromPresentation(editor.value, editor.selectionStart);
        const before = sourceText.slice(0, cursor);
        const lineStart = before.lastIndexOf('\n') + 1;
        const match = before.slice(lineStart).match(/^[\t ]*/);
        return match ? match[0] : '';
    }

    function indentUnit() {
        if (!settings.insertSpaces) return '\t';
        return ' '.repeat(Math.max(1, Number(settings.tabSize) || 4));
    }

    function clampPopup(popup, clientX, clientY) {
        popup.style.left = `${Math.max(6, Math.min(clientX + 10, window.innerWidth - 40))}px`;
        popup.style.top = `${Math.max(6, Math.min(clientY + 14, window.innerHeight - 40))}px`;
        requestAnimationFrame(() => {
            const rect = popup.getBoundingClientRect();
            if (rect.right > window.innerWidth - 6) popup.style.left = `${Math.max(6, window.innerWidth - rect.width - 6)}px`;
            if (rect.bottom > window.innerHeight - 28) popup.style.top = `${Math.max(6, clientY - rect.height - 8)}px`;
        });
    }

    function domPointAtPresentationOffset(offset) {
        const walker = document.createTreeWalker(highlight, NodeFilter.SHOW_TEXT);
        let remaining = Math.max(0, offset);
        let node = walker.nextNode();
        while (node) {
            if (remaining <= node.nodeValue.length) return { node, offset: remaining };
            remaining -= node.nodeValue.length;
            node = walker.nextNode();
        }
        return null;
    }

    function caretRectForSourceOffset(sourceOffset) {
        const presentationOffset = presentationOffsetFromSource(editor.value, sourceOffset);
        const point = domPointAtPresentationOffset(presentationOffset);
        if (!point) return null;
        const range = document.createRange();
        range.setStart(point.node, Math.min(point.offset, point.node.nodeValue.length));
        range.collapse(true);
        return range.getBoundingClientRect();
    }

    function presentationOffsetAtPoint(clientX, clientY) {
        const editorPointer = editor.style.pointerEvents;
        const highlightPointer = highlight.style.pointerEvents;
        editor.style.pointerEvents = 'none';
        highlight.style.pointerEvents = 'auto';
        let node = null;
        let offset = 0;
        try {
            if (document.caretPositionFromPoint) {
                const caret = document.caretPositionFromPoint(clientX, clientY);
                node = caret?.offsetNode || null;
                offset = caret?.offset || 0;
            } else if (document.caretRangeFromPoint) {
                const range = document.caretRangeFromPoint(clientX, clientY);
                node = range?.startContainer || null;
                offset = range?.startOffset || 0;
            }
        } finally {
            editor.style.pointerEvents = editorPointer;
            highlight.style.pointerEvents = highlightPointer;
        }
        if (!node || !highlight.contains(node)) return null;
        const range = document.createRange();
        range.selectNodeContents(highlight);
        try { range.setEnd(node, offset); } catch (_) { return null; }
        return range.toString().length;
    }

    function sourceOffsetAtPoint(clientX, clientY) {
        const presentationOffset = presentationOffsetAtPoint(clientX, clientY);
        if (presentationOffset === null) return null;
        return sourceOffsetFromPresentation(editor.value, presentationOffset);
    }

    function diagnosticAtOffset(offset) {
        return diagnosticsAtOffset(sourceText, diagnostics, offset);
    }

    function showHover(text, clientX, clientY, offset) {
        const related = diagnosticAtOffset(offset);
        const diagnosticText = related.map(formatDiagnostic).filter(Boolean).join('\n\n');
        const combined = [diagnosticText, text].filter(Boolean).join('\n\n');
        if (!combined) {
            hoverPopup.hidden = true;
            return;
        }
        // Diagnostics are plain text; hover contents are LSP Markdown.
        const markdown = window.SultanCMarkdown;
        if (markdown) {
            const diagnosticHtml = diagnosticText
                ? `<div class="lsp-hover-diagnostics">${markdown.escapeHtml(diagnosticText).replace(/\n/g, '<br>')}</div>`
                : '';
            // Paragraphs here take their direction from their first letter
            // (dir="auto"), which the server's line isolates would hide.
            const plain = text ? text.replace(/[\u2067\u2069]/g, '') : '';
            hoverPopup.innerHTML = diagnosticHtml + (plain ? markdown.render(plain) : '');
        } else {
            hoverPopup.textContent = combined;
        }
        hoverPopup.hidden = false;
        clampPopup(hoverPopup, clientX, clientY);
    }

    function hideHover() {
        hoverPopup.hidden = true;
        pendingHoverPoint = null;
        if (hoverTimer) clearTimeout(hoverTimer);
        hoverTimer = null;
    }

    function scheduleHover(event) {
        if (!lspReady) return;
        const offset = sourceOffsetAtPoint(event.clientX, event.clientY);
        if (offset === null) {
            hideHover();
            return;
        }
        pendingHoverPoint = { x: event.clientX, y: event.clientY, offset };
        if (hoverTimer) clearTimeout(hoverTimer);
        hoverTimer = setTimeout(() => {
            const point = pendingHoverPoint;
            if (!point) return;
            const requestId = ++hoverRequestId;
            vscode.postMessage({ type: 'lspHover', requestId, offset: point.offset });
        }, 240);
    }

    function popupAtCursor(popup, offset) {
        const rect = caretRectForSourceOffset(offset);
        const x = rect?.left ?? 20;
        const y = rect?.bottom ?? 40;
        clampPopup(popup, x, y);
    }

    function hideCompletion() {
        completionPopup.hidden = true;
        completionPopup.textContent = '';
        completionState = null;
    }

    // The server's items for the word being typed, filtered by what has been
    // typed since (the list is asked once per word, as VS Code does).
    function visibleCompletionItems() {
        if (!completionState) return [];
        return filterCompletionItems(completionState.items, typedWord());
    }

    // ---- Completion list -------------------------------------------------
    // Each row: the item's kind icon (VS Code's symbol colours), the label
    // with the typed letters marked, and its type or the module an
    // auto-import adds. The selected item's signature, docs and import show
    // in a details pane under the list.

    const SVG_NS = 'http://www.w3.org/2000/svg';
    // LSP CompletionItemKind -> [name, path(s) on a 16x16 grid]
    const COMPLETION_KINDS = {
        2: ['method', 'M8 1.8 13.5 5v6L8 14.2 2.5 11V5L8 1.8Zm0 0V8m5.5-3L8 8 2.5 5'],
        3: ['function', 'M8 1.8 13.5 5v6L8 14.2 2.5 11V5L8 1.8Zm0 0V8m5.5-3L8 8 2.5 5'],
        4: ['constructor', 'M8 1.8 13.5 5v6L8 14.2 2.5 11V5L8 1.8Zm0 0V8m5.5-3L8 8 2.5 5'],
        5: ['field', 'M2.5 8 8 2.5 13.5 8 8 13.5 2.5 8Zm3 0L8 5.5 10.5 8 8 10.5 5.5 8Z'],
        6: ['variable', 'M4 4H2.5v8H4m8-8h1.5v8H12M6 6.5l4 3m0-3-4 3'],
        7: ['class', 'M6 2.5H4.5a1 1 0 0 0-1 1V7L2 8l1.5 1v3.5a1 1 0 0 0 1 1H6m4-11h1.5a1 1 0 0 1 1 1V7L14 8l-1.5 1v3.5a1 1 0 0 1-1 1H10'],
        8: ['interface', 'M4.5 8a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0Zm5 0h4'],
        9: ['module', 'M2.5 4.5 8 2l5.5 2.5v7L8 14l-5.5-2.5v-7Zm0 0L8 7l5.5-2.5M8 7v7'],
        10: ['property', 'M2.5 8 8 2.5 13.5 8 8 13.5 2.5 8Zm3 0L8 5.5 10.5 8 8 10.5 5.5 8Z'],
        12: ['value', 'M3 4.5h10v7H3v-7Zm2.5 2h5m-5 3h5'],
        13: ['enum', 'M2.5 3.5h6v4h-6v-4Zm5 5h6v4h-6v-4ZM2.5 10.5h3m5-7h3'],
        14: ['keyword', 'M2.5 4h8m-8 4h11m-11 4h6'],
        15: ['snippet', 'M3 2.5h10v11H3v-11Zm2.5 3h5m-5 2.5h5m-5 2.5h3'],
        17: ['file', 'M4 1.8h5l3 3v9.4H4V1.8Zm5 0v3h3'],
        20: ['enumMember', 'M3 4h5v5H3V4Zm7 1.5h3.5M10 8h3.5M3 12h10.5'],
        21: ['constant', 'M3 4.5h10v7H3v-7Zm2.5 2h5m-5 3h5'],
        22: ['struct', 'M6 2.5H4.5a1 1 0 0 0-1 1V7L2 8l1.5 1v3.5a1 1 0 0 0 1 1H6m4-11h1.5a1 1 0 0 1 1 1V7L14 8l-1.5 1v3.5a1 1 0 0 1-1 1H10'],
        24: ['operator', 'M3 8h10M8 3v10'],
        25: ['typeParameter', 'M3.5 3.5h9M8 3.5v9'],
    };

    function completionIcon(kind) {
        const [name, path] = COMPLETION_KINDS[kind] || ['text', 'M3 3.5h10M3 6.5h10M3 9.5h10M3 12.5h6'];
        const icon = document.createElement('span');
        icon.className = 'lsp-completion-icon';
        icon.dataset.kind = name;
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 16 16');
        svg.setAttribute('aria-hidden', 'true');
        const shape = document.createElementNS(SVG_NS, 'path');
        shape.setAttribute('d', path);
        svg.appendChild(shape);
        icon.appendChild(svg);
        return icon;
    }

    function completionLabel(text, word) {
        const label = document.createElement('span');
        label.className = 'lsp-completion-label';
        label.dir = 'auto';
        const marked = new Set(completionMatchIndices(text, word));
        let run = '';
        let runMarked = false;
        const flush = () => {
            if (!run) return;
            if (runMarked) {
                const mark = document.createElement('span');
                mark.className = 'lsp-completion-match';
                mark.textContent = run;
                label.appendChild(mark);
            } else {
                label.appendChild(document.createTextNode(run));
            }
            run = '';
        };
        [...text].forEach((character, index) => {
            const isMarked = marked.has(index);
            if (isMarked !== runMarked) { flush(); runMarked = isMarked; }
            run += character;
        });
        flush();
        return label;
    }

    function typedWord() {
        if (!completionState) return '';
        const cursor = sourceSelection().end;
        return cursor >= completionState.wordStart ? sourceText.slice(completionState.wordStart, cursor) : '';
    }

    // The selected item's signature, docs, and the import it adds.
    function renderCompletionDetails(pane, item) {
        pane.textContent = '';
        const parts = [];
        const signature = item.detail && !item.importFrom && (item.kind === 3 || item.kind === 2 || item.detail.length > 28) ? item.detail : '';
        if (signature) {
            const code = document.createElement('div');
            code.className = 'lsp-completion-signature';
            code.dir = 'auto';
            code.textContent = signature;
            parts.push(code);
        }
        if (item.importFrom) {
            const code = document.createElement('div');
            code.className = 'lsp-completion-import';
            code.dir = 'auto';
            code.textContent = item.detail || `import ${item.importFrom};`;
            parts.push(code);
        }
        if (item.documentation) {
            const docs = document.createElement('div');
            docs.className = 'lsp-completion-docs';
            const markdown = window.SultanCMarkdown;
            if (markdown) docs.innerHTML = markdown.render(item.documentation);
            else docs.textContent = item.documentation;
            parts.push(docs);
        }
        pane.hidden = parts.length === 0;
        parts.forEach((part) => pane.appendChild(part));
    }

    // Under the line being typed, or wholly above it when there is no room
    // below (never over it, as VS Code's suggest widget); in right-to-left
    // text it opens leftwards from the caret.
    function placeCompletion(offset) {
        const caret = caretRectForSourceOffset(offset);
        const box = completionPopup.getBoundingClientRect();
        const margin = 6;
        const caretTop = caret?.top ?? 30;
        const caretBottom = caret?.bottom ?? 40;
        const caretX = caret?.left ?? 20;
        let left = completionPopup.dir === 'rtl' ? caretX - box.width + 8 : caretX - 8;
        left = Math.max(margin, Math.min(left, window.innerWidth - box.width - margin));
        const below = window.innerHeight - 28 - caretBottom;
        let top = caretBottom + 4;
        if (box.height > below && caretTop - margin > below) top = Math.max(margin, caretTop - box.height - 4);
        completionPopup.style.left = `${left}px`;
        completionPopup.style.top = `${top}px`;
    }

    function renderCompletion() {
        if (!completionState?.items?.length) {
            hideCompletion();
            return;
        }
        completionState.visible = visibleCompletionItems();
        if (!completionState.visible.length) {
            // Nothing matches what was typed: hide, but keep the list so a
            // Backspace can bring it back.
            completionPopup.hidden = true;
            completionPopup.textContent = '';
            return;
        }
        if (completionState.active >= completionState.visible.length) completionState.active = 0;
        const opening = completionPopup.hidden;
        const word = typedWord();
        completionPopup.textContent = '';
        completionPopup.dir = shell.dataset.direction === 'rtl' ? 'rtl' : 'ltr';
        const list = document.createElement('div');
        list.className = 'lsp-completion-list';
        list.setAttribute('role', 'listbox');
        let activeRow = null;
        completionState.visible.forEach((item, index) => {
            const row = document.createElement('div');
            row.className = 'lsp-completion-item';
            row.setAttribute('role', 'option');
            const active = index === completionState.active;
            row.dataset.active = active ? 'true' : 'false';
            row.setAttribute('aria-selected', active ? 'true' : 'false');
            const detail = document.createElement('span');
            detail.className = 'lsp-completion-detail';
            detail.dir = 'auto';
            if (item.importFrom) {
                detail.classList.add('lsp-completion-auto-import');
                detail.textContent = item.importFrom;
            } else {
                detail.textContent = item.kind === 3 || item.kind === 2 ? '' : (item.detail || '');
            }
            row.append(completionIcon(item.kind), completionLabel(item.label, word), detail);
            row.addEventListener('mousedown', (event) => {
                event.preventDefault();
                completionState.active = index;
                acceptCompletion();
            });
            list.appendChild(row);
            if (active) activeRow = row;
        });
        const details = document.createElement('div');
        details.className = 'lsp-completion-details';
        renderCompletionDetails(details, completionState.visible[completionState.active]);
        completionPopup.append(list, details);
        completionPopup.hidden = false;
        if (opening) {
            completionPopup.classList.remove('lsp-completion-opening');
            void completionPopup.offsetWidth;
            completionPopup.classList.add('lsp-completion-opening');
        }
        placeCompletion(completionState.offset);
        if (activeRow) activeRow.scrollIntoView({ block: 'nearest' });
    }

    function triggerCompletion(keepShown = false) {
        if (!lspReady) return;
        hideHover();
        const offset = sourceSelection().end;
        const requestId = ++completionRequestId;
        // Asking again for the same word (an incomplete list): the current
        // items stay on screen, filtered, until the new answer replaces them.
        const kept = keepShown && completionState ? completionState : null;
        completionState = {
            requestId, offset, wordStart: wordStartAt(sourceText, offset),
            items: kept ? kept.items : [], visible: kept ? kept.visible : [], active: kept ? kept.active : 0,
            incomplete: false,
        };
        vscode.postMessage({ type: 'lspCompletion', requestId, offset });
    }

    // After each keystroke: open, filter or close the list.
    function completeWhileTyping(again = false) {
        if (!lspReady || composing) return;
        const cursor = sourceSelection().end;
        // `again`: the open list's request failed, so the word is asked anew.
        const open = completionState && !again ? completionState.wordStart : null;
        const action = completionTriggerAt(sourceText, cursor, open);
        if (action === 'open') triggerCompletion();
        // Before the answer arrives there is nothing to filter yet: the
        // answer is filtered by what has been typed by then.
        else if (action === 'filter') {
            if (completionState.items.length) renderCompletion();
            if (completionState.incomplete) triggerCompletion(true);
        }
        else hideCompletion();
    }

    function acceptCompletion() {
        if (!completionState?.visible?.length) return;
        const state = completionState;
        vscode.postMessage({
            type: 'lspCompletionAccept',
            requestId: state.requestId,
            index: state.visible[state.active].index,
            offset: state.offset,
            // Letters typed after the list was asked are replaced too.
            cursor: sourceSelection().end,
        });
        hideCompletion();
    }

    function hideSignature() {
        signaturePopup.hidden = true;
        signaturePopup.textContent = '';
        signatureState = null;
    }

    function triggerSignature() {
        if (!lspReady) return;
        const offset = sourceSelection().end;
        const requestId = ++signatureRequestId;
        signatureState = { requestId, offset };
        vscode.postMessage({ type: 'lspSignature', requestId, offset });
    }

    function editorLineHeight() {
        const style = getComputedStyle(editor);
        const fontSize = Number.parseFloat(style.fontSize) || 14;
        return Number.parseFloat(style.lineHeight) || fontSize * Number(settings.lineHeight || 1.65);
    }

    // Scrolls only as far as needed to show the line of `offset`: nothing when
    // it is already in view (VS Code's reveal). `center` puts a line that is
    // out of view a third down, for jumps.
    function scrollToShow(offset, mode) {
        const lineHeight = editorLineHeight();
        const lineIndex = countLineBreaks(sourceText, 0, offset);
        const paddingTop = Number.parseFloat(getComputedStyle(editor).paddingTop) || 0;
        editor.scrollTop = revealScrollTop(editor.scrollTop, editor.clientHeight - paddingTop,
            paddingTop + lineIndex * lineHeight, lineHeight, mode);
        syncScroll();
    }

    // The scroll position that keeps the first visible line on screen where
    // it was, after the text changed: `map` takes an offset of `before` to the
    // new text, `after` (default: the current text).
    function anchoredScrollTop(before, scrollTop, map, after = sourceText) {
        const lineHeight = editorLineHeight();
        const firstVisible = Math.floor(scrollTop / lineHeight);
        let anchor = 0;
        for (let line = 0; line < firstVisible; line += 1) {
            const next = before.indexOf('\n', anchor);
            if (next === -1) return scrollTop;
            anchor = next + 1;
        }
        const newLine = countLineBreaks(after, 0, map(anchor));
        return Math.max(0, scrollTop + (newLine - firstVisible) * lineHeight);
    }

    function revealOffset(offset) {
        const safe = Math.max(0, Math.min(Number(offset) || 0, sourceText.length));
        setSourceSelection(safe, safe);
        scrollToShow(safe, 'center');
        updatePosition();
        saveViewState();
        editor.focus();
    }

    // An accepted completion, applied here as typing is: the caret goes right
    // after the inserted text; lines added above the view (an import) move the
    // view with them, so the line being edited stays where it is on screen.
    function applyCompletionEdits(message) {
        if (sourceText.length !== message.baseLength || textHash(sourceText) !== message.baseHash) return;
        const result = applyTextEdits(sourceText, message.edits);
        if (!result) return;
        const primary = message.edits.find((edit) => edit.primary) || message.edits[0];
        let caret = primary.start + message.caretInPrimary;
        for (const edit of message.edits) {
            if (edit !== primary && edit.end <= primary.start) caret += (edit.text || '').length - (edit.end - edit.start);
        }
        const oldText = sourceText;
        const scrollTop = anchoredScrollTop(oldText, editor.scrollTop, result.map, result.text);
        const scrollLeft = editor.scrollLeft;
        sourceText = result.text;
        rebuildPresentationFromSource(caret, caret);
        editor.scrollTop = scrollTop;
        editor.scrollLeft = scrollLeft;
        refresh();
        scrollToShow(caret, 'minimal');
        saveViewState();
        sendEdit();
        editor.focus();
    }

    function sendPositionRequest(type, offset = sourceSelection().end) {
        if (!lspReady) return;
        vscode.postMessage({ type, offset });
    }

    editor.addEventListener('compositionstart', () => { composing = true; });

    editor.addEventListener('compositionend', () => {
        composing = false;
        normalizePresentationInput();
        refresh();
        saveViewState();
        sendEdit();
        completeWhileTyping();
    });

    // Coming back to VS Code (another app, another panel) gives the webview
    // focus but not the text area: give it back, with its caret where it was.
    window.addEventListener('focus', () => {
        if (document.activeElement !== editor && peekPanel.hidden) editor.focus({ preventScroll: true });
    });

    editor.addEventListener('input', () => {
        normalizePresentationInput();
        refresh();
        saveViewState();
        hideHover();
        if (!composing) sendEdit();
        const cursor = sourceSelection().end;
        const previous = sourceText[cursor - 1];
        if (!composing && (previous === '(' || previous === ',')) triggerSignature();
        completeWhileTyping();
    });

    editor.addEventListener('scroll', () => {
        syncScroll();
        saveViewState();
        hideHover();
    });

    hoverPopup.addEventListener('click', (event) => {
        const link = event.target.closest && event.target.closest('a[data-href]');
        if (!link) return;
        event.preventDefault();
        vscode.postMessage({ type: 'openLink', href: link.getAttribute('data-href') });
    });
    hoverPopup.addEventListener('mouseenter', () => { if (hoverTimer) clearTimeout(hoverTimer); });
    editor.addEventListener('mousemove', scheduleHover);
    editor.addEventListener('mouseleave', hideHover);

    editor.addEventListener('copy', (event) => {
        const selection = sourceSelection();
        if (!event.clipboardData) return;
        event.preventDefault();
        event.clipboardData.setData('text/plain', sourceText.slice(selection.start, selection.end));
    });

    editor.addEventListener('cut', (event) => {
        const selection = sourceSelection();
        if (!event.clipboardData) return;
        event.preventDefault();
        if (selection.start === selection.end) {
            // Nothing selected: the whole line, as VS Code does.
            const line = lineForCut(sourceText, selection.start);
            event.clipboardData.setData('text/plain', line.text);
            applySourceOperation((text) => ({
                text: text.slice(0, line.start) + text.slice(line.end),
                selectionStart: line.start,
                selectionEnd: line.start,
            }));
            return;
        }
        event.clipboardData.setData('text/plain', sourceText.slice(selection.start, selection.end));
        replaceSelection('');
    });

    editor.addEventListener('click', (event) => {
        updatePosition();
        saveViewState();
        hideCompletion();
        if ((event.metaKey || event.ctrlKey) && lspReady) {
            event.preventDefault();
            sendPositionRequest('lspDefinition');
            return;
        }
        const offset = sourceOffsetAtPoint(event.clientX, event.clientY);
        if (offset !== null && diagnosticAtOffset(offset).length) {
            showHover('', event.clientX, event.clientY, offset);
        }
    });

    for (const eventName of ['keyup', 'select']) {
        editor.addEventListener(eventName, () => {
            updatePosition();
            saveViewState();
        });
    }

    editor.addEventListener('keydown', (event) => {
        if (event.isComposing || composing) return;
        const commandKey = event.metaKey || event.ctrlKey;
        const key = event.key;

        if (!completionPopup.hidden && completionState) {
            if (key === 'ArrowDown' || key === 'ArrowUp') {
                event.preventDefault();
                const count = completionState.visible.length;
                if (count) {
                    completionState.active = (completionState.active + (key === 'ArrowDown' ? 1 : -1) + count) % count;
                    renderCompletion();
                }
                return;
            }
            if (key === 'Enter' || key === 'Tab') {
                event.preventDefault();
                acceptCompletion();
                return;
            }
            if (key === 'Escape') {
                event.preventDefault();
                hideCompletion();
                return;
            }
        }

        if (key === 'Escape') {
            hideHover();
            hideSignature();
            if (!peekPanel.hidden) {
                event.preventDefault();
                hidePeek();
                return;
            }
        }

        if (key === 'F12' && event.altKey) {
            event.preventDefault();
            sendPositionRequest('lspPeek');
            return;
        }

        if (key === 'F12') {
            event.preventDefault();
            sendPositionRequest(event.shiftKey ? 'lspReferences' : 'lspDefinition');
            return;
        }

        if (key === 'F2') {
            event.preventDefault();
            sendPositionRequest('lspRename');
            return;
        }

        if (commandKey && event.shiftKey && key.toLowerCase() === 'o') {
            event.preventDefault();
            vscode.postMessage({ type: 'lspDocumentSymbols' });
            return;
        }

        if (event.ctrlKey && !event.altKey && key === ' ') {
            event.preventDefault();
            if (event.shiftKey) triggerSignature();
            else triggerCompletion();
            return;
        }

        if ((commandKey && key === '.') || (event.altKey && key === 'Enter')) {
            event.preventDefault();
            sendPositionRequest('lspCodeAction');
            return;
        }

        if (commandKey && key.toLowerCase() === 's') {
            event.preventDefault();
            vscode.postMessage({ type: 'save' });
            return;
        }

        if (commandKey && key.toLowerCase() === 'z') {
            event.preventDefault();
            vscode.postMessage({ type: event.shiftKey ? 'redo' : 'undo' });
            return;
        }

        if (event.ctrlKey && !event.metaKey && key.toLowerCase() === 'y') {
            event.preventDefault();
            vscode.postMessage({ type: 'redo' });
            return;
        }

        // VS Code's line commands: Delete Line (Cmd/Ctrl+Shift+K), Move Line
        // (Alt+Up/Down), Copy Line (Shift+Alt+Up/Down).
        if (commandKey && event.shiftKey && !event.altKey && key.toLowerCase() === 'k') {
            event.preventDefault();
            hideCompletion();
            applySourceOperation((text, start, end) => deleteLines(text, start, end));
            return;
        }

        if (event.altKey && !commandKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
            event.preventDefault();
            hideCompletion();
            const direction = key === 'ArrowUp' ? -1 : 1;
            const operation = event.shiftKey ? copyLines : moveLines;
            applySourceOperation((text, start, end) => operation(text, start, end, direction));
            return;
        }

        if (commandKey && !event.altKey && key === '/') {
            event.preventDefault();
            applySourceOperation((text, start, end) => toggleLineComment(text, start, end, '//'));
            return;
        }

        if (commandKey && !event.altKey && (key === '[' || key === ']')) {
            event.preventDefault();
            const operation = key === ']' ? indentLines : outdentLines;
            applySourceOperation((text, start, end) => operation(text, start, end, indentUnit()));
            return;
        }

        if (key === 'Tab' && !commandKey && !event.altKey) {
            event.preventDefault();
            const selection = sourceSelection();
            if (event.shiftKey || selectionSpansLines(selection)) {
                const operation = event.shiftKey ? outdentLines : indentLines;
                applySourceOperation((text, start, end) => operation(text, start, end, indentUnit()));
            } else {
                replaceSelection(indentUnit());
            }
            return;
        }

        if (key === 'Enter') {
            event.preventDefault();
            const selection = sourceSelection();
            applySourceOperation((text) => enterEdit(text, selection.start, selection.end, indentUnit()));
            return;
        }

        if ((key === '}' || key === ']' || key === ')') && !commandKey && !event.altKey) {
            const selection = sourceSelection();
            const nextChar = sourceText[selection.end];
            if (nextChar !== key) {
                const result = closingBracketEdit(sourceText, selection.start, selection.end, key);
                if (result) {
                    event.preventDefault();
                    applySourceOperation(() => result);
                    return;
                }
            }
        }

        // Backspace and Delete edit the source text: the text area holds a
        // direction mark at each line start, which a native Backspace would
        // erase instead of the line break.
        if ((key === 'Backspace' || key === 'Delete') && !(event.shiftKey && commandKey)) {
            const mac = /Mac/i.test(navigator.platform || navigator.userAgent || '');
            const mode = (mac ? event.metaKey : false) ? 'line'
                : ((mac ? event.altKey : event.ctrlKey) ? 'word' : 'char');
            const selection = sourceSelection();
            event.preventDefault();
            hideHover();
            if (key === 'Backspace' && mode === 'char' && selection.start === selection.end && selection.start > 0
                && pairs.get(sourceText[selection.start - 1]) === sourceText[selection.start]) {
                // An empty pair (`()`, `""`) goes as one.
                applySourceOperation((text, start) => ({
                    text: text.slice(0, start - 1) + text.slice(start + 1),
                    selectionStart: start - 1,
                    selectionEnd: start - 1,
                }));
            } else if (key === 'Backspace') {
                applySourceOperation((text, start, end) => backspaceEdit(text, start, end, mode, indentUnit().length || 4));
            } else {
                applySourceOperation((text, start, end) => deleteForwardEdit(text, start, end, mode));
            }
            updatePosition();
            completeWhileTyping();
            return;
        }

        if (closing.has(key) && editor.selectionStart === editor.selectionEnd) {
            const cursor = sourceOffsetFromPresentation(editor.value, editor.selectionStart);
            if (sourceText.slice(cursor, cursor + key.length) === key) {
                event.preventDefault();
                setSourceSelection(cursor + key.length);
                updatePosition();
                saveViewState();
                return;
            }
        }

        if (pairs.has(key) && !commandKey && !event.altKey) {
            event.preventDefault();
            const close = pairs.get(key);
            const selection = sourceSelection();
            const selected = sourceText.slice(selection.start, selection.end);
            replaceSelection(key + selected + close, key.length + selected.length);
        }
    });

    window.addEventListener('message', (event) => {
        const message = event.data;
        if (!message || typeof message.type !== 'string') return;

        if (message.type === 'syntax' && message.syntax) {
            renderer = SultanCSyntaxRenderer.createRenderer(message.syntax);
            refresh();
            return;
        }

        if (message.type === 'configuration' && message.settings) {
            settings = { ...settings, ...message.settings };
            applyConfiguration();
            return;
        }

        if (message.type === 'lspStatus') {
            lspReady = Boolean(message.ready);
            applyDirection();
            return;
        }

        if (message.type === 'diagnostics') {
            diagnostics = Array.isArray(message.diagnostics) ? message.diagnostics : [];
            renderDiagnostics();
            updateLines();
            return;
        }

        if (message.type === 'lspHoverResult') {
            if (message.requestId !== hoverRequestId || !pendingHoverPoint) return;
            showHover(message.text || '', pendingHoverPoint.x, pendingHoverPoint.y, pendingHoverPoint.offset);
            return;
        }

        if (message.type === 'lspCompletionResult') {
            if (!completionState || message.requestId !== completionState.requestId) return;
            const items = Array.isArray(message.items) ? message.items : [];
            // Typing went on while the server answered: it drops a request
            // whose text changed (ContentModified), so ask again for the
            // current text, as VS Code's own editor does.
            if (!items.length && sourceSelection().end !== completionState.offset) {
                completeWhileTyping(true);
                return;
            }
            completionState.items = items;
            completionState.incomplete = Boolean(message.incomplete);
            completionState.active = 0;
            renderCompletion();
            return;
        }

        if (message.type === 'focus') {
            if (document.activeElement !== editor && peekPanel.hidden) editor.focus({ preventScroll: true });
            return;
        }

        if (message.type === 'lspSignatureResult') {
            if (!signatureState || message.requestId !== signatureState.requestId) return;
            if (!message.text) {
                hideSignature();
                return;
            }
            signaturePopup.textContent = message.text;
            signaturePopup.hidden = false;
            popupAtCursor(signaturePopup, signatureState.offset);
            return;
        }

        if (message.type === 'lspError') {
            if (message.requestId === hoverRequestId) hideHover();
            // The server drops a request whose document changed after it
            // (ContentModified, -32801); the edit of the keystroke itself can
            // reach it after the request. Ask again for the current text, a
            // few times at most, as VS Code's own editor does.
            if (completionState && message.requestId === completionState.requestId) {
                const retries = completionState.retries || 0;
                if (/content modified|cancel/i.test(String(message.message || '')) && retries < 5) {
                    setTimeout(() => {
                        if (!completionState || completionState.requestId !== message.requestId) return;
                        completeWhileTyping(true);
                        if (completionState) completionState.retries = retries + 1;
                    }, 40);
                }
            }
            return;
        }

        if (message.type === 'breadcrumbs') {
            renderBreadcrumbs(Array.isArray(message.segments) ? message.segments : [], Array.isArray(message.symbols) ? message.symbols : []);
            return;
        }

        if (message.type === 'peek') {
            showPeek(message);
            return;
        }

        if (message.type === 'reveal') {
            revealOffset(message.offset);
            return;
        }

        if (message.type === 'completionEdits') {
            applyCompletionEdits(message);
            return;
        }

        if (message.type !== 'document' || typeof message.text !== 'string') return;

        currentFileName = message.fileName || currentFileName;
        if (message.text === sourceText && initialized) {
            applyDirection();
            return;
        }

        const oldSelection = sourceSelection();
        const oldScrollTop = editor.scrollTop;
        const oldScrollLeft = editor.scrollLeft;
        const saved = vscode.getState() || {};
        const oldText = sourceText;

        sourceText = message.text;
        editor.value = presentationForSource();
        refresh();

        if (!initialized) {
            const start = Math.min(saved.selectionStart || 0, sourceText.length);
            const end = Math.min(saved.selectionEnd ?? start, sourceText.length);
            setSourceSelection(start, end);
            editor.scrollTop = saved.scrollTop || 0;
            editor.scrollLeft = saved.scrollLeft || 0;
            initialized = true;
            setTimeout(() => editor.focus(), 0);
        } else {
            // A change made outside (format, rename, undo, another editor):
            // the caret moves with the text around it, and lines added or
            // removed above the view move the view with them.
            setSourceSelection(
                mapOffsetThroughChange(oldText, sourceText, oldSelection.start),
                mapOffsetThroughChange(oldText, sourceText, oldSelection.end)
            );
            editor.scrollTop = anchoredScrollTop(oldText, oldScrollTop, (offset) => mapOffsetThroughChange(oldText, sourceText, offset));
            editor.scrollLeft = oldScrollLeft;
        }

        refresh();
        saveViewState();
        updatePosition();
    });

    vscode.postMessage({ type: 'ready' });
})();
