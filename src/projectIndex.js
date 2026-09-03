'use strict';

const vscode = require('vscode');
const fs = require('fs');
const { parsePhp } = require('./php');
const { ClassGraph, describeTemplate } = require('./classGraph');
const { parseConfigYaml } = require('./config');

const PHP_EXCLUDE = '{**/node_modules/**,**/.git/**,**/vendor/**,**/silverstripe-cache/**,**/public/_resources/**}';
const VENDOR_INCLUDE = 'vendor/*/*/{src,code,thirdparty}/**/*.php';
const VENDOR_EXCLUDE = '{**/tests/**,**/test/**,**/node_modules/**}';
const READ_CONCURRENCY = 24;

const settings = () => vscode.workspace.getConfiguration('silverstripe');

async function readFileText(uri) {
    if (uri.scheme === 'file') return fs.promises.readFile(uri.fsPath, 'utf8');
    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
}

/** Run `worker` over `items` with a bounded number of concurrent operations. */
async function mapLimit(items, limit, worker) {
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        for (;;) {
            const i = cursor++;
            if (i >= items.length) return;
            await worker(items[i]);
        }
    }));
}

/** Scans the workspace and keeps a {@link ClassGraph} in step with it. */
class ProjectIndex extends ClassGraph {
    constructor(output) {
        super();
        this.output = output;
        this.status = 'idle';
        this._ready = null;
        this._onDidChange = new vscode.EventEmitter();
        this.onDidChange = this._onDidChange.event;
    }

    /** Resolves once the first full scan has completed. */
    ready() {
        if (!this._ready) this._ready = this.rebuild();
        return this._ready;
    }

    async rebuild() {
        if (!settings().get('index.enable', true)) {
            this.status = 'disabled';
            return;
        }
        const started = Date.now();
        this.status = 'indexing';
        this.clear();

        try {
            // Reading PHP source is what `untrustedWorkspaces: limited` refers to.
            // Template names come from file paths alone, so they stay available.
            const work = [this._indexTemplates()];
            if (vscode.workspace.isTrusted) work.push(this._indexPhp(), this._indexConfig());
            else this.log('workspace is not trusted — skipping PHP indexing');
            await Promise.all(work);
            this.status = 'ready';
            this.log(
                `indexed ${this.classesByFqcn.size} classes, ${this.templates.length} templates ` +
                `and ${this.extensionsByClass.size} extended classes in ${Date.now() - started}ms`
            );
        } catch (err) {
            this.status = 'error';
            this.log(`indexing failed: ${err && err.message}`);
        }
        this._onDidChange.fire();
    }

    log(message) {
        if (this.output) this.output.appendLine(`[index] ${message}`);
    }

    async _indexTemplates() {
        const uris = await vscode.workspace.findFiles(
            '**/*.ss', '{**/node_modules/**,**/.git/**,**/silverstripe-cache/**}', 20000
        );
        this.templates = uris.map(describeTemplate);
    }

    async _indexConfig() {
        const uris = await vscode.workspace.findFiles(
            '**/_config/**/*.{yml,yaml}', '{**/node_modules/**,**/.git/**}', 2000
        );
        uris.push(...await vscode.workspace.findFiles('**/_config.yml', '{**/node_modules/**,**/.git/**}', 500));
        await mapLimit(uris, READ_CONCURRENCY, async (uri) => {
            try {
                this.addConfigExtensions(parseConfigYaml(await readFileText(uri)));
            } catch (err) {
                this.log(`failed to read ${uri.fsPath}: ${err && err.message}`);
            }
        });
    }

    async _indexPhp() {
        const max = settings().get('index.maxFiles', 20000);
        const uris = await vscode.workspace.findFiles('**/*.php', PHP_EXCLUDE, max);
        if (settings().get('index.includeVendor', true)) {
            uris.push(...await vscode.workspace.findFiles(VENDOR_INCLUDE, VENDOR_EXCLUDE, max));
        }
        await mapLimit(uris, READ_CONCURRENCY, (uri) => this._indexPhpFile(uri));
    }

    async _indexPhpFile(uri) {
        let text;
        try {
            text = await readFileText(uri);
        } catch {
            return;
        }
        if (!/\b(class|trait|interface|enum)\s/.test(text)) return;
        try {
            const classes = parsePhp(text);
            if (classes.length) this.addFile(uri, classes);
        } catch (err) {
            this.log(`failed to parse ${uri.fsPath}: ${err && err.message}`);
        }
    }

    // --- incremental updates ---------------------------------------------------------

    async updatePhpFile(uri) {
        if (!vscode.workspace.isTrusted) return;
        await this.ready();
        await this._indexPhpFile(uri);
        this._onDidChange.fire();
    }

    async removePhpFile(uri) {
        await this.ready();
        this.removeFile(uri);
        this._onDidChange.fire();
    }

    async addTemplate(uri) {
        await this.ready();
        if (!this.templates.some((t) => t.uri.toString() === uri.toString())) {
            this.templates.push(describeTemplate(uri));
                this._onDidChange.fire();
        }
    }

    async removeTemplate(uri) {
        await this.ready();
        const key = uri.toString();
        const next = this.templates.filter((t) => t.uri.toString() !== key);
        if (next.length !== this.templates.length) {
            this.templates = next;
            this._onDidChange.fire();
        }
    }

    dispose() {
        this._onDidChange.dispose();
    }
}

module.exports = { ProjectIndex };
