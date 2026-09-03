'use strict';

/**
 * A tolerant scanner for Silverstripe `.ss` templates.
 *
 * Deliberately not a full grammar: everything the language features need is
 * positional (where does this tag start, which segment of this variable chain is the
 * cursor in), so one left-to-right pass is both simpler and fast enough to run on
 * every keystroke. Highlighting is handled entirely by the TextMate grammar; this
 * scanner never touches it.
 */

const BLOCK_OPENERS = new Set(['if', 'loop', 'with', 'cached', 'uncached']);

const BLOCK_CLOSERS = new Map([
    ['end_if', 'if'],
    ['end_loop', 'loop'],
    ['end_with', 'with'],
    ['end_cached', 'cached'],
    ['end_uncached', 'uncached'],
]);

const BLOCK_CONTINUATIONS = new Map([
    ['else', 'if'],
    ['else_if', 'if'],
]);

/** Iterator and scope variables provided by SSViewer rather than by a data object. */
const LANGUAGE_VARIABLES = new Set([
    'Up', 'Top', 'Me',
    'Pos', 'FromEnd', 'TotalItems', 'First', 'Last', 'Middle',
    'Even', 'Odd', 'EvenOdd', 'IsFirst', 'IsLast', 'Modulus', 'MultipleOf',
]);

/**
 * Template globals that never belong to the current record, mapped to the class they
 * evaluate to so that `$SiteConfig.Foo` and `<% with $SiteConfig %>` narrow scope the
 * same way a relation does. `null` means the value is a string rather than an object.
 */
const GLOBAL_VARIABLES = new Map([
    ['SiteConfig', 'SilverStripe\\SiteConfig\\SiteConfig'],
    ['CurrentMember', 'SilverStripe\\Security\\Member'],
    ['CurrentUser', 'SilverStripe\\Security\\Member'],
    ['Now', 'SilverStripe\\ORM\\FieldType\\DBDatetime'],
    ['ThemeDir', null],
    ['BaseHref', null],
    ['BaseURL', null],
    ['AbsoluteBaseURL', null],
    ['Layout', null],
    ['MetaTags', null],
]);

/** Escaping helpers that are template syntax, not class members. */
const CAST_METHODS = new Set([
    'XML', 'RAW', 'ATT', 'JS', 'CDATA', 'HTML', 'HTMLATT',
    'RAWURLATT', 'URLATT', 'ProcessedRAW', 'JSON',
]);

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*/;

/**
 * Split `text` into `<%-- --%>` comment regions and `<% %>` tags.
 *
 * Quotes are tracked while looking for `%>` so a literal `%>` inside a string
 * argument does not end the tag early.
 */
function scanRegions(text) {
    const comments = [];
    const tags = [];
    const len = text.length;
    let i = 0;

    while (i < len) {
        const open = text.indexOf('<%', i);
        if (open === -1) break;

        if (text.startsWith('<%--', open)) {
            const close = text.indexOf('--%>', open + 4);
            const end = close === -1 ? len : close + 4;
            comments.push({ start: open, end, text: text.slice(open, end), closed: close !== -1 });
            i = end;
            continue;
        }

        let j = open + 2;
        let quote = null;
        let end = -1;
        while (j < len) {
            const ch = text[j];
            if (quote) {
                if (ch === '\\') j++;
                else if (ch === quote) quote = null;
            } else if (ch === '"' || ch === "'") {
                quote = ch;
            } else if (ch === '%' && text[j + 1] === '>') {
                end = j + 2;
                break;
            } else if (ch === '<' && text[j + 1] === '%') {
                break; // Unterminated; don't swallow the tag that follows.
            }
            j++;
        }

        if (end === -1) {
            tags.push(makeTag(text, open, Math.min(j, len), false));
            i = Math.max(open + 2, j);
        } else {
            tags.push(makeTag(text, open, end, true));
            i = end;
        }
    }

    return { comments, tags };
}

