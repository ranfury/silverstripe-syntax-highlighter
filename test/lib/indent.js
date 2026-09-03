/**
 * Runs the indentation rules from `language-configuration.json` the way VS Code does,
 * so indentation behaviour can be asserted without launching an editor.
 *
 *  - `reindent`     -> what `editor.action.reindentlines` / reindent-on-paste produce
 *  - `enterIndent`  -> the indent applied when Enter is pressed at the end of a line
 */
const fs = require('fs');
const path = require('path');

const raw = fs.readFileSync(path.join(__dirname, '..', '..', 'language-configuration.json'), 'utf8');
// The file format is JSONC: VS Code allows comments and trailing commas.
const config = JSON.parse(
    raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/,(\s*[}\]])/g, '$1')
);

const increase = new RegExp(config.indentationRules.increaseIndentPattern);
const decrease = new RegExp(config.indentationRules.decreaseIndentPattern);
const onEnterRules = (config.onEnterRules || []).map((rule) => ({
    beforeText: new RegExp(rule.beforeText),
    afterText: rule.afterText ? new RegExp(rule.afterText) : null,
    // In the language-configuration file format the key is `indent`, not `indentAction`.
    action: rule.action.indent,
}));

const UNIT = '    ';

/**
 * Re-indent lines from scratch: a line matching `decreaseIndentPattern` drops a level
 * before it is emitted, and a line matching `increaseIndentPattern` raises the level
 * for the lines that follow.
 */
function reindent(source, startLevel = 0) {
    let level = startLevel;
    return source.split('\n').map((raw_) => {
        const text = raw_.trim();
        if (!text) return '';
        if (decrease.test(text)) level = Math.max(0, level - 1);
        const out = UNIT.repeat(level) + text;
        if (increase.test(text)) level += 1;
        return out;
    }).join('\n');
}

/** Indent level, in units, that pressing Enter at the end of `prevLine` produces. */
function enterIndent(prevLine, restOfLine = '') {
    const base = Math.floor(/^ */.exec(prevLine)[0].length / UNIT.length);
    for (const rule of onEnterRules) {
        if (!rule.beforeText.test(prevLine)) continue;
        if (rule.afterText && !rule.afterText.test(restOfLine)) continue;
        if (rule.action === 'indent' || rule.action === 'indentOutdent') return base + 1;
        if (rule.action === 'outdent') return base - 1;
        return base;
    }
    let level = base;
    if (increase.test(prevLine)) level += 1;
    if (restOfLine.trim() && decrease.test(restOfLine)) level -= 1;
    return Math.max(0, level);
}

/** True when Enter also pushes the closing tag down onto its own line. */
function isIndentOutdent(prevLine, restOfLine) {
    for (const rule of onEnterRules) {
        if (!rule.beforeText.test(prevLine)) continue;
        if (rule.afterText && !rule.afterText.test(restOfLine)) continue;
        return rule.action === 'indentOutdent';
    }
    return false;
}

module.exports = { reindent, enterIndent, isIndentOutdent, increase, decrease };
