import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { DEFAULT_FILE, getIconForFile } from '@yutengjing/vscode-icons';
import manifest from '@yutengjing/vscode-icons/assets/manifest.json' with { type: 'json' };
import type { RehypeCodeOptions } from 'fumadocs-core/mdx-plugins';

const require = createRequire(import.meta.url);
const iconsDirectory = path.dirname(require.resolve('@yutengjing/vscode-icons/assets/icons/default_file.svg'));
const languageIcons: Readonly<Record<string, string>> = manifest.languageIcons;
const languageAliases: Readonly<Record<string, string>> = {
    shell: 'shellscript',
    shellsession: 'shellscript',
    console: 'shellscript',
    text: 'plaintext',
    'c#': 'csharp',
};

export function getCodeFileIcon(filename: string, language = '') {
    const basename = filename.replaceAll('\\', '/').split('/').at(-1) ?? filename;
    const normalizedLanguage = language.toLowerCase();
    const languageId = languageAliases[normalizedLanguage] ?? normalizedLanguage;
    const name =
        getIconForFile(basename) ??
        languageIcons[languageId] ??
        (languageId.length > 0 ? getIconForFile(`file.${languageId}`) : undefined) ??
        DEFAULT_FILE;
    const lightName = name.replace('file_type_', 'file_type_light_');
    const dataUrl = (icon: string) =>
        `data:image/svg+xml,${encodeURIComponent(readFileSync(path.join(iconsDirectory, icon), 'utf8'))}`;
    return {
        name,
        src: dataUrl(name),
        lightSrc:
            lightName !== name && existsSync(path.join(iconsDirectory, lightName)) ? dataUrl(lightName) : undefined,
    };
}

export function transformerFileIcons(): NonNullable<RehypeCodeOptions['transformers']>[number] {
    return {
        name: 'docs:code-file-icons',
        pre(pre) {
            const title: unknown = this.options.meta?.['title'];
            if (typeof title !== 'string') {
                return;
            }
            const icon = getCodeFileIcon(title, this.options.lang);
            pre.properties['data-file-icon'] = icon.src;
            if (icon.lightSrc !== undefined) {
                pre.properties['data-file-icon-light'] = icon.lightSrc;
            }
        },
    };
}
