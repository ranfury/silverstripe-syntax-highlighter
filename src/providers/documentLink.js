'use strict';

const vscode = require('vscode');
const { parsed, rangeOf, config } = require('./shared');

/**
 * Ctrl/Cmd-clickable links for `<% include %>` template names.
 *
 * Quoted arguments are left alone on purpose — a string passed to a method or to
 * `<% require %>` is a value, not a reference.
 */
class SilverstripeDocumentLinkProvider {
    constructor(index) {
        this.index = index;
    }

    async provideDocumentLinks(document) {
        if (!config().get('links.enable', true)) return [];
        await this.index.ready();

        const links = [];
        for (const tag of parsed(document).tags) {
            if (tag.kind !== 'include' || !tag.templateName) continue;
            const [best] = this.index.resolveInclude(tag.templateName, document.uri);
            if (!best) continue;
            const link = new vscode.DocumentLink(
                rangeOf(document, tag.templateNameStart, tag.templateNameEnd),
                best.uri
            );
            link.tooltip = `Open ${vscode.workspace.asRelativePath(best.uri)}`;
            links.push(link);
        }
        return links;
    }
}

module.exports = { SilverstripeDocumentLinkProvider };
