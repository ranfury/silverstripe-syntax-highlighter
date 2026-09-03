# Enhanced Silverstripe Templates

Supercharge your Silverstripe development in VS Code! This extension brings vibrant syntax highlighting to `.ss` template files, making your code pop with colour and clarity. Say goodbye to old and broken extensions and hello to a coding experience that's as dynamic as your Silverstripe sites.

## See for yourself

Open any `.ss` file in VS Code and watch the magic happen! Syntax highlighting kicks in automatically for all Silverstripe goodies.

```ss
<!doctype html>
<html lang="en-NZ">
    <head>
        <title>$Title</title>
        <%-- This is a Silverstripe comment --%>
    </head>
    <body>
        <h1>$PageTitle</h1>

        <%-- Variable examples --%>
        <p>Welcome $FirstName $LastName!</p>
        <p>User email: $Email</p>
        <p>Complex variable: $User.Profile.Avatar.URL</p>
        <p>Method call: $User.getFullName()</p>

        <%-- Control structures with operators --%>
        <% if $Content || not $HideDetails %>
            <div class="welcome">
                <p>Welcome to our site!</p>
            </div>
        <% end_if %>

        <% if $Articles.Count %>
            <% loop $Articles %>
                <article>
                    <h2>$Title</h2>
                    <p>$Content.Summary(100)</p>
                    <% if $Image %>
                        <img src="{$Image.Fill(200,200).Convert('webp').URL}" alt="{$Image.Title.ATT}">
                    <% end_if %>
                </article>
            <% end_loop %>
        <% end_if %>

        <%-- Include and require --%>
        <% include SiteNavigation %>
        <% require css('themes/mytheme/css/layout.css') %>

        <%-- Caching --%>
        <% cached 'navigation', $LastEdited %>
            <% include SiteNavigation %>
        <% end_cached %>

        <script>
            // JavaScript code here
            console.log('Page loaded');
        </script>

        <style>
            /* CSS styles here */
            body { font-family: Arial, sans-serif; }
        </style>
    </body>
</html>
```

## Go to Definition

Ctrl/Cmd-click, or press <kbd>F12</kbd>, on:

| In your template | Jumps to |
| --- | --- |
| `$Subtitle` | the `'Subtitle'` entry in `private static $db` |
| `$HeroImage` | the `has_one` / `has_many` / `many_many` entry |
| `$ReadingTime` | `public function getReadingTime()` |
| `$Title` | `SiteTree::$db` in `vendor/`, found through your class's ancestry |
| `<% include Navigation %>` | `.../templates/**/Includes/Navigation.ss` |
| `<%t App.GREETING %>` | the entry in your `lang/*.yml` files |

Quoted arguments are never navigable. A string passed to a method or a tag is a value,
not a reference, so nothing inside `{$getStyleTag("themes/main/app.css")}` is clickable
except `getStyleTag` itself. An *unquoted* variable argument still is, so
`$List.Filter('TypeID', $CategoryID)` navigates from `$CategoryID`.

The class a template renders against is inferred from its path, so
`app/templates/App/PageTypes/Layout/HomePage.ss` resolves against
`App\PageTypes\HomePage` — and, because Silverstripe renders a page with its
controller as the top-level scope, `App\PageTypes\HomePageController` as well.

Members are found wherever Silverstripe would actually find them:

- up the inheritance chain, including into `vendor/`;
- in `use`d **traits**, which is how every image manipulation (`Fill`, `ScaleMaxWidth`,
  `URL`) reaches `File`;
- in **`Extension` classes wired up in `_config/*.yml`**, which is how a lot of
  project-specific API gets attached;
- in `$db`, `$casting`, relations, and `DataObject`'s built-in `$fixed_fields`
  (`$ID`, `$ClassName`, `$Created`, `$LastEdited`).

Lists built from `ArrayData` carry no class of their own, but their keys are right
there in the source, so they resolve to the line that declares them:

```php
$list->push(new ArrayData([
    'CategoryName' => $category->Name,       // <-- $CategoryName jumps here
    'Items' => TaxonomyTerm::get()->filter(...),
]));
```

…and because the value's type is traced too, `<% loop $Items %>` knows it is looping
`TaxonomyTerm`.

