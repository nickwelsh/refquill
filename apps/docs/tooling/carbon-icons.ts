import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parse as parseJsx, parseExpression } from '@babel/parser';
import { createProcessor } from '@mdx-js/mdx';
import type { Plugin, ViteDevServer } from 'vite';

const publicId = 'virtual:carbon-icons';
const resolvedId = `\0${publicId}`;

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object';
}
function visit(value: unknown, onNode: (node: Record<string, unknown>) => void): void {
    if (Array.isArray(value)) {
        for (const child of value) {
            visit(child, onNode);
        }
    } else if (isRecord(value)) {
        if (typeof value['type'] === 'string') {
            onNode(value);
        }
        for (const child of Object.values(value)) {
            visit(child, onNode);
        }
    }
}
function attributeValue(node: Record<string, unknown>, jsx: boolean): unknown {
    const { attributes } = node;
    if (!Array.isArray(attributes)) {
        return undefined;
    }
    for (const attribute of attributes) {
        if (isRecord(attribute)) {
            const { name } = attribute;
            if (jsx ? isRecord(name) && name['name'] === 'name' : name === 'name') {
                return attribute['value'];
            }
        }
    }
    return undefined;
}

export function collectCarbonIcons(text: string, filename: string): Array<string> {
    const names = new Set<string>();
    const add = (value: unknown) => {
        if (typeof value !== 'string') {
            return;
        }
        const name = value.replace(/^carbon[:/]/u, '');
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name)) {
            throw new Error(`Invalid Carbon icon "${value}" in ${filename}. Use Carbon kebab-case names.`);
        }
        names.add(name);
    };
    let body = text;
    if (/\.mdx?$/u.test(filename)) {
        const frontmatter = /^---\r?\n(?<yaml>[\s\S]*?)\r?\n---/u.exec(text);
        if (frontmatter) {
            const data: unknown = parseYaml(frontmatter.groups?.['yaml'] ?? '');
            if (isRecord(data)) {
                add(data['icon']);
            }
            body = text.slice(frontmatter[0].length);
        }
    }
    if (path.basename(filename) === 'meta.json') {
        const data: unknown = JSON.parse(text);
        if (isRecord(data)) {
            add(data['icon']);
        }
    }
    if (filename.endsWith('.tsx')) {
        visit(parseJsx(text, { sourceType: 'module', plugins: ['typescript', 'jsx'] }), (node) => {
            const tag = node['name'];
            if (
                node['type'] !== 'JSXOpeningElement' ||
                !isRecord(tag) ||
                tag['type'] !== 'JSXIdentifier' ||
                tag['name'] !== 'Icon'
            ) {
                return;
            }
            const value = attributeValue(node, true);
            if (isRecord(value) && value['type'] === 'StringLiteral') {
                add(value['value']);
            } else if (
                isRecord(value) &&
                isRecord(value['expression']) &&
                value['expression']['type'] === 'StringLiteral'
            ) {
                add(value['expression']['value']);
            } else {
                throw new Error(
                    `Icon names must be static literals in ${filename}. Import dynamic icons from ~icons/carbon directly.`,
                );
            }
        });
    } else if (/\.mdx?$/u.test(filename)) {
        visit(createProcessor().parse(body), (node) => {
            if (
                (node['type'] !== 'mdxJsxFlowElement' && node['type'] !== 'mdxJsxTextElement') ||
                node['name'] !== 'Icon'
            ) {
                return;
            }
            const value = attributeValue(node, false);
            if (typeof value === 'string') {
                add(value);
            } else if (isRecord(value) && typeof value['value'] === 'string') {
                const expression = parseExpression(value['value']);
                if (expression.type !== 'StringLiteral') {
                    throw new Error(`Icon names must be static literals in ${filename}.`);
                }
                add(expression.value);
            } else {
                throw new Error(`Icon requires a literal name in ${filename}.`);
            }
        });
    }
    return [...names].toSorted();
}

export function carbonIcons(): Plugin {
    let root = '';
    const invalidate = (server: ViteDevServer, filename: string) => {
        if (!/\.(?:mdx?|json|tsx)$/u.test(filename)) {
            return;
        }
        if (
            !filename.startsWith(path.resolve(root, 'content') + path.sep) &&
            !filename.startsWith(path.resolve(root, 'src') + path.sep)
        ) {
            return;
        }
        for (const environment of Object.values(server.environments)) {
            const module = environment.moduleGraph.getModuleById(resolvedId);
            if (module) {
                environment.moduleGraph.invalidateModule(module);
                environment.hot.send({ type: 'full-reload' });
            }
        }
    };
    return {
        name: 'docs:carbon-icons',
        configResolved(config) {
            ({ root } = config);
        },
        resolveId(id) {
            if (id === publicId) {
                return resolvedId;
            }
            return null;
        },
        load(id) {
            if (id !== resolvedId) {
                return null;
            }
            const names = new Set<string>();
            const walk = (dir: string) => {
                for (const entry of readdirSync(dir, { withFileTypes: true })) {
                    const filename = path.resolve(dir, entry.name);
                    if (entry.isDirectory()) {
                        walk(filename);
                    } else if (/\.(?:mdx?|json|tsx)$/u.test(entry.name)) {
                        this.addWatchFile(filename);
                        for (const name of collectCarbonIcons(readFileSync(filename, 'utf8'), filename)) {
                            names.add(name);
                        }
                    }
                }
            };
            walk(path.resolve(root, 'content'));
            walk(path.resolve(root, 'src'));
            const icons = [...names].toSorted();
            return `${icons
                .map((name, index) => `import I${index} from '~icons/carbon/${name}';`)
                .join('\n')}\nexport const carbonIcons = {${icons
                .map((name, index) => `${JSON.stringify(name)}: I${index}`)
                .join(',')}};`;
        },
        configureServer(server) {
            const onFile = (filename: string) => invalidate(server, filename);
            server.watcher.on('add', onFile).on('unlink', onFile);
            server.httpServer?.once('close', () => {
                server.watcher.off('add', onFile).off('unlink', onFile);
            });
        },
        handleHotUpdate(ctx) {
            invalidate(ctx.server, ctx.file);
        },
    };
}
