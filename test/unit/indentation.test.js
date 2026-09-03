const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { reindent, enterIndent, isIndentOutdent, increase, decrease } = require('../lib/indent');

/** `input` is already correctly indented, so re-indenting it must be a no-op. */
function stable(name, input) {
    test(name, () => {
        const expected = input.replace(/^\n/, '').replace(/\n$/, '');
        assert.strictEqual(reindent(expected), expected);
    });
}

// --- the reported bug -------------------------------------------------------------

test('self-closing tags do not increase indent', () => {
    for (const line of [
        '<path d="M10 0L0 10" stroke="black"/>',
        '<path d="M10 0L0 10" stroke="black" />',
        '<circle cx="5" cy="5" r="4"/>',
        '<rect width="20" height="20" fill="white"/>',
        '<use href="#icon-search"/>',
        '<stop offset="0" stop-color="#fff"/>',
        '<line x1="0" y1="0" x2="10" y2="10"/>',
        '<polygon points="0,0 10,10"/>',
        '<my-component :prop="1"/>',
        '<div/>',
    ]) {
        assert.ok(!increase.test(line), `should not increase indent: ${line}`);
    }
});

test('Enter after a self-closing tag keeps the current indent', () => {
    assert.strictEqual(enterIndent('        <path d="M0 0" fill="none"/>', ''), 2);
    assert.ok(!isIndentOutdent('        <path d="M0 0" fill="none"/>', '</svg>'));
    assert.ok(!isIndentOutdent('    <use href="#a" />', '</svg>'));
});

test('Enter after a void element keeps the current indent', () => {
    assert.strictEqual(enterIndent('    <img src="x.png" alt="y">', ''), 1);
    assert.ok(!isIndentOutdent('    <img src="x.png" alt="y">', '</div>'));
    assert.ok(!isIndentOutdent('    <br>', '</p>'));
});

stable('inline svg with self-closing children', `
<div class="icon">
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 0L0 10" stroke="currentColor" stroke-width="2"/>
        <circle cx="10" cy="10" r="9"/>
        <rect width="20" height="20" fill="white"/>
    </svg>
</div>`);

stable('svg with nested groups, defs and clip paths', `
<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <title>Menu</title>
    <g clip-path="url(#clip0)" fill="none">
        <path d="M3 6h18" stroke="#000"/>
        <path d="M3 12h18" stroke="#000"/>
    </g>
    <defs>
        <clipPath id="clip0">
            <rect width="24" height="24" fill="white"/>
        </clipPath>
        <linearGradient id="grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#fff"/>
            <stop offset="1" stop-color="#000"/>
        </linearGradient>
    </defs>
</svg>`);

stable('svg inside a silverstripe loop', `
<% loop $Items %>
    <a href="$Link" class="card">
        <svg viewBox="0 0 16 16">
            <use href="#icon-arrow" />
        </svg>
        <span>$Title</span>
    </a>
<% end_loop %>`);

// --- guarding against regressions in what already worked ---------------------------

test('open tags still increase indent', () => {
    for (const line of [
        '<svg width="20" viewBox="0 0 20 20">',
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">',
        '<g clip-path="url(#c0)">',
        '<div>',
        '<div class="a">',
        '<a href="https://example.com/">',
        '<script>',
        '<style>',
        '<clipPath id="clip0">',
        '<linearGradient id="grad" x1="0">',
    ]) {
        assert.ok(increase.test(line), `should increase indent: ${line}`);
    }
});

test('void elements still do not increase indent', () => {
    for (const line of ['<br>', '<img src="x.png">', '<input type="text" name="q">', '<hr>', '<meta name="a" content="b">']) {
        assert.ok(!increase.test(line), `should not increase indent: ${line}`);
    }
});

test('tags closed on the same line still do not increase indent', () => {
    for (const line of ['<title>$Title</title>', '<span class="a">text</span>', '<h1>Hi</h1>']) {
        assert.ok(!increase.test(line), `should not increase indent: ${line}`);
    }
});

test('silverstripe blocks still increase and decrease', () => {
    for (const line of ['<% if $A %>', '<% loop $Items %>', '<% with $X %>', "<% cached 'k', $L %>", '<% else %>', '<% else_if $B %>']) {
        assert.ok(increase.test(line), `should increase indent: ${line}`);
    }
    for (const line of ['<% end_if %>', '<% end_loop %>', '<% end_with %>', '<% end_cached %>', '<% else %>', '<% else_if $B %>']) {
        assert.ok(decrease.test(line), `should decrease indent: ${line}`);
    }
    assert.ok(!increase.test('<% if $X %>a<% end_if %>'), 'single-line block should not indent');
});

test('closing tags still decrease indent', () => {
    for (const line of ['</div>', '</svg>', '</script>', '</style>', '</clipPath>']) {
        assert.ok(decrease.test(line), `should decrease indent: ${line}`);
    }
});

test('Enter between an open tag and its closer still indents and outdents', () => {
    assert.ok(isIndentOutdent('    <div class="a">', '</div>'));
    assert.ok(isIndentOutdent('    <svg viewBox="0 0 24 24">', '</svg>'));
    assert.strictEqual(enterIndent('    <svg viewBox="0 0 24 24">', ''), 2);
    assert.ok(isIndentOutdent('    <% if $X %>', '<% end_if %>'));
    assert.ok(isIndentOutdent('    <% loop $Items %>', '<% end_loop %>'));
});

stable('silverstripe control blocks', `
<% if $Content %>
    <div class="content">
        $Content
    </div>
<% else_if $Fallback %>
    <p>$Fallback</p>
<% else %>
    <p>Nothing</p>
<% end_if %>`);

stable('nested loops, with and cached blocks', `
<% cached 'nav', $LastEdited %>
    <% with $SiteConfig %>
        <h1>$Title</h1>
    <% end_with %>
    <% loop $Menu(1) %>
        <% if $LinkingMode == 'current' %>
            <strong>$MenuTitle</strong>
        <% end_if %>
    <% end_loop %>
<% end_cached %>`);

stable('void elements and single-line blocks', `
<ul>
    <li class="<% if $Current %>active<% end_if %>">$Title</li>
    <img src="$Image.URL" alt="$Image.Title">
    <br>
</ul>`);

stable('script and style bodies', `
<script>
    var config = {
        title: "$Title",
        items: [
            1,
            2
        ]
    };
</script>`);

stable('doctype and html shell', `
<!doctype html>
<html lang="en-NZ">
    <head>
        <title>$Title</title>
    </head>
    <body>
        $Layout
    </body>
</html>`);

test('the bundled sample template re-indents to itself', () => {
    const sample = fs.readFileSync(path.join(__dirname, '..', '..', 'sample.ss'), 'utf8').replace(/\n$/, '');
    assert.strictEqual(reindent(sample), sample);
});