function makeTag(text, start, end, closed) {
    const raw = text.slice(start, end);
    const inner = closed ? raw.slice(2, -2) : raw.slice(2);
    const innerStart = start + 2;

    const head = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)/.exec(inner);
    const keyword = head ? head[2] : '';
    const keywordStart = head ? innerStart + head[1].length : innerStart;

    const tag = {
        start,
        end,
        closed,
        raw,
        inner,
        innerStart,
        keyword,
        keywordStart,
        keywordEnd: keywordStart + keyword.length,
        kind: 'unknown',
    };

    const rest = head ? inner.slice(head[0].length) : inner;
    const restStart = keywordStart + keyword.length;

    if (keyword === 'include') {
        tag.kind = 'include';
        const name = /^(\s*)([A-Za-z_][A-Za-z0-9_]*(?:[\\/][A-Za-z_][A-Za-z0-9_]*)*)/.exec(rest);
        if (name) {
            tag.templateName = name[2];
            tag.templateNameStart = restStart + name[1].length;
            tag.templateNameEnd = tag.templateNameStart + name[2].length;
        }
    } else if (keyword === 'require') {
        tag.kind = 'require';
        tag.requirements = [];
        const re = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*(['"])((?:\\.|(?!\2).)*)\2/g;
        let m;
        while ((m = re.exec(inner))) {
            const pathStart = innerStart + m.index + m[0].length - m[3].length - 1;
            tag.requirements.push({ fn: m[1], path: m[3], pathStart, pathEnd: pathStart + m[3].length });
        }
    } else if (keyword === 't') {
        tag.kind = 'translate';
        const key = /^(\s*)([A-Za-z_][A-Za-z0-9_]*(?:[.\\][A-Za-z_][A-Za-z0-9_]*)+)/.exec(rest);
        if (key) {
            tag.entityKey = key[2];
            tag.entityKeyStart = restStart + key[1].length;
            tag.entityKeyEnd = tag.entityKeyStart + key[2].length;
        }
    } else if (BLOCK_OPENERS.has(keyword)) {
        tag.kind = 'open';
        tag.block = keyword;
    } else if (BLOCK_CLOSERS.has(keyword)) {
        tag.kind = 'close';
        tag.block = BLOCK_CLOSERS.get(keyword);
    } else if (BLOCK_CONTINUATIONS.has(keyword)) {
        tag.kind = 'continue';
        tag.block = BLOCK_CONTINUATIONS.get(keyword);
    } else if (keyword === 'base_tag') {
        tag.kind = 'standalone';
    }

    if (tag.kind === 'open' || tag.kind === 'continue') {
        // The subject of `<% loop $X %>` / `<% with $X %>` drives scope narrowing.
        const subject = /^\s*(\$?[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*|\([^)]*\))*)/.exec(rest);
        if (subject) tag.subject = subject[1];
    }

    return tag;
}

/** Skip a balanced `(...)` starting at `text[pos] === '('`; returns the index after `)`. */
function skipArguments(text, pos) {
    let depth = 0;
    let quote = null;
    for (let i = pos; i < text.length; i++) {
        const ch = text[i];
        if (quote) {
            if (ch === '\\') i++;
            else if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '(') depth++;
        else if (ch === ')') {
            depth--;
            if (depth === 0) return i + 1;
        } else if (ch === '\n') {
            return -1; // Unbalanced; don't swallow the rest of the file.
        }
    }
    return -1;
}

/** Read a `$Foo.Bar(1).Baz` chain starting at the `$`. */
function readChain(text, dollar) {
    const first = IDENT.exec(text.slice(dollar + 1));
    if (!first) return null;

    let cursor = dollar + 1 + first[0].length;
    const segments = [{ name: first[0], start: dollar + 1, end: cursor, call: false }];

    const argSpans = [];
    for (;;) {
        if (text[cursor] === '(') {
            const after = skipArguments(text, cursor);
            if (after === -1) break;
            segments[segments.length - 1].call = true;
            argSpans.push({ start: cursor + 1, end: after - 1 });
            cursor = after;
            continue;
        }
        if (text[cursor] === '.') {
            const next = IDENT.exec(text.slice(cursor + 1));
            if (!next) break;
            const start = cursor + 1;
            cursor = start + next[0].length;
            segments.push({ name: next[0], start, end: cursor, call: false });
            continue;
        }
        break;
    }

    return { start: dollar, end: cursor, segments, argSpans };
}

/**
 * All `$Foo.Bar` chains, excluding anything inside a `<%-- --%>` comment.
 *
 * Arguments are scanned too, so `$List.Filter('TypeID', $CategoryID)` finds
 * `$CategoryID` — but only outside quotes, because a quoted argument is a literal
 * string to Silverstripe, not an interpolation.
 */
