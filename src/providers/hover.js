'use strict';

const vscode = require('vscode');
const { parsed, rangeOf, config } = require('./shared');
const { resolveVariableAt, describeMember } = require('../resolver');

/**
 * Hover for variables, so it is obvious *why* Go to Definition landed where it did —
 * and what to do when it could not resolve.
 */
class SilverstripeHoverProvider {
    constructor(index) {
        this.index = index;
    }

    async provideHover(document, position) {
        if (!config().get('hover.enable', true)) return null;
        await this.index.ready();

        const doc = parsed(document);
        const result = resolveVariableAt(this.index, doc, document.uri, document.offsetAt(position));
        if (!result) return null;

        const start = result.index === 0 ? result.chain.start : result.segment.start;
        const range = rangeOf(document, start, result.segment.end);

        switch (result.status) {
            case 'resolved':
                return hover(`**\`$${result.segment.name}\`** — ${describeMember(result.cls, result.member)}`, range);
            case 'language':
                return hover(`**\`$${result.name}\`** — Silverstripe scope variable.`, range);
            case 'global':
                return hover(`**\`$${result.name}\`** — Silverstripe template global.`, range);
            case 'cast':
                return hover(`**\`.${result.name}\`** — template casting helper.`, range);
            case 'listMethod': {
                const of = result.elementClass ? ` Iterates \`${result.elementClass.synthetic ? result.elementClass.displayName : result.elementClass.fqcn}\`.` : '';
                return hover(`**\`.${result.name}\`** — \`SS_List\` method.${of}`, range);
            }
            case 'candidates': {
                const list = result.candidates.slice(0, 6).map((c) => `- ${describeMember(c.cls, c.member)}`).join('\n');
                const more = result.candidates.length > 6 ? `\n\n_…and ${result.candidates.length - 6} more._` : '';
                return hover(
                    `**\`$${result.segment.name}\`** — no class inferred for this template.\n\n` +
                    `Possible definitions:\n${list}${more}\n\n` +
                    'Add `<%-- @var Your\\Class\\Name --%>` at the top to pin the scope.',
                    range
                );
            }
            case 'unresolved':
                if (!result.searchedClass) return null;
                return hover(`**\`$${result.segment.name}\`** — not found on \`${result.searchedClass}\`.`, range);
            default:
                return null;
        }
    }
}

function hover(markdown, range) {
    return new vscode.Hover(new vscode.MarkdownString(markdown), range);
}

module.exports = { SilverstripeHoverProvider };
