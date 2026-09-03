'use strict';

/**
 * Maps a position in a template onto the PHP that backs it.
 *
 * Free of any `vscode` import so the resolution rules can be unit tested against a
 * plain {@link ClassGraph}.
 */

const {
    chainAt, readChain, scopeChainAt, readScopeHint,
    LANGUAGE_VARIABLES, GLOBAL_VARIABLES, CAST_METHODS,
} = require('./template');
const { SELF_TYPE } = require('./php');

/**
 * `SS_List` methods, grouped by what they do to the scope.
 *
 * `<% loop $Items.Sort('Name') %>` iterates exactly what `<% loop $Items %>` does, so
 * these calls have to be seen through rather than looked up as members — otherwise the
 * element type is lost and every variable inside the loop resolves against nothing.
 */
const LIST_TRANSFORM = new Set([
    'sort', 'filter', 'filterany', 'filterbycallback', 'exclude', 'excludeany',
    'limit', 'reverse', 'shuffle', 'sortable',
]);

/** Return one record from the list, so the scope becomes the element type. */
const LIST_ELEMENT = new Set(['first', 'last', 'find', 'byid']);

/** Return a scalar, so there is nothing further to resolve. */
const LIST_SCALAR = new Set([
    'count', 'exists', 'sum', 'avg', 'min', 'max', 'map', 'column', 'toarray', 'nth',
]);

/** Look a member up across every class sharing the current scope. */
function resolveInScope(index, scope, name) {
    for (const cls of scope || []) {
        const found = index.resolveMember(cls, name);
        if (found) return found;
    }
    return null;
}

/** Resolve a member's declared type to a class, honouring the `static`/`self` sentinel. */
function classForType(index, type, declaringClass) {
    if (!type) return null;
    if (type === SELF_TYPE) return declaringClass || null;
    return index.getClass(type);
}

/**
 * The class a member evaluates to, preferring its element type for lists.
 *
 * A union like `@return AssetContainer|Image` names the interface first, but the
 * concrete class is what actually carries the members a template calls.
 */
function classForMember(index, member, declaringClass) {
    const direct = classForType(index, member.elementType || member.type, declaringClass);
    if (!member.typeAlternatives) return direct;
    if (direct && direct.kind === 'class') return direct;
    for (const alternative of member.typeAlternatives) {
        const candidate = classForType(index, alternative, declaringClass);
        if (candidate && candidate.kind === 'class') return candidate;
    }
    return direct;
}

/**
 * The scope entered by following a member's type.
 *
 * Silverstripe's fluent APIs are declared as returning an interface — image
 * manipulations are all `@return AssetContainer` — but they really hand back the same
 * concrete object. Keeping the class we came from alongside the interface means
 * `$Image.Fill(400,300).ScaleMaxWidth(200)` still finds its members, without pretending
 * the declared type is something it is not.
 */
function scopeAfter(index, member, declaringClass, currentScope) {
    const next = classForMember(index, member, declaringClass);
    if (!next) return [];
    if (next.kind !== 'interface') return [next];
    const concrete = (currentScope || []).find((cls) => cls && cls.kind === 'class');
    return concrete && concrete !== next ? [next, concrete] : [next];
}

/**
 * The stack of classes in scope at `offset`: index 0 is the template's own class, and
 * each enclosing `<% loop %>` / `<% with %>` pushes the class it entered.
 *
 * Entries may be `null` where a subject could not be resolved; that keeps `$Up` and
 * `$Top` pointing at the right depth even when an intermediate type is unknown.
 */
function buildScopeStack(index, parsed, offset, baseScope) {
    const stack = [baseScope || []];
    for (const frame of scopeChainAt(parsed, offset)) {
        const resolved = resolveSubject(index, stack, frame.subject);
        if (!resolved) {
            stack.push([]);
            continue;
        }
        const { member } = resolved;
        const wanted = frame.kind === 'loop'
            ? (member.elementType || (member.isList ? null : member.type))
            : (member.type || member.elementType);
        const current = stack[stack.length - 1];
        const entered = wanted === (member.elementType || member.type)
            ? scopeAfter(index, member, resolved.cls, current)
            : [classForType(index, wanted, resolved.cls)].filter(Boolean);
        stack.push(entered);
    }
    return stack;
}

/** Resolve the `$X.Y` subject of a loop/with tag against the current scope stack. */
function resolveSubject(index, stack, subject) {
    if (!subject) return null;
    const chain = readChain(subject.startsWith('$') ? subject : `$${subject}`, 0);
    if (!chain) return null;
    const result = walkChain(index, stack, chain.segments, chain.segments.length - 1);
    if (result.status === 'resolved') return result;
    // `$Items.Sort('Name')` ends on a list call but still identifies `Items`.
    if (result.status === 'listMethod' && result.member) return result;
    return null;
}

/**
 * Walk `segments[0..upto]`, resolving each against the class the previous one produced.
 */
