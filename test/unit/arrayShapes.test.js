const assert = require('node:assert');
const { test } = require('node:test');
const path = require('node:path');
const { buildFixtureIndex, uriFor, ROOT } = require('../lib/fixtureIndex');
const { parse } = require('../../src/template');
const { resolveVariableAt } = require('../../src/resolver');

const index = buildFixtureIndex();
const COLLECTION = uriFor(path.join(ROOT, 'app/templates/Toast/Pages/Layout/CollectionPage.ss'));

/** Resolve the variable marked by `|` in `source`. */
function resolveAt(source, uri = COLLECTION) {
    const offset = source.indexOf('|');
    assert.notStrictEqual(offset, -1, 'source must contain a | cursor marker');
    return resolveVariableAt(index, parse(source.replace('|', '')), uri, offset);
}

const LOOP = (body) => [
    '<% loop $CategoriesFilters %>',
    `    ${body}`,
    '<% end_loop %>',
].join('\n');

test('the ArrayData keys of a built list become resolvable members', () => {
    for (const name of ['CategoryID', 'CategoryName', 'LabelName', 'Items']) {
        const marked = name.slice(0, 3) + '|' + name.slice(3);
        const r = resolveAt(LOOP(`<span>$${marked}</span>`));
        assert.strictEqual(r.status, 'resolved', `${name} should resolve`);
        assert.match(r.cls.uri.fsPath, /CollectionPage\.php$/, `${name} should point at the page class`);
        assert.strictEqual(r.member.name, name);
    }
});

test('an ArrayData key points at the line that declares it', () => {
    const r = resolveAt(LOOP('<span>$Category|Name</span>'));
    const source = require('node:fs').readFileSync(r.cls.uri.fsPath, 'utf8').split('\n');
    assert.match(source[r.member.position.line], /'CategoryName'\s*=>/);
});

test('a list built from a ::get() query carries its element type', () => {
    const r = resolveAt(LOOP('<span>$It|ems</span>'));
    assert.strictEqual(r.member.elementType, 'SilverStripe\\Taxonomy\\TaxonomyTerm');
    assert.strictEqual(r.member.isList, true);
});

test('list-shaping calls are transparent when narrowing scope', () => {
    const source = [
        '<% loop $CategoriesFilters %>',
        '    <% loop $Items.Sort(\'Name\') %>',
        '        <option>{$Na|me}</option>',
        '    <% end_loop %>',
        '<% end_loop %>',
    ].join('\n');
    const r = resolveAt(source);
    assert.strictEqual(r.status, 'resolved');
    assert.strictEqual(r.cls.fqcn, 'SilverStripe\\Taxonomy\\TaxonomyTerm');
    assert.strictEqual(r.member.kind, 'db');
});

test('scope narrowing also works without a list-shaping call', () => {
    const source = [
        '<% loop $CategoriesFilters %>',
        '    <% loop $Items %>',
        '        <option>{$Na|me}</option>',
        '    <% end_loop %>',
        '<% end_loop %>',
    ].join('\n');
    assert.strictEqual(resolveAt(source).cls.fqcn, 'SilverStripe\\Taxonomy\\TaxonomyTerm');
});

test('the page class own methods still resolve', () => {
    const r = resolveAt('<form action="{$API|URL}">');
    assert.strictEqual(r.status, 'resolved');
    assert.strictEqual(r.member.via, 'getAPIURL');
});

test('a page template also sees members defined on its controller', () => {
    const r = resolveAt('<form action="{$Categories|Filters}">');
    assert.strictEqual(r.status, 'resolved');
    assert.strictEqual(r.cls.fqcn, 'Toast\\Pages\\CollectionPageController');
});

test('the page record is still in scope alongside the controller', () => {
    const r = resolveAt('<p>$In|tro</p>');
    assert.strictEqual(r.status, 'resolved');
    assert.strictEqual(r.cls.fqcn, 'Toast\\Pages\\CollectionPage');
});

