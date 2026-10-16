'use client';
import { useLayoutEffect, useRef, useState, useId } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'fumadocs-core/link';
import type { Folder, Node, Root } from 'fumadocs-core/page-tree';
import ChevronRight from '~icons/carbon/chevron-right';
import type { DocsSection } from '@/lib/docs-navigation';
import { Button } from '@/components/ui/button';

function contains(node: Node, path: string): boolean {
    return node.type === 'page'
        ? node.url === path
        : node.type === 'folder' &&
              (node.index?.url === path ||
                  (node.index !== undefined && path.startsWith(`${node.index.url}/`)) ||
                  node.children.some((child) => contains(child, path)));
}

function indicatorPosition(active: HTMLElement, container: HTMLElement, line: HTMLElement) {
    const bounds = container.getBoundingClientRect();
    const label = active.querySelector<HTMLElement>(':scope > span') ?? active;
    const icon = active.querySelector<SVGElement>(':scope > svg');
    const labelBounds = label.getBoundingClientRect();
    const iconBounds = icon?.getBoundingClientRect();
    const gap = iconBounds ? labelBounds.left - iconBounds.right : 10;
    return {
        x: (iconBounds ?? labelBounds).left - bounds.left - gap - line.offsetWidth,
        y: labelBounds.top - bounds.top,
    };
}

function FolderItem({
    node,
    depth,
    path,
    onNavigate,
}: {
    node: Folder;
    depth: number;
    path: string;
    onNavigate?: (() => void) | undefined;
}) {
    const active = contains(node, path);
    const [state, setState] = useState({ path, open: active || node.defaultOpen === true });
    const open = node.collapsible === false || state.open || (state.path !== path && active);
    const setOpen = (value: boolean) => setState({ path, open: value });
    const id = useId();
    return (
        <li>
            <div className="nav-folder">
                {node.index && <NavLink node={node.index} depth={depth} path={path} onNavigate={onNavigate} />}
                {!node.index && node.collapsible === false && (
                    <span className="nav-row" style={{ '--nav-depth': depth }}>
                        {node.icon}
                        <span>{node.name}</span>
                    </span>
                )}
                {!node.index && node.collapsible !== false && (
                    <Button
                        intent="plain"
                        className="nav-row nav-folder-label"
                        style={{ '--nav-depth': depth }}
                        onPress={() => setOpen(!open)}
                        aria-expanded={open}
                        aria-controls={id}
                    >
                        {node.icon}
                        <span>{node.name}</span>
                        <ChevronRight className={open ? 'nav-chevron rotate-90' : 'nav-chevron'} />
                    </Button>
                )}
                {node.index && node.collapsible !== false && (
                    <Button
                        intent="plain"
                        size="sq-sm"
                        className="nav-folder-toggle"
                        aria-label={`${open ? 'Collapse' : 'Expand'} ${typeof node.name === 'string' ? node.name : 'section'}`}
                        aria-expanded={open}
                        aria-controls={id}
                        onPress={() => setOpen(!open)}
                    >
                        <ChevronRight className={open ? 'rotate-90 transition-transform' : 'transition-transform'} />
                    </Button>
                )}
            </div>
            <ul id={id} hidden={!open}>
                <Nodes nodes={node.children} depth={depth + 1} path={path} onNavigate={onNavigate} />
            </ul>
        </li>
    );
}

function NavLink({
    node,
    depth,
    path,
    onNavigate,
}: {
    node: Extract<Node, { type: 'page' }>;
    depth: number;
    path: string;
    onNavigate?: (() => void) | undefined;
}) {
    const props = {
        className: 'nav-row nav-link',
        'aria-current': node.url === path ? ('page' as const) : undefined,
        style: { '--nav-depth': depth } as CSSProperties,
        onClick: onNavigate,
    };
    const children = (
        <>
            {node.icon}
            <span>{node.name}</span>
        </>
    );
    return node.external === true ? (
        <a href={node.url} {...props}>
            {children}
        </a>
    ) : (
        <Link href={node.url} {...props}>
            {children}
        </Link>
    );
}

