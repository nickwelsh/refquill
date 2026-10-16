import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { renderToPipeableStream } from 'react-dom/server';
import { createFromSource } from 'fumadocs-core/search/server';
import { Document } from './Document.tsx';
import { reference, source, symbolUrl } from './source.ts';

const require = createRequire(import.meta.url);
const directory = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT ?? 4174);
const search = createFromSource(source);
const bundle = await build({
  absWorkingDir: directory,
  entryPoints: ['client.tsx'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  define: { 'process.env.NODE_ENV': '"development"' },
});
const assets = new Map([
  ['/client.js', { type: 'text/javascript', body: bundle.outputFiles[0].contents }],
  ['/fumadocs.css', { type: 'text/css', body: await readFile(require.resolve('fumadocs-ui/style.css')) }],
  ['/reference.css', { type: 'text/css', body: await readFile(require.resolve('@nickwelsh/refquill-fumadocs/style.css')) }],
]);

createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
    const asset = assets.get(url.pathname);
    if (asset) {
      response.writeHead(200, { 'Content-Type': asset.type });
      response.end(asset.body);
      return;
    }
    if (url.pathname === '/api/search') {
      const result = await search.GET(new Request(url));
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(await result.text());
      return;
    }
    if (url.pathname === '/') {
      response.writeHead(302, { Location: symbolUrl('Record') });
      response.end();
      return;
    }
    const page = source.getPageByUrl(url.pathname);
    const stream = renderToPipeableStream(
      <Document pathname={url.pathname} />,
      {
        bootstrapModules: ['/client.js'],
        onAllReady() {
          response.writeHead(page ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
          stream.pipe(response);
        },
        onError(error) { console.error(error); },
        onShellError(error) {
          console.error(error);
          response.writeHead(500, { 'Content-Type': 'text/plain' });
          response.end('Could not render the example; see the server terminal.');
        },
      },
    );
  } catch (error) {
    console.error(error);
    response.writeHead(500, { 'Content-Type': 'text/plain' });
    response.end('Could not render the example; see the server terminal.');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Rust Fumadocs example: http://127.0.0.1:${port}`);
  console.log(`${reference.document.symbols.length} Rust symbols, ${source.getPages().length} pages`);
});
