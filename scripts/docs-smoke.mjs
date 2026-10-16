import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';

// Exercise the actual Workers deployment, including assets, prerendered routes, and the search index.
const socket = createServer();
await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => resolve(null));
});
const address = socket.address();
assert.ok(address !== null && typeof address !== 'string');
const port = address.port;
await new Promise((resolve) => socket.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const worker = spawn(
    process.execPath,
    [
        'node_modules/wrangler/bin/wrangler.js',
        'dev',
        '--config',
        'wrangler.jsonc',
        '--local',
        '--ip',
        '127.0.0.1',
        '--port',
        String(port),
        '--inspector-port',
        '0',
    ],
    {
        cwd: new URL('../apps/docs/', import.meta.url),
        env: { ...process.env, WRANGLER_SEND_METRICS: 'false', BROWSER: 'none' },
        stdio: ['ignore', 'pipe', 'pipe'],
    },
);
let log = '';
worker.stdout.on('data', (chunk) => {
    log += chunk;
});
worker.stderr.on('data', (chunk) => {
    log += chunk;
});
worker.on('error', (error) => {
    log += error.message;
});
const exited = new Promise((resolve) => worker.once('exit', resolve));
const { ref } = JSON.parse(
    await readFile(new URL('../apps/docs/dist/assets/refquill/build.json', import.meta.url), 'utf8'),
);
/** @param {string} path @param {RegExp} type */
async function read(path, type) {
    const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(30_000) });
    assert.equal(response.status, 200, `${path}: ${response.status}`);
    assert.match(response.headers.get('content-type') ?? '', type, path);
    return response;
}
async function readHtml(path) {
    const html = await (await read(path, /text\/html/)).text();
    assert.match(html.slice(0, 1024), /<meta charset="utf-8"\s*\/?\s*>/i, `${path}: declare UTF-8 early`);
    assert.match(
        html,
        /<meta name="viewport" content="width=device-width,\s*initial-scale=1"\s*\/?\s*>/i,
        `${path}: use the device viewport without restricting zoom`,
    );
    return html;
}
try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
        if (worker.exitCode !== null) throw new Error(`Worker exited: ${log}`);
        try {
            const response = await fetch(`${origin}/refquill/`, { signal: AbortSignal.timeout(1_000) });
            if (response.ok) {
                ready = true;
                break;
            }
        } catch {
            /* Waiting for Wrangler to bind its local port. */
        }
        await setTimeout(500);
    }
    assert.ok(ready, `Worker did not become ready:\n${log}`);
    const bare = await read('/refquill', /text\/html/);
    assert.equal(new URL(bare.url).pathname, '/refquill/');
    const home = await readHtml('/refquill/');
    assert.match(home, /API documentation from your source/);
    assert.match(home, /href="\/refquill\/docs\/0\.x"/);
    assert.doesNotMatch(
        home,
        /class="[^"]*\b(?:docs-sidebar|mobile-sidebar|mobile-navigation|section-trigger|version-trigger)\b/,
    );
    assert.doesNotMatch(home, /(?:href|src)="\/(?:docs|assets|RSC|llms)/);
    const asset = home.match(/(?:src|href)="(\/refquill\/assets\/[^" ]+\.js)"/);
    assert.ok(asset, 'The landing page must reference a deployed JS asset');
    assert.ok(asset[1]);
    await read(asset[1], /javascript/);
    await read('/refquill/RSC/R/docs/0.x.txt', /text\/x-component/);
    for (const name of ['config', 'document', 'resolved', 'reference']) {
        const schema = await (await read(`/refquill/schema/${name}-v1.json`, /application\/json/)).json();
        assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    }
    const defaultGuide = await readHtml('/refquill/docs');
    assert.match(defaultGuide, /https:\/\/docs\.nickwelsh\.me\/refquill\/docs\/0\.x/);
    const guide = await readHtml('/refquill/docs/0.x');
    assert.match(guide, /class="docs-sidebar"/);
    assert.ok(guide.includes('https://docs.nickwelsh.me/refquill/docs/0.x'));
    assert.doesNotMatch(guide, /\/refquill\/refquill\//);
    for (const suffix of ['api', 'schemas/document', 'manpage']) {
        await read(`/refquill/docs/0.x/${suffix}`, /text\/html/);
    }
    const manual = await readHtml('/refquill/docs/0.x/manpage');
    assert.ok(manual.includes(`/blob/${ref}/packages/cli/man/refquill.1`));
    const index = await (await read('/refquill/llms.txt', /text\/plain/)).text();
    assert.doesNotMatch(index, /\/docs\/main(?:[\s/)#]|$)/);
    const pages = [
        ...new Set(
            [...index.matchAll(/\]\(https:\/\/docs\.nickwelsh\.me(\/refquill\/docs[^)#]*)\)/g)].map(
                (match) => match[1],
            ),
        ),
    ];
    assert.ok(pages.length > 20, 'The generated index must include authored and generated pages');
    // A site-wide link crawl catches stale authored links and missing generated pages before deployment.
    const pending = [...pages];
    await Promise.all(
        Array.from({ length: 4 }, async () => {
            let path;
            while ((path = pending.pop()) !== undefined) {
                const html = await readHtml(path);
                assert.doesNotMatch(html, /\/refquill\/refquill\//, path);
                for (const match of html.matchAll(/href="(\/refquill\/docs[^"?#]*)/g)) {
                    assert.ok(match[1]);
                    const target = match[1].replace(/\/$/, '');
                    assert.ok(
                        ['/refquill/docs', '/refquill/docs/0.x'].includes(target) ||
                            pages.includes(target),
                        `Broken documentation link from ${path}: ${target}`,
                    );
                }
            }
        }),
    );
    await read('/refquill/llms-full.txt', /text\/plain/);
    const markdown = await (await read('/refquill/llms.mdx/docs/0.x/content.md', /text\/markdown/)).text();
    assert.match(markdown, /Refquill/);
    const searchIndex = await (await read('/refquill/api/search', /application\/json/)).json();
    assert.equal(searchIndex.type, 'advanced');
    const image = await read('/refquill/og/docs/0.x/image.webp', /image\/webp/);
    assert.ok((await image.arrayBuffer()).byteLength > 100);
    const removedMain = await fetch(`${origin}/refquill/docs/main`);
    assert.equal(removedMain.status, 404, 'Only the 0.x documentation is published');
    const missing = await fetch(`${origin}/refquill/docs/does-not-exist`);
    assert.equal(missing.status, 404);
    console.log(`Worker smoke check passed: ${pages.length} pages, assets, search, Markdown, social image, and 404.`);
} catch (error) {
    console.error(log);
    throw error;
} finally {
    worker.kill('SIGTERM');
    await Promise.race([exited, setTimeout(5_000)]);
}
