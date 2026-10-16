'use client';
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'fumadocs-core/link';
import { useRouter } from 'waku/router/client';
import GitHub from '~icons/carbon/logo-github';
import MenuIcon from '~icons/carbon/menu';
import Close from '~icons/carbon/close';
import { FocusScope } from 'react-aria/FocusScope';
import { useOverlay } from 'react-aria/useOverlay';
import { usePreventScroll } from 'react-aria/usePreventScroll';
import { Button } from '@/components/ui/button';
import { appName, githubUrl, publicPath } from '@/lib/shared';
import { ThemeToggle } from '@/components/theme-toggle';
import { Navigation } from './navigation';
import { DocsSearch } from './search';
import { getDocsPageUrl } from '@/lib/docs-navigation';
import type { DocsVersion } from '@/lib/docs-navigation';
import { SectionSelector } from './section-selector';
import { VersionSelector } from './version-selector';

function SiteControls({
    versions,
    current,
    pageUrl,
}: {
    versions: Array<DocsVersion>;
    current: DocsVersion;
    pageUrl: string;
}) {
    return (
        <>
            <a className="header-icon" href={githubUrl} target="_blank" rel="noreferrer" aria-label="GitHub repository">
                <GitHub />
            </a>
            <ThemeToggle />
            <VersionSelector versions={versions} current={current} pageUrl={pageUrl} />
        </>
    );
}

export function DocsShell({ versions, children }: { versions: Array<DocsVersion>; children: ReactNode }) {
    const { path } = useRouter();
    const [navigationOpen, setNavigationOpen] = useState(false);
    const navigationId = useId();
    const shell = useRef<HTMLDivElement>(null);
    const navigationButton = useRef<HTMLButtonElement>(null);
    const closeNavigation = () => {
        setNavigationOpen(false);
        navigationButton.current?.focus({ preventScroll: true });
    };
    const { overlayProps } = useOverlay({ isOpen: navigationOpen, onClose: closeNavigation }, shell);
    usePreventScroll({ isDisabled: !navigationOpen });
    useEffect(() => {
        const viewport = globalThis.matchMedia('(width < 768px)');
        const onChange = () => {
            if (!viewport.matches) {
                setNavigationOpen(false);
            }
        };
        viewport.addEventListener('change', onChange);
        return () => viewport.removeEventListener('change', onChange);
    }, []);
    const current =
        versions.find((version) => path === version.url || path.startsWith(`${version.url}/`)) ?? versions[0];
    if (!current) {
        throw new Error('The docs shell requires at least one documentation version.');
    }
    const pageUrl = getDocsPageUrl(current, path);
    const section = current.sections.find((item) => item.pages.includes(pageUrl)) ?? current.sections[0];
    if (!section) {
        throw new Error('The docs shell requires at least one documentation section.');
    }
    return (
        <FocusScope contain={navigationOpen}>
            <div
                {...overlayProps}
                ref={shell}
                className="docs-shell"
                data-navigation-open={navigationOpen || undefined}
            >
                <aside
                    id={navigationId}
                    className="mobile-sidebar"
                    inert={!navigationOpen}
                    aria-hidden={!navigationOpen}
                >
                    <div className="mobile-sidebar-heading">
                        {appName}
                        <span> / {section.name}</span>
                    </div>
                    <Navigation
                        tree={section.tree}
                        path={pageUrl}
                        sections={current.sections}
                        currentSection={section}
                        onNavigate={closeNavigation}
                    />
                    <div className="mobile-sidebar-footer">
                        <a className="mobile-sidebar-github" href={githubUrl} target="_blank" rel="noreferrer">
                            <GitHub />
                            GitHub
                        </a>
                        <div className="mobile-sidebar-controls">
                            <ThemeToggle />
                            <VersionSelector versions={versions} current={current} pageUrl={pageUrl} />
                        </div>
                    </div>
                </aside>
                <div className="docs-site">
                    <a className="skip-link" href="#docs-content" inert={navigationOpen}>
                        Skip to content
                    </a>
                    <header className="site-header material-regular">
                        <div className="site-header-inner site-frame">
                            <div className="header-start">
                                <Button
                                    ref={navigationButton}
                                    intent="plain"
                                    size="sq-sm"
                                    className="mobile-navigation"
                                    aria-label={navigationOpen ? 'Close navigation' : 'Open navigation'}
                                    aria-controls={navigationId}
                                    aria-expanded={navigationOpen}
                                    onPress={() => (navigationOpen ? closeNavigation() : setNavigationOpen(true))}
                                >
                                    {navigationOpen ? <Close /> : <MenuIcon />}
                                </Button>
                                <div className="header-brand" inert={navigationOpen}>
                                    <a href={publicPath('/')} className="site-brand">
                                        {appName}
                                    </a>
                                    <span className="brand-divider" aria-hidden="true">
                                        /
                                    </span>
                                    <SectionSelector sections={current.sections} current={section} />
                                </div>
                            </div>
                            <div className="header-search" inert={navigationOpen}>
                                <DocsSearch version={current.url} sections={current.searchSections} />
                            </div>
                            <div className="header-controls" inert={navigationOpen}>
                                <SiteControls versions={versions} current={current} pageUrl={pageUrl} />
                            </div>
                        </div>
                    </header>
                    <div className="site-frame docs-grid" inert={navigationOpen}>
                        <aside className="docs-sidebar">
                            <Navigation
                                tree={section.tree}
                                path={pageUrl}
                                sections={current.sections}
                                currentSection={section}
                            />
                        </aside>
                        <div className="docs-cutter cutter-left" aria-hidden="true" />
                        <div className="docs-page-slot">{children}</div>
                    </div>
                    <footer className="site-footer" inert={navigationOpen}>
                        <div className="site-frame site-footer-inner">
                            <a href={publicPath('/')} className="site-brand">
                                {appName}
                            </a>
                            <nav aria-label="Footer">
                                <Link href={current.url}>Docs</Link>
                                <a href={publicPath('/llms.txt')}>llms.txt</a>
                                <a href={githubUrl} target="_blank" rel="noreferrer">
                                    GitHub
                                </a>
                            </nav>
                        </div>
                    </footer>
                </div>
            </div>
        </FocusScope>
    );
}
