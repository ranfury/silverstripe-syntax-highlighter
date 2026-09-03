'use strict';

const vscode = require('vscode');
const { format } = require('../formatter');
const { formatPhp } = require('../phpFormatter');

/**
 * Re-indent the active editor the way **Format Document** would.
 *
 * `editor.action.reindentlines` cannot match it, for two reasons that both live in VS
 * Code core rather than in this extension:
 *
 *  - It skips any line whose first token is a string, so an array entry such as
 *    `'Key' => 'Varchar(255)',` sitting at column 0 is never touched — and once a line
 *    is there, reindent can never bring it back.
 *  - Indentation rules are per-line regexes, so they cannot see that `->setFoo()`
 *    continues the statement above it.
 *
 * This command runs the same state-tracking formatter instead, so it is worth binding
 * to whatever key you had on Reindent Lines.
 */
async function fixIndentation() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showInformationMessage('Silverstripe: open a file to re-indent first.');
        return;
    }

    const { document } = editor;
    const options = {
        tabSize: Number(editor.options.tabSize) || 4,
        insertSpaces: editor.options.insertSpaces !== false,
    };

    let result;
    if (document.languageId === 'php') result = formatPhp(document.getText(), options);
    else if (document.languageId === 'silverstripe') result = format(document.getText(), options);
    else {
        vscode.window.showInformationMessage(
            'Silverstripe: Fix Indentation works on Silverstripe templates and PHP files.'
        );
        return;
    }

    // Indentation depends on the whole file, so it is always computed in full; a
    // selection just limits which of the resulting edits get applied.
    const selected = editor.selections.filter((s) => !s.isEmpty);
    const inSelection = (line) => !selected.length
        || selected.some((s) => line >= s.start.line && line <= s.end.line);

    const changed = [];
    const count = Math.min(document.lineCount, result.lines.length);
    for (let i = 0; i < count; i++) {
        if (!inSelection(i)) continue;
        const line = document.lineAt(i);
        if (line.text !== result.lines[i]) changed.push([line.range, result.lines[i]]);
    }

    if (!changed.length) return;
    await editor.edit((builder) => {
        for (const [range, text] of changed) builder.replace(range, text);
    }, { undoStopBefore: true, undoStopAfter: true });
}

module.exports = { fixIndentation };