function walkChain(index, stack, segments, upto) {
    const first = segments[0];
    let scope = stack[stack.length - 1] || [];
    let startAt = 0;

    if (first.name === 'Up' || first.name === 'Top' || first.name === 'Me') {
        if (upto === 0) return { status: 'language', name: first.name };
        if (first.name === 'Up') scope = stack.length >= 2 ? stack[stack.length - 2] : [];
        else if (first.name === 'Top') scope = stack[0] || [];
        startAt = 1;
    } else if (LANGUAGE_VARIABLES.has(first.name)) {
        if (upto === 0) return { status: 'language', name: first.name };
        startAt = 1;
        scope = [];
    } else if (GLOBAL_VARIABLES.has(first.name) && !resolveInScope(index, scope, first.name)) {
        // A real field of the same name on the current class wins over the global.
        if (upto === 0) return { status: 'global', name: first.name };
        startAt = 1;
        scope = [];
    }

    let resolved = null;
    let onList = false;

    for (let i = startAt; i <= upto; i++) {
        const segment = segments[i];

        // A cast (`.XML`, `.ATT`) is template syntax, not a class member.
        if (i > 0 && CAST_METHODS.has(segment.name)) {
            return { status: 'cast', name: segment.name, cls: scope[0] || null };
        }

        // List methods belong to `SS_List`, not to the element class. Carrying the last
        // resolved member through means `$Items.Sort('Name')` still narrows scope, and
        // `$Items.Count` reports a list method instead of guessing at some other class.
        if (onList) {
            const lower = segment.name.toLowerCase();
            const listResult = {
                status: 'listMethod',
                name: segment.name,
                cls: resolved.cls,
                member: resolved.member,
                elementClass: scope[0] || null,
            };
            if (LIST_SCALAR.has(lower)) return listResult;
            if (LIST_TRANSFORM.has(lower)) {
                if (i === upto) return listResult;
                continue; // same list, so the element class is unchanged
            }
            if (LIST_ELEMENT.has(lower)) {
                onList = false;
                if (i === upto) return listResult;
                continue; // the scope is already the element class
            }
        }

        const found = resolveInScope(index, scope, segment.name);
        if (!found) {
            const searched = scope[0] || null;
            return {
                status: 'unresolved',
                name: segment.name,
                cls: searched,
                searchedClass: searched ? searched.fqcn : null,
            };
        }
        resolved = found;
        onList = Boolean(found.member.isList);
        if (i < upto) {
            scope = scopeAfter(index, found.member, found.cls, scope);
        }
    }

    return { status: 'resolved', cls: resolved.cls, member: resolved.member };
}

/** The class a template renders against: an explicit `@var` hint wins over the path. */
function baseClassFor(index, parsed, uri) {
    const hint = readScopeHint(parsed);
    if (hint) {
        const hinted = index.getClass(hint);
        if (hinted) return hinted;
    }
    return index.classForTemplate(uri);
}

/** Every class in scope at the top level of a template: the record and its controller. */
function scopeClassesFor(index, parsed, uri) {
    return index.companionsOf(baseClassFor(index, parsed, uri));
}

/**
 * Resolve the variable under `offset`.
 *
 * Falls back to a workspace-wide search by member name when the template's own class
 * cannot be determined — shared includes have no class of their own, and a ranked list
 * of candidates is far more useful there than nothing.
 */
function resolveVariableAt(index, parsed, uri, offset) {
    const hit = chainAt(parsed, offset);
    if (!hit) return null;

    const scope = scopeClassesFor(index, parsed, uri);
    const stack = buildScopeStack(index, parsed, offset, scope);
    const result = walkChain(index, stack, hit.chain.segments, hit.index);

    Object.assign(result, {
        segment: hit.segment, chain: hit.chain, index: hit.index, baseClass: scope[0] || null,
    });

    if (['resolved', 'language', 'global', 'cast', 'listMethod'].includes(result.status)) return result;

    const candidates = index.findMembersByName(hit.segment.name);
    if (candidates.length) {
        return { ...result, status: 'candidates', candidates: rankCandidates(candidates, scope[0] || null, uri) };
    }
    return result;
}

/** Best-guess ordering for a name that could belong to many classes. */
function rankCandidates(candidates, baseClass, uri) {
    const from = uri && typeof uri.path === 'string' ? uri.path : '';
    return [...candidates]
        .map((entry) => {
            let score = 0;
            if (baseClass && entry.cls.fqcn === baseClass.fqcn) score += 100;
            if (baseClass && baseClass.namespace && entry.cls.namespace === baseClass.namespace) score += 20;
            if (!/[\\/]vendor[\\/]/.test(entry.cls.uri.path || '')) score += 15;
            if (entry.member.kind !== 'method') score += 4;
            if (from && entry.cls.uri.path) score += Math.min(sharedSegments(entry.cls.uri.path, from), 6);
            return { entry, score };
        })
        .sort((a, b) => b.score - a.score)
        .map((s) => s.entry)
        .slice(0, 50);
}

function sharedSegments(a, b) {
    const as = a.split('/');
    const bs = b.split('/');
    let i = 0;
    while (i < as.length && i < bs.length && as[i] === bs[i]) i++;
    return i;
}

/** Human-readable summary of a member, for hovers and peek lists. */
function describeMember(cls, member) {
    const type = member.type ? ` — \`${member.type}\`` : '';
    const labels = {
        db: `\`$db\` field${type}`,
        fixed_fields: `built-in \`DataObject\` field${type}`,
        casting: `\`$casting\` field${type}`,
        has_one: `\`has_one\` relation${type}`,
        has_many: `\`has_many\` relation${type}`,
        many_many: `\`many_many\` relation${type}`,
        belongs_many_many: `\`belongs_many_many\` relation${type}`,
        belongs_to: `\`belongs_to\` relation${type}`,
        method: `method \`${member.via || member.name}()\`${member.type ? ` — returns \`${member.type}\`` : ''}`,
        property: 'public property',
        shape: `\`ArrayData\` key${type}`,
    };
    const owner = cls.synthetic ? `\`${cls.displayName}\`` : `\`${cls.fqcn}\``;
    return `${labels[member.kind] || 'member'} ${cls.synthetic ? 'built in' : 'on'} ${owner}`;
}

module.exports = {
    resolveVariableAt, buildScopeStack, walkChain, baseClassFor, scopeClassesFor,
    classForType, classForMember,
    describeMember, rankCandidates,
};
