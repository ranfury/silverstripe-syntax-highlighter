'use strict';

/**
 * Re-indents PHP.
 *
 * Deliberately indentation-only: it rewrites leading whitespace and trims trailing
 * whitespace, and never reorders, wraps or restyles anything. That keeps it safe to run
 * on a whole project and means it composes with — rather than fights — a real code
 * style fixer such as PHP-CS-Fixer.
 *
 * It tracks state rather than matching per-line regexes, which is what lets it handle
 * the three things `indentationRules` cannot express: fluent chains that continue an
 * unterminated statement, `switch`/`case` bodies, and heredocs.
 */

/** A statement is finished when the last code character is one of these. */
const STATEMENT_ENDERS = new Set([';', '{', '}', ',', ':']);

const OPENERS = { '{': '}', '(': ')', '[': ']' };
const CLOSERS = new Set([')', ']', '}']);

/**
 * Walk one line, carrying string/comment state across lines.
 *
 * @returns line facts plus the state the next line starts in.
 */
function scanLine(line, state) {
    const events = [];          // '(' / ')' etc., in order
    let blanked = '';           // the line with string and comment bodies removed
    let i = 0;

    const push = (ch) => { blanked += ch; };

    while (i < line.length) {
        const ch = line[i];
        const rest = line.slice(i);

        switch (state.mode) {
            case 'html': {
                const open = rest.match(/^<\?(php\b|=)?/);
                if (open) {
                    state.mode = 'code';
                    i += open[0].length;
                    push(' '.repeat(open[0].length));
                } else {
                    push(' ');
                    i++;
                }
                break;
            }
            case 'blockComment': {
                const end = rest.indexOf('*/');
                if (end === -1) { push(' '.repeat(rest.length)); i = line.length; }
                else { push(' '.repeat(end + 2)); i += end + 2; state.mode = 'code'; }
                break;
            }
            case 'sq':
            case 'dq': {
                const quote = state.mode === 'sq' ? "'" : '"';
                if (ch === '\\') { push('  '); i += 2; break; }
                if (ch === quote) { state.mode = 'code'; push(quote); i++; break; }
                push(' ');
                i++;
                break;
            }
            case 'heredoc':
            case 'nowdoc': {
                // Only a line whose sole content is the label can close it.
                const close = new RegExp(`^[ \\t]*${state.label}\\b`);
                if (close.test(line)) {
                    state.mode = 'code';
                    state.closingHeredoc = true;
                    const consumed = close.exec(line)[0].length;
                    push(' '.repeat(consumed));
                    i += consumed;
                } else {
                    push(' '.repeat(rest.length));
                    i = line.length;
                }
                break;
            }
            default: {
                if (rest.startsWith('?>')) { state.mode = 'html'; push('  '); i += 2; break; }
                if (rest.startsWith('//') || ch === '#') { push(' '.repeat(rest.length)); i = line.length; break; }
                if (rest.startsWith('/*')) { state.mode = 'blockComment'; push('  '); i += 2; break; }

                const heredoc = /^<<<[ \t]*(?:"([A-Za-z_]\w*)"|'([A-Za-z_]\w*)'|([A-Za-z_]\w*))/.exec(rest);
                if (heredoc) {
                    state.mode = heredoc[2] ? 'nowdoc' : 'heredoc';
                    state.label = heredoc[1] || heredoc[2] || heredoc[3];
                    push(' '.repeat(heredoc[0].length));
                    i += heredoc[0].length;
                    break;
                }

                if (ch === "'") { state.mode = 'sq'; push("'"); i++; break; }
                if (ch === '"') { state.mode = 'dq'; push('"'); i++; break; }

                if (OPENERS[ch] || CLOSERS.has(ch)) events.push(ch);
                push(ch);
                i++;
            }
        }
    }

    return { events, blanked };
}

/**
 * Format `text`.
 *
 * @returns {{ text: string, lines: string[], unbalanced: boolean }}
 */
