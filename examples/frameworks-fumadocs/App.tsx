import { FrameworkProvider } from 'fumadocs-core/framework';
import { RootProvider } from 'fumadocs-ui/provider/base';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { DocsBody, DocsPage } from 'fumadocs-ui/page';
import { ApiReference } from '@nickwelsh/refquill-fumadocs/components';
import { reference, source, symbolUrl, pageTree } from './source.ts';

// This small example uses ordinary browser navigation instead of requiring a
// particular application router. A framework app can use its Fumadocs provider.
export function App({ pathname }: { pathname: string }) {
  const page = source.getPageByUrl(pathname);
  if (!page) return <main><h1>Page not found</h1><a href={symbolUrl('Badge')}>Open the framework reference</a></main>;

  return (
    <FrameworkProvider
      usePathname={() => pathname}
      useParams={() => ({ slug: pathname.split('/').filter(Boolean) })}
      useRouter={() => ({ push: url => { window.location.assign(url); }, refresh: () => { window.location.reload(); } })}
    >
      <RootProvider search={{ options: { api: '/api/search' } }}>
        <DocsLayout
          tree={pageTree}
          nav={{ title: 'Refquill · Frameworks', url: symbolUrl('Badge') }}
          links={['Badge', 'VueCard', 'SvelteCard', 'SolidBadge'].map(name => ({ text: name, url: symbolUrl(name) }))}
          tabs={false}
        >
          <DocsPage full toc={page.data.toc} tableOfContent={{ enabled: false }}>
            <DocsBody>
              <ApiReference reference={reference} symbolId={page.data.symbolId} inputName={page.data.inputName} namespace={page.data.namespace} />
            </DocsBody>
          </DocsPage>
        </DocsLayout>
      </RootProvider>
    </FrameworkProvider>
  );
}
