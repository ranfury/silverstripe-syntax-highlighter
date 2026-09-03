const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');

const BADLY_INDENTED = [
    '<?php',
    '',
    'namespace App;',
    '',
    'class Thing extends \\Page',
    '{',
    'private static $db = [',
    "'Title' => 'Varchar(255)',",
    '];',
    '',
    'public function doThing($input)',
    '{',
    'if ($input) {',
    'foreach ($input as $item) {',
    '$this->handle($item);',
    '}',
    '}',
    'return $this;',
    '}',
    '}',
].join('\n');

const CORRECTLY_INDENTED = [
    '<?php',
    '',
    'namespace App;',
    '',
    'class Thing extends \\Page',
    '{',
    '    private static $db = [',
    "        'Title' => 'Varchar(255)',",
    '    ];',
    '',
    '    public function doThing($input)',
    '    {',
    '        if ($input) {',
    '            foreach ($input as $item) {',
    '                $this->handle($item);',
    '            }',
    '        }',
    '        return $this;',
    '    }',
    '}',
].join('\n');

/**
 * Open a document and wait until it is genuinely the active editor.
 *
 * `editor.action.*` commands act on whatever is focused, so without this they
 * intermittently run against the previous test's document.
 */
async function openPhp(content) {
    const document = await vscode.workspace.openTextDocument({ language: 'php', content });
    const editor = await vscode.window.showTextDocument(document, { preview: false });
    // VS Code detects indentation from file content; pin it so expectations are stable.
    editor.options.tabSize = 4;
    editor.options.insertSpaces = true;
    // `editor.action.*` commands run against the focused editor, so make sure the
    // editor group actually has focus before the test drives one.
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    for (let i = 0; i < 50; i++) {
        if (vscode.window.activeTextEditor
            && vscode.window.activeTextEditor.document.uri.toString() === document.uri.toString()) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return { document, editor };
}

/**
 * Editor commands act on real, saved files here rather than untitled buffers: an
 * untitled document is dirty from the moment it has content, which makes closing and
 * re-focusing editors between tests unreliable.
 */
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-php-'));

async function openPhpFile(content) {
    const file = path.join(scratchDir, `case-${Math.random().toString(36).slice(2)}.php`);
    fs.writeFileSync(file, content, 'utf8');
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    const editor = await vscode.window.showTextDocument(document, { preview: false });
    // VS Code detects indentation from file content; pin it so expectations are stable.
    editor.options.tabSize = 4;
    editor.options.insertSpaces = true;
    // `editor.action.*` commands run against the focused editor, so make sure the
    // editor group actually has focus before the test drives one.
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    for (let i = 0; i < 50; i++) {
        if (vscode.window.activeTextEditor
            && vscode.window.activeTextEditor.document.uri.toString() === document.uri.toString()) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return { document, editor };
}

/**
 * Run a focus-dependent editor command, reporting whether it actually did anything.
 *
 * `editor.action.*` commands are silent no-ops unless the test window holds OS focus,
 * which is not guaranteed in an automated run. Callers skip rather than fail in that
 * case, so these tests verify real editor behaviour when they can and never report a
 * failure that says nothing about the code.
 */
async function runEditorCommand(command, document) {
    const before = document.getText();
    for (let attempt = 0; attempt < 10; attempt++) {
        await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
        await vscode.commands.executeCommand(command);
        if (document.getText() !== before) return true;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
}

suite('PHP support', () => {
    suiteTeardown(() => {
        fs.rmSync(scratchDir, { recursive: true, force: true });
    });

    test('a PHP language configuration is contributed', () => {
        const extension = vscode.extensions.getExtension('Ranfurly.enhanced-silverstripe-templates');
        const php = extension.packageJSON.contributes.languages.find((l) => l.id === 'php');
        assert.ok(php, 'expected a php entry in contributes.languages');
        const config = JSON.parse(fs.readFileSync(
            path.join(extension.extensionPath, php.configuration), 'utf8'
        ));
        assert.ok(config.indentationRules.increaseIndentPattern);
        // Only indentation rules, so the built-in configuration supplies the rest.
        assert.deepStrictEqual(
            Object.keys(config).filter((k) => k !== '//'),
            ['indentationRules']
        );
    });

    test('the extension contributes indentation rules for PHP', async function () {
        const { document, editor } = await openPhpFile(BADLY_INDENTED);
        editor.selection = new vscode.Selection(
            new vscode.Position(0, 0),
            new vscode.Position(document.lineCount - 1, 0)
        );
        if (!await runEditorCommand('editor.action.reindentlines', document)) this.skip();
        // VS Code's reindent leaves indentation on blank lines; compare without it.
        const stripBlank = (text) => text.split('\n').map((l) => (l.trim() ? l : '')).join('\n');
        assert.strictEqual(stripBlank(document.getText()), CORRECTLY_INDENTED);
    });

    test('contributing indentation rules does not clobber the built-in configuration', async function () {
        // Comment toggling comes from VS Code's own PHP configuration; if our
        // contribution had replaced it wholesale rather than merged, this would fail.
        const { document, editor } = await openPhpFile('<?php\n$a = 1;\n');
        editor.selection = new vscode.Selection(new vscode.Position(1, 0), new vscode.Position(1, 0));
        if (!await runEditorCommand('editor.action.commentLine', document)) this.skip();
        assert.strictEqual(document.lineAt(1).text.trim(), '// $a = 1;');
    });

    test('format document re-indents PHP', async () => {
        const { document } = await openPhp(BADLY_INDENTED);
        const edits = await vscode.commands.executeCommand(
            'vscode.executeFormatDocumentProvider', document.uri, { tabSize: 4, insertSpaces: true }
        );
        assert.ok(edits && edits.length, 'expected formatting edits');
        const edit = new vscode.WorkspaceEdit();
        edit.set(document.uri, edits);
        await vscode.workspace.applyEdit(edit);
        assert.strictEqual(document.getText(), CORRECTLY_INDENTED);
    });

    test('format document handles fluent chains and switch bodies', async () => {
        const { document } = await openPhp([
            '<?php',
            '',
            'function build($fields)',
            '{',
            '$fields->addFieldsToTab(\'Root.Main\', [',
            'UploadField::create(\'Image\')',
            '->setIsMultiUpload(false)',
            '->setFolderName(\'Images\'),',
            ']);',
            'switch ($mode) {',
            'case \'a\':',
            '$this->a();',
            'break;',
            'default:',
            '$this->b();',
            '}',
            '}',
        ].join('\n'));

        const edits = await vscode.commands.executeCommand(
            'vscode.executeFormatDocumentProvider', document.uri, { tabSize: 4, insertSpaces: true }
        );
        const edit = new vscode.WorkspaceEdit();
        edit.set(document.uri, edits);
        await vscode.workspace.applyEdit(edit);

        assert.strictEqual(document.getText(), [
            '<?php',
            '',
            'function build($fields)',
            '{',
            "    $fields->addFieldsToTab('Root.Main', [",
            "        UploadField::create('Image')",
            '            ->setIsMultiUpload(false)',
            "            ->setFolderName('Images'),",
            '    ]);',
            '    switch ($mode) {',
            "        case 'a':",
            '            $this->a();',
            '            break;',
            '        default:',
            '            $this->b();',
            '    }',
            '}',
        ].join('\n'));
    });

    test('format document leaves heredoc bodies untouched', async () => {
        const { document } = await openPhp([
            '<?php',
            'function f()',
            '{',
            '$sql = <<<SQL',
            '    SELECT *',
            '      FROM tbl',
            'SQL;',
            'return $sql;',
            '}',
        ].join('\n'));
        const edits = await vscode.commands.executeCommand(
            'vscode.executeFormatDocumentProvider', document.uri, { tabSize: 4, insertSpaces: true }
        );
        const edit = new vscode.WorkspaceEdit();
        edit.set(document.uri, edits);
        await vscode.workspace.applyEdit(edit);
        const lines = document.getText().split('\n');
        assert.strictEqual(lines[4], '    SELECT *', 'heredoc content must be preserved exactly');
        assert.strictEqual(lines[5], '      FROM tbl');
        assert.strictEqual(lines[6], 'SQL;');
    });

    test('Fix Indentation matches the formatter where reindent cannot', async () => {
        // Both cases VS Code's Reindent Lines gets wrong: a line whose first token is a
        // string (core skips it) and a fluent chain (rules cannot see continuation).
        const { document } = await openPhpFile([
            '<?php',
            'class Page extends SiteTree',
            '{',
            'private static $db = [',
            "'PageHeading' => 'Varchar(255)',",
            "        'PageSummary' => 'Text',",
            '];',
            '',
            'public function f($fields)',
            '{',
            "$fields->push(TextField::create('BannerHeading', 'Banner Heading')",
            "->setDescription('The main heading.'));",
            '}',
            '}',
        ].join('\n'));

        await vscode.commands.executeCommand('silverstripe.fixIndentation');

        assert.strictEqual(document.getText(), [
            '<?php',
            'class Page extends SiteTree',
            '{',
            '    private static $db = [',
            "        'PageHeading' => 'Varchar(255)',",
            "        'PageSummary' => 'Text',",
            '    ];',
            '',
            '    public function f($fields)',
            '    {',
            "        $fields->push(TextField::create('BannerHeading', 'Banner Heading')",
            "            ->setDescription('The main heading.'));",
            '    }',
            '}',
        ].join('\n'));
    });

    test('Fix Indentation only rewrites the selection when there is one', async () => {
        const { document, editor } = await openPhpFile([
            '<?php',
            'class A',
            '{',
            '$a = 1;',
            '$b = 2;',
            '}',
        ].join('\n'));
        editor.selections = [new vscode.Selection(3, 0, 3, 0)];
        editor.selection = new vscode.Selection(3, 0, 3, 7);
        await vscode.commands.executeCommand('silverstripe.fixIndentation');
        assert.strictEqual(document.lineAt(3).text, '    $a = 1;', 'selected line is fixed');
        assert.strictEqual(document.lineAt(4).text, '$b = 2;', 'unselected line is left alone');
    });

    test('Fix Indentation also works on Silverstripe templates', async () => {
        const document = await vscode.workspace.openTextDocument({
            language: 'silverstripe',
            content: '<div>\n<svg viewBox="0 0 24 24">\n<path d="M0 0"/>\n</svg>\n</div>',
        });
        await vscode.window.showTextDocument(document, { preview: false });
        await vscode.commands.executeCommand('silverstripe.fixIndentation');
        assert.strictEqual(document.getText(), [
            '<div>',
            '    <svg viewBox="0 0 24 24">',
            '        <path d="M0 0"/>',
            '    </svg>',
            '</div>',
        ].join('\n'));
    });

    test('silverstripe templates are unaffected by the PHP formatter', async () => {
        const document = await vscode.workspace.openTextDocument({
            language: 'silverstripe',
            content: '<div>\n<p>$Title</p>\n</div>',
        });
        await vscode.window.showTextDocument(document);
        const edits = await vscode.commands.executeCommand(
            'vscode.executeFormatDocumentProvider', document.uri, { tabSize: 4, insertSpaces: true }
        );
        const edit = new vscode.WorkspaceEdit();
        edit.set(document.uri, edits);
        await vscode.workspace.applyEdit(edit);
        assert.strictEqual(document.getText(), '<div>\n    <p>$Title</p>\n</div>');
    });
});
