const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const config = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', 'php-language-configuration.json'), 'utf8')
);
const increase = new RegExp(config.indentationRules.increaseIndentPattern);
const decrease = new RegExp(config.indentationRules.decreaseIndentPattern);
const unIndented = new RegExp(config.indentationRules.unIndentedLinePattern);

/** Mirrors `editor.action.reindentlines`. */
function reindent(source) {
    let level = 0;
    return source.split('\n').map((raw) => {
        const text = raw.trim();
        if (!text) return '';
        if (unIndented.test(raw)) return raw.replace(/\s+$/, '');
        if (decrease.test(text)) level = Math.max(0, level - 1);
        const out = '    '.repeat(level) + text;
        if (increase.test(text)) level += 1;
        return out;
    }).join('\n');
}

function stable(name, input) {
    test(name, () => {
        const source = input.replace(/^\n/, '').replace(/\n$/, '');
        assert.strictEqual(reindent(source), source);
    });
}

test('braces drive indentation', () => {
    for (const line of ['class A {', 'function f() {', '{', 'if ($x) {', '} else {', '$a = [', 'foo(']) {
        assert.ok(increase.test(line), `should increase: ${line}`);
    }
    for (const line of ['}', '};', ']', '];', ')', ');', '} else {', '} catch (E $e) {']) {
        assert.ok(decrease.test(line), `should decrease: ${line}`);
    }
});

test('a brace inside a string or comment does not indent', () => {
    for (const line of ['$a = "a { b";', "$b = 'c { d';", '// if ($x) {', '$c = 1; // {']) {
        assert.ok(!increase.test(line), `should not increase: ${line}`);
    }
});

test('single-line blocks do not indent', () => {
    for (const line of ['$x = [1, 2];', 'if ($a) { return; }', 'foo($bar);']) {
        assert.ok(!increase.test(line), `should not increase: ${line}`);
    }
});

test('alternative syntax still works', () => {
    for (const line of ['if ($x):', 'foreach ($a as $b):', 'while ($x):', 'else:']) {
        assert.ok(increase.test(line), `should increase: ${line}`);
    }
    for (const line of ['endif;', 'endforeach;', 'endwhile;', 'else:']) {
        assert.ok(decrease.test(line), `should decrease: ${line}`);
    }
});

test('docblock lines are left alone', () => {
    for (const line of ['     * Text', '     */', '    * Text']) {
        assert.ok(unIndented.test(line), `should be left alone: ${line}`);
    }
});

stable('a class with methods', `
<?php

namespace App;

class Thing extends \\Page
{
    private static $db = [
        'Title' => 'Varchar(255)',
    ];

    public function doThing($input)
    {
        if ($input) {
            foreach ($input as $item) {
                $this->handle($item);
            }
        } else {
            return null;
        }
        return $this;
    }
}`);

stable('try/catch and closures', `
<?php
try {
    $x = array_filter($y, function ($v) {
        return $v !== null;
    });
} catch (Exception $e) {
    report($e);
}`);

test('a real project file re-indents to itself', () => {
    const fixture = path.join(__dirname, '..', 'fixtures', 'project', 'app', 'src', 'Toast', 'Pages', 'CollectionPage.php');
    const source = fs.readFileSync(fixture, 'utf8').replace(/\n$/, '');
    assert.strictEqual(reindent(source), source);
});
