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
    provideDocumentFormattingEdits(document, options) {
        const result = format(document.getText(), {
            tabSize: options.tabSize,
            insertSpaces: options.insertSpaces,
            normaliseTagSpacing: config().get('format.normaliseTagSpacing', true),
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
    provideDocumentRangeFormattingEdits(document, range, options) {
        const all = this.provideDocumentFormattingEdits(document, options);
        return all.filter((edit) => edit.range.start.line >= range.start.line
            && edit.range.end.line <= range.end.line);
    }
}

module.exports = { SilverstripeFormattingProvider };
