'use strict';

/**
 * Re-indents a Silverstripe template.
 *
 * The one hard rule is that formatting must never change what the template renders.
 * So this only rewrites leading whitespace, trims trailing whitespace, and normalises
 * whitespace *inside* `<% %>` tags (which is never output). Nothing is ever moved
 * between lines, and `<pre>` / `<textarea>` content is left byte-for-byte alone.
 *
 * Indentation is driven by a character-level scan rather than per-line regexes, which
 * is what lets it handle tags whose attributes span several lines, `<% %>` tags inside
 * an HTML tag, and quoted attribute values containing `>`.
 */

const VOID_ELEMENTS = new Set([
    'area', 'base', 'basefont', 'br', 'col', 'embed', 'frame', 'hr', 'img', 'input',
    'isindex', 'keygen', 'link', 'menuitem', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** Elements whose body is raw text: re-indented as a block, never re-parsed as HTML. */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);

/** Elements whose body is whitespace-significant and must be preserved exactly. */
const VERBATIM_ELEMENTS = new Set(['pre', 'textarea']);

const BLOCK_OPENERS = new Set(['if', 'loop', 'with', 'cached', 'uncached']);
const BLOCK_CLOSERS = new Set(['end_if', 'end_loop', 'end_with', 'end_cached', 'end_uncached']);
const BLOCK_CONTINUATIONS = new Set(['else', 'else_if']);

function lineStarts(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
    return starts;
}

function makeLineLookup(starts) {
    return (offset) => {
        let lo = 0;
        let hi = starts.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (starts[mid] <= offset) lo = mid;
            else hi = mid - 1;
        }
        return lo;
    };
}

/**
 * Walk the document and record, per line, the sequence of indent deltas it produces,
 * plus the line spans of raw-text and verbatim element bodies.
 *
 * An HTML tag contributes `+1` where it starts (so wrapped attributes indent) and `-1`
 * at its `>` (bringing the closing bracket back), followed by another `+1` when the
 * element actually opens a body. That single rule covers both single-line and
 * multi-line tags without any special casing.
 */
function scan(text) {
    const starts = lineStarts(text);
    const lineOf = makeLineLookup(starts);
    const events = [];
    const regions = [];
    const len = text.length;

    const emit = (offset, delta) => events.push({ line: lineOf(offset), delta });

    let i = 0;
    while (i < len) {
        const ch = text[i];

        if (ch !== '<') { i++; continue; }

        // Silverstripe comment
        if (text.startsWith('<%--', i)) {
            const end = text.indexOf('--%>', i + 4);
            i = end === -1 ? len : end + 4;
            continue;
        }

        // Silverstripe tag
        if (text.startsWith('<%', i)) {
            const end = findTagEnd(text, i + 2, '%>');
            const inner = text.slice(i + 2, end === -1 ? len : end);
            const keyword = (/^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(inner) || [])[1];
            if (BLOCK_OPENERS.has(keyword)) {
                emit(i, +1);
            } else if (BLOCK_CLOSERS.has(keyword)) {
                emit(i, -1);
            } else if (BLOCK_CONTINUATIONS.has(keyword)) {
                emit(i, -1);
                emit(i, +1);
            }
            i = end === -1 ? len : end + 2;
            continue;
        }

        // HTML comment
        if (text.startsWith('<!--', i)) {
            const end = text.indexOf('-->', i + 4);
            i = end === -1 ? len : end + 3;
            continue;
        }

        // Doctype / processing instruction
        if (text[i + 1] === '!' || text[i + 1] === '?') {
            const end = text.indexOf('>', i + 2);
            i = end === -1 ? len : end + 1;
            continue;
        }

        // Closing tag
        if (text[i + 1] === '/') {
            const end = text.indexOf('>', i + 2);
            emit(i, -1);
            i = end === -1 ? len : end + 1;
            continue;
        }

        // Opening tag
        const nameMatch = /^<([A-Za-z][-_.:A-Za-z0-9]*)/.exec(text.slice(i, i + 64));
        if (!nameMatch) { i++; continue; }

        const name = nameMatch[1].toLowerCase();
        emit(i, +1); // wrapped attributes indent one level

        const tagEnd = findAttributeEnd(text, i + nameMatch[0].length);
        const closeAt = tagEnd === -1 ? len - 1 : tagEnd;
        const selfClosing = text[closeAt - 1] === '/';
        emit(closeAt, -1);

        i = closeAt + 1;

        if (selfClosing || VOID_ELEMENTS.has(name)) continue;

        emit(closeAt, +1); // the element body opens

        if (RAW_TEXT_ELEMENTS.has(name) || VERBATIM_ELEMENTS.has(name)) {
            const found = new RegExp(`</${name}\\s*>`, 'i').exec(text.slice(i));
            const bodyEnd = found ? i + found.index : len;
            const verbatim = VERBATIM_ELEMENTS.has(name);
            regions.push({
                kind: verbatim ? 'verbatim' : 'raw',
                startLine: lineOf(i) + 1,
                // Whitespace before `</pre>` is part of the element's content, so the
                // closing line has to stay untouched too.
                endLine: lineOf(bodyEnd) - (verbatim ? 0 : 1),
            });
            i = bodyEnd;
        }
    }

    return { events, regions, lineOf };
}

