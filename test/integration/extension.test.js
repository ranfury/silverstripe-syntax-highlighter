const assert = require('assert');
const path = require('path');
const vscode = require('vscode');

const ROOT = vscode.workspace.workspaceFolders[0].uri.fsPath;
const HOME_TEMPLATE = vscode.Uri.file(path.join(ROOT, 'app/templates/App/PageTypes/Layout/HomePage.ss'));

async function openTemplate() {
    const document = await vscode.workspace.openTextDocument(HOME_TEMPLATE);
    await vscode.window.showTextDocument(document, { preview: false });
    const extension = vscode.extensions.getExtension('Ranfurly.enhanced-silverstripe-templates');
    assert.ok(extension, 'extension should be present');
    const api = await extension.activate();
    await api.index.ready();
    return { document, api };
}

/** Position just inside the first occurrence of `needle`. */
function positionOf(document, needle, offsetInto = 1) {
    const index = document.getText().indexOf(needle);
    assert.notStrictEqual(index, -1, `template should contain ${needle}`);
    return document.positionAt(index + offsetInto);
}

async function definitionAt(document, needle, offsetInto = 1) {
    const locations = await vscode.commands.executeCommand(
        'vscode.executeDefinitionProvider', document.uri, positionOf(document, needle, offsetInto)
    );
    assert.ok(locations && locations.length, `expected a definition for ${needle}`);
    return locations[0].uri || locations[0].targetUri;
}

suite('Silverstripe templates', () => {
    setup(async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    test('.ss files use the silverstripe language', async () => {
        const { document } = await openTemplate();
        assert.strictEqual(document.languageId, 'silverstripe');
    });

    test('the project index finds fixture classes and templates', async () => {
        const { api } = await openTemplate();
        assert.ok(api.index.getClass('App\\PageTypes\\HomePage'));
        assert.ok(api.index.getClass('SilverStripe\\CMS\\Model\\SiteTree'), 'vendor code should be indexed');
        assert.ok(api.index.templates.length >= 4);
    });

    test('go to definition on a $db field lands on the PHP declaration', async () => {
        const { document } = await openTemplate();
        const target = await definitionAt(document, '$Subtitle');
        assert.match(target.fsPath, /HomePage\.php$/);
    });

    test('go to definition follows inheritance into vendor code', async () => {
        const { document } = await openTemplate();
        assert.match((await definitionAt(document, '$Title')).fsPath, /SiteTree\.php$/);
    });

    test('go to definition narrows scope inside a loop', async () => {
        const { document } = await openTemplate();
        assert.match((await definitionAt(document, '$Quote')).fsPath, /Testimonial\.php$/);
    });

    test('$Up resolves back to the outer scope', async () => {
        const { document } = await openTemplate();
        const at = document.positionAt(document.getText().indexOf('$Up.Subtitle') + 5);
        const locations = await vscode.commands.executeCommand(
            'vscode.executeDefinitionProvider', document.uri, at
        );
        assert.ok(locations && locations.length);
        assert.match((locations[0].uri || locations[0].targetUri).fsPath, /HomePage\.php$/);
    });

    test('go to definition on an include opens the template file', async () => {
        const { document } = await openTemplate();
        const target = await definitionAt(document, 'Navigation', 2);
        assert.match(target.fsPath, /Includes[\\/]Navigation\.ss$/);
    });

    test('includes are clickable document links', async () => {
        const { document } = await openTemplate();
        const links = await vscode.commands.executeCommand('vscode.executeLinkProvider', document.uri);
        assert.ok(links && links.length >= 2, 'expected links for both includes');
        assert.ok(links.some((l) => /Navigation\.ss$/.test(l.target.fsPath)));
        assert.ok(links.some((l) => /Footer\.ss$/.test(l.target.fsPath)));
    });

    test('hover explains a resolved variable', async () => {
        const { document } = await openTemplate();
        const hovers = await vscode.commands.executeCommand(
            'vscode.executeHoverProvider', document.uri, positionOf(document, '$Subtitle')
        );
        assert.ok(hovers && hovers.length);
        assert.match(hovers[0].contents.map((c) => c.value || c).join('\n'), /\$db/);
    });

    test('format document fixes broken indentation', async () => {
        const document = await vscode.workspace.openTextDocument({
            language: 'silverstripe',
            content: [
                '<div>',
                '<svg viewBox="0 0 24 24">',
                '<path d="M3 6h18"/>',
                '<circle cx="5" cy="5" r="4"/>',
                '</svg>',
                '<%if $A%>',
                '<p>x</p>',
                '<% end_if %>',
                '</div>',
            ].join('\n'),
        });
        await vscode.window.showTextDocument(document, { preview: false });
        const edits = await vscode.commands.executeCommand(
            'vscode.executeFormatDocumentProvider', document.uri, { tabSize: 4, insertSpaces: true }
        );
        const edit = new vscode.WorkspaceEdit();
        edit.set(document.uri, edits);
        await vscode.workspace.applyEdit(edit);
        assert.strictEqual(document.getText(), [
            '<div>',
            '    <svg viewBox="0 0 24 24">',
            '        <path d="M3 6h18"/>',
            '        <circle cx="5" cy="5" r="4"/>',
            '    </svg>',
            '    <% if $A %>',
            '        <p>x</p>',
            '    <% end_if %>',
            '</div>',
        ].join('\n'));
    });

    test('format document leaves an already-formatted template alone', async () => {
        const { document } = await openTemplate();
        const before = document.getText();
        const edits = await vscode.commands.executeCommand(
            'vscode.executeFormatDocumentProvider', document.uri,
            { tabSize: 4, insertSpaces: true }
        );
        assert.ok(!edits || edits.length === 0, 'expected no edits for a formatted template');
        assert.strictEqual(document.getText(), before);
    });
});