Scope narrowing means variables resolve against the right class inside blocks:

```ss
<% loop $Testimonials %>   <%-- has_many Testimonial::class --%>
    <p>$Quote</p>          <%-- resolves on App\Models\Testimonial --%>
    <p>$Up.Subtitle</p>    <%-- $Up walks back out to the page class --%>
<% end_loop %>
```

`$Up`, `$Top` and `$Me` are tracked through nested `<% loop %>` and `<% with %>`
blocks. List-shaping calls are seen through, so `<% loop $Items.Sort('Name') %>` narrows
scope exactly as `<% loop $Items %>` does, and `$Items.Count` is reported as an
`SS_List` method rather than guessing at some unrelated class. Fluent chains follow
`@return static` and see past interface return types, so `$Image.Fill(400,300).URL`
lands on `getURL()` even though `Fill()` is declared `@return AssetContainer`.

Some things genuinely cannot be resolved statically — extensions registered in PHP with
`add_extension()`, and variables passed in as `<% include Foo Bar=$Baz %>` arguments.
Those fall back to a ranked list of candidates.

Shared includes have no class of their own. Pin one with a hint comment:

```ss
<%-- @var App\PageTypes\HomePage --%>
```

Without a hint the extension still offers every matching member in the workspace,
ranked with your own code above `vendor/`. Hovering a variable shows what it resolved
to, which is the quickest way to see why a jump went where it did.

## Format Document

**Format Document** (<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd>) re-indents `.ss`
files: HTML, SVG, Silverstripe blocks, multi-line attribute lists, and `<script>` /
`<style>` bodies. It also tidies whitespace inside tags, so `<%if $X%>` becomes
`<% if $X %>`.

It is deliberately conservative — it only ever changes leading and trailing
whitespace, never moves anything between lines, and leaves `<pre>` and `<textarea>`
content byte-for-byte alone, so formatting can never change what a template renders.

## PHP files

Silverstripe is PHP as much as it is templates, and VS Code's built-in PHP support has a
gap: its indentation rules only describe alternative syntax (`if:` … `endif;`) and say
nothing about braces. Pressing <kbd>Enter</kbd> still works, because the editor falls
back to bracket matching — but **Reindent Lines** uses those rules alone, so it flattened
every brace-indented file.

This extension contributes the missing brace, bracket and parenthesis rules, so
`editor.action.reindentlines` works on PHP. Nothing else about VS Code's PHP support is
touched: comments, brackets, word selection and docblock behaviour all still come from
the built-in configuration.

**Format Document** on a `.php` file re-indents it properly. Unlike the rules above it
tracks state, so it also handles the three things regex rules cannot express:

```php
$fields->addFieldsToTab('Root.Main', [   // several brackets on one line indent once
    UploadField::create('Image')
        ->setIsMultiUpload(false)        // a fluent chain continues one level in
        ->setFolderName('Images'),
]);

switch ($mode) {
    case 'a':                            // case bodies indent past their label
        $this->a();
        break;
}
```

It changes leading and trailing whitespace and nothing else — it never reorders, wraps
or restyles code, and `<pre>`-like content (heredocs, nowdocs and inline HTML outside
`<?php`) is preserved byte-for-byte. That means it composes with a real style fixer such
as PHP-CS-Fixer rather than fighting it.

### Reindent Lines cannot match it

**Format Document** and **Reindent Lines** give different results, and the difference is
in VS Code itself rather than in these rules. Two things stop `editor.action.reindentlines`
matching the formatter:

- It **skips any line whose first token is a string**, so an array entry such as
  `'PageHeading' => 'Varchar(255)',` sitting at column 0 is never touched. Worse, that is
  self-perpetuating: once a line is at column 0 reindent can never bring it back. (Lines
  that already have some indentation start with a whitespace token, so they are fixed
  normally — which is why one entry can stay at column 0 while the rest line up.)
- Indentation rules are per-line regular expressions, so they cannot see that
  `->setDescription(...)` continues the statement above it. Fluent chains lose their
  extra level. VS Code's own TypeScript configuration has the same limitation.

If a file already has string-leading lines stranded at column 0, run **Format Document**
once to repair it; after that reindent behaves on everything except chains.

