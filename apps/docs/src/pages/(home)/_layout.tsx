import type { ReactNode } from 'react';
import { Link } from 'fumadocs-core/link';
import { ThemeToggle } from '@/components/theme-toggle';
import { appName, githubUrl, publicPath } from '@/lib/shared';

export default function HomeLayout({ children }: { children: ReactNode }) {
    return (
        <div className="isolate flex min-h-dvh flex-col">
            <a className="skip-link" href="#main-content">
                Skip to content
            </a>
            <header className="site-header material-regular">
                <div className="mx-auto flex h-full max-w-5xl items-center justify-between gap-4 px-5 sm:px-8">
                    <Link href="/" className="site-brand" aria-label="Homepage">
                        {appName}
                    </Link>
                    <nav aria-label="Main" className="flex items-center gap-4 text-base sm:text-sm">
                        <a href={publicPath('/docs/0.x')} className="text-muted-foreground hover:text-foreground">
                            Docs
                        </a>
                        <a href={githubUrl} className="text-muted-foreground hover:text-foreground">
                            GitHub
                        </a>
                        <ThemeToggle />
                    </nav>
                </div>
            </header>
            <div className="mx-auto w-full max-w-5xl flex-1 px-5 sm:px-8">{children}</div>
            <footer className="site-footer">
                <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-5 py-6 text-base text-muted-foreground sm:px-8 sm:text-sm">
                    <Link href="/" className="site-brand">
                        {appName}
                    </Link>
                    <a href={publicPath('/llms.txt')} className="hover:text-foreground">
                        llms.txt
                    </a>
                </div>
            </footer>
        </div>
    );
}
