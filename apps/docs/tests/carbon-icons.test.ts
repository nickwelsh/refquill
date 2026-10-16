import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectCarbonIcons } from '../tooling/carbon-icons.ts';

await test('collects and normalizes frontmatter, MDX and metadata icons', () => {
    assert.deepEqual(
        collectCarbonIcons(
            '---\nicon: carbon:rocket\n---\n\n<Icon name="search" />\n<Icon name={"rocket"} />',
            'page.mdx',
        ),
        ['rocket', 'search'],
    );
    assert.deepEqual(collectCarbonIcons('{"icon":"carbon/book"}', 'meta.json'), ['book']);
});

await test('ignores code fences, strings and comments', () => {
    assert.deepEqual(collectCarbonIcons('```mdx\n<Icon name="fake" />\n```\n\n<Icon name="checkmark" />', 'page.mdx'), [
        'checkmark',
    ]);
    assert.deepEqual(
        collectCarbonIcons(
            'const example = \'<Icon name="fake" />\';\n// <Icon name="comment" />\nconst view = <Icon name={"checkmark"} />;',
            'view.tsx',
        ),
        ['checkmark'],
    );
});

await test('rejects dynamic names and malformed imports at compile time', () => {
    assert.throws(() => collectCarbonIcons('<Icon name={dynamic} />', 'page.mdx'), /static literals/u);
    assert.throws(() => collectCarbonIcons('const view = <Icon name={dynamic} />;', 'view.tsx'), /static literals/u);
    assert.throws(() => collectCarbonIcons('---\nicon: ../outside\n---', 'page.mdx'), /Invalid Carbon icon/u);
});