test('a class extending a root-namespaced parent still inherits', () => {
    const cls = index.getClass('Toast\\Pages\\CollectionPage');
    assert.strictEqual(cls.extends, 'Page', 'extends \\Page should be parsed');
    const r = resolveAt('<h1>$Ti|tle</h1>');
    assert.strictEqual(r.status, 'resolved');
    assert.strictEqual(r.cls.fqcn, 'SilverStripe\\CMS\\Model\\SiteTree');
});

test('built-in DataObject fields resolve', () => {
    const source = [
        '<% loop $CategoriesFilters %>',
        '    <% loop $Items %>',
        '        <option value="{$I|D}">x</option>',
        '    <% end_loop %>',
        '<% end_loop %>',
    ].join('\n');
    const r = resolveAt(source);
    assert.strictEqual(r.status, 'resolved');
    assert.strictEqual(r.member.kind, 'fixed_fields');
    assert.strictEqual(r.cls.fqcn, 'SilverStripe\\ORM\\DataObject');
});

test('a list scalar reports as a list method rather than guessing', () => {
    const r = resolveAt(LOOP('<% if $Items.Cou|nt %>x<% end_if %>'));
    assert.strictEqual(r.status, 'listMethod');
    assert.strictEqual(r.name, 'Count');
});

test('synthetic shapes never win a short-name class lookup', () => {
    assert.strictEqual(index.getClass('getCategoriesFilters()'), null);
});

test('members reach a class through a trait it uses', () => {
    const r = resolveAt('<img src="{$HeroImage.Fi|ll(400,300).URL}">',
        uriFor(path.join(ROOT, 'app/templates/App/PageTypes/Layout/HomePage.ss')));
    assert.strictEqual(r.status, 'resolved');
    assert.strictEqual(r.cls.fqcn, 'SilverStripe\\Assets\\ImageManipulation');
});

test('a fluent method declared as returning an interface keeps the concrete scope', () => {
    // `Fill()` is `@return AssetContainer`, but the members live on `File`/`Image`.
    const r = resolveAt('<img src="{$HeroImage.Fill(400,300).UR|L}">',
        uriFor(path.join(ROOT, 'app/templates/App/PageTypes/Layout/HomePage.ss')));
    assert.strictEqual(r.status, 'resolved');
    assert.strictEqual(r.member.via, 'getURL');
});

test('a union return type prefers the concrete class over the interface', () => {
    const r = resolveAt('<img alt="{$HeroImage.ScaleWidth(400).Ti|tle}">',
        uriFor(path.join(ROOT, 'app/templates/App/PageTypes/Layout/HomePage.ss')));
    assert.strictEqual(r.status, 'resolved');
    assert.strictEqual(r.cls.fqcn, 'SilverStripe\\Assets\\File');
});

test('extensions applied through YAML config are searched', () => {
    const r = resolveAt('{$getStyle|Tag("themes/main/css/app.css")}');
    assert.strictEqual(r.status, 'resolved');
    assert.strictEqual(r.cls.fqcn, 'Toast\\Extensions\\ControllerExtension');
});

test('commented-out extensions in YAML are ignored', () => {
    const { parseConfigYaml } = require('../../src/config');
    const parsed = parseConfigYaml([
        '---',
        'Name: test',
        '---',
        'SilverStripe\\Assets\\File:',
        '  extensions:',
        '    # - App\\Disabled',
        '    - App\\Enabled',
        '  other_setting: true',
        '',
        'App\\Other:',
        '  extensions:',
        '    - App\\Second',
    ].join('\n'));
    assert.deepStrictEqual(parsed.get('silverstripe\\assets\\file'), ['App\\Enabled']);
    assert.deepStrictEqual(parsed.get('app\\other'), ['App\\Second']);
    assert.strictEqual(parsed.has('name'), false, 'YAML front matter is not a class target');
});

test('a sibling key ends the extensions list', () => {
    const { parseConfigYaml } = require('../../src/config');
    const parsed = parseConfigYaml([
        'App\\Thing:',
        '  extensions:',
        '    - App\\Real',
        '  css_folder_path: App\\NotAnExtension',
    ].join('\n'));
    assert.deepStrictEqual(parsed.get('app\\thing'), ['App\\Real']);
});
