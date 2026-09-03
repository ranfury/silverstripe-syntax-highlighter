'use strict';

const vscode = require('vscode');
const { ProjectIndex } = require('./projectIndex');
const shared = require('./providers/shared');
const { SilverstripeDefinitionProvider } = require('./providers/definition');
const { SilverstripeDocumentLinkProvider } = require('./providers/documentLink');
const { SilverstripeHoverProvider } = require('./providers/hover');
const { SilverstripeFormattingProvider } = require('./providers/formatting');

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
        vscode.commands.registerCommand('silverstripe.showOutput', () => output.show())
    );

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
        })
    );

    // Warm the index in the background; every provider awaits `ready()` anyway.
    index.ready().catch((err) => output.appendLine(`[index] ${err && err.stack}`));

    return { index };
}

function deactivate() {}

module.exports = { activate, deactivate };
