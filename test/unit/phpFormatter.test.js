const assert = require('node:assert');
const { test } = require('node:test');
const { formatPhp } = require('../../src/phpFormatter');

/** Formatting `input` must leave it exactly as it is. */
function stable(name, input) {
    test(name, () => {
        const source = input.replace(/^\n/, '').replace(/\n$/, '');
        assert.strictEqual(formatPhp(source).text, source);
    });
}

/** Formatting `input` must produce `expected`. */
function fixes(name, input, expected) {
    test(name, () => {
        const source = input.replace(/^\n/, '').replace(/\n$/, '');
        const want = expected.replace(/^\n/, '').replace(/\n$/, '');
        assert.strictEqual(formatPhp(source).text, want);
        assert.strictEqual(formatPhp(want).text, want, 'result must be stable');
    });
}

// --- invariants ---------------------------------------------------------------------

test('formatting only ever changes leading and trailing whitespace', () => {
    const sources = [
        "<?php\nclass A\n{\n  public function b()\n{\nreturn 1;\n}\n}",
        "<?php\n$x = ['a' => 1, 'b' => 2];\n",
        "<?php\n$s = \"a { b } c\";\n$t = 'it\\'s';\n",
    ];
    for (const source of sources) {
        const strip = (t) => t.split('\n').map((l) => l.trim()).join('\n');
        assert.strictEqual(strip(formatPhp(source).text), strip(source));
    }
});

test('CRLF line endings are preserved', () => {
    const result = formatPhp('<?php\r\nclass A\r\n{\r\n$x = 1;\r\n}\r\n');
    assert.ok(result.text.includes('\r\n'));
    assert.ok(!/[^\r]\n/.test(result.text));
});

test('tabs are used when insertSpaces is false', () => {
    const result = formatPhp('<?php\nclass A\n{\n$x = 1;\n}', { insertSpaces: false });
    assert.strictEqual(result.text.split('\n')[3], '\t$x = 1;');
});

// --- structure -----------------------------------------------------------------------

fixes('braces on their own line', `
<?php
class Thing extends \\Page
{
private static $db = [
'Title' => 'Varchar(255)',
];
}`, `
<?php
class Thing extends \\Page
{
    private static $db = [
        'Title' => 'Varchar(255)',
    ];
}`);

stable('nested control structures', `
<?php
function f($input)
{
    if ($input) {
        foreach ($input as $item) {
            $this->handle($item);
        }
    } else {
        return null;
    }
    return $this;
}`);

stable('a fluent chain continues at one level', `
<?php
$fields->addFieldsToTab('Root.Main', [
    UploadField::create('Image')
        ->setIsMultiUpload(false)
        ->setFolderName('Images'),
]);`);

stable('a chain whose first call opens a bracket', `
<?php
$fields->addFieldToTab('Root.Main', SortableUploadField::create('Images', 'Images')
    ->setSortColumn('Sort')
    ->setFolderName('Images'));`);

stable('several brackets opened on one line indent once', `
<?php
$list->push(new ArrayData([
    'CategoryID' => $category->ID,
    'CategoryName' => $category->Name,
]));`);

stable('switch bodies indent past their case labels', `
<?php
switch ($mode) {
    case 'a':
        $this->a();
        break;
    case 'b':
    case 'c':
        $this->bc();
        break;
    default:
        $this->d();
}`);

stable('a multi-line signature', `
<?php
public function longSignature(
    $first,
    $second
) {
    return $first;
}`);

stable('a multi-line signature with the brace on its own line', `
<?php
public function longSignature(
    $first,
    $second
)
{
    return $first;
}`);

stable('single-statement control bodies', `
<?php
if (!$x)
    return;
$y = 1;`);

stable('closures and callables', `
<?php
$schema = array_filter($schema, function ($v) {
    return $v !== null;
});`);

stable('try/catch/finally', `
<?php
try {
    $this->go();
} catch (Exception $e) {
    $this->log($e);
} finally {
    $this->done();
}`);

// --- things whose whitespace must not be touched ---------------------------------------

test('heredoc and nowdoc bodies are preserved exactly', () => {
    const source = [
        '<?php',
        'function f()',
        '{',
        '$a = <<<SQL',
        '    SELECT *',
        '      FROM tbl',
        'SQL;',
        "$b = <<<'TXT'",
        '   raw   text',
        'TXT;',
        'return [$a, $b];',
        '}',
    ].join('\n');
    const lines = formatPhp(source).text.split('\n');
    assert.strictEqual(lines[4], '    SELECT *');
    assert.strictEqual(lines[5], '      FROM tbl');
    assert.strictEqual(lines[6], 'SQL;');
    assert.strictEqual(lines[8], '   raw   text');
    assert.strictEqual(lines[9], 'TXT;');
});

test('inline HTML outside php tags is preserved exactly', () => {
    const source = ['<div>', '   <p>hello</p>', '</div>', '<?php', 'echo 1;'].join('\n');
    const lines = formatPhp(source).text.split('\n');
    assert.strictEqual(lines[1], '   <p>hello</p>');
});

test('braces inside strings and comments do not change indentation', () => {
    const source = [
        '<?php',
        'function f()',
        '{',
        '$a = "a { b";',
        "$b = 'c } d';",
        '// if ($x) {',
        '/* } */',
        'return 1;',
        '}',
    ].join('\n');
    const lines = formatPhp(source).text.split('\n');
    for (const i of [3, 4, 5, 6, 7]) {
        assert.match(lines[i], /^ {4}\S/, `line ${i} should be at one level: ${JSON.stringify(lines[i])}`);
    }
});

test('docblock continuation lines align on their asterisk', () => {
    const source = ['<?php', 'class A', '{', '/**', '* Text', '*/', 'public $x;', '}'].join('\n');
    const lines = formatPhp(source).text.split('\n');
    assert.strictEqual(lines[3], '    /**');
    assert.strictEqual(lines[4], '     * Text');
    assert.strictEqual(lines[5], '     */');
});

// --- malformed input ---------------------------------------------------------------------

test('unbalanced braces are reported and never produce negative indentation', () => {
    const result = formatPhp('<?php\nfunction f()\n{\n$x = 1;\n');
    assert.ok(result.unbalanced);
    for (const line of result.lines) assert.ok(!/^\s+$/.test(line));

    const extra = formatPhp('<?php\n}\n}\n$x = 1;');
    assert.ok(extra.unbalanced);
    assert.strictEqual(extra.lines[3], '$x = 1;');
});

test('an unterminated string does not swallow the rest of the file', () => {
    const result = formatPhp('<?php\n$a = "unterminated;\n$b = 2;\n');
    assert.strictEqual(result.lines.length, 4);
});