function formatPhp(text, options = {}) {
    const tabSize = options.tabSize || 4;
    const unit = options.insertSpaces === false ? '\t' : ' '.repeat(tabSize);
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);

    const state = { mode: 'html', label: null, closingHeredoc: false };
    /**
     * One frame per open bracket. `body` is the level its contents sit at and `restore`
     * the level its closing line returns to. Every bracket opened on the same line
     * shares one level, so `$list->push(new ArrayData([` indents once, not three times.
     */
    const stack = [];
    const levelOf = () => (stack.length ? stack[stack.length - 1].body : 0);

    // A statement that runs over several lines indents its continuation lines one level
    // past where the statement began — not one level per line, and not on top of an
    // indent a bracket has already provided.
    let inContinuation = false;
    let statementLevel = 0;
    let unbalanced = false;
    const out = [];

    for (const raw of lines) {
        const startMode = state.mode;
        state.closingHeredoc = false;
        const { events, blanked } = scanLine(raw, state);

        // Regions whose whitespace is part of the program's output or data.
        if (startMode === 'html' || ((startMode === 'heredoc' || startMode === 'nowdoc') && !state.closingHeredoc)) {
            out.push(raw.replace(/\s+$/, ''));
            continue;
        }
        if (startMode === 'heredoc' || startMode === 'nowdoc') {
            // The closing label's own indentation controls PHP 7.3+ dedenting.
            out.push(raw.replace(/\s+$/, ''));
            continue;
        }

        const trimmed = raw.trim();
        if (!trimmed) { out.push(''); continue; }

        const code = blanked.trim();

        // Inside a block comment, align continuation lines on their leading `*`.
        if (startMode === 'blockComment') {
            out.push(/^\*/.test(trimmed) ? `${unit.repeat(levelOf())} ${trimmed}` : raw.replace(/\s+$/, ''));
            continue;
        }

        // A run of closing brackets at the start of the line closes those frames and
        // brings the line itself back to where the outermost of them was opened.
        let leadingClosers = 0;
        for (const ch of code) {
            if (CLOSERS.has(ch)) leadingClosers++;
            else if (ch === ';' || ch === ',' || ch === ' ' || ch === '\t') continue;
            else break;
        }

        let lineLevel;
        if (leadingClosers > 0) {
            let restore = levelOf();
            for (let n = 0; n < leadingClosers; n++) {
                const frame = stack.pop();
                if (frame) restore = frame.restore;
                else unbalanced = true;
            }
            lineLevel = restore;
            statementLevel = lineLevel;
        } else if (inContinuation && !code.startsWith('{')) {
            lineLevel = Math.max(levelOf(), statementLevel + 1);
        } else {
            const frame = stack[stack.length - 1];
            const isCaseLabel = /^(case\b|default\s*:)/.test(code);
            const caseExtra = frame && frame.isSwitch && frame.inCase && !isCaseLabel ? 1 : 0;
            lineLevel = levelOf() + caseExtra;
            // A line opening with `->` continues the previous one even when a bracket
            // already supplied its indent, so its peers have to land alongside it.
            statementLevel = /^\??->/.test(code) ? Math.max(0, lineLevel - 1) : lineLevel;
            if (isCaseLabel && frame && frame.isSwitch) frame.inCase = true;
        }

        out.push(unit.repeat(Math.max(0, lineLevel)) + trimmed);

        // Apply the brackets this line leaves open or closes beyond the leading run.
        let skipped = 0;
        let opened = 0;
        for (const event of events) {
            if (CLOSERS.has(event) && skipped < leadingClosers) { skipped++; continue; }
            if (OPENERS[event]) {
                stack.push({
                    restore: lineLevel,
                    body: lineLevel + 1,
                    isSwitch: event === '{' && /\bswitch\b/.test(code),
                    inCase: false,
                });
                opened++;
            } else if (stack.length) {
                stack.pop();
                opened--;
            } else {
                unbalanced = true;
            }
        }

        if (code !== '') {
            // Opening a bracket hands indentation over to that bracket, so the next
            // line starts a fresh statement inside it rather than continuing this one.
            inContinuation = !(STATEMENT_ENDERS.has(code.slice(-1)) || opened > 0 || code.startsWith('{'));
        }
    }

    if (stack.length) unbalanced = true;
    return { text: out.join(eol), lines: out, unbalanced };
}

module.exports = { formatPhp };
