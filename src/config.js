'use strict';

/**
 * Reads `extensions:` declarations out of Silverstripe's YAML config.
 *
 * A lot of template-visible API is attached this way rather than by inheritance:
 *
 *     SilverStripe\Control\Controller:
 *       extensions:
 *         - App\Extensions\ControllerExtension
 *
 * A hand-rolled line scanner is enough — only two nesting levels matter, and pulling in
 * a YAML dependency for it would be out of proportion.
 */

/** A key at column 0 that names a class, e.g. `App\Pages\HomePage:`. */
const TARGET = /^([A-Za-z_\\][A-Za-z0-9_\\]*)\s*:\s*(?:#.*)?$/;
/** `extensions:` nested under a target. */
const EXTENSIONS_KEY = /^(\s+)extensions\s*:\s*(?:#.*)?$/;
/** `- App\Extensions\Foo` or `someKey: App\Extensions\Foo`. */
const LIST_ITEM = /^\s*-\s*(?:['"]?)([A-Za-z_\\][A-Za-z0-9_\\]*)(?:['"]?)\s*(?:#.*)?$/;
const MAP_ITEM = /^\s*[A-Za-z0-9_-]+\s*:\s*(?:['"]?)([A-Za-z_\\][A-Za-z0-9_\\]*)(?:['"]?)\s*(?:#.*)?$/;

/**
 * @returns {Map<string, string[]>} lowercased target class -> extension class names.
 */
function parseConfigYaml(text) {
    const found = new Map();
    const lines = text.split(/\r?\n/);

    let target = null;
    let extensionsIndent = -1;

    for (const line of lines) {
        if (!line.trim() || line.trim().startsWith('#')) continue;

        // `---` separates the header block from the config body.
        if (line.startsWith('---')) {
            target = null;
            extensionsIndent = -1;
            continue;
        }

        const targetMatch = TARGET.exec(line);
        if (targetMatch) {
            target = targetMatch[1].replace(/^\\+/, '');
            extensionsIndent = -1;
            continue;
        }
        if (!target) continue;

        const extensionsMatch = EXTENSIONS_KEY.exec(line);
        if (extensionsMatch) {
            extensionsIndent = extensionsMatch[1].length;
            continue;
        }
        if (extensionsIndent === -1) continue;

        const indent = line.length - line.trimStart().length;
        if (indent <= extensionsIndent) {
            // Back out to a sibling key; the extensions list has ended.
            extensionsIndent = -1;
            continue;
        }

        const item = LIST_ITEM.exec(line) || MAP_ITEM.exec(line);
        if (!item) continue;
        const key = target.toLowerCase();
        if (!found.has(key)) found.set(key, []);
        found.get(key).push(item[1].replace(/^\\+/, ''));
    }

    return found;
}

module.exports = { parseConfigYaml };
