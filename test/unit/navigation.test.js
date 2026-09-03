const assert = require('node:assert');
const { test } = require('node:test');
const { parse, chainAt, tagAt } = require('../../src/template');

/** Every offset in `source` that is a navigable variable, as `name@offset`. */
function jumpTargets(source) {
    const doc = parse(source);
    const hits = [];
    let previous = null;
    for (let i = 0; i < source.length; i++) {
        const hit = chainAt(doc, i);
        if (hit && hit.segment !== previous) hits.push(hit.segment.name);
        previous = hit ? hit.segment : null;
    }
    return hits;
}

/** True when any offset inside `needle` is navigable. */
function navigableInside(source, needle) {
    const doc = parse(source);
    const from = source.indexOf(needle);
    assert.notStrictEqual(from, -1, `source should contain ${needle}`);
    for (let i = from; i < from + needle.length; i++) {
        if (chainAt(doc, i)) return true;
    }
    return false;
}

test('a quoted argument is not a jump target', () => {
    // Regression: every word of the path used to jump to `getStyleTag`.
    const source = '{$getStyleTag("_resources/themes/main/dist/styles/forms.css")}';
    assert.deepStrictEqual(jumpTargets(source), ['getStyleTag']);
    assert.strictEqual(navigableInside(source, '_resources/themes/main/dist/styles/forms.css'), false);
});

test('quoted arguments are inert in every tag and quote style', () => {
    for (const source of [
        "{$getStyleTag('themes/main/app.css')}",
        '<% require themedCSS("layout") %>',
        "<% require javascript('themes/main/js/app.js') %>",
        "<% include Card Title='Some words here' %>",
        "<%t App.KEY 'Default text with words' %>",
        "<% loop $Items.Sort('Name', 'ASC') %>",
    ]) {
        const inner = /['"]([^'"]+)['"]/.exec(source)[1];
        assert.strictEqual(navigableInside(source, inner), false,
            `"${inner}" should not be navigable in ${source}`);
    }
});

test('an unquoted variable argument is still a jump target', () => {
    const source = '<% loop $Items.Filter("TypeID", $CategoryID) %>';
    assert.deepStrictEqual(jumpTargets(source), ['Items', 'Filter', 'CategoryID']);
    assert.strictEqual(navigableInside(source, 'TypeID'), false, 'the quoted key stays inert');
});

test('nested variables inside arguments are found', () => {
    const doc = parse('<p>$List.Filter($Field, $Value).First.Title</p>');
    const names = doc.variables.map((v) => v.segments.map((s) => s.name).join('.'));
    assert.ok(names.includes('Field'), `expected $Field, got ${names}`);
    assert.ok(names.includes('Value'), `expected $Value, got ${names}`);
});

test('argument contents are not jump targets', () => {
    const source = '<p>$Image.Fill(200,200).URL</p>';
    const doc = parse(source);
    // A position that is only ever *inside* the brackets resolves to nothing. The
    // bracket itself is excluded because it shares an offset with the end of `Fill`,
    // where clicking should still resolve — that is ordinary end-of-word behaviour.
    for (const offset of [source.indexOf('200,'), source.indexOf(',200') + 1, source.indexOf(')')]) {
        assert.strictEqual(chainAt(doc, offset), null, `offset ${offset} should not resolve`);
    }
    assert.ok(chainAt(doc, source.indexOf('URL')), 'the trailing segment still works');
    assert.ok(chainAt(doc, source.indexOf('Fill')), 'the method name still works');
});

test('clicking at the end of a segment name still resolves', () => {
    const source = '<p>$Title</p>';
    const doc = parse(source);
    assert.strictEqual(chainAt(doc, source.indexOf('$Title') + 6).segment.name, 'Title');
});

test('plain variables and chains are unaffected', () => {
    assert.deepStrictEqual(jumpTargets('<p>$Title</p>'), ['Title']);
    assert.deepStrictEqual(
        jumpTargets('<p>$Member.Profile.Name</p>'),
        ['Member', 'Profile', 'Name']
    );
    assert.deepStrictEqual(jumpTargets('<img src="{$Image.Fill(200,200).URL}">'),
        ['Image', 'Fill', 'URL']);
});

test('include names remain navigable', () => {
    const source = '<% include Toast\\Includes\\Content %>';
    const doc = parse(source);
    const tag = tagAt(doc, source.indexOf('Toast'));
    assert.strictEqual(tag.kind, 'include');
    assert.strictEqual(tag.templateName, 'Toast\\Includes\\Content');
    const at = source.indexOf('Includes');
    assert.ok(at >= tag.templateNameStart && at <= tag.templateNameEnd);
});

test('text outside any variable is not a jump target', () => {
    const doc = parse('<p>Just some prose about $Title and things.</p>');
    assert.strictEqual(chainAt(doc, 5), null);
    assert.strictEqual(chainAt(doc, doc.variables[0].end + 3), null);
});
