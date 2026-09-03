'use strict';

/**
 * A regex-level reader for the parts of a Silverstripe PHP class a template can reach:
 * `$db` / `$casting` fields, relations, public methods and public properties.
 *
 * Intentionally not a PHP parser — it has to stay fast enough to index a whole project
 * (vendor included) in the background, and templates only ever address members by name.
 */

// `fixed_fields` is how `DataObject` declares `ID`, `ClassName`, `Created` and
// `LastEdited`, which templates use constantly.
const CONFIG_KINDS = new Set(['db', 'fixed_fields', 'has_one', 'has_many', 'many_many', 'belongs_many_many', 'belongs_to', 'casting']);
const RELATION_KINDS = new Set(['has_one', 'has_many', 'many_many', 'belongs_many_many', 'belongs_to']);
const LIST_KINDS = new Set(['has_many', 'many_many', 'belongs_many_many']);

/** Sentinel meaning "the declaring class"; resolved by the caller. */
const SELF_TYPE = '@self';

const BUILTIN_TYPES = new Set([
    'string', 'int', 'integer', 'float', 'double', 'bool', 'boolean', 'array', 'object',
    'callable', 'iterable', 'void', 'mixed', 'never', 'null', 'false', 'true', 'resource',
]);

function lineStarts(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
    return starts;
}

function positionAt(starts, offset) {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= offset) lo = mid;
        else hi = mid - 1;
    }
    return { line: lo, character: offset - starts[lo] };
}

/**
 * Traits pulled in by `use SomeTrait;` inside a class body.
 *
 * Silverstripe puts a lot of template-visible API in traits — every image manipulation
 * method (`Fill`, `ScaleMaxWidth`, `URL`, …) reaches `File` through `ImageManipulation`
 * — so a class's own members and its ancestry are not the whole picture.
 */
