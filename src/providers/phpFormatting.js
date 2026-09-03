'use strict';

const vscode = require('vscode');
const { formatPhp } = require('../phpFormatter');

/**
 * `Format Document` for PHP — indentation only.
 *
 * VS Code's built-in PHP indentation rules describe alternative syntax (`if:` …
 * `endif;`) and nothing else, so brace-indented code cannot be re-indented correctly by
 * rules alone. This tracks state instead, which is what fluent chains, `switch`/`case`
 * and heredocs need.
 *
 * It only ever rewrites leading whitespace, so it composes with a real style fixer such
 * as PHP-CS-Fixer rather than competing with it.
 */
class PhpFormattingProvider {
    provideDocumentFormattingEdits(document, options) {
        const result = formatPhp(document.getText(), {
            tabSize: options.tabSize,
            insertSpaces: options.insertSpaces,
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

    /** Indentation is a whole-file property, so format everything and clip to the range. */
    provideDocumentRangeFormattingEdits(document, range, options) {
        return this.provideDocumentFormattingEdits(document, options)
            .filter((edit) => edit.range.start.line >= range.start.line
                && edit.range.end.line <= range.end.line);
    }
}

module.exports = { PhpFormattingProvider };
