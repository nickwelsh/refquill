'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TableOfContents } from 'fumadocs-core/toc';

export function TableOfContentsNav({ toc }: { toc: TableOfContents }) {
    const list = useRef<HTMLUListElement>(null);
    const [visible, setVisible] = useState<Array<number>>([]);
    const indicator = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        const headings = toc.map((item) => {
            const id = decodeURIComponent(item.url.slice(1));
            return document.querySelector(`#${CSS.escape(id)}`);
        });
        const article = document.querySelector<HTMLElement>('.docs-article');
        let frame = 0;
        let previous = '';
        const measure = () => {
            const top = (document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? 60) + 24;
            const bottom = globalThis.innerHeight;
            const positions = headings.map((heading) => heading?.getBoundingClientRect().top ?? Infinity);
            const end = article?.getBoundingClientRect().bottom ?? Infinity;
            const active = positions.flatMap((start, index) =>
                start < bottom && (positions[index + 1] ?? end) > top ? [index] : [],
            );
            const key = active.join(',');
            if (key !== previous) {
                previous = key;
                setVisible(active);
            }
        };
        const schedule = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(measure);
        };
        globalThis.addEventListener('scroll', schedule, { passive: true });
        globalThis.addEventListener('resize', schedule);
        const observer = new ResizeObserver(schedule);
        if (article) {
            observer.observe(article);
        }
        schedule();
        return () => {
            cancelAnimationFrame(frame);
            globalThis.removeEventListener('scroll', schedule);
            globalThis.removeEventListener('resize', schedule);
            observer.disconnect();
        };
    }, [toc]);
    useLayoutEffect(() => {
        const element = list.current;
        const measure = () => {
            if (!element) {
                return;
            }
            const rows = element.querySelectorAll<HTMLElement>('li');
            const first = rows[visible[0] ?? -1];
            const last = rows[visible.at(-1) ?? -1];
            const line = indicator.current;
            if (!line) {
                return;
            }
            if (!first || !last || element.getClientRects().length === 0) {
                line.style.height = '0px';
                return;
            }
            line.style.transform = `translateY(${first.offsetTop + 4}px)`;
            line.style.height = `${last.offsetTop + last.offsetHeight - first.offsetTop - 8}px`;
            const container = element.closest('.toc-scroll');
            if (container) {
                const row = first.getBoundingClientRect();
                const bounds = container.getBoundingClientRect();
                if (row.top < bounds.top || row.bottom > bounds.bottom) {
                    container.scrollTo({
                        top: container.scrollTop + row.top - bounds.top - 24,
                        behavior: globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches
                            ? 'instant'
                            : 'smooth',
                    });
                }
            }
        };
        const observer = new ResizeObserver(measure);
        if (element) {
            observer.observe(element);
        }
        measure();
        return () => observer.disconnect();
    }, [visible]);
    if (toc.length === 0) {
        return null;
    }
    const minDepth = Math.min(...toc.map((item) => item.depth));
    return (
        <nav aria-label="On this page" className="toc-scroll">
            <h2>On this page</h2>
            <div className="toc-list">
                <span className="toc-indicator" aria-hidden="true" ref={indicator} />
                <ul ref={list}>
                    {toc.map((item, index) => (
                        <li key={item.url}>
                            <a
                                href={item.url}
                                data-active={visible.includes(index)}
                                aria-current={visible.includes(index) ? 'location' : undefined}
                                style={{ paddingLeft: 24 + (item.depth - minDepth) * 12 }}
                            >
                                {item.title}
                            </a>
                        </li>
                    ))}
                </ul>
            </div>
        </nav>
    );
}
