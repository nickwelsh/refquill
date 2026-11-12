import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// Exercise the adapter actually resolved by the docs framework, not a test-only copy.
const docsRequire = createRequire(new URL('../apps/docs/package.json', import.meta.url));
const wakuRequire = createRequire(docsRequire.resolve('waku/package.json'));
const { Hono } = wakuRequire('hono');
const { serve } = wakuRequire('@hono/node-server');
const { serveStatic } = wakuRequire('@hono/node-server/serve-static');
const { parse } = docsRequire('yaml');

async function startServer(t, app) {
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  await once(server, 'listening');
  return path => new Promise((resolve, reject) => {
    // A raw request path avoids URL normalization hiding adapter regressions.
    const req = request({ hostname: '127.0.0.1', port: server.address().port, path, agent: false }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
      res.on('error', reject);
    });
    req.setTimeout(3000, () => req.destroy(new Error('Local adapter request timed out')));
    req.on('error', reject);
    req.end();
  });
}

test('the docs lockfile keeps every Node adapter at the patched baseline', () => {
  const lock = parse(readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8'));
  const versions = Object.keys(lock.packages).filter(name => name.startsWith('@hono/node-server@'));
  assert.ok(versions.length > 0, 'expected the Waku Node adapter in the lockfile');
  for (const name of versions) {
    const version = name.slice('@hono/node-server@'.length);
    assert.match(version, /^\d+\.\d+\.\d+$/);
    const [major, minor, patch] = version.split('.').map(Number);
    assert.ok(major > 2 || (major === 2 && (minor > 1 || (minor === 1 && patch >= 7))), name);
  }
});

test('the docs Node adapter rejects raw backslashes instead of rewriting protected paths', async t => {
  const app = new Hono();
  app.get('/admin/secret', c => c.text('protected fixture'));
  const get = await startServer(t, app);
  assert.equal((await get('/admin/secret')).status, 200);
  assert.equal((await get('/admin\\secret')).status, 400);
  assert.equal((await get('/public\\..\\admin/secret')).status, 400);
});

test('allowPercentInPath cannot decode around static-path middleware', async t => {
  const root = await mkdtemp(join(tmpdir(), 'refquill-node-adapter-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'static/admin'), { recursive: true });
  await writeFile(join(root, 'static/admin/secret.txt'), 'protected fixture');
  await writeFile(join(root, 'static/100%.txt'), 'literal percent fixture');
  const app = new Hono();
  app.use('/static/admin/*', c => c.text('Unauthorized', 401));
  app.use('/static/*', serveStatic({ root, allowPercentInPath: true }));
  const get = await startServer(t, app);
  assert.equal((await get('/static/admin/secret.txt')).status, 401);
  assert.deepEqual(await get('/static/100%25.txt'), { status: 200, body: 'literal percent fixture' });
  for (const path of ['/static/%%36%31dmin/secret.txt', '/static/%6%31dmin/secret.txt', '/static/%%361dmin/secret.txt']) {
    const response = await get(path);
    assert.equal(response.status, 404, path);
    assert.notEqual(response.body, 'protected fixture', path);
  }
});
