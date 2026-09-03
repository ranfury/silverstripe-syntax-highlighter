const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { format, normaliseTags } = require('../../src/formatter');

const ROOT = path.join(__dirname, '..', '..');

/** Formatting `input` must produce `input` unchanged. */
function stable(name, input) {
    test(name, () => {
        const source = input.replace(/^\n/, '').replace(/\n$/, '');
        assert.strictEqual(format(source).text, source);
    });
}

/** Formatting `input` must produce `expected`. */
function fixes(name, input, expected) {
    test(name, () => {
        const source = input.replace(/^\n/, '').replace(/\n$/, '');
        const want = expected.replace(/^\n/, '').replace(/\n$/, '');
        assert.strictEqual(format(source).text, want);
    });
}

// --- invariants --------------------------------------------------------------------

/** Everything except whitespace outside `<% %>` tags must survive untouched. */
function renderedContent(text) {
    return text
        .replace(/<%(?!--)((?:[^%]|%(?!>))*)%>/g, (m, inner) => `<%${inner.replace(/\s+/g, ' ').trim()}%>`)
        .replace(/[ \t]+/g, ' ')
        .replace(/[ \t]*\n[ \t]*/g, '\n')
        .trim();
}

const CORPUS = [
    path.join(ROOT, 'sample.ss'),
    path.join(ROOT, 'test', 'fixtures', 'messy.ss'),
];

test('formatting never changes rendered content', () => {
    for (const file of CORPUS) {
        const source = fs.readFileSync(file, 'utf8');
        assert.strictEqual(
            renderedContent(format(source).text),
            renderedContent(source),
            `content changed while formatting ${path.basename(file)}`
        );
    }
});

test('formatting is idempotent', () => {
    for (const file of CORPUS) {
        const once = format(fs.readFileSync(file, 'utf8')).text;
        assert.strictEqual(format(once).text, once, `not idempotent for ${path.basename(file)}`);
    }
});

test('formatting never adds or removes lines', () => {
    for (const file of CORPUS) {
        const source = fs.readFileSync(file, 'utf8');
        assert.strictEqual(
            format(source).text.split('\n').length,
            source.split('\n').length,
            `line count changed for ${path.basename(file)}`
        );
    }
});

test('the bundled sample is already correctly formatted', () => {
    const source = fs.readFileSync(path.join(ROOT, 'sample.ss'), 'utf8');
    assert.strictEqual(format(source).text, source.replace(/\n$/, '') + '\n'.repeat(source.endsWith('\n') ? 1 : 0));
});

test('CRLF line endings are preserved', () => {
    const result = format('<div>\r\n<p>x</p>\r\n</div>');
    assert.ok(result.text.includes('\r\n'));
    assert.ok(!/[^\r]\n/.test(result.text));
});

test('tabs are used when insertSpaces is false', () => {
    const result = format('<div>\n<p>x</p>\n</div>', { insertSpaces: false });
    assert.strictEqual(result.text.split('\n')[1], '\t<p>x</p>');
});

test('tabSize is honoured', () => {
    const result = format('<div>\n<p>x</p>\n</div>', { tabSize: 2 });
    assert.strictEqual(result.text.split('\n')[1], '  <p>x</p>');
});

// --- indentation -------------------------------------------------------------------

fixes('re-indents an svg with self-closing children', `
<svg viewBox="0 0 24 24">
<g clip-path="url(#c)">
<path d="M3 6h18"/>
<circle cx="5" cy="5" r="4"/>
</g>
</svg>`, `
<svg viewBox="0 0 24 24">
    <g clip-path="url(#c)">
        <path d="M3 6h18"/>
        <circle cx="5" cy="5" r="4"/>
    </g>
</svg>`);

fixes('corrects over-indented content', `
<div>
                <p>a</p>
        <p>b</p>
</div>`, `
<div>
    <p>a</p>
    <p>b</p>
</div>`);

stable('multi-line attribute lists', `
<a
    href="$Link"
    class="btn"
>
    <span>Go</span>
</a>`);

stable('multi-line attributes on a void element', `
<img
    src="$Image.URL"
    alt="$Image.Title"
>
<p>after</p>`);

stable('silverstripe blocks with else branches', `
<% if $Content %>
    <p>$Content</p>
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
        <a href="$Link">$MenuTitle</a>
    <% end_loop %>
<% end_cached %>`);

stable('tags opened and closed on one line', `
<ul>
    <li class="<% if $Current %>active<% end_if %>">$Title</li>
    <li><% if $X %>a<% else %>b<% end_if %></li>
    <p>text</p>
</ul>`);

