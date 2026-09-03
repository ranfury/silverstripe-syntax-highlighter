'use strict';

const vscode = require('vscode');
const { parse } = require('../template');

const cache = new Map();

/** Parse `document`, reusing the previous result while its version is unchanged. */
function parsed(document) {
    const key = document.uri.toString();
    const hit = cache.get(key);
    if (hit && hit.version === document.version) return hit.result;
    const result = parse(document.getText());
    cache.set(key, { version: document.version, result });
    if (cache.size > 64) cache.delete(cache.keys().next().value);
    return result;
}

const forget = (uri) => cache.delete(uri.toString());

const rangeOf = (document, start, end) =>
    new vscode.Range(document.positionAt(start), document.positionAt(end));

const locationFor = (uri, position) =>
    new vscode.Location(uri, new vscode.Position(position.line, position.character));

const memberLocation = (entry) => locationFor(entry.cls.uri, entry.member.position);

const config = () => vscode.workspace.getConfiguration('silverstripe');

module.exports = { parsed, forget, rangeOf, locationFor, memberLocation, config };
