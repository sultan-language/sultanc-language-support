'use strict';

(function expose(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.SultanCDiagnosticRenderer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
    function escapeHtml(text) {
        return String(text).replace(/[&<>]/g, (char) => {
            if (char === '&') return '&amp;';
            if (char === '<') return '&lt;';
            return '&gt;';
        });
    }

    function offsetFromLspPosition(sourceText, value) {
        if (!value || !Number.isInteger(value.line) || !Number.isInteger(value.character)) return 0;
        let line = 0;
        let offset = 0;
        while (line < value.line && offset < sourceText.length) {
            const newline = sourceText.indexOf('\n', offset);
            if (newline < 0) return sourceText.length;
            offset = newline + 1;
            line += 1;
        }
        return Math.min(sourceText.length, offset + Math.max(0, value.character));
    }

    function diagnosticsAtOffset(sourceText, diagnostics, offset) {
        return (Array.isArray(diagnostics) ? diagnostics : []).filter((item) => {
            const start = offsetFromLspPosition(sourceText, item?.range?.start);
            const end = offsetFromLspPosition(sourceText, item?.range?.end);
            if (end <= start) return offset === start;
            return offset >= start && offset < end;
        });
    }

    function severityClass(value) {
        if (value === 1) return 'diagnostic-error';
        if (value === 2) return 'diagnostic-warning';
        return 'diagnostic-info';
    }

    function renderOverlay(sourceText, presentationText, diagnostics, presentationOffsetFromSource) {
        const ranges = [];
        for (const item of Array.isArray(diagnostics) ? diagnostics : []) {
            const sourceStart = offsetFromLspPosition(sourceText, item?.range?.start);
            const sourceEnd = offsetFromLspPosition(sourceText, item?.range?.end);
            const start = presentationOffsetFromSource(presentationText, Math.min(sourceStart, sourceEnd));
            const end = presentationOffsetFromSource(presentationText, Math.max(sourceStart, sourceEnd));
            if (end <= start) continue;
            ranges.push({ start, end, severity: Number(item?.severity) || 4 });
        }
        if (!ranges.length) return escapeHtml(presentationText) + '\n';

        const boundaries = new Set([0, presentationText.length]);
        for (const range of ranges) {
            boundaries.add(range.start);
            boundaries.add(range.end);
        }
        const points = [...boundaries].sort((a, b) => a - b);
        let html = '';
        for (let index = 0; index < points.length - 1; index += 1) {
            const start = points[index];
            const end = points[index + 1];
            if (end <= start) continue;
            const active = ranges.filter((range) => range.start < end && range.end > start);
            const text = escapeHtml(presentationText.slice(start, end));
            if (!active.length) html += text;
            else {
                const severity = active.reduce((value, range) => Math.min(value, range.severity), 4);
                html += `<span class="diagnostic-span ${severityClass(severity)}">${text}</span>`;
            }
        }
        return html + '\n';
    }

    function locationText(range) {
        const start = range?.start;
        if (!start || !Number.isInteger(start.line) || !Number.isInteger(start.character)) return '';
        const line = start.line + 1;
        const column = start.character + 1;
        const end = range?.end;
        if (end && end.line === start.line && Number.isInteger(end.character) && end.character > start.character) {
            return `Ln ${line}, Col ${column}-${end.character + 1}`;
        }
        return `Ln ${line}, Col ${column}`;
    }

    function diagnosticArguments(data) {
        const result = [];
        for (const argument of Array.isArray(data?.arguments) ? data.arguments : []) {
            if (!argument || typeof argument.key !== 'string') continue;
            if (argument.key !== 'expected' && argument.key !== 'found') continue;
            const label = typeof argument.label === 'string' && argument.label ? argument.label : argument.key;
            result.push(`${label}: ${String(argument.value ?? '')}`);
        }
        return result;
    }

    function relatedText(item) {
        const result = [];
        for (const related of Array.isArray(item?.relatedInformation) ? item.relatedInformation : []) {
            const where = locationText(related?.location?.range);
            const message = typeof related?.message === 'string' ? related.message : 'related location';
            result.push(`related: ${message}${where ? ` · ${where}` : ''}`);
        }
        return result;
    }

    function commentText(prefix, values) {
        const result = [];
        for (const value of Array.isArray(values) ? values : []) {
            const message = typeof value === 'string' ? value : value?.message;
            if (typeof message === 'string' && message) result.push(`${prefix}: ${message}`);
        }
        return result;
    }

    function formatDiagnostic(item) {
        const data = item?.data && typeof item.data === 'object' ? item.data : {};
        const code = item?.code === null || item?.code === undefined ? '' : String(item.code);
        const message = typeof item?.message === 'string' ? item.message : '';
        const lines = [`${code ? `${code} · ` : ''}${message}`.trim()];
        const where = locationText(item?.range);
        if (where) lines.push(where);
        if (typeof data.primaryRoleLabel === 'string' && data.primaryRoleLabel) lines.push(data.primaryRoleLabel);
        lines.push(...diagnosticArguments(data));
        lines.push(...relatedText(item));
        lines.push(...commentText('note', data.notes));
        lines.push(...commentText('help', data.help));
        const fixes = Array.isArray(data.fixes) ? data.fixes : [];
        for (const fix of fixes) {
            if (!fix || typeof fix.message !== 'string') continue;
            const applicability = typeof fix.applicability === 'string' && fix.applicability ? ` · ${fix.applicability}` : '';
            lines.push(`fix: ${fix.message}${applicability}`);
        }
        if (fixes.length) lines.push('Quick Fix: Cmd/Ctrl+. or Alt+Enter');
        lines.push(...commentText('trace', data.trace));
        return lines.filter(Boolean).join('\n');
    }

    return {
        offsetFromLspPosition,
        diagnosticsAtOffset,
        renderOverlay,
        formatDiagnostic,
    };
});
