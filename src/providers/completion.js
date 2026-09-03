'use strict';

const vscode = require('vscode');
const { parsed, config } = require('./shared');
const {
    LANGUAGE_VARIABLES, GLOBAL_VARIABLES, CAST_METHODS, readChain,
} = require('../template');
const {
    scopeClassesFor, buildScopeStack, walkChain, classForMember, describeMember,
} = require('../resolver');

/**
 * Sort buckets. Members of the class the template renders against come first, then the
 * rest of your own code, then template built-ins, and finally anything from `vendor`.
 */
const OWN = '1';
const PROJECT = '2';
const BUILTIN = '3';
const GLOBAL = '4';
const VENDOR = '5';

const BLOCK_TAGS = [
    ['if', 'if ', 'Conditional block'],
    ['else_if', 'else_if ', 'Additional branch of an if block'],
    ['else', 'else %>', 'Fallback branch of an if block'],
    ['loop', 'loop ', 'Iterate a list, entering each item’s scope'],
    ['with', 'with ', 'Enter the scope of a single object'],
    ['cached', 'cached ', 'Partial caching block'],
    ['uncached', 'uncached %>', 'Opt out of an enclosing cached block'],
    ['include', 'include ', 'Render another template'],
    ['require', 'require ', 'Add a CSS or JavaScript requirement'],
    ['base_tag', 'base_tag %>', 'Output the HTML base tag'],
    ['t', 't ', 'Translatable string'],
];

const LIST_METHOD_DOCS = {
    Count: 'Number of items in the list.',
    Exists: 'True when the list has any items.',
    First: 'The first item.',
    Last: 'The last item.',
    Sort: 'Sorted copy of the list.',
    Filter: 'Filtered copy of the list.',
    Limit: 'A slice of the list.',
    Reverse: 'Reversed copy of the list.',
};

/**
 * Suggestions driven by the same index that powers Go to Definition: whatever resolves
 * at this position is what gets offered here.
 *
 * Where the template's class cannot be determined — a shared include with no
 * `<%-- @var --%>` hint — nothing is offered rather than every member in the workspace.
 */
class SilverstripeCompletionProvider {
    constructor(index) {
        this.index = index;
    }

    async provideCompletionItems(document, position) {
        if (!config().get('completion.enable', true)) return null;

        const doc = parsed(document);
        const offset = document.offsetAt(position);
        if (doc.comments.some((c) => offset >= c.start && offset < c.end)) return null;

        const prefix = document.getText(new vscode.Range(position.with(undefined, 0), position));
        const rangeFor = (typed) => new vscode.Range(
            position.line, position.character - typed.length, position.line, position.character
        );

        // `$Foo.Bar.|` — members of whatever the chain resolved to.
        const chain = /(\$[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*|\([^()]*\))*)\.([A-Za-z0-9_]*)$/.exec(prefix);
        if (chain) {
            await this.index.ready();
            return this._afterDot(document, doc, offset, chain[1], rangeFor(chain[2]));
        }

        // `$|` — members in scope.
        // Wait for a letter before offering anything: a bare `$` would list every member
        // of the class, which is noise rather than help.
        const variable = /\$([A-Za-z0-9_]*)$/.exec(prefix);
        if (variable) {
            if (!variable[1]) return null;
            await this.index.ready();
            return this._inScope(document, doc, offset, rangeFor(variable[1]));
        }

        // `<% include |` — template names.
        const include = /<%\s*include\s+([A-Za-z0-9_\\/]*)$/.exec(prefix);
        if (include) {
            await this.index.ready();
            return this._includeNames(document, rangeFor(include[1]));
        }

        // `<% |` — block tags.
        const tag = /<%\s*([A-Za-z_]*)$/.exec(prefix);
        if (tag && !prefix.endsWith('<%--')) return this._blockTags(doc, offset, rangeFor(tag[1]));

        return null;
    }

    /** Members of the class in scope at `offset`, plus the template built-ins. */
    _inScope(document, doc, offset, range) {
        const scope = scopeClassesFor(this.index, doc, document.uri);
        if (!scope.length) return null;

        const stack = buildScopeStack(this.index, doc, offset, scope);
        const current = stack[stack.length - 1] || [];
        if (!current.length) return null;

        const items = this._members(current, range);
        for (const name of LANGUAGE_VARIABLES) {
            items.push(simple(name, range, BUILTIN, vscode.CompletionItemKind.Variable,
                'Silverstripe scope variable'));
        }
        for (const name of GLOBAL_VARIABLES) {
            items.push(simple(name, range, GLOBAL, vscode.CompletionItemKind.Constant,
                'Silverstripe template global'));
        }
        return items;
    }

    /** Members reachable through `prefix`, or list methods when it resolves to a list. */
    _afterDot(document, doc, offset, prefix, range) {
        const items = CAST_METHODS.size
            ? [...CAST_METHODS].map((name) => simple(name, range, GLOBAL,
                vscode.CompletionItemKind.Operator, 'Template casting helper'))
            : [];

        const scope = scopeClassesFor(this.index, doc, document.uri);
        if (!scope.length) return items;

        const parsedChain = readChain(prefix, 0);
        if (!parsedChain) return items;

        const stack = buildScopeStack(this.index, doc, offset, scope);
        const walked = walkChain(this.index, stack, parsedChain.segments, parsedChain.segments.length - 1);

        if (walked.status === 'listMethod' || (walked.status === 'resolved' && walked.member.isList)) {
            for (const name of ['Count', 'Exists', 'First', 'Last', 'Sort', 'Filter', 'Limit', 'Reverse']) {
                items.push(simple(name, range, OWN, vscode.CompletionItemKind.Method,
                    LIST_METHOD_DOCS[name] || 'SS_List method'));
            }
            return items;
        }
        if (walked.status !== 'resolved') return items;

        const target = classForMember(this.index, walked.member, walked.cls);
        return target ? items.concat(this._members([target], range)) : items;
    }

    /**
     * Build one item per uniquely-named member, nearest declaration winning.
     *
     * A `getFoo()` method is registered under `Foo` as well, and `$Foo` is how a template
     * addresses it, so only that spelling is offered.
     */
    _members(classes, range) {
        const items = [];
        const seen = new Set();
        for (const cls of classes) {
            this.index.ancestry(cls).forEach((owner, depth) => {
                const vendor = /[\\/]vendor[\\/]/.test(owner.uri.path || '');
                for (const [key, member] of owner.members) {
                    if (seen.has(key)) continue;
                    seen.add(key);

                    // `getFoo()` is offered both ways: `$Foo` is the idiomatic spelling,
                    // but `$getFoo` is equally valid and plenty of people write it. The
                    // idiomatic one sorts first.
                    const spelledOut = /^get[A-Z]/.test(member.name)
                        && owner.members.has(member.name.slice(3).toLowerCase());

                    const bucket = depth === 0 ? OWN : (vendor ? VENDOR : PROJECT);
                    const item = new vscode.CompletionItem(member.name, kindOf(member));
                    item.range = range;
                    item.filterText = member.name;
                    item.sortText = bucket + (spelledOut ? '~' : '') + member.name.toLowerCase();
                    item.detail = spelledOut ? `same as $${member.name.slice(3)}` : detailOf(member);
                    item.documentation = new vscode.MarkdownString(describeMember(owner, member));
                    items.push(item);
                }
            });
        }
        return items;
    }

    _includeNames(document, range) {
        const seen = new Set();
        const items = [];
        for (const template of this.index.templates) {
            if (!template.relPath || seen.has(template.relPath)) continue;
            seen.add(template.relPath);

            const name = template.relPath.replace(/\//g, '\\');
            const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.File);
            item.range = range;
            item.filterText = name;
            item.sortText = (template.isVendor ? VENDOR : (template.isTheme ? OWN : PROJECT)) + name;
            item.detail = vscode.workspace.asRelativePath(template.uri);
            items.push(item);
        }
        return items;
    }

    /** Block tags, with the closer for whatever is currently open offered first. */
    _blockTags(doc, offset, range) {
        const items = [];
        const open = [];
        for (const tag of doc.tags) {
            if (tag.start >= offset) break;
            if (tag.kind === 'open') open.push(tag.block);
            else if (tag.kind === 'close') {
                const at = open.lastIndexOf(tag.block);
                if (at !== -1) open.splice(at);
            }
        }

        if (open.length) {
            const innermost = open[open.length - 1];
            const item = new vscode.CompletionItem(`end_${innermost}`, vscode.CompletionItemKind.Keyword);
            item.range = range;
            item.insertText = `end_${innermost} %>`;
            item.detail = 'Close the innermost open block';
            item.sortText = '0';
            item.preselect = true;
            items.push(item);
        }

        for (const [label, insert, detail] of BLOCK_TAGS) {
            if (label.startsWith('else') && !open.includes('if')) continue;
            const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Keyword);
            item.range = range;
            item.insertText = insert;
            item.detail = detail;
            item.sortText = OWN + label;
            items.push(item);
        }
        return items;
    }
}

function simple(name, range, bucket, kind, detail) {
    const item = new vscode.CompletionItem(name, kind);
    item.range = range;
    item.filterText = name;
    item.sortText = bucket + name.toLowerCase();
    item.detail = detail;
    return item;
}

function kindOf(member) {
    if (member.kind === 'method') return vscode.CompletionItemKind.Method;
    if (member.kind === 'property') return vscode.CompletionItemKind.Property;
    return vscode.CompletionItemKind.Field;
}

function detailOf(member) {
    if (member.via) return `${member.via}()`;
    if (member.kind === 'method') return `${member.name}()`;
    if (member.type) return `${member.kind.replace(/_/g, ' ')} — ${member.type.split('\\').pop()}`;
    return member.kind.replace(/_/g, ' ');
}

module.exports = { SilverstripeCompletionProvider };
