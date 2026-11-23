'use strict';

/**
 * SultanC presentation lexer.
 *
 * Presentation only: the compiler-generated syntax surface remains the owner of
 * SultanC spellings and identifier policy. The renderer never inserts bidi
 * control characters into source text and never rewrites document bytes.
 */
(function expose(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.SultanCSyntaxRenderer = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
    function escapeHtml(text) {
        return text.replace(/[&<>]/g, (char) => {
            if (char === '&') return '&amp;';
            if (char === '<') return '&lt;';
            return '&gt;';
        });
    }

    function className(kind) {
        return `syntax-${kind}`;
    }

    function span(kind, text) {
        return `<span class="${className(kind)}">${escapeHtml(text)}</span>`;
    }

    function technicalAtom(kind, text, extraClass = '') {
        const suffix = extraClass ? ` ${extraClass}` : '';
        return `<bdi class="${className(kind)} syntax-technical${suffix}" dir="ltr">${escapeHtml(text)}</bdi>`;
    }


    function isLatinOnlyIdentifier(text) {
        const hasLatin = /[A-Za-z]/.test(text);
        const hasArabic = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/u.test(text);
        return hasLatin && !hasArabic;
    }

    function identifierAtom(kind, text, isolateLatin) {
        const classes = kind ? `${className(kind)} syntax-ltr-identifier` : 'syntax-ltr-identifier';
        if (!isLatinOnlyIdentifier(text) || !isolateLatin) {
            return kind ? span(kind, text) : escapeHtml(text);
        }
        return `<bdi class="${classes}" dir="ltr">${escapeHtml(text)}</bdi>`;
    }

    const LRM = '\u200E';
    const RLM = '\u200F';

    function firstStrongDirection(line) {
        for (const char of line) {
            const value = char.codePointAt(0);
            if (value === 0x200F) return 'rtl';
            if (value === 0x200E) return 'ltr';
            if ((value >= 0x0600 && value <= 0x06FF) ||
                (value >= 0x0750 && value <= 0x077F) ||
                (value >= 0x08A0 && value <= 0x08FF)) return 'rtl';
            if ((value >= 0x41 && value <= 0x5A) || (value >= 0x61 && value <= 0x7A)) return 'ltr';
        }
        return null;
    }

    /**
     * Build an editor-only presentation buffer. Every physical line gets an
     * invisible first-strong anchor so Chromium cannot treat punctuation-only
     * SultanC lines such as `};` as LTR paragraphs. The anchors live only in
     * the webview buffer and are stripped before any edit reaches VS Code.
     */
    function structuralDelimiters(line) {
        const result = [];
        let index = 0;
        let quote = null;
        while (index < line.length) {
            if (!quote && line.startsWith('//', index)) break;
            const char = line[index];
            if (quote) {
                if (char === '\\') {
                    index += 2;
                    continue;
                }
                if ((quote === '«' && char === '»') || char === quote) quote = null;
                index += 1;
                continue;
            }
            if (char === '«' || char === '"' || char === "'") {
                quote = char;
                index += 1;
                continue;
            }
            if ('{}[]()'.includes(char)) result.push(char);
            index += 1;
        }
        return result;
    }

    function matchingOpen(close) {
        if (close === '}') return '{';
        if (close === ']') return '[';
        if (close === ')') return '(';
        return null;
    }

    function createPresentationText(text, fallbackDirection = 'ltr', forcedDirection = null) {
        const lines = text.split('\n');
        const rendered = [];
        const stack = [];
        let inherited = fallbackDirection === 'rtl' ? 'rtl' : 'ltr';

        for (const line of lines) {
            const delimiters = structuralDelimiters(line);
            const strong = firstStrongDirection(line);
            let structuralDirection = null;
            if (!strong && delimiters.length > 0 && matchingOpen(delimiters[0])) {
                const expected = matchingOpen(delimiters[0]);
                for (let index = stack.length - 1; index >= 0; index -= 1) {
                    if (stack[index].open === expected) {
                        structuralDirection = stack[index].direction;
                        break;
                    }
                }
            }

            const direction = forcedDirection || strong || structuralDirection || inherited;
            inherited = direction;
            rendered.push((direction === 'rtl' ? RLM : LRM) + line);

            for (const delimiter of delimiters) {
                if (delimiter === '{' || delimiter === '[' || delimiter === '(') {
                    stack.push({ open: delimiter, direction });
                    continue;
                }
                const expected = matchingOpen(delimiter);
                if (!expected) continue;
                for (let index = stack.length - 1; index >= 0; index -= 1) {
                    if (stack[index].open === expected) {
                        stack.splice(index, 1);
                        break;
                    }
                }
            }
        }

        return rendered.join('\n');
    }

    function stripPresentationMarks(text) {
        return text.replace(/[\u200E\u200F]/gu, '');
    }

    function sourceOffsetFromPresentation(text, presentationOffset) {
        let sourceOffset = 0;
        const limit = Math.max(0, Math.min(presentationOffset, text.length));
        for (let index = 0; index < limit; index += 1) {
            const char = text[index];
            if (char !== LRM && char !== RLM) sourceOffset += 1;
        }
        return sourceOffset;
    }

    function presentationOffsetFromSource(text, sourceOffset) {
        const target = Math.max(0, sourceOffset);
        let sourceCount = 0;
        let index = 0;

        while (index < text.length && sourceCount < target) {
            const char = text[index];
            if (char !== LRM && char !== RLM) sourceCount += 1;
            index += 1;
        }
        while (index < text.length && (text[index] === LRM || text[index] === RLM)) index += 1;
        return index;
    }

    function codePointWidth(value) {
        return value > 0xFFFF ? 2 : 1;
    }

    function inRanges(value, ranges) {
        for (const range of ranges || []) {
            if (value >= range.start && value <= range.end) return true;
        }
        return false;
    }

    function createRenderer(surface) {
        if (!surface || !surface.identifierPolicy) {
            throw new TypeError('SultanC syntax surface is missing identifier policy data.');
        }

        const policy = surface.identifierPolicy;
        const ignoredCodepoints = new Set(policy.ignoredCodepoints || []);
        const operators = [...(surface.operators || [])].sort((a, b) => b.length - a.length);
        const keywordMap = new Map();
        const declarationNames = new Map();
        const pairedGlyphs = new Set(['(', ')', '[', ']', '{', '}']);

        function isIdentifierStart(value) {
            return ignoredCodepoints.has(value) ||
                (policy.startScalars || []).includes(value) ||
                inRanges(value, policy.startRanges);
        }

        function isIdentifierRest(value) {
            return isIdentifierStart(value) ||
                (policy.restScalars || []).includes(value) ||
                inRanges(value, policy.restRanges);
        }

        function canonicalIdentifier(text) {
            let result = '';
            for (const char of text) {
                if (!ignoredCodepoints.has(char.codePointAt(0))) result += char;
            }
            return result;
        }

        for (const [group, words] of Object.entries(surface.groups || {})) {
            for (const word of words) keywordMap.set(canonicalIdentifier(word), group);
        }
        for (const [word, kind] of Object.entries(surface.declarationNames || {})) {
            declarationNames.set(canonicalIdentifier(word), kind);
        }

        function scanString(text, start, opener, closer) {
            let index = start + opener.length;
            while (index < text.length) {
                if (text[index] === '\n' || text[index] === '\r') break;
                if (text.startsWith(closer, index)) return index + closer.length;
                if (text[index] === '\\') {
                    index += 1;
                    if (index < text.length) index += codePointWidth(text.codePointAt(index));
                    continue;
                }
                index += codePointWidth(text.codePointAt(index));
            }
            return index;
        }

        function scanCharacter(text, start) {
            let index = start + 1;
            if (index >= text.length || text[index] === '\n' || text[index] === '\r') return index;
            if (text[index] === '\\') {
                index += 1;
                if (index < text.length) {
                    const escape = text[index];
                    index += 1;
                    const digits = escape === 'x' ? 2 : escape === 'u' ? 4 : escape === 'U' ? 8 : 0;
                    index = Math.min(text.length, index + digits);
                }
            } else {
                index += codePointWidth(text.codePointAt(index));
            }
            if (text[index] === "'") index += 1;
            return index;
        }


        function matchNumber(text, index) {
            const source = text.slice(index);
            const match = source.match(/^(?:0[xX][0-9A-Fa-f](?:_?[0-9A-Fa-f])*|0[bB][01](?:_?[01])*|[0-9](?:_?[0-9])*\.[0-9](?:_?[0-9])*(?:[eE][+-]?[0-9](?:_?[0-9])*)?|[0-9](?:_?[0-9])*)/);
            return match ? match[0] : '';
        }

        function matchOperator(text, index) {
            for (const operator of operators) {
                if (text.startsWith(operator, index)) return operator;
            }
            return '';
        }

        function shouldIsolateOperator(operator) {
            // Delimiters must follow the physical line direction exactly like
            // the transparent textarea. In RTL Arabic lines the browser may
            // mirror paired brackets/braces; forcing them LTR makes the syntax
            // overlay disagree with the actual editing layer.
            if (pairedGlyphs.has(operator)) return false;

            // Multi-character technical operators must remain internally LTR,
            // and < / > must keep their language meaning instead of Unicode
            // bidi mirroring changing one comparison glyph into the other.
            return operator.length > 1 || operator === '<' || operator === '>';
        }

        function render(text) {
            let output = '';
            let index = 0;
            let pendingDeclarationName = null;
            let lineNumber = 0;
            const lineDirections = text.split('\n').map(firstStrongDirection);

            while (index < text.length) {
                if (text.startsWith('//', index)) {
                    let end = text.indexOf('\n', index);
                    if (end < 0) end = text.length;
                    output += span('comment', text.slice(index, end));
                    index = end;
                    continue;
                }

                if (text.startsWith('«', index)) {
                    const end = scanString(text, index, '«', '»');
                    output += span('string', text.slice(index, end));
                    index = end;
                    pendingDeclarationName = null;
                    continue;
                }

                if (text[index] === '"') {
                    const end = scanString(text, index, '"', '"');
                    output += span('string', text.slice(index, end));
                    index = end;
                    pendingDeclarationName = null;
                    continue;
                }

                if (text[index] === "'") {
                    const end = scanCharacter(text, index);
                    output += span('literal', text.slice(index, end));
                    index = end;
                    pendingDeclarationName = null;
                    continue;
                }

                const indexedWildcard = text.slice(index).match(/^_[0-9]+/);
                if (indexedWildcard) {
                    output += technicalAtom('reserved', indexedWildcard[0]);
                    index += indexedWildcard[0].length;
                    pendingDeclarationName = null;
                    continue;
                }

                if (text[index] === '_') {
                    const nextIndex = index + 1;
                    const next = nextIndex < text.length ? text.codePointAt(nextIndex) : -1;
                    if (next < 0 || !isIdentifierRest(next)) {
                        output += span('operator', '_');
                        index += 1;
                        pendingDeclarationName = null;
                        continue;
                    }
                }

                const current = text.codePointAt(index);
                if (current >= 0x30 && current <= 0x39) {
                    const number = matchNumber(text, index);
                    if (number) {
                        output += span('number', number);
                        index += number.length;
                        pendingDeclarationName = null;
                        continue;
                    }
                }

                if (isIdentifierStart(current)) {
                    let end = index + codePointWidth(current);
                    while (end < text.length) {
                        const value = text.codePointAt(end);
                        if (!isIdentifierRest(value)) break;
                        end += codePointWidth(value);
                    }

                    const word = text.slice(index, end);
                    const canonical = canonicalIdentifier(word);
                    const group = keywordMap.get(canonical);
                    const isolateLatin = lineDirections[lineNumber] === 'rtl';
                    if (group) {
                        // Keep keywords transparent to paragraph-direction detection.
                        // Their own letters already carry the correct strong direction.
                        output += span(group, word);
                        pendingDeclarationName = declarationNames.get(canonical) || null;
                    } else if (pendingDeclarationName) {
                        const presentationKind = pendingDeclarationName === 'type' ? 'typeName' : pendingDeclarationName;
                        output += identifierAtom(presentationKind, word, isolateLatin);
                        pendingDeclarationName = null;
                    } else if (isolateLatin && isLatinOnlyIdentifier(word) && text[end] === '.') {
                        // A dotted Latin path (std.io.println, compiler.source.provenance) is
                        // one LTR run; otherwise the neutral dots let the bidi algorithm
                        // reorder its segments inside an RTL line.
                        const path = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+/.exec(text.slice(index));
                        if (path) {
                            output += `<bdi class="syntax-ltr-identifier syntax-module-path" dir="ltr">${escapeHtml(path[0])}</bdi>`;
                            index += path[0].length;
                            pendingDeclarationName = null;
                            continue;
                        }
                        output += identifierAtom(null, word, isolateLatin);
                    } else {
                        output += identifierAtom(null, word, isolateLatin);
                    }
                    index = end;
                    continue;
                }

                const operator = matchOperator(text, index);
                if (operator) {
                    const lineDirection = lineDirections[lineNumber];
                    const presentationClass = operator === '->' && lineDirection === 'rtl'
                        ? 'syntax-rtl-arrow'
                        : '';
                    output += shouldIsolateOperator(operator)
                        ? technicalAtom('operator', operator, presentationClass)
                        : span('operator', operator);
                    index += operator.length;
                    pendingDeclarationName = null;
                    continue;
                }

                const width = codePointWidth(current);
                const raw = text.slice(index, index + width);
                output += escapeHtml(raw);
                if (raw === '\n') lineNumber += 1;
                if (!/\s/u.test(raw)) pendingDeclarationName = null;
                index += width;
            }

            return output;
        }

        return Object.freeze({ render, canonicalIdentifier });
    }

    return Object.freeze({
        createRenderer,
        escapeHtml,
        technicalAtom,
        isLatinOnlyIdentifier,
        firstStrongDirection,
        createPresentationText,
        stripPresentationMarks,
        sourceOffsetFromPresentation,
        presentationOffsetFromSource,
        LRM,
        RLM,
    });
});