function scanVariables(text, comments) {
    const out = [];
    const inComment = (offset) => comments.some((c) => offset >= c.start && offset < c.end);

    const scan = (from, to, skipQuotes) => {
        let quote = null;
        for (let i = from; i < to; i++) {
            const ch = text[i];
            if (skipQuotes) {
                if (quote) {
                    if (ch === '\\') i++;
                    else if (ch === quote) quote = null;
                    continue;
                }
                if (ch === '"' || ch === "'") { quote = ch; continue; }
            }
            if (ch !== '$') continue;
            // `${...}` is a JavaScript template literal, not Silverstripe syntax.
            if (!IDENT.test(text.slice(i + 1))) continue;
            if (!skipQuotes && inComment(i)) continue;

            const chain = readChain(text, i);
            if (!chain) continue;
            chain.braced = text[i - 1] === '{';
            out.push(chain);
            for (const span of chain.argSpans) scan(span.start, span.end, true);
            i = chain.end - 1;
        }
    };

    scan(0, text.length, false);
    return out;
}

/**
 * Match block openers with their closers.
 *
 * Returns unmatched tags as well, so callers can decide how to treat a malformed
 * template rather than having the imbalance silently swallowed.
 */
function pairBlocks(tags) {
    const stack = [];
    const pairs = [];
    const unmatchedOpen = [];
    const unmatchedClose = [];
    const strayContinuations = [];

    for (const tag of tags) {
        if (tag.kind === 'open') {
            stack.push({ open: tag, continuations: [] });
        } else if (tag.kind === 'continue') {
            const top = stack[stack.length - 1];
            if (top && top.open.block === tag.block) top.continuations.push(tag);
            else strayContinuations.push(tag);
        } else if (tag.kind === 'close') {
            let idx = -1;
            for (let i = stack.length - 1; i >= 0; i--) {
                if (stack[i].open.block === tag.block) { idx = i; break; }
            }
            if (idx === -1) {
                unmatchedClose.push(tag);
                continue;
            }
            // Anything still open above the match was never closed.
            for (const orphan of stack.splice(idx + 1)) {
                unmatchedOpen.push(orphan.open);
                pairs.push({ ...orphan, close: null });
            }
            pairs.push({ ...stack.pop(), close: tag });
        }
    }

    for (const frame of stack) {
        unmatchedOpen.push(frame.open);
        pairs.push({ ...frame, close: null });
    }
    unmatchedOpen.sort((a, b) => a.start - b.start);
    pairs.sort((a, b) => a.open.start - b.open.start);

    return { pairs, unmatchedOpen, unmatchedClose, strayContinuations };
}

function parse(text) {
    const { comments, tags } = scanRegions(text);
    return { comments, tags, variables: scanVariables(text, comments), blocks: pairBlocks(tags) };
}

/**
 * The variable chain and segment covering `offset`, if any.
 *
 * The cursor has to sit on a segment name (or the leading `$`). Anywhere else inside
 * the chain — a `.`, a bracket, or the middle of a quoted argument — is not a jump
 * target, so `{$getStyleTag("path/to/file.css")}` only navigates from `getStyleTag`.
 */
function chainAt(parsed, offset) {
    for (const chain of parsed.variables) {
        if (offset < chain.start || offset > chain.end) continue;
        for (let i = 0; i < chain.segments.length; i++) {
            const seg = chain.segments[i];
            const from = i === 0 ? chain.start : seg.start;
            if (offset >= from && offset <= seg.end) return { chain, segment: seg, index: i };
        }
    }
    return null;
}

/** The tag covering `offset`, if any. */
function tagAt(parsed, offset) {
    return parsed.tags.find((t) => offset >= t.start && offset <= t.end) || null;
}

/** `<%-- @var App\Pages\HomePage --%>` pins the class a shared include renders against. */
function readScopeHint(parsed) {
    for (const comment of parsed.comments) {
        const m = /@(?:var|type)\s+\\?([A-Za-z_][A-Za-z0-9_\\]*)/.exec(comment.text);
        if (m) return m[1];
    }
    return null;
}

/** Enclosing `<% loop %>` / `<% with %>` subjects at `offset`, outermost first. */
function scopeChainAt(parsed, offset) {
    const frames = [];
    for (const pair of parsed.blocks.pairs) {
        if (pair.open.block !== 'loop' && pair.open.block !== 'with') continue;
        const end = pair.close ? pair.close.start : Infinity;
        if (offset > pair.open.end && offset < end && pair.open.subject) {
            frames.push({ kind: pair.open.block, subject: pair.open.subject });
        }
    }
    return frames;
}

module.exports = {
    parse,
    scanRegions,
    readChain,
    chainAt,
    tagAt,
    readScopeHint,
    scopeChainAt,
    pairBlocks,
    BLOCK_OPENERS,
    BLOCK_CLOSERS,
    BLOCK_CONTINUATIONS,
    LANGUAGE_VARIABLES,
    GLOBAL_VARIABLES,
    CAST_METHODS,
};