/** Index of the `%>` (or other closer) that ends a tag, skipping quoted strings. */
function findTagEnd(text, from, closer) {
    let quote = null;
    for (let i = from; i < text.length - 1; i++) {
        const ch = text[i];
        if (quote) {
            if (ch === '\\') i++;
            else if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") quote = ch;
        else if (text.startsWith(closer, i)) return i;
    }
    return -1;
}

/**
 * Index of the `>` closing an HTML open tag, skipping quoted attribute values and any
 * `<% %>` tags embedded among the attributes.
 */
function findAttributeEnd(text, from) {
    let quote = null;
    for (let i = from; i < text.length; i++) {
        const ch = text[i];
        if (quote) {
            if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") { quote = ch; continue; }
        if (text.startsWith('<%', i)) {
            const end = findTagEnd(text, i + 2, '%>');
            i = end === -1 ? text.length : end + 1;
            continue;
        }
        if (ch === '>') return i;
    }
    return -1;
}

/**
 * Collapse runs of whitespace inside `<% %>` tags — never rendered, so this is safe —
 * while leaving quoted arguments and multi-line tags untouched.
 */
function normaliseTags(text) {
    return text.replace(/<%(?!--)((?:[^%\n]|%(?!>))*)%>/g, (match, inner) => {
        if (inner.includes('\n')) return match;
        const parts = [];
        let quote = null;
        let buffer = '';
        for (let i = 0; i < inner.length; i++) {
            const ch = inner[i];
            if (quote) {
                buffer += ch;
                if (ch === '\\' && i + 1 < inner.length) { buffer += inner[++i]; continue; }
                if (ch === quote) { parts.push(buffer); buffer = ''; quote = null; }
                continue;
            }
            if (ch === '"' || ch === "'") {
                if (buffer) { parts.push(buffer); buffer = ''; }
                quote = ch;
                buffer = ch;
                continue;
            }
            buffer += ch;
        }
        if (buffer) parts.push(buffer);

        const rebuilt = parts
            .map((part) => (/^['"]/.test(part) ? part : part.replace(/\s+/g, ' ')))
            .join('')
            .trim();
        if (!rebuilt) return match;
        // `<%t` is written without a space in Silverstripe's own docs; keep that form.
        const prefix = /^<%t(?![A-Za-z0-9_])/.test(match) && /^t\b/.test(rebuilt) ? '<%' : '<% ';
        return `${prefix}${rebuilt} %>`;
    });
}

/**
 * Format `text`.
 *
 * @returns {{ text: string, lines: string[], original: string[], unbalanced: boolean }}
 */
function format(text, options = {}) {
    const tabSize = options.tabSize || 4;
    const insertSpaces = options.insertSpaces !== false;
    const unit = insertSpaces ? ' '.repeat(tabSize) : '\t';

    const source = options.normaliseTagSpacing === false ? text : normaliseTags(text);
    const { events, regions } = scan(source);

    // Work in `\n` and restore the document's own line ending at the end, so formatting
    // never silently converts CRLF to LF.
    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    const original = source.split(/\r?\n/);
    const eventsByLine = new Map();
    for (const event of events) {
        if (!eventsByLine.has(event.line)) eventsByLine.set(event.line, []);
        eventsByLine.get(event.line).push(event.delta);
    }

    const regionByLine = new Map();
    for (const region of regions) {
        for (let line = region.startLine; line <= region.endLine; line++) regionByLine.set(line, region);
    }
    // A raw body is re-based as a block, so it needs the shallowest indent it contains.
    for (const region of regions) {
        let min = Infinity;
        for (let line = region.startLine; line <= region.endLine; line++) {
            const text_ = original[line];
            if (text_ === undefined || !text_.trim()) continue;
            min = Math.min(min, leadingWidth(text_, tabSize));
        }
        region.minIndent = min === Infinity ? 0 : min;
    }

    const out = [];
    let level = 0;
    let unbalanced = false;

    for (let line = 0; line < original.length; line++) {
        const raw = original[line];
        const region = regionByLine.get(line);
        const trimmed = raw.trim();

        // A line's own indent is the level minus however far its *leading* closers
        // reach; what it leaves behind for the next line is the net balance.
        let balance = 0;
        let lowest = 0;
        for (const delta of eventsByLine.get(line) || []) {
            balance += delta;
            lowest = Math.min(lowest, balance);
        }

        if (region && region.kind === 'verbatim') {
            // Whitespace here is part of the rendered output; emit the line verbatim.
            out.push(raw);
        } else if (!trimmed) {
            out.push('');
        } else if (region && region.kind === 'raw') {
            // Not a JavaScript or CSS formatter: keep the body's own relative shape and
            // only re-base it, so a whole file shifting sideways still gets fixed.
            const relative = Math.max(0, leadingWidth(raw, tabSize) - region.minIndent);
            out.push(unit.repeat(level) + ' '.repeat(relative) + trimmed);
        } else {
            const indent = level + lowest;
            if (indent < 0) unbalanced = true;
            out.push(unit.repeat(Math.max(0, indent)) + trimmed);
        }

        level += balance;
        if (level < 0) { unbalanced = true; level = 0; }
    }

    if (level !== 0) unbalanced = true;

    return { text: out.join(eol), lines: out, original, unbalanced };
}

/** Visible width of a line's leading whitespace, with tabs expanded. */
function leadingWidth(line, tabSize) {
    let width = 0;
    for (const ch of line) {
        if (ch === ' ') width++;
        else if (ch === '\t') width += tabSize - (width % tabSize);
        else break;
    }
    return width;
}

module.exports = { format, normaliseTags, scan, VOID_ELEMENTS, RAW_TEXT_ELEMENTS, VERBATIM_ELEMENTS };
