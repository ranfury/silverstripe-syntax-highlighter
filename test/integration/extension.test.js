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

// --- completion ---------------------------------------------------------------------

/** Completion labels at the `|` marker in `content`, in the order the provider returns. */
async function completeAt(content, uri) {
    const offset = content.indexOf('|');
    assert.notStrictEqual(offset, -1, 'content must contain a | marker');
    const text = content.replace('|', '');

    let document;
    if (uri) {
        document = await vscode.workspace.openTextDocument(uri);
    } else {
        document = await vscode.workspace.openTextDocument({ language: 'silverstripe', content: text });
    }
    await vscode.window.showTextDocument(document, { preview: false });
    const list = await vscode.commands.executeCommand(
        'vscode.executeCompletionItemProvider', document.uri, document.positionAt(offset)
    );
    // `executeCompletionItemProvider` aggregates every provider, so the extension's own
    // snippet file and VS Code's word-based suggestions come back too. Drop those.
    return (list ? list.items : [])
        .filter((i) => i.kind !== vscode.CompletionItemKind.Snippet
            && i.kind !== vscode.CompletionItemKind.Text)
        .map((i) => ({
            label: typeof i.label === 'string' ? i.label : i.label.label,
            sortText: i.sortText,
            detail: i.detail,
            hasRange: Boolean(i.range),
            range: i.range,
        }));
}

