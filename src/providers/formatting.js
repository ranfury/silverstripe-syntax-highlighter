'use strict';

const vscode = require('vscode');
const { format } = require('../formatter');
const { config } = require('./shared');

/**
 * `Format Document` for `.ss` files.
 *
 * Emits one edit per changed line rather than replacing the whole document, so the
 * cursor, selections and folded regions survive formatting.
 */
class SilverstripeFormattingProvider {
    provideDocumentFormattingEdits(document, options, token, pasted) {
        const result = format(document.getText(), {
            tabSize: options.tabSize,
            insertSpaces: options.insertSpaces,
            normaliseTagSpacing: config().get('format.normaliseTagSpacing', true),
            pasted,
        });

        const edits = [];
        const count = Math.min(document.lineCount, result.lines.length);
        for (let i = 0; i < count; i++) {
            const line = document.lineAt(i);
            if (line.text !== result.lines[i]) {
                edits.push(vscode.TextEdit.replace(line.range, result.lines[i]));
            }
        }
        return edits;
    }

    /**
     * `Format Selection`. Indentation is a whole-document property, so the document is
     * formatted in full and only the edits inside the selection are returned.
     */
    async provideDocumentRangeFormattingEdits(document, range, options, token) {
        const pasted = await pastedBlock(document, range);
        const all = this.provideDocumentFormattingEdits(document, options, token, pasted);
        return all.filter((edit) => edit.range.start.line >= range.start.line
            && edit.range.end.line <= range.end.line);
    }
}

/**
 * When `range` is text that was just pasted at an indented cursor, the lines it covers
 * (as the formatter's `pasted` option); otherwise `undefined`.
 *
 * Format On Paste and Format Selection reach the provider the same way, so a paste is
 * recognised by the range holding exactly what is on the clipboard. Only then is the
 * first line's indent known to come from the cursor rather than from the copied text.
 */
async function pastedBlock(document, range) {
    if (range.start.line === range.end.line) return undefined;
    let clipboard;
    try {
        clipboard = await vscode.env.clipboard.readText();
    } catch {
        return undefined;
    }
    const clip = clipboard.replace(/\r\n/g, '\n');
    const text = document.getText(range).replace(/\r\n/g, '\n');
    // Allow for the range having been widened to the start of the line.
    if (!clip || !text.endsWith(clip) || !/^[ \t]*$/.test(text.slice(0, text.length - clip.length))) {
        return undefined;
    }

    const startPos = document.positionAt(document.offsetAt(range.start) + (text.length - clip.length));
    const before = document.lineAt(startPos.line).text.slice(0, startPos.character);
    // Pasted at column 0, or after other text: the clipboard's own indents are all there is.
    if (!before || before.trim()) return undefined;
    // A trailing newline ends the paste at the start of the next line, which is not part of it.
    const lineCount = clip.replace(/\n$/, '').split('\n').length;
    if (lineCount < 2) return undefined;
    return { startLine: startPos.line, endLine: startPos.line + lineCount - 1 };
}

module.exports = { SilverstripeFormattingProvider };
