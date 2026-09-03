const assert = require('node:assert');
const { test } = require('node:test');
const path = require('node:path');
const { buildFixtureIndex, uriFor, ROOT } = require('../lib/fixtureIndex');
const { parse } = require('../../src/template');
const { resolveVariableAt, baseClassFor } = require('../../src/resolver');

const index = buildFixtureIndex();
const HOME = uriFor(path.join(ROOT, 'app/templates/App/PageTypes/Layout/HomePage.ss'));
const SHARED = uriFor(path.join(ROOT, 'themes/main/templates/Includes/Navigation.ss'));

/** Resolve the variable marked by `|` in `source`. */
function resolveAt(source, uri = HOME) {
    const offset = source.indexOf('|');
    assert.notStrictEqual(offset, -1, 'source must contain a | cursor marker');
    return resolveVariableAt(index, parse(source.replace('|', '')), uri, offset);
}

test('the template path infers the backing class', () => {
    assert.strictEqual(baseClassFor(index, parse(''), HOME).fqcn, 'App\\PageTypes\\HomePage');
});

test('resolves a $db field on the template class', () => {
    const r = resolveAt('<p>$Sub|title</p>');
    assert.strictEqual(r.status, 'resolved');
    assert.strictEqual(r.member.name, 'Subtitle');
    assert.strictEqual(r.member.kind, 'db');
    assert.strictEqual(r.cls.fqcn, 'App\\PageTypes\\HomePage');
});

test('resolves a getter through the $Foo -> getFoo() convention', () => {
    const r = resolveAt('<p>$Read|ingTime</p>');
    assert.strictEqual(r.status, 'resolved');
    // `$casting` declares it too; either declaration is a correct jump target.
    assert.ok(['casting', 'method'].includes(r.member.kind));
});

test('resolves a field inherited from the parent class', () => {
    const r = resolveAt('<p>$Tag|line</p>');
    assert.strictEqual(r.status, 'resolved');
    assert.strictEqual(r.cls.fqcn, 'Page');
});

test('resolves a field inherited from vendor code', () => {
    const r = resolveAt('<h1>$Ti|tle</h1>');
    assert.strictEqual(r.status, 'resolved');
    assert.strictEqual(r.cls.fqcn, 'SilverStripe\\CMS\\Model\\SiteTree');
});

test('follows a has_one relation through the chain', () => {
    const r = resolveAt('<p>$HeroImage.Ti|tle</p>');
    assert.strictEqual(r.status, 'resolved');
    assert.strictEqual(r.cls.fqcn, 'SilverStripe\\Assets\\File');
});

test('follows a fluent @return static method mid-chain', () => {
    const r = resolveAt('<img src="{$HeroImage.Fill(400,300).UR|L}">');
    assert.strictEqual(r.status, 'resolved');
    assert.strictEqual(r.member.via, 'getURL');
});

test('narrows scope inside a loop over a has_many relation', () => {
    const r = resolveAt([
        '<% loop $Testimonials %>',
        '    <blockquote>$Qu|ote</blockquote>',
        '<% end_loop %>',
    ].join('\n'));
    assert.strictEqual(r.status, 'resolved');
    assert.strictEqual(r.cls.fqcn, 'App\\Models\\Testimonial');
});

test('narrows scope through a docblock generic return type', () => {
    const r = resolveAt([
        '<% loop $Children %>',
        '    <a href="$Link">$Menu|Title</a>',
        '<% end_loop %>',
    ].join('\n'));
    assert.strictEqual(r.status, 'resolved');
    assert.strictEqual(r.cls.fqcn, 'SilverStripe\\CMS\\Model\\SiteTree');
});

test('$Up walks back out to the enclosing scope', () => {
    const r = resolveAt([
        '<% loop $Testimonials %>',
        '    <p>$Up.Sub|title</p>',
        '<% end_loop %>',
    ].join('\n'));
    assert.strictEqual(r.status, 'resolved');
    assert.strictEqual(r.cls.fqcn, 'App\\PageTypes\\HomePage');
});

test('$Top returns to the template class from nested loops', () => {
    const r = resolveAt([
        '<% loop $Testimonials %>',
        '    <% with $Portrait %>',
        '        <p>$Top.Sub|title</p>',
        '    <% end_with %>',
        '<% end_loop %>',
    ].join('\n'));
    assert.strictEqual(r.status, 'resolved');
    assert.strictEqual(r.cls.fqcn, 'App\\PageTypes\\HomePage');
});

test('iterator variables are reported as language built-ins', () => {
    for (const source of ['<% loop $Testimonials %>$Po|s<% end_loop %>', '<p>$Fir|st</p>', '<p>$U|p</p>']) {
        assert.strictEqual(resolveAt(source).status, 'language', source);
    }
});

test('a data field shadowing a global name still resolves to the class', () => {
    assert.strictEqual(resolveAt('<h1>$Ti|tle</h1>').status, 'resolved');
});

test('globals resolve as globals when nothing shadows them', () => {
    assert.strictEqual(resolveAt('<link href="$ThemeD|ir/css/app.css">').status, 'global');
});

test('casting suffixes are reported as casts, not missing members', () => {
    const r = resolveAt('<p>$Subtitle.X|ML</p>');
    assert.strictEqual(r.status, 'cast');
    assert.strictEqual(r.name, 'XML');
});

test('a shared include with no class of its own falls back to candidates', () => {
    const r = resolveAt('<p>$Qu|ote</p>', SHARED);
    assert.strictEqual(r.status, 'candidates');
    assert.ok(r.candidates.some((c) => c.cls.fqcn === 'App\\Models\\Testimonial'));
});

test('an @var hint pins the class for a shared include', () => {
    const r = resolveAt(['<%-- @var App\\PageTypes\\HomePage --%>', '<p>$Sub|title</p>'].join('\n'), SHARED);
    assert.strictEqual(r.status, 'resolved');
    assert.strictEqual(r.cls.fqcn, 'App\\PageTypes\\HomePage');
});

test('candidate ranking prefers project code over vendor code', () => {
    const r = resolveAt('<p>$Auth|or</p>', SHARED);
    assert.strictEqual(r.candidates[0].cls.fqcn, 'App\\Models\\Testimonial');
});

test('unknown members report as unresolved rather than guessing', () => {
    const r = resolveAt('<p>$Nonexis|tentThing</p>');
    assert.strictEqual(r.status, 'unresolved');
    assert.strictEqual(r.searchedClass, 'App\\PageTypes\\HomePage');
});

test('private and protected methods are not reachable from templates', () => {
    assert.strictEqual(resolveAt('<p>$hiddenHel|per</p>').status, 'unresolved');
    assert.strictEqual(resolveAt('<p>$alsoHid|den</p>').status, 'unresolved');
});

// --- include resolution ------------------------------------------------------------

test('resolves a bare include name to an Includes template', () => {
    const hits = index.resolveInclude('Navigation', HOME);
    assert.match(hits[0].uri.path, /themes\/main\/templates\/Includes\/Navigation\.ss$/);
});

test('resolves a namespaced include path', () => {
    const hits = index.resolveInclude('App\\PageTypes\\Layout\\HomePage', HOME);
    assert.match(hits[0].uri.path, /app\/templates\/App\/PageTypes\/Layout\/HomePage\.ss$/);
});

test('prefers templates from the same module', () => {
    assert.match(index.resolveInclude('Footer', HOME)[0].uri.path, /app\/templates\/Includes\/Footer\.ss$/);
});

test('unknown includes resolve to nothing', () => {
    assert.strictEqual(index.resolveInclude('NoSuchTemplate', HOME).length, 0);
});