To get formatter-quality indentation from a keystroke, use
**Silverstripe: Fix Indentation**. It runs the formatter on the current selection, or the
whole file if nothing is selected, works in both `.ss` and `.php`, and — unlike Format
Document — never asks which formatter to use. Bind it to whatever key you had on Reindent
Lines:

```jsonc
// keybindings.json
{
    "key": "cmd+k cmd+i",
    "command": "silverstripe.fixIndentation",
    "when": "editorTextFocus && (editorLangId == silverstripe || editorLangId == php)"
}
```

If another extension already formats your PHP — Intelephense does, for instance — VS Code
will ask which to use the first time. Pick one with:

```jsonc
"[php]": { "editor.defaultFormatter": "Ranfurly.enhanced-silverstripe-templates" }
```

or set `silverstripe.php.format.enable` to `false` to leave PHP formatting alone
entirely. The indentation rules are independent of this setting and always apply.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `silverstripe.index.enable` | `true` | Index the workspace so definitions can be resolved. |
| `silverstripe.index.includeVendor` | `true` | Also index `vendor/*/*/src` and `vendor/*/*/code`, so inherited members resolve. Turn off on very large projects. |
| `silverstripe.index.maxFiles` | `20000` | Cap on PHP files indexed per pass. |
| `silverstripe.links.enable` | `true` | Clickable links for `<% include %>` names. |
| `silverstripe.hover.enable` | `true` | Hover documentation for variables. |
| `silverstripe.format.normaliseTagSpacing` | `true` | Tidy whitespace inside tags when formatting. |
| `silverstripe.php.format.enable` | `true` | Provide an indentation-only **Format Document** for PHP files. |

Run **Silverstripe: Reindex Project** from the Command Palette after large changes,
**Silverstripe: Fix Indentation** to re-indent the current file or selection, and
**Silverstripe: Show Extension Log** to see what was indexed. Indexing reads PHP source,
so it only runs in [trusted workspaces](https://code.visualstudio.com/docs/editor/workspace-trust);
highlighting, indentation and formatting always work.

## Custom Styling

Want to tweak the look? Let's make it yours!

1. Inspect the TextMate scopes: Press `Cmd/Ctrl + Shift + P` to open the Command Palette, then search for "Developer: Inspect Editor Tokens and Scopes".
2. Add customizations to your `settings.json`. Below are some examples to get you started:

```jsonc
"editor.tokenColorCustomizations": {
    "textMateRules": [
        {
            "scope": "punctuation.definition.silverstripe",
            "settings": {
                "foreground": "#30afae",
            }
        },
        {
            "scope": "keyword.silverstripe",
            "settings": {
                "foreground": "#559ad1",
            }
        },
        {
            "scope": "entity.name.type.silverstripe",
            "settings": {
                "foreground": "#C695C6",
                "fontStyle": "italic"
            }
        },
        {
            "scope": "entity.name.silverstripe variable.silverstripe",
            "settings": {
                "foreground": "#f6ac81"
            }
        },
        {
            "scope": "entity.name.function.silverstripe",
            "settings": {
                "foreground": "#dcc665",
            }
        },
        {
            "scope": "comment.block.silverstripe meta.silverstripe",
            "settings": {
                "foreground": "#9E9E9E",
                "fontStyle": "italic"
            }
        },
    ]
}
```

Experiment and have fun personalizing your theme!

## Development

```sh
npm install
npm run lint             # eslint
npm run test:unit        # indentation, parser, resolver and formatter tests (no VS Code needed)
npm run test:integration # drives the real extension inside VS Code
npm test                 # all of the above
```

Press <kbd>F5</kbd> to launch an Extension Development Host.

## Extension Development & Local Installation

Building locally? Here's how to get it running:

1. Run `vsce package` in this folder to whip up a `.vsix` file.
2. Install in VS Code: `code --install-extension <your-vsix-file>`
3. Open a `.ss` file and bask in the glory.
4. For updates, just re-package and re-install—easy peasy!

## File Association

No setup needed! The extension auto-activates for `.ss` files. Just code away.

## License

MIT – Free as a Silverstripe template!
