import assert from 'node:assert/strict';
import test from 'node:test';
import { createProcessor } from '@mdx-js/mdx';
import { applyMdxPreset } from 'fumadocs-mdx/config';
import { getCodeFileIcon, transformerFileIcons } from '../tooling/code-file-icons.ts';

void test('specific configuration filenames take priority over their extensions', () => {
    const configurations = [
        ['.oxlintrc.json', 'oxc'],
        ['.oxfmtrc.json', 'oxc'],
        ['oxlint.config.ts', 'oxc'],
        ['vite.config.ts', 'vite'],
        ['eslint.config.mjs', 'eslint'],
        ['.prettierrc', 'prettier'],
        ['package.json', 'npm'],
        ['pnpm-lock.yaml', 'pnpm'],
    ] as const;
    for (const [filename, icon] of configurations) {
        assert.equal(getCodeFileIcon(filename).name, `file_type_${icon}.svg`);
    }
});

void test('file icons handle paths, compound extensions, theme variants, and unknown files', () => {
    assert.equal(getCodeFileIcon('config/vite.config.ts').name, 'file_type_vite.svg');
    assert.equal(getCodeFileIcon(String.raw`config\VITE.CONFIG.TS`).name, 'file_type_vite.svg');
    assert.equal(getCodeFileIcon('types/index.d.ts').name, 'file_type_typescriptdef.svg');
    assert.equal(getCodeFileIcon('components/Button.tsx').name, 'file_type_reactts.svg');
    assert.equal(getCodeFileIcon('README.md').name, 'file_type_markdown.svg');
    const vite = getCodeFileIcon('vite.config.ts');
    assert.notEqual(vite.lightSrc, vite.src);
    assert.equal(vite.lightSrc?.startsWith('data:image/svg+xml,'), true);
    const unknown = getCodeFileIcon('example.unknown-extension');
    assert.equal(unknown.name, 'default_file.svg');
    assert.match(decodeURIComponent(unknown.src), /<svg\b/u);
});

void test('MDX compilation embeds only resolved icon data on titled code blocks', async () => {
    const options = await applyMdxPreset({
        rehypeCodeOptions: {
            themes: { light: 'github-light', dark: 'github-dark' },
            icon: false,
            transformers: [transformerFileIcons()],
        },
    })('bundler');
    const processor = createProcessor(options);
    const titled = String(await processor.process('```json title=".oxlintrc.json"\n{}\n```'));
    assert.ok(titled.includes('data-file-icon'));
    assert.ok(titled.includes('data:image/svg+xml,'));
    assert.equal(titled.includes('@yutengjing/vscode-icons'), false);
    const languageFallback = String(
        await processor.process('```typescript title="My Title"\nconsole.log(\'hello\');\n```'),
    );
    assert.ok(languageFallback.includes(getCodeFileIcon('My Title', 'typescript').src));
    const untitled = String(await processor.process('```json\n{}\n```'));
    assert.equal(untitled.includes('data-file-icon'), false);
});

void test('unmatched titles fall back to the code language without replacing filename matches', () => {
    for (const [language, icon] of [
        ['typescript', 'typescript'],
        ['ts', 'typescript'],
        ['TSX', 'reactts'],
        ['js', 'js'],
        ['json', 'json'],
        ['python', 'python'],
        ['shell', 'shell'],
        ['bash', 'shell'],
        ['text', 'text'],
    ] as const) {
        assert.equal(getCodeFileIcon('My Title', language).name, `file_type_${icon}.svg`);
    }
    assert.equal(getCodeFileIcon('vite.config.ts', 'json').name, 'file_type_vite.svg');
    assert.equal(getCodeFileIcon('example.unknown-extension', 'ts').name, 'file_type_typescript.svg');
    assert.equal(getCodeFileIcon('My Title', 'unknown-language').name, 'default_file.svg');
});