function traitsUsedIn(code, fromOffset, uses, namespace) {
    const open = code.indexOf('{', fromOffset);
    if (open === -1) return [];
    const close = matchBracket(code, open);
    if (close === -1) return [];

    const found = [];
    // `use ($var)` inside a closure cannot match: an identifier list is required.
    const re = /\buse\s+(\\?[A-Za-z_][A-Za-z0-9_\\]*(?:\s*,\s*\\?[A-Za-z_][A-Za-z0-9_\\]*)*)\s*[;{]/g;
    re.lastIndex = open;
    let m;
    while ((m = re.exec(code)) && m.index < close) {
        for (const name of m[1].split(',')) {
            const resolved = resolveClassName(name.trim(), uses, namespace);
            if (resolved) found.push(resolved);
        }
    }
    return found;
}

/**
 * Blank out comments and step over string literals so member scanning is not confused
 * by documentation. String bodies are left in place because `$db` values live in them.
 */
function blankComments(text) {
    const out = text.split('');
    const len = text.length;
    let i = 0;
    while (i < len) {
        const ch = text[i];
        if (ch === '/' && text[i + 1] === '*') {
            const end = text.indexOf('*/', i + 2);
            const stop = end === -1 ? len : end + 2;
            for (let k = i; k < stop; k++) if (out[k] !== '\n') out[k] = ' ';
            i = stop;
        } else if ((ch === '/' && text[i + 1] === '/') || (ch === '#' && text[i + 1] !== '[')) {
            while (i < len && text[i] !== '\n') out[i++] = ' ';
        } else if (ch === '"' || ch === "'") {
            const quote = ch;
            i++;
            while (i < len) {
                if (text[i] === '\\') { i += 2; continue; }
                if (text[i] === quote) { i++; break; }
                i++;
            }
        } else {
            i++;
        }
    }
    return out.join('');
}

/** Index just past the bracket matching the one at `open`. */
function matchBracket(text, open) {
    const closers = { '[': ']', '(': ')', '{': '}' };
    const close = closers[text[open]];
    if (!close) return -1;
    let depth = 0;
    let quote = null;
    for (let i = open; i < text.length; i++) {
        const ch = text[i];
        if (quote) {
            if (ch === '\\') i++;
            else if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") quote = ch;
        else if (ch === text[open]) depth++;
        else if (ch === close) {
            depth--;
            if (depth === 0) return i + 1;
        }
    }
    return -1;
}

function resolveClassName(name, uses, namespace) {
    if (!name) return null;
    const absolute = name.startsWith('\\');
    const clean = name.replace(/^\\+/, '');
    if (absolute) return clean;
    // Fluent APIs are common in Silverstripe; keep the scope on the declaring class.
    if (/^(static|self|\$this)$/i.test(clean)) return SELF_TYPE;
    if (BUILTIN_TYPES.has(clean.toLowerCase())) return null;
    if (clean.includes('\\')) {
        const [head, ...rest] = clean.split('\\');
        const mapped = uses.get(head.toLowerCase());
        if (mapped) return `${mapped}\\${rest.join('\\')}`;
        return namespace ? `${namespace}\\${clean}` : clean;
    }
    return uses.get(clean.toLowerCase()) || (namespace ? `${namespace}\\${clean}` : clean);
}

/**
 * Turn `Foo::class`, `'App\Foo'` or `'Varchar(255)'` into a usable type.
 *
 * `$db` and `$casting` values are DBField shorthands rather than class references, so
 * they must not be qualified with the declaring namespace.
 */
function resolveTypeExpression(raw, uses, namespace, { dbFieldShorthand = false } = {}) {
    if (!raw) return null;
    let value = raw.trim().replace(/^[|&]+/, '');

    const classConst = /^(\\?)([A-Za-z_][A-Za-z0-9_\\]*)::class$/.exec(value);
    if (classConst) return resolveClassName(classConst[1] + classConst[2], uses, namespace);

    const quoted = /^(['"])((?:\\.|(?!\1).)*)\1/.exec(value);
    if (quoted) value = quoted[2].replace(/\\\\/g, '\\');

    // `many_many` "through" definitions are arrays; there is no single target class.
    if (value.startsWith('[') || value.startsWith('array')) return null;

    const parameterised = /^([A-Za-z_][A-Za-z0-9_\\]*)\s*\(/.exec(value);
    if (parameterised) value = parameterised[1];

    if (!/^\\?[A-Za-z_][A-Za-z0-9_\\]*$/.test(value)) return null;
    if (dbFieldShorthand) return value.replace(/^\\+/, '');
    return resolveClassName(value, uses, namespace);
}

/** The `/** ... *\/` block immediately preceding `offset`, if there is one. */
function docblockBefore(text, offset) {
    const head = text.lastIndexOf('/**', offset);
    if (head === -1) return null;
    const tail = text.indexOf('*/', head);
    if (tail === -1 || tail > offset) return null;
    const between = text.slice(tail + 2, offset).replace(/\b(public|protected|private|static|final|abstract)\b/g, '');
    if (between.trim()) return null;
    return text.slice(head, tail);
}

/** Bodies that build a list rather than returning a single record. */
const LIST_BUILDER = /\b(?:new\s+\\?ArrayList|\\?ArrayList::create|->push\s*\()/;

/** The `{ ... }` body of a method whose parameter list ends at `afterParen`. */
function methodBody(code, afterParen) {
    for (let i = afterParen; i < code.length; i++) {
        const ch = code[i];
        if (ch === ';') return null;              // abstract or interface method
        if (ch === '{') {
            const end = matchBracket(code, i);
            return end === -1 ? null : { start: i + 1, end: end - 1 };
        }
    }
    return null;
}

/**
 * Best-effort type of a PHP expression, limited to the shapes that actually carry type
 * information in Silverstripe code.
 */
function typeOfExpression(rhs, uses, namespace, locals) {
    let m;
    if ((m = /^\\?([A-Za-z_][A-Za-z0-9_\\]*)::get\s*\(/.exec(rhs))) {
        return { type: resolveClassName(m[1], uses, namespace), isList: true };
    }
    if ((m = /^new\s+\\?([A-Za-z_][A-Za-z0-9_\\]*)\s*\(/.exec(rhs))) {
        return { type: resolveClassName(m[1], uses, namespace), isList: false };
    }
    if ((m = /^\\?([A-Za-z_][A-Za-z0-9_\\]*)::create\s*\(/.exec(rhs))) {
        return { type: resolveClassName(m[1], uses, namespace), isList: false };
    }
    if ((m = /^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(rhs))) {
        // `$categories = $categories->sort(...)` keeps whatever the variable already was.
        return locals.get(m[1]) || null;
    }
    return null;
}

/** Types of local variables assigned within a method body. */
function inferLocals(code, body, uses, namespace) {
    const locals = new Map();
    const re = /\$([A-Za-z_][A-Za-z0-9_]*)\s*=(?![=>])\s*([^;\n]{0,200})/g;
    re.lastIndex = body.start;
    let m;
    while ((m = re.exec(code)) && m.index < body.end) {
        const inferred = typeOfExpression(m[2].trim(), uses, namespace, locals);
        if (inferred && inferred.type) locals.set(m[1], inferred);
    }
    return locals;
}

/**
 * Collect the keys of every `new ArrayData([...])` / `ArrayData::create([...])` literal
 * in a method body.
 *
 * Silverstripe templates lean heavily on lists of `ArrayData`, which carry no class of
 * their own — but the keys are right there in the source, and they are exactly what the
 * template addresses, so they make excellent jump targets.
 */
function findArrayDataKeys(code, text, body, uses, namespace, locals, starts) {
    const keys = new Map();
    const re = /\b(?:new\s+\\?ArrayData\s*\(|\\?ArrayData::create\s*\()\s*/g;
    re.lastIndex = body.start;

    let m;
    while ((m = re.exec(code)) && m.index < body.end) {
        let open = m.index + m[0].length;
        if (code[open] !== '[') {
            if (!/^array\s*\(/.test(code.slice(open, open + 12))) continue;
            open = code.indexOf('(', open);
        }
        const close = matchBracket(code, open);
        if (close === -1) continue;

        const inner = text.slice(open + 1, close - 1);
        const entryRe = /(['"])([A-Za-z_][A-Za-z0-9_]*)\1\s*=>\s*([^,\n]+)/g;
        let entry;
        while ((entry = entryRe.exec(inner))) {
            const key = entry[2];
            if (keys.has(key.toLowerCase())) continue;
            const valueType = typeOfExpression(entry[3].trim(), uses, namespace, locals);
            keys.set(key.toLowerCase(), {
                name: key,
                kind: 'shape',
                type: valueType ? valueType.type : null,
                elementType: valueType && valueType.isList ? valueType.type : null,
                isList: Boolean(valueType && valueType.isList),
                isDbField: false,
                position: positionAt(starts, open + 1 + entry.index + 1),
            });
        }
    }
    return keys;
}

/**
 * Parse one PHP file.
 * @returns {Array} class descriptors, each with a `members` map keyed by lowercased name.
 */
function parsePhp(text) {
    const code = blankComments(text);
    const starts = lineStarts(text);

    const ns = /\bnamespace\s+([A-Za-z_][A-Za-z0-9_\\]*)\s*[;{]/.exec(code);
    const namespace = ns ? ns[1] : '';

    const uses = new Map();
    const useRe = /\buse\s+(?!function\b|const\b)([A-Za-z_][A-Za-z0-9_\\]*)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?\s*;/g;
    let use;
    while ((use = useRe.exec(code))) {
        const fqcn = use[1].replace(/^\\+/, '');
        uses.set((use[2] || fqcn.split('\\').pop()).toLowerCase(), fqcn);
    }

    const classes = [];
    const classRe = /\b(?:abstract\s+|final\s+|readonly\s+)*(class|interface|trait|enum)\s+([A-Za-z_][A-Za-z0-9_]*)([^{;]*)/g;
    let cls;
    while ((cls = classRe.exec(code))) {
        const name = cls[2];
        const ext = /\bextends\s+(\\?[A-Za-z_][A-Za-z0-9_\\]*)/.exec(cls[3] || '');
        classes.push({
            kind: cls[1],
            name,
            namespace,
            fqcn: namespace ? `${namespace}\\${name}` : name,
            extends: ext ? resolveClassName(ext[1], uses, namespace) : null,
            traits: traitsUsedIn(code, cls.index + cls[0].length, uses, namespace),
            position: positionAt(starts, cls.index + cls[0].indexOf(name, cls[1].length)),
            declarationOffset: cls.index,
            members: new Map(),
        });
    }
    if (!classes.length) return [];
    const shapes = [];

    const ownerAt = (offset) => {
        let owner = classes[0];
        for (const candidate of classes) {
            if (candidate.declarationOffset <= offset) owner = candidate;
            else break;
        }
        return owner;
    };

    const addMember = (owner, member) => {
        const key = member.name.toLowerCase();
        if (!owner.members.has(key)) owner.members.set(key, member);
        // A template writes `$Foo` for a `getFoo()` method. The capital matters: it is
        // what separates that convention from an ordinary method such as `get_category()`.
        const getter = /^get([A-Z][A-Za-z0-9_]*)$/.exec(member.name);
        if (getter) {
            const alias = getter[1].toLowerCase();
            if (!owner.members.has(alias)) {
                owner.members.set(alias, { ...member, name: getter[1], via: member.name });
            }
        }
    };

    // --- static config arrays -------------------------------------------------------
    const configRe = /(?:private|public|protected)\s+static\s+(?:array\s+)?\$([a-z_]+)\s*=\s*(\[|array\s*\()/g;
    let config;
    while ((config = configRe.exec(code))) {
        const kind = config[1];
        if (!CONFIG_KINDS.has(kind)) continue;
        const openOffset = config.index + config[0].length - 1;
        const close = matchBracket(code, openOffset);
        if (close === -1) continue;

        const owner = ownerAt(config.index);
        const body = text.slice(openOffset + 1, close - 1);
        const isShorthand = kind === 'db' || kind === 'casting' || kind === 'fixed_fields';

        const entryRe = /(['"])([A-Za-z_][A-Za-z0-9_]*)\1\s*=>\s*([^,\n]+)/g;
        let entry;
        while ((entry = entryRe.exec(body))) {
            const type = resolveTypeExpression(entry[3], uses, namespace, { dbFieldShorthand: isShorthand });
            addMember(owner, {
                name: entry[2],
                kind,
                type,
                elementType: RELATION_KINDS.has(kind) ? type : null,
                isList: LIST_KINDS.has(kind),
                isDbField: isShorthand,
                position: positionAt(starts, openOffset + 1 + entry.index + 1),
            });
        }
    }

    // --- methods ---------------------------------------------------------------------
    const fnRe = /\bfunction\s+&?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    let fn;
    while ((fn = fnRe.exec(code))) {
        const before = code.slice(Math.max(0, fn.index - 60), fn.index);
        if (/\b(private|protected)\s+(?:static\s+)?(?:final\s+)?$/.test(before)) continue;

        const parenOpen = fn.index + fn[0].length - 1;
        const parenClose = matchBracket(code, parenOpen);

        let returnType = null;
        let elementType = null;
        let alternatives = null;
        if (parenClose !== -1) {
            const declared = /^\s*:\s*\??(\\?[A-Za-z_][A-Za-z0-9_\\]*)/.exec(code.slice(parenClose));
            if (declared) returnType = resolveClassName(declared[1], uses, namespace);
        }
        if (!returnType) {
            const doc = docblockBefore(text, fn.index);
            // Supports `@return DataList<App\Foo>` as well as the plain form.
            const ret = doc && /@return\s+(\\?[A-Za-z_][A-Za-z0-9_\\|]*)(?:\s*<\s*(\\?[A-Za-z_][A-Za-z0-9_\\]*)\s*>)?/.exec(doc);
            if (ret) {
                // `@return AssetContainer|Image` — keep every option so the caller can
                // prefer a concrete class over an interface.
                alternatives = ret[1].split('|')
                    .filter((t) => !/^\\?(null|void|mixed)$/i.test(t))
                    .map((t) => resolveClassName(t.trim(), uses, namespace))
                    .filter(Boolean);
                if (alternatives.length) returnType = alternatives[0];
                if (ret[2]) elementType = resolveClassName(ret[2], uses, namespace);
            }
        }

        const owner = ownerAt(fn.index);
        let isList = Boolean(elementType) ||
            (returnType ? /(List|ArrayList|DataList|SS_List|ManyManyList|HasManyList|PaginatedList)$/.test(returnType) : false);

        // A method with no declared type may still build `ArrayData` records whose keys
        // the template addresses directly. Register those keys as a synthetic type.
        const body = parenClose === -1 ? null : methodBody(code, parenClose);
        if (body && !elementType) {
            const locals = inferLocals(code, body, uses, namespace);
            const keys = findArrayDataKeys(code, text, body, uses, namespace, locals, starts);
            if (keys.size) {
                const shape = {
                    kind: 'shape',
                    synthetic: true,
                    name: `${fn[1]}()`,
                    displayName: `${owner.name}::${fn[1]}()`,
                    namespace,
                    fqcn: `${owner.fqcn}::${fn[1]}()`,
                    extends: null,
                    position: positionAt(starts, fn.index + fn[0].indexOf(fn[1])),
                    declarationOffset: fn.index,
                    members: keys,
                };
                shapes.push(shape);
                if (LIST_BUILDER.test(code.slice(body.start, body.end))) {
                    elementType = shape.fqcn;
                    isList = true;
                } else if (!returnType) {
                    returnType = shape.fqcn;
                }
            }
        }

        addMember(owner, {
            name: fn[1],
            kind: 'method',
            type: returnType,
            typeAlternatives: alternatives && alternatives.length > 1 ? alternatives : null,
            elementType,
            isList,
            isDbField: false,
            hasArguments: parenClose !== -1 && code.slice(parenOpen + 1, parenClose - 1).trim().length > 0,
            position: positionAt(starts, fn.index + fn[0].indexOf(fn[1])),
        });
    }

    // --- public properties -------------------------------------------------------------
    const propRe = /\bpublic\s+(?!static\b|function\b)(?:readonly\s+)?(?:\??[A-Za-z_][A-Za-z0-9_\\|]*\s+)?\$([A-Za-z_][A-Za-z0-9_]*)\s*[;=]/g;
    let prop;
    while ((prop = propRe.exec(code))) {
        addMember(ownerAt(prop.index), {
            name: prop[1],
            kind: 'property',
            type: null,
            elementType: null,
            isList: false,
            isDbField: false,
            position: positionAt(starts, prop.index + prop[0].lastIndexOf('$' + prop[1]) + 1),
        });
    }

    return classes.concat(shapes);
}

module.exports = { parsePhp, resolveTypeExpression, resolveClassName, SELF_TYPE, LIST_KINDS, RELATION_KINDS };
