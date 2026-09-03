'use strict';

const vscode = require('vscode');
const { parsed, memberLocation, locationFor } = require('./shared');
const { tagAt } = require('../template');
const { resolveVariableAt } = require('../resolver');

const TOP = { line: 0, character: 0 };

/**
 * Go to Definition for templates:
 *   `<% include Foo %>`    -> the template file
 *   `<%t Some.Key %>`      -> the entry in a lang YAML file
 *   `$Variable` / `$A.B.C` -> the `$db` entry, relation or method on the class
 *
 * Quoted arguments are deliberately not navigable. A string passed to a method is a
 * value, not a reference, and treating it as one meant every word inside
 * `{$getStyleTag("path/to/file.css")}` jumped to `getStyleTag`.
 */
class SilverstripeDefinitionProvider {
    constructor(index) {
        this.index = index;
    }

    async provideDefinition(document, position) {
        await this.index.ready();
        const doc = parsed(document);
        const offset = document.offsetAt(position);

        const tag = tagAt(doc, offset);
        if (tag) {
            const fromTag = await this._fromTag(document, tag, offset);
            if (fromTag) return fromTag;
        }

        const result = resolveVariableAt(this.index, doc, document.uri, offset);
        if (!result) return null;
        if (result.status === 'resolved') return memberLocation(result);
        if (result.status === 'candidates') return result.candidates.map(memberLocation);
        return null;
    }

    async _fromTag(document, tag, offset) {
        if (tag.kind === 'include' && tag.templateName &&
            offset >= tag.templateNameStart && offset <= tag.templateNameEnd) {
            return this.index.resolveInclude(tag.templateName, document.uri)
                .map((t) => locationFor(t.uri, TOP));
        }

        if (tag.kind === 'translate' && tag.entityKey &&
            offset >= tag.entityKeyStart && offset <= tag.entityKeyEnd) {
            return findTranslationEntry(tag.entityKey);
        }

        return null;
    }
}

/**
 * Locate `Namespace.Entity` in the project's `lang/*.yml` files.
 *
 * Silverstripe nests the entity under its namespace key, so the search tracks which
 * top-level block it is inside rather than matching the entity name alone.
 */
async function findTranslationEntry(entityKey) {
    const parts = entityKey.split('.');
    const entity = parts.pop();
    const namespace = parts.join('.');
    if (!entity) return null;

    const files = await vscode.workspace.findFiles('**/lang/*.{yml,yaml}', '**/node_modules/**', 200);
    const entryRe = new RegExp(`^\\s+['"]?${escapeRegExp(entity)}['"]?\\s*:`);
    const locations = [];

    for (const uri of files) {
        let text;
        try {
            text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
        } catch {
            continue;
        }
        const lines = text.split(/\r?\n/);
        let inNamespace = !namespace;
        for (let i = 0; i < lines.length; i++) {
            const top = /^([^\s#][^:]*):\s*$/.exec(lines[i]);
            if (top) {
                inNamespace = !namespace || top[1].trim().replace(/^['"]|['"]$/g, '') === namespace;
                continue;
            }
            if (!inNamespace || !entryRe.test(lines[i])) continue;
            const indent = lines[i].length - lines[i].trimStart().length;
            locations.push(new vscode.Location(uri, new vscode.Position(i, indent)));
        }
    }
    return locations.length ? locations : null;
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = { SilverstripeDefinitionProvider };
