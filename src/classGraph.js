'use strict';

const path = require('path');

/**
 * The queryable half of the project index: classes, their members, and templates.
 *
 * Free of any `vscode` dependency so the resolution rules can be unit tested directly.
 */
class ClassGraph {
    constructor() {
        this.classesByFqcn = new Map();
        this.classesByShortName = new Map();
        this.classesByFile = new Map();
        this.templates = [];
        this.extensionsByClass = new Map();
        this._memberIndex = null;
    }

    /** Record `extensions:` declarations from one YAML config file. */
    addConfigExtensions(byTarget) {
        for (const [target, extensions] of byTarget) {
            const existing = this.extensionsByClass.get(target) || [];
            for (const name of extensions) {
                if (!existing.includes(name)) existing.push(name);
            }
            this.extensionsByClass.set(target, existing);
        }
    }

    /** Register (or replace) every class parsed from one file. */
    addFile(uri, classes) {
        this.removeFile(uri);
        const stored = [];
        for (const cls of classes) {
            cls.uri = uri;
            this.classesByFqcn.set(cls.fqcn.toLowerCase(), cls);
            // Synthetic shapes are only ever reached through a member's element type,
            // so they must not compete in short-name lookups.
            if (!cls.synthetic) {
                const shortKey = cls.name.toLowerCase();
                if (!this.classesByShortName.has(shortKey)) this.classesByShortName.set(shortKey, []);
                this.classesByShortName.get(shortKey).push(cls);
            }
            stored.push(cls);
        }
        if (stored.length) this.classesByFile.set(uri.toString(), stored);
        this._memberIndex = null;
    }

    removeFile(uri) {
        const key = uri.toString();
        const existing = this.classesByFile.get(key);
        if (!existing) return;
        for (const cls of existing) {
            const fqcnKey = cls.fqcn.toLowerCase();
            if (this.classesByFqcn.get(fqcnKey) === cls) this.classesByFqcn.delete(fqcnKey);
            if (cls.synthetic) continue;
            const shortKey = cls.name.toLowerCase();
            const bucket = this.classesByShortName.get(shortKey);
            if (bucket) {
                const rest = bucket.filter((c) => c !== cls);
                if (rest.length) this.classesByShortName.set(shortKey, rest);
                else this.classesByShortName.delete(shortKey);
            }
        }
        this.classesByFile.delete(key);
        this._memberIndex = null;
    }

    clear() {
        this.classesByFqcn.clear();
        this.classesByShortName.clear();
        this.classesByFile.clear();
        this.templates = [];
        this.extensionsByClass.clear();
        this._memberIndex = null;
    }

    /** Look up a class by fully-qualified name, falling back to its short name. */
    getClass(name) {
        if (!name) return null;
        const clean = name.replace(/^\\+/, '');
        const direct = this.classesByFqcn.get(clean.toLowerCase());
        if (direct) return direct;
        if (!clean.includes('\\')) {
            const bucket = this.classesByShortName.get(clean.toLowerCase());
            if (bucket && bucket.length) return preferProjectClass(bucket);
        }
        return null;
    }

    /** A class and every ancestor it inherits from, nearest first. */
    ancestry(cls, limit = 24) {
        const seen = new Set();
        const chain = [];
        let current = cls;
        while (current && chain.length < limit && !seen.has(current.fqcn.toLowerCase())) {
            seen.add(current.fqcn.toLowerCase());
            chain.push(current);
            current = current.extends ? this.getClass(current.extends) : null;
        }
        return chain;
    }

    /**
     * Look up a template member name on a class, walking up the inheritance chain.
     * `$Foo` also matches a `getFoo()` method, as Silverstripe does.
     */
    resolveMember(cls, name) {
        if (!cls || !name) return null;
        const key = name.toLowerCase();
        for (const candidate of this.ancestry(cls)) {
            const member = candidate.members.get(key) || candidate.members.get(`get${key}`);
            if (member) return { cls: candidate, member };
            const inherited = this._resolveInTraits(candidate, key, new Set());
            if (inherited) return inherited;
            const extended = this._resolveInExtensions(candidate, key);
            if (extended) return extended;
        }
        return null;
    }

    /** Search the `Extension` classes applied to a class through YAML config. */
    _resolveInExtensions(cls, key) {
        for (const name of this.extensionsByClass.get(cls.fqcn.toLowerCase()) || []) {
            // An extension may be listed with constructor arguments: `Foo("bar")`.
            const extension = this.getClass(name.split('(')[0]);
            if (!extension) continue;
            for (const candidate of this.ancestry(extension)) {
                const member = candidate.members.get(key) || candidate.members.get(`get${key}`);
                if (member) return { cls: candidate, member };
                const inherited = this._resolveInTraits(candidate, key, new Set());
                if (inherited) return inherited;
            }
        }
        return null;
    }

    /** Search the traits a class uses, and any traits those traits use. */
    _resolveInTraits(cls, key, seen) {
        for (const name of cls.traits || []) {
            const trait = this.getClass(name);
            if (!trait || seen.has(trait.fqcn)) continue;
            seen.add(trait.fqcn);
            const member = trait.members.get(key) || trait.members.get(`get${key}`);
            if (member) return { cls: trait, member };
            const nested = this._resolveInTraits(trait, key, seen);
            if (nested) return nested;
        }
        return null;
    }

    /**
     * Every member reachable from `cls`, nearest declaration first.
     *
     * Deliberately mirrors {@link resolveMember}'s search order — class, its traits, the
     * extensions applied to it, then up the inheritance chain — so that anything Go to
     * Definition can find is also something completion can offer. The two drifting apart
     * is how `$SiteConfig.TermsLink` came to resolve but never be suggested.
     */
    visibleMembers(cls) {
        if (!cls) return [];
        const out = [];
        const seen = new Set();

        const take = (owner, depth) => {
            for (const [key, member] of owner.members) {
                if (seen.has(key)) continue;
                seen.add(key);
                out.push({ cls: owner, member, depth });
            }
        };

        const takeTraits = (owner, depth, guard) => {
            for (const name of owner.traits || []) {
                const trait = this.getClass(name);
                if (!trait || guard.has(trait.fqcn)) continue;
                guard.add(trait.fqcn);
                take(trait, depth);
                takeTraits(trait, depth, guard);
            }
        };

        this.ancestry(cls).forEach((owner, depth) => {
            take(owner, depth);
            takeTraits(owner, depth, new Set());
            for (const name of this.extensionsByClass.get(owner.fqcn.toLowerCase()) || []) {
                const extension = this.getClass(name.split('(')[0]);
                if (!extension) continue;
                for (const applied of this.ancestry(extension)) {
                    take(applied, depth);
                    takeTraits(applied, depth, new Set());
                }
            }
        });

        return out;
    }

    /** Every class in the workspace exposing a member with this name. */
    findMembersByName(name) {
        if (!name) return [];
        if (!this._memberIndex) {
            const map = new Map();
            for (const cls of this.classesByFqcn.values()) {
                for (const [key, member] of cls.members) {
                    if (!map.has(key)) map.set(key, []);
                    map.get(key).push({ cls, member });
                }
            }
            this._memberIndex = map;
        }
        return this._memberIndex.get(name.toLowerCase()) || [];
    }

    /**
     * Resolve an `<% include %>` name to candidate template files, best first.
     *
     * Mirrors Silverstripe's own lookup: a bare name may sit directly under
     * `templates/`, inside any `Includes/` directory, or at the namespaced path when
     * written as `App\Pages\Includes\Foo`. Templates from the same module or theme as
     * the calling file are preferred, and vendor copies are pushed down.
     */
    resolveInclude(name, fromUri) {
        if (!name) return [];
        const wanted = name.replace(/\\/g, '/').replace(/^\/+/, '');
        const base = wanted.split('/').pop();
        const dir = wanted.slice(0, wanted.length - base.length).replace(/\/$/, '');
        const withIncludes = dir ? `${dir}/Includes/${base}` : `Includes/${base}`;
        const fromRoot = fromUri ? sourceRootOf(fromUri) : null;

        const scored = [];
        for (const template of this.templates) {
            let score = -1;
            if (template.relPath === wanted) score = 100;
            else if (template.relPath === withIncludes) score = 90;
            else if (!dir && template.name === base && template.inIncludes) score = 70;
            else if (template.relPath.endsWith(`/${wanted}`)) score = 60;
            else if (template.relPath.endsWith(`/${withIncludes}`)) score = 55;
            else if (!dir && template.name === base) score = 50;
            if (score < 0) continue;

            if (fromRoot && template.sourceRoot === fromRoot) score += 6;
            if (template.isTheme) score += 3;
            if (template.isVendor) score -= 8;
            score -= Math.min(template.relPath.split('/').length, 8) * 0.1;
            scored.push({ template, score });
        }
        scored.sort((a, b) => b.score - a.score);
        return scored.map((s) => s.template);
    }

    /**
     * Classes that share a template's scope: a page and its `*Controller` counterpart.
     *
     * Silverstripe renders a page template with the controller as the top-level scope
     * and the record as its failover, so `$Title` (on the page) and a helper defined
     * only on the controller both have to resolve.
     */
    companionsOf(cls) {
        if (!cls) return [];
        const found = [cls];

        if (cls.fqcn.endsWith('Controller')) {
            const record = this.getClass(cls.fqcn.slice(0, -'Controller'.length));
            if (record && record !== cls) found.push(record);
            return found;
        }

        // The controller may be declared against an ancestor: a page type with no
        // controller of its own is still rendered by the nearest one that has it, which
        // is where project-wide helpers usually live.
        for (const ancestor of this.ancestry(cls)) {
            const controller = this.getClass(`${ancestor.fqcn}Controller`);
            if (controller && controller !== cls) {
                found.push(controller);
                break;
            }
        }
        return found;
    }

    /**
     * The class a template most likely renders against, inferred from its path:
     * `templates/App/Pages/Layout/HomePage.ss` -> `App\Pages\HomePage`.
     */
    classForTemplate(uri) {
        const template = describeTemplate(uri);
        if (!template.relPath) return null;
        const segments = template.relPath.split('/');
        const withoutFolder = segments.filter((s, i) =>
            !(i === segments.length - 2 && (s === 'Layout' || s === 'Includes' || s === 'Content')));
        for (const candidate of [withoutFolder.join('\\'), segments.join('\\'), segments[segments.length - 1]]) {
            const cls = this.getClass(candidate);
            if (cls) return cls;
        }
        return null;
    }
}

function preferProjectClass(bucket) {
    const nonVendor = bucket.filter((c) => !/[\\/]vendor[\\/]/.test(c.uri.path));
    return (nonVendor.length ? nonVendor : bucket)[0];
}

/** Path of the module or theme a file belongs to, used to prefer local templates. */
function sourceRootOf(uri) {
    const parts = uri.path.split('/');
    const idx = parts.lastIndexOf('templates');
    return idx === -1 ? null : parts.slice(0, idx).join('/');
}

function describeTemplate(uri) {
    const parts = uri.path.split('/');
    const idx = parts.lastIndexOf('templates');
    const name = path.basename(uri.path).replace(/\.ss$/i, '');
    const relParts = idx === -1 ? [name] : parts.slice(idx + 1);
    return {
        uri,
        name,
        relPath: relParts.join('/').replace(/\.ss$/i, ''),
        sourceRoot: idx === -1 ? null : parts.slice(0, idx).join('/'),
        inIncludes: relParts.includes('Includes'),
        isTheme: uri.path.includes('/themes/'),
        isVendor: uri.path.includes('/vendor/'),
    };
}

module.exports = { ClassGraph, describeTemplate, sourceRootOf };
