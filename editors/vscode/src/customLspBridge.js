'use strict';

function markedStringText(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(markedStringText).filter(Boolean).join('\n\n');
    if (typeof value.value === 'string') return value.value;
    return '';
}

function hoverText(result) {
    if (!result) return '';
    return markedStringText(result.contents).trim();
}

function importedModule(item) {
    for (const edit of item?.additionalTextEdits || []) {
        const match = /^\s*(?:import|استورد)\s+([^;\s]+)\s*;/.exec(edit?.newText || '');
        if (match) return match[1];
    }
    return '';
}

function completionItems(result) {
    const items = Array.isArray(result) ? result : result?.items;
    if (!Array.isArray(items)) return [];
    return items.map((item, index) => ({
        index,
        label: typeof item?.label === 'string' ? item.label : item?.label?.label || '',
        detail: typeof item?.detail === 'string' ? item.detail : '',
        documentation: markedStringText(item?.documentation),
        kind: Number.isInteger(item?.kind) ? item.kind : 1,
        // An auto-import item: the module its `import` adds.
        importFrom: importedModule(item),
    })).filter((item) => item.label);
}

function signatureText(result) {
    if (!result || !Array.isArray(result.signatures) || result.signatures.length === 0) return '';
    const index = Number.isInteger(result.activeSignature) ? result.activeSignature : 0;
    const signature = result.signatures[Math.max(0, Math.min(index, result.signatures.length - 1))];
    if (!signature) return '';
    const documentation = markedStringText(signature.documentation).trim();
    return documentation ? `${signature.label || ''}\n${documentation}`.trim() : String(signature.label || '').trim();
}

function locations(result) {
    if (!result) return [];
    return (Array.isArray(result) ? result : [result]).filter((item) => item?.uri && item?.range);
}

function flattenDocumentSymbols(symbols, parent = '', depth = 0, output = []) {
    if (!Array.isArray(symbols)) return output;
    for (const symbol of symbols) {
        if (!symbol?.name || !symbol?.range) continue;
        output.push({
            name: symbol.name,
            detail: symbol.detail || '',
            kind: symbol.kind,
            range: symbol.selectionRange || symbol.range,
            parent,
            depth,
        });
        flattenDocumentSymbols(symbol.children, symbol.name, depth + 1, output);
    }
    return output;
}

function diagnosticsForWebview(items) {
    if (!Array.isArray(items)) return [];
    return items.filter((item) => item?.range).map((item) => ({
        range: item.range,
        severity: item.severity || 1,
        code: item.code ?? null,
        source: item.source || 'sultanc',
        message: item.message || '',
        relatedInformation: Array.isArray(item.relatedInformation)
            ? item.relatedInformation.filter((related) => related?.location?.uri && related?.location?.range && typeof related?.message === 'string')
            : [],
        data: item.data && typeof item.data === 'object' ? item.data : null,
    }));
}

function containsPosition(range, position) {
    if (!range) return false;
    const after = position.line > range.start.line
        || (position.line === range.start.line && position.character >= range.start.character);
    const before = position.line < range.end.line
        || (position.line === range.end.line && position.character <= range.end.character);
    return after && before;
}

/**
 * The symbols enclosing `position`, outermost first, as VS Code's breadcrumbs
 * show them. Works for nested DocumentSymbol trees and for flat lists whose
 * ranges nest (a record and its fields, an enum and its constructors).
 */
function symbolChainAt(symbols, position) {
    const found = [];
    const visit = (items) => {
        if (!Array.isArray(items)) return;
        for (const symbol of items) {
            const range = symbol?.range || symbol?.location?.range;
            if (!symbol?.name || !containsPosition(range, position)) continue;
            found.push({ name: symbol.name, kind: symbol.kind, range, selectionRange: symbol.selectionRange || range });
            visit(symbol.children);
        }
    };
    visit(symbols);
    const size = (r) => (r.end.line - r.start.line) * 100000 + (r.end.character - r.start.character);
    return found.sort((a, b) => size(b.range) - size(a.range));
}

module.exports = {
    symbolChainAt,
    markedStringText,
    hoverText,
    completionItems,
    signatureText,
    locations,
    flattenDocumentSymbols,
    diagnosticsForWebview,
};
