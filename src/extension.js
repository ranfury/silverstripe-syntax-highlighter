'use strict';

const vscode = require('vscode');
const { ProjectIndex } = require('./projectIndex');
const shared = require('./providers/shared');
const { SilverstripeDefinitionProvider } = require('./providers/definition');
const { SilverstripeDocumentLinkProvider } = require('./providers/documentLink');
const { SilverstripeHoverProvider } = require('./providers/hover');
const { SilverstripeCompletionProvider } = require('./providers/completion');
const { SilverstripeFormattingProvider } = require('./providers/formatting');
const { PhpFormattingProvider } = require('./providers/phpFormatting');
const { fixIndentation } = require('./providers/fixIndentation');

const SELECTOR = { language: 'silverstripe', scheme: '*' };

function activate(context) {
    const output = vscode.window.createOutputChannel('Silverstripe Templates');
    const index = new ProjectIndex(output);
    const formatting = new SilverstripeFormattingProvider();
    context.subscriptions.push(output, index);

    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(SELECTOR, new SilverstripeDefinitionProvider(index)),
        vscode.languages.registerDocumentLinkProvider(SELECTOR, new SilverstripeDocumentLinkProvider(index)),
        vscode.languages.registerHoverProvider(SELECTOR, new SilverstripeHoverProvider(index)),
        vscode.languages.registerCompletionItemProvider(
            SELECTOR, new SilverstripeCompletionProvider(index), '$', '.', ' '
        ),
        vscode.languages.registerDocumentFormattingEditProvider(SELECTOR, formatting),
        vscode.languages.registerDocumentRangeFormattingEditProvider(SELECTOR, formatting)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('silverstripe.reindex', async () => {
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Window, title: 'Silverstripe: indexing project…' },
                () => index.rebuild()
            );
            vscode.window.setStatusBarMessage(
                `Silverstripe: indexed ${index.classesByFqcn.size} classes, ${index.templates.length} templates`,
                4000
            );
        }),
        vscode.commands.registerCommand('silverstripe.showOutput', () => output.show()),
        vscode.commands.registerCommand('silverstripe.fixIndentation', fixIndentation)
    );

    // PHP formatting is registered on demand so it only competes with another PHP
    // formatter when the user has actually asked for it.
    let phpFormatting = null;
    const syncPhpFormatting = () => {
        const wanted = vscode.workspace.getConfiguration('silverstripe').get('php.format.enable', true);
        if (wanted && !phpFormatting) {
            const provider = new PhpFormattingProvider();
            const selector = { language: 'php', scheme: '*' };
            phpFormatting = vscode.Disposable.from(
                vscode.languages.registerDocumentFormattingEditProvider(selector, provider),
                vscode.languages.registerDocumentRangeFormattingEditProvider(selector, provider)
            );
            context.subscriptions.push(phpFormatting);
        } else if (!wanted && phpFormatting) {
            phpFormatting.dispose();
            phpFormatting = null;
        }
    };
    syncPhpFormatting();

    // Keep the index in step with the workspace.
    const phpWatcher = vscode.workspace.createFileSystemWatcher('**/*.php');
    const templateWatcher = vscode.workspace.createFileSystemWatcher('**/*.ss');
    context.subscriptions.push(phpWatcher, templateWatcher);
    phpWatcher.onDidChange((uri) => index.updatePhpFile(uri), null, context.subscriptions);
    phpWatcher.onDidCreate((uri) => index.updatePhpFile(uri), null, context.subscriptions);
    phpWatcher.onDidDelete((uri) => index.removePhpFile(uri), null, context.subscriptions);
    templateWatcher.onDidCreate((uri) => index.addTemplate(uri), null, context.subscriptions);
    templateWatcher.onDidDelete((uri) => index.removeTemplate(uri), null, context.subscriptions);

    context.subscriptions.push(
        // Indexing is skipped until the workspace is trusted; pick it up when that changes.
        vscode.workspace.onDidGrantWorkspaceTrust(() => index.rebuild()),
        vscode.workspace.onDidCloseTextDocument((doc) => shared.forget(doc.uri)),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('silverstripe.index')) index.rebuild();
            if (event.affectsConfiguration('silverstripe.php.format')) syncPhpFormatting();
        })
    );

    // Warm the index only when a template is actually open — the extension also
    // activates for PHP files, and those need nothing from it. Every provider awaits
    // `ready()` anyway, so nothing breaks if this never runs.
    if (vscode.workspace.textDocuments.some((doc) => doc.languageId === 'silverstripe')) {
        index.ready().catch((err) => output.appendLine(`[index] ${err && err.stack}`));
    }

    return { index };
}

function deactivate() {}

module.exports = { activate, deactivate };