suite('Completion', () => {
    setup(async () => {
        const extension = vscode.extensions.getExtension('Ranfurly.enhanced-silverstripe-templates');
        const api = await extension.activate();
        await api.index.ready();
    });

    test('$ offers members of the class in scope, own code before vendor', async () => {
        const items = await completeAt([
            '<%-- @var App\\PageTypes\\HomePage --%>',
            '<p>$T|</p>',
        ].join('\n'));
        const labels = items.map((i) => i.label);
        assert.ok(labels.includes('Subtitle'), `expected Subtitle in ${labels.slice(0, 15)}`);
        assert.ok(labels.includes('Tagline'), 'inherited project field');
        assert.ok(labels.includes('Title'), 'inherited vendor field');

        const sortOf = (label) => items.find((i) => i.label === label).sortText;
        assert.ok(sortOf('Subtitle') < sortOf('Tagline'), 'own class before inherited project code');
        assert.ok(sortOf('Tagline') < sortOf('Title'), 'project code before vendor');
    });

    test('a getFoo() method is offered both ways, idiomatic spelling first', async () => {
        const items = await completeAt([
            '<%-- @var App\\PageTypes\\HomePage --%>',
            '<p>$R|</p>',
        ].join('\n'));
        const spelled = items.find((i) => i.label === 'ReadingTime');
        const raw = items.find((i) => i.label === 'getReadingTime');
        assert.ok(spelled, 'expected ReadingTime, the idiomatic spelling');
        assert.ok(raw, 'expected getReadingTime too — plenty of people write it');
        assert.ok(spelled.sortText < raw.sortText, '$ReadingTime should rank above $getReadingTime');
        assert.match(raw.detail, /same as \$ReadingTime/);
    });

    test('lowercase-prefixed methods are offered as written', async () => {
        const items = await completeAt([
            '<%-- @var App\\PageTypes\\HomePage --%>',
            '<p>$h|</p>',
        ].join('\n'));
        const labels = items.map((i) => i.label);
        assert.ok(labels.includes('hasBanner'), `expected hasBanner, got ${labels.slice(0, 12)}`);
    });

    test('nothing is offered until a letter follows the dollar', async () => {
        const bare = await completeAt([
            '<%-- @var App\\PageTypes\\HomePage --%>',
            '<p>$|</p>',
        ].join('\n'));
        assert.strictEqual(bare.length, 0, 'a bare $ should not list every member');

        const typed = await completeAt([
            '<%-- @var App\\PageTypes\\HomePage --%>',
            '<p>$S|</p>',
        ].join('\n'));
        assert.ok(typed.some((i) => i.label === 'Subtitle'), 'one letter is enough to start');
    });

    test('a page with no controller of its own still sees the ancestor controller', async () => {
        // App\PageTypes\HomePage has no HomePageController; PageController is where
        // project-wide helpers live.
        const items = await completeAt([
            '<%-- @var App\\PageTypes\\HomePage --%>',
            '<p>$I|</p>',
        ].join('\n'));
        assert.ok(items.some((i) => i.label === 'IsDev'),
            `expected PageController helpers, got ${items.map((i) => i.label).slice(0, 12)}`);
    });

    test('suggestions are allowed while a snippet placeholder is active', async () => {
        // Otherwise tabbing through `<% loop $1 %>` silently suppresses completion.
        const document = await vscode.workspace.openTextDocument({
            language: 'silverstripe', content: '<p>x</p>',
        });
        const suggest = vscode.workspace.getConfiguration(
            'editor.suggest', { uri: document.uri, languageId: 'silverstripe' }
        );
        assert.strictEqual(suggest.get('snippetsPreventQuickSuggestions'), false);
    });

    test('completion replaces only the identifier, so typing filters the list', async () => {
        const items = await completeAt([
            '<%-- @var App\\PageTypes\\HomePage --%>',
            '<p>$Sub|</p>',
        ].join('\n'));
        assert.ok(items.length, 'expected items');
        // `<p>$Sub|` — the range must start after the `$`, or VS Code filters the list
        // against "$Sub" and nothing matches a label such as "Subtitle".
        assert.ok(items.every((i) => i.hasRange), 'every item needs an explicit range');
        for (const item of items) {
            // `<p>$Sub` — `<p>$` is characters 0-3, so the replaced word is 4..7.
            assert.strictEqual(item.range.start.character, 4, `${item.label} should replace "Sub" only`);
            assert.strictEqual(item.range.end.character, 7);
        }
        assert.ok(items.some((i) => i.label === 'Subtitle'));
    });

    test('scope narrows inside a loop', async () => {
        const items = await completeAt([
            '<%-- @var App\\PageTypes\\HomePage --%>',
            '<% loop $Testimonials %>',
            '    <p>$Q|</p>',
            '<% end_loop %>',
        ].join('\n'));
        const labels = items.map((i) => i.label);
        assert.ok(labels.includes('Quote'), `expected Testimonial fields, got ${labels.slice(0, 12)}`);
        assert.ok(labels.includes('Author'));
        assert.ok(!labels.includes('Subtitle'), 'the outer page class should not leak in');
    });

    test('nothing is offered when the template has no class', async () => {
        const items = await completeAt('<p>$|</p>');
        assert.strictEqual(items.length, 0);
    });

    test('a dot offers members of the resolved type plus casting helpers', async () => {
        const items = await completeAt([
            '<%-- @var App\\PageTypes\\HomePage --%>',
            '<p>$HeroImage.|</p>',
        ].join('\n'));
        const labels = items.map((i) => i.label);
        assert.ok(labels.includes('Title'), `expected File members, got ${labels.slice(0, 12)}`);
        assert.ok(labels.includes('XML'), 'casting helpers should always be offered after a dot');
        assert.ok(labels.includes('ATT'));
    });

    test('a dot on a global offers that class members', async () => {
        const items = await completeAt([
            '<%-- @var App\\PageTypes\\HomePage --%>',
            '<p>$SiteConfig.C|</p>',
        ].join('\n'));
        const labels = items.map((i) => i.label);
        assert.ok(labels.includes('ContactUsLink'), `expected SiteConfig fields, got ${labels.slice(0, 12)}`);
        assert.ok(labels.includes('Tagline'));
    });

    test('extension members are suggested through a global', async () => {
        // Regression: these resolved for Go to Definition but were never offered,
        // because completion walked only the inheritance chain.
        const items = await completeAt([
            '<%-- @var App\\PageTypes\\HomePage --%>',
            '<p>$SiteConfig.T|</p>',
        ].join('\n'));
        const labels = items.map((i) => i.label);
        assert.ok(labels.includes('TermsLink'),
            `expected the extension's has_one, got ${labels.slice(0, 12)}`);
        assert.ok(labels.includes('CompanyEmail'), 'and its $db fields');
    });

    test('extension members are suggested inside <% with %>', async () => {
        const items = await completeAt([
            '<%-- @var App\\PageTypes\\HomePage --%>',
            '<% with $SiteConfig %>',
            '    $T|',
            '<% end_with %>',
        ].join('\n'));
        assert.ok(items.map((i) => i.label).includes('TermsLink'));
    });

    test('trait members are suggested', async () => {
        const items = await completeAt([
            '<%-- @var App\\PageTypes\\HomePage --%>',
            '<p>$HeroImage.F|</p>',
        ].join('\n'));
        assert.ok(items.map((i) => i.label).includes('Fill'),
            'ImageManipulation::Fill arrives through a trait');
    });

    test('<% with %> on a global narrows suggestions to its class', async () => {
        const items = await completeAt([
            '<%-- @var App\\PageTypes\\HomePage --%>',
            '<% with $SiteConfig %>',
            '    $C|',
            '<% end_with %>',
        ].join('\n'));
        const labels = items.map((i) => i.label);
        assert.ok(labels.includes('ContactUsLink'), `expected SiteConfig fields, got ${labels.slice(0, 12)}`);
        assert.ok(!labels.includes('Subtitle'), 'the page class should not leak in');
    });

    test('<% with %> on a relation narrows suggestions to its class', async () => {
        const items = await completeAt([
            '<%-- @var App\\PageTypes\\HomePage --%>',
            '<% with $HeroImage %>',
            '    $N|',
            '<% end_with %>',
        ].join('\n'));
        const labels = items.map((i) => i.label);
        assert.ok(labels.includes('Name'), `expected File fields, got ${labels.slice(0, 12)}`);
    });

    test('$Up. offers the enclosing scope members', async () => {
        const items = await completeAt([
            '<%-- @var App\\PageTypes\\HomePage --%>',
            '<% loop $Testimonials %>',
            '    $Up.S|',
            '<% end_loop %>',
        ].join('\n'));
        const labels = items.map((i) => i.label);
        assert.ok(labels.includes('Subtitle'), `expected page fields, got ${labels.slice(0, 12)}`);
        assert.ok(!labels.includes('Quote'), 'the loop scope should not leak back in');
    });

    test('a dot on a list offers list methods rather than element members', async () => {
        const items = await completeAt([
            '<%-- @var App\\PageTypes\\HomePage --%>',
            '<p>$Testimonials.|</p>',
        ].join('\n'));
        const labels = items.map((i) => i.label);
        assert.ok(labels.includes('Count'), `expected list methods, got ${labels.slice(0, 12)}`);
        assert.ok(labels.includes('First'));
        assert.ok(!labels.includes('Quote'), 'element members need a loop first');
    });

    test('include names are offered', async () => {
        const items = await completeAt('<% include |%>');
        const labels = items.map((i) => i.label);
        assert.ok(labels.some((l) => l.endsWith('Navigation')), `expected templates, got ${labels}`);
        assert.ok(labels.some((l) => l.endsWith('Footer')));
        assert.ok(items.every((i) => i.hasRange));
    });

    test('block tags are offered, with the matching closer first', async () => {
        const items = await completeAt('<% loop $Items %>\n<% |');
        const labels = items.map((i) => i.label);
        assert.strictEqual(labels[0], 'end_loop', `expected end_loop first, got ${labels}`);
        assert.ok(labels.includes('include'));
        assert.ok(labels.includes('with'));
    });

    test('else is only offered inside an if block', async () => {
        const inIf = (await completeAt('<% if $X %>\n<% |')).map((i) => i.label);
        assert.ok(inIf.includes('else'));
        const inLoop = (await completeAt('<% loop $X %>\n<% |')).map((i) => i.label);
        assert.ok(!inLoop.includes('else'), 'else has no meaning inside a loop');
    });

    test('nothing is offered inside a comment', async () => {
        const items = await completeAt('<%-- $| --%>');
        assert.strictEqual(items.length, 0);
    });

    test('completion works inside a script block', async () => {
        const items = await completeAt([
            '<%-- @var App\\PageTypes\\HomePage --%>',
            '<script>',
            'var t = "$S|";',
            '</script>',
        ].join('\n'));
        assert.ok(items.some((i) => i.label === 'Subtitle'), 'templates interpolate inside script too');
    });
});
