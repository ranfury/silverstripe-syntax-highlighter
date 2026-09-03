/**
 * Builds a real {@link ClassGraph} from the on-disk fixture project, so resolver tests
 * exercise the shipping lookup code rather than a stand-in.
 */
const fs = require('fs');
const path = require('path');
const { ClassGraph, describeTemplate } = require('../../src/classGraph');
const { parsePhp } = require('../../src/php');
const { parseConfigYaml } = require('../../src/config');

const ROOT = path.join(__dirname, '..', 'fixtures', 'project');

/** Minimal stand-in for `vscode.Uri`; the index only reads `path` and `toString()`. */
function uriFor(fsPath) {
    const posix = fsPath.split(path.sep).join('/');
    return { scheme: 'file', path: posix, fsPath, toString: () => `file://${posix}` };
}

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else out.push(full);
    }
    return out;
}

function buildFixtureIndex() {
    const graph = new ClassGraph();
    const files = walk(ROOT);
    for (const file of files.filter((f) => f.endsWith('.php'))) {
        const classes = parsePhp(fs.readFileSync(file, 'utf8'));
        if (classes.length) graph.addFile(uriFor(file), classes);
    }
    for (const file of files.filter((f) => /_config[/\\].*\.ya?ml$/.test(f))) {
        graph.addConfigExtensions(parseConfigYaml(fs.readFileSync(file, 'utf8')));
    }
    graph.templates = files.filter((f) => f.endsWith('.ss')).map((f) => describeTemplate(uriFor(f)));
    return graph;
}

module.exports = { buildFixtureIndex, uriFor, ROOT };
