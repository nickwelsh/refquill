import { createHighlighter } from 'shiki';
import type { ShikiTransformer } from 'shiki';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { Fragment } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { CodeBlock } from './code-block';

const highlighter = createHighlighter({
    themes: ['github-light', 'github-dark'],
    langs: ['typescript', 'php', 'rust', 'json', 'shellscript'],
});

export async function HighlightedCode({
    code,
    language,
    transformers = [],
    components,
}: {
    code: string;
    language: string;
    transformers?: Array<ShikiTransformer>;
    components?: Parameters<typeof toJsxRuntime>[1]['components'];
}) {
    const shiki = await highlighter;
    return (
        <>
            {toJsxRuntime(
                shiki.codeToHast(code, {
                    lang: shiki.getLoadedLanguages().includes(language) ? language : 'text',
                    themes: { light: 'github-light', dark: 'github-dark' },
                    defaultColor: false,
                    transformers,
                }),
                { Fragment, jsx, jsxs, components: { pre: CodeBlock, ...components } },
            )}
        </>
    );
}