function Nodes({
    nodes,
    depth,
    path,
    onNavigate,
}: {
    nodes: Array<Node>;
    depth: number;
    path: string;
    onNavigate?: (() => void) | undefined;
}) {
    return nodes.map((node, index) => {
        const key = node.$id ?? `${node.type}-${index}`;
        if (node.type === 'separator') {
            return (
                <li className="nav-section" key={key}>
                    {node.icon}
                    {node.name}
                </li>
            );
        }
        if (node.type === 'folder') {
            return <FolderItem key={key} node={node} depth={depth} path={path} onNavigate={onNavigate} />;
        }
        return (
            <li key={key}>
                <NavLink node={node} depth={depth} path={path} onNavigate={onNavigate} />
            </li>
        );
    });
}

export function Navigation({
    tree,
    path,
    sections,
    currentSection,
    onNavigate,
}: {
    tree: Root;
    path: string;
    sections: Array<DocsSection>;
    currentSection: DocsSection;
    onNavigate?: (() => void) | undefined;
}) {
    const content = useRef<HTMLDivElement>(null);
    const indicator = useRef<HTMLSpanElement>(null);
    const initialized = useRef(false);
    const animation = useRef<Animation | null>(null);
    useLayoutEffect(() => {
        const container = content.current;
        const line = indicator.current;
        if (!container || !line) {
            throw new Error('Navigation must be mounted before measuring its indicator.');
        }
        let frame = 0;
        let destination: { x: number; y: number } | null = null;
        const measure = () => {
            const active = container.querySelector<HTMLElement>('.nav-link[aria-current="page"]');
            if (!active || active.getClientRects().length === 0) {
                line.style.opacity = '0';
                return;
            }
            const row = active.getBoundingClientRect();
            const viewport = container.parentElement;
            if (viewport) {
                const view = viewport.getBoundingClientRect();
                if (row.top < view.top + 24 || row.bottom > view.bottom - 24) {
                    viewport.scrollTo({
                        top: viewport.scrollTop + row.top - view.top - viewport.clientHeight / 2 + row.height / 2,
                        behavior: globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches
                            ? 'instant'
                            : 'smooth',
                    });
                }
            }
            const { x: targetX, y: targetY } = indicatorPosition(active, container, line);
            line.style.opacity = '1';
            if (destination?.x === targetX && destination.y === targetY) {
                return;
            }
            destination = { x: targetX, y: targetY };
            const previous = new DOMMatrix(getComputedStyle(line).transform);
            animation.current?.cancel();
            line.style.transform = `translate(${targetX}px, ${targetY}px)`;
            if (initialized.current && !globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                const frames: Array<Keyframe> = [{ transform: `translate(${previous.m41}px, ${previous.m42}px)` }];
                if (targetX !== previous.m41 && targetY !== previous.m42) {
                    const outward = targetX < previous.m41;
                    frames.push({
                        transform: outward
                            ? `translate(${targetX}px, ${previous.m42}px)`
                            : `translate(${previous.m41}px, ${targetY}px)`,
                        offset: outward ? 0.35 : 0.65,
                    });
                }
                frames.push({ transform: `translate(${targetX}px, ${targetY}px)` });
                animation.current = line.animate(frames, {
                    duration: frames.length === 3 ? 300 : 240,
                    easing: 'cubic-bezier(.22,1,.36,1)',
                });
            }
            initialized.current = true;
        };
        const schedule = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(measure);
        };
        const resize = new ResizeObserver(schedule);
        resize.observe(container);
        const mutations = new MutationObserver(schedule);
        mutations.observe(container, { subtree: true, attributes: true, attributeFilter: ['hidden', 'aria-current'] });
        schedule();
        return () => {
            cancelAnimationFrame(frame);
            resize.disconnect();
            mutations.disconnect();
            animation.current?.cancel();
        };
    }, []);
    return (
        <nav className="docs-navigation" aria-label="Documentation">
            <div ref={content} className="nav-content">
                <div className="nav-shortcuts">
                    {sections.map((section) => (
                        <Link
                            key={section.id}
                            href={section.url}
                            onClick={onNavigate}
                            aria-current={section.id === currentSection.id ? 'true' : undefined}
                        >
                            {section.icon}
                            <span>{section.name}</span>
                            <ChevronRight />
                        </Link>
                    ))}
                </div>
                <div className="nav-section">{tree.name}</div>
                <span ref={indicator} className="nav-indicator" aria-hidden="true" />
                <ul>
                    <Nodes nodes={tree.children} depth={0} path={path} onNavigate={onNavigate} />
                </ul>
            </div>
        </nav>
    );
}
