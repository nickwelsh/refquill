import { absoluteUrl, publicPath } from '@/lib/shared';

export default function Home() {
    const reference = '/docs/0.x';
    return (
        <main id="main-content" className="min-w-0 py-12 sm:py-20">
            <title>Refquill | API documentation from source</title>
            <meta
                name="description"
                content="Generate API documentation from PHP, TypeScript, and Rust. Publish it with Fumadocs or build on the versioned JSON contract."
            />
            <link rel="canonical" href={absoluteUrl('/')} />
            <div className="flex flex-col gap-8">
                <div>
                    <p className="mb-5 font-mono text-base text-muted-foreground sm:text-sm">PHP · TypeScript · Rust</p>
                    <h1 className="max-w-[20ch] text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
                        API documentation from your source
                    </h1>
                    <p className="mt-6 max-w-[48ch] text-lg text-pretty text-muted-foreground">
                        Refquill turns code into a versioned JSON reference. Bring it to Fumadocs, alongside JSON Schema
                        references and command manuals.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-5 text-base">
                    <a
                        href={publicPath('/docs/0.x')}
                        className="rounded-lg bg-primary px-4 py-3 font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                        Get started
                    </a>
                    <a href={publicPath(`${reference}/api`)} className="font-medium text-primary hover:underline">
                        Explore the API
                    </a>
                </div>
                <div className="min-w-0 rounded-lg border border-foreground/10 bg-muted/40 p-5">
                    <p className="mb-3 text-base font-medium">Install the CLI</p>
                    <pre className="overflow-x-auto font-mono text-base sm:text-sm">
                        <code>npm install --save-dev @nickwelsh/refquill</code>
                    </pre>
                </div>
                <div className="typeset">
                    <h2>Choose your reference</h2>
                    <ul>
                        <li>
                            <a href={publicPath(`${reference}/typescript`)}>TypeScript and UI components</a> — analyze
                            TypeScript, React, Vue, Svelte, and Solid with their compiler tools.
                        </li>
                        <li>
                            <a href={publicPath(`${reference}/php`)}>PHP</a> — document classes, interfaces, traits,
                            enums, and functions without loading application code.
                        </li>
                        <li>
                            <a href={publicPath(`${reference}/rust`)}>Rust</a> — turn rustdoc JSON into linked crate and
                            module references.
                        </li>
                        <li>
                            <a href={publicPath(`${reference}/fumadocs`)}>Fumadocs</a> — add navigation, search,
                            Markdown exports, and reference pages to your docs.
                        </li>
                    </ul>
                </div>
            </div>
        </main>
    );
}

export async function getConfig() {
    return { render: 'static' } as const;
}
