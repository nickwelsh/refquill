import { App } from './App.tsx';
import { source } from './source.ts';

export function Document({ pathname }: { pathname: string }) {
  const page = source.getPageByUrl(pathname);
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{page ? `${page.data.title} · Framework API reference` : 'Page not found'}</title>
        <link rel="stylesheet" href="/fumadocs.css" />
        <link rel="stylesheet" href="/reference.css" />
      </head>
      <body><div id="root"><App pathname={pathname} /></div></body>
    </html>
  );
}
