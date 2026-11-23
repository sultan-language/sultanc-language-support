'use strict';

// Minimal, safe Markdown renderer for LSP hover and documentation content in the
// RTL webview. Every input character is HTML-escaped first; only the constructs
// SultanC LSP emits are recognised: ``` fences, `code`, **bold**, [text](url),
// horizontal rules (---), hard line breaks ("  \n") and paragraphs.
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.SultanCMarkdown = api;
}(typeof self !== 'undefined' ? self : this, function () {
    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function safeHref(url) {
        return /^(file|https?):/i.test(url) ? url : null;
    }

    function inline(text) {
        const parts = String(text).split('`');
        return parts.map((part, index) => {
            if (index % 2 === 1) return `<code dir="auto">${escapeHtml(part)}</code>`;
            let html = escapeHtml(part);
            html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
            html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, url) => {
                const href = safeHref(url.replace(/&amp;/g, '&'));
                return href ? `<a href="#" data-href="${escapeHtml(href)}">${label}</a>` : label;
            });
            return html;
        }).join('');
    }

    function render(markdown) {
        const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
        const out = [];
        let paragraph = [];
        const flush = () => {
            if (paragraph.length === 0) return;
            out.push(`<p dir="auto">${joinParagraph(paragraph)}</p>`);
            paragraph = [];
        };
        function joinParagraph(items) {
            return items.map((line, index) => {
                const hard = / {2}$/.test(line);
                const body = inline(line.replace(/ {2}$/, ''));
                if (index === items.length - 1) return body;
                return body + (hard ? '<br>' : ' ');
            }).join('');
        }
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const fence = /^```(\w*)\s*$/.exec(line);
            if (fence) {
                flush();
                const code = [];
                i++;
                while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i++]);
                out.push(`<pre dir="auto"><code>${escapeHtml(code.join('\n'))}</code></pre>`);
                continue;
            }
            if (/^\s*---+\s*$/.test(line)) { flush(); out.push('<hr>'); continue; }
            if (/^\s*$/.test(line)) { flush(); continue; }
            paragraph.push(line);
        }
        flush();
        return out.join('');
    }

    return { render, escapeHtml };
}));
