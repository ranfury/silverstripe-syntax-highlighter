# Change Log

All notable changes to the "silverstripe-syntax-highlighter" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.1.0]

### Added

- **Go to Definition** for `$Variables` (`$db`, `$casting`, relations, methods and the
  `$Foo` -> `getFoo()` convention), `<% include %>` names and `<%t %>` translation keys.
  Quoted arguments are deliberately not navigable — a string passed to a method or a tag
  is a value, not a reference — but an unquoted variable argument such as the
  `$CategoryID` in `$List.Filter('TypeID', $CategoryID)` is.
- A background index of workspace PHP classes and templates that follows inheritance
  into `vendor/`, so members inherited from `SiteTree` and `DataObject` resolve.
- Scope narrowing inside `<% loop %>` / `<% with %>`, with `$Up`, `$Top` and `$Me`
  tracked through nesting, and chains followed through relations, typed methods and
  `@return static`.
- Members are resolved the way Silverstripe resolves them: through the page's
  controller as well as the page, through `use`d traits (so image manipulations such as
  `Fill` and `ScaleMaxWidth` resolve), through `Extension` classes wired up in
  `_config/*.yml`, and through `DataObject`'s built-in `$fixed_fields` (`$ID`,
  `$ClassName`, `$Created`, `$LastEdited`).
- Keys of `ArrayData` records built inside a method resolve to the line that declares
  them, and the value's type is traced — so a list built with
  `'Items' => TaxonomyTerm::get()->filter(...)` lets `<% loop $Items %>` narrow to
  `TaxonomyTerm`.
- `SS_List` calls are handled as list operations rather than member lookups:
  `<% loop $Items.Sort('Name') %>` narrows scope exactly as `<% loop $Items %>` does,
  and `$Items.Count` reports a list method instead of jumping to an unrelated class.
- Interface and union return types resolve to the concrete class, so
  `$Image.Fill(400,300).URL` works even though `Fill()` is `@return AssetContainer`.
- `<%-- @var App\Pages\HomePage --%>` hints to pin the class a shared include renders
  against.
- Ctrl/Cmd-clickable document links for `<% include %>` names, and hovers showing what a
  variable resolved to.
- **Suggestions**, driven by the same index as Go to Definition: `$` offers the members
  of the class in scope, `$Foo.` offers the members of whatever it resolves to (or
  `SS_List` methods for a list) plus casting helpers, `<% ` offers block tags with the
  matching closer first, and `<% include ` offers every template in the workspace. Scope
  narrows inside `<% loop %>` and `<% with %>` exactly as it does for navigation.
  Suggestions are ranked with your own class first and `vendor` last, and nothing at all
  is offered where the template's class cannot be determined.
  A `getFoo()` method is offered both as `$Foo` and as `$getFoo`, the idiomatic spelling
  first; methods with any other prefix (`hasBanner()`, `isPublished()`) are offered as
  written. Controller members are included, falling back to the nearest controller in the
  page's ancestry when a page type has none of its own. Suggestions wait for one
  character after the `$` rather than listing every member.
- `editor.suggest.snippetsPreventQuickSuggestions` now defaults to `false` for `.ss`
  files, so suggestions still appear while tabbing through a snippet's placeholders.
- Template globals carry their type, so `$SiteConfig.ContactUsLink`,
  `<% with $SiteConfig %>` and `$CurrentMember.FirstName` navigate and complete like any
  other object — including members added to them by traits and `_config` extensions.
  Globals that evaluate to a string (`$ThemeDir`, `$BaseHref`, `$Layout`, …) carry no
  class and are not treated as though they had members. `$Up.` and `$Top.` complete
  against the scope they hop to.
- Suggestions now include members that arrive through **traits** and through
  `_config` **extensions**, not just the inheritance chain. Lookup already searched
  those, so a field such as `$SiteConfig.TermsLink` would jump to its declaration but
  never appear as a suggestion. Both now share one enumerator, with a test asserting they
  agree.
- **Format Document** and **Format Selection** for `.ss` files: re-indents HTML, SVG,
  Silverstripe blocks, multi-line attribute lists and `<script>` / `<style>` bodies,
  and tidies whitespace inside tags. Only leading and trailing whitespace changes,
  nothing moves between lines, and `<pre>` / `<textarea>` content is preserved exactly.
- Settings under `silverstripe.*`, plus **Reindex Project** and **Show Extension Log**
  commands.
- **PHP indentation rules.** VS Code's built-in PHP configuration describes only
  alternative syntax (`if:` … `endif;`), so `editor.action.reindentlines` flattened every
  brace-indented file. The missing brace, bracket and parenthesis rules are contributed
  here; everything else about PHP — comments, brackets, word selection, docblocks — is
  left to the built-in configuration.
- **Format Document for PHP**, indentation only. It tracks state rather than matching
  per-line patterns, so it handles fluent method chains, `switch`/`case` bodies and
  several brackets opened on one line, none of which indentation rules can express.
  Heredocs, nowdocs and inline HTML are preserved byte-for-byte, and nothing but leading
  and trailing whitespace ever changes, so it composes with PHP-CS-Fixer rather than
  competing with it. Turn it off with `silverstripe.php.format.enable` if another
  extension already formats your PHP.
- **Silverstripe: Fix Indentation** command, applying the formatter to the current
  selection — or the whole file if nothing is selected — in both `.ss` and `.php`.
  VS Code's own **Reindent Lines** cannot match the formatter: it skips any line whose
  first token is a string (so an array entry stranded at column 0 stays there for good),
  and indentation rules are per-line regexes that cannot see a fluent chain continuing
  the statement above. Bind this command to your Reindent Lines key to get formatter
  behaviour from a keystroke, without Format Document's "which formatter?" prompt.
- A test suite: indentation, parser, resolver and formatter unit tests, plus
  integration tests that drive the real extension in VS Code.

### Fixed

- **Self-closing tags no longer increase indentation.** `<path/>`, `<circle/>`,
  `<rect/>`, `<use/>` and `<stop/>` each added an indent level, which is why SVG icons
  and their children drifted right. The guard against self-closing tags sat *after* the
  `>`, so it only ever saw the rest of the line, never the tag's own `/` — which
  `[^>]*` had already swallowed as an attribute character.
- Pressing <kbd>Enter</kbd> after a self-closing tag, or after a void element such as
  `<img>` or `<br>`, no longer adds an indent level.
- `class Foo extends \Page` — a parent named with a leading backslash — was not parsed,
  so nothing inherited from it resolved.

### Unchanged

- The TextMate grammar. No scope names changed, so syntax colours are exactly as
  before.

## [0.0.35] and earlier

- Syntax highlighting and snippets for `.ss` templates.