stable('silverstripe tags among html attributes', `
<div>
    <a href="$Link" <% if $New %>target="_blank"<% end_if %>>$Title</a>
</div>`);

stable('void elements do not open a block', `
<div>
    <img src="a.png">
    <br>
    <input type="text">
    <hr>
</div>`);

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

stable('html comments are left alone', `
<div>
    <!-- a comment with <div> inside -->
    <p>x</p>
</div>`);

stable('silverstripe comments are left alone', `
<div>
    <%-- commented out: <% if $X %> --%>
    <p>x</p>
</div>`);

stable('attribute values containing angle brackets', `
<div>
    <a title="a > b" href="#">x</a>
</div>`);

// --- verbatim and raw bodies -------------------------------------------------------

test('pre content and its closing tag are preserved exactly', () => {
    const source = ['<div>', '<pre>', '   spaced   out', '      more', '</pre>', '</div>'].join('\n');
    const lines = format(source).text.split('\n');
    assert.strictEqual(lines[1], '    <pre>');
    assert.strictEqual(lines[2], '   spaced   out');
    assert.strictEqual(lines[3], '      more');
    assert.strictEqual(lines[4], '</pre>', 'indenting </pre> would add whitespace to the content');
});

test('textarea content is preserved exactly', () => {
    const source = ['<form>', '<textarea>', 'hello', '  world', '</textarea>', '</form>'].join('\n');
    const lines = format(source).text.split('\n');
    assert.strictEqual(lines[2], 'hello');
    assert.strictEqual(lines[3], '  world');
});

test('script bodies keep their relative shape but are re-based', () => {
    const source = ['<div>', '<script>', '        const a = 1;', '          const b = 2;', '</script>', '</div>'].join('\n');
    const lines = format(source).text.split('\n');
    assert.strictEqual(lines[1], '    <script>');
    assert.strictEqual(lines[2], '        const a = 1;');
    assert.strictEqual(lines[3], '          const b = 2;');
    assert.strictEqual(lines[4], '    </script>');
});

test('html inside a script string is not treated as markup', () => {
    const source = ['<div>', '<script>', 'var s = "<div>";', '</script>', '<p>after</p>', '</div>'].join('\n');
    const lines = format(source).text.split('\n');
    assert.strictEqual(lines[4], '    <p>after</p>');
});

// --- tag whitespace ----------------------------------------------------------------

test('tag whitespace is normalised', () => {
    assert.strictEqual(normaliseTags('<%if $X%>'), '<% if $X %>');
    assert.strictEqual(normaliseTags('<%   end_if   %>'), '<% end_if %>');
    assert.strictEqual(normaliseTags('<%  loop   $Items  %>'), '<% loop $Items %>');
    assert.strictEqual(normaliseTags('<% include  Foo  Bar=$Baz %>'), '<% include Foo Bar=$Baz %>');
});

test('quoted arguments keep their internal spacing', () => {
    assert.strictEqual(normaliseTags("<%t App.KEY   'Hello   there' %>"), "<%t App.KEY 'Hello   there' %>");
    assert.strictEqual(normaliseTags("<% require themedCSS( 'my  file' ) %>"), "<% require themedCSS( 'my  file' ) %>");
});

test('comments and multi-line tags are not normalised', () => {
    assert.strictEqual(normaliseTags('<%--  spaced  comment  --%>'), '<%--  spaced  comment  --%>');
    assert.strictEqual(normaliseTags('<% if $A\n    && $B %>'), '<% if $A\n    && $B %>');
});

test('tag normalisation can be turned off', () => {
    assert.strictEqual(format('<%if $X%>a<%end_if%>', { normaliseTagSpacing: false }).text, '<%if $X%>a<%end_if%>');
});

// --- malformed input ----------------------------------------------------------------

test('an unclosed block is reported but still formats sanely', () => {
    const result = format(['<div>', '<% if $A %>', '<p>x</p>', '</div>'].join('\n'));
    assert.ok(result.unbalanced, 'should flag the imbalance');
    assert.strictEqual(result.lines[2], '        <p>x</p>');
});

test('a stray closing tag never produces negative indentation', () => {
    const result = format(['</div>', '</div>', '<p>x</p>'].join('\n'));
    assert.ok(result.unbalanced);
    for (const line of result.lines) assert.ok(!line.startsWith(' '), `unexpected indent: ${line}`);
});

test('an unterminated tag does not swallow the rest of the file', () => {
    const result = format(['<div>', '<% if $A ', '<p>x</p>', '</div>'].join('\n'));
    assert.strictEqual(result.lines.length, 4);
});